import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it } from 'vitest'
import { LivePulseApiError, type HttpMethod, type LivePulseClient } from './livepulse-client.js'
import { createLivePulseMcpServer, UNTRUSTED_NOTE } from './tools.js'

const SESSION_ID = '11111111-1111-4111-8111-111111111111'
const JOB_ID = '22222222-2222-4222-8222-222222222222'

type Call = { method: HttpMethod; path: string; body?: unknown }

const fakeClient = (respond: (call: Call) => unknown): { client: LivePulseClient; calls: Call[] } => {
  const calls: Call[] = []
  return {
    calls,
    client: {
      sessionId: SESSION_ID,
      request: async (method, path, body) => {
        const call = { method, path, body }
        calls.push(call)
        return respond(call)
      },
    },
  }
}

const closers: (() => Promise<void>)[] = []

const connect = async (
  client: LivePulseClient,
  timing: { suggestPollIntervalMs?: number; suggestTimeoutMs?: number } = {},
): Promise<Client> => {
  const server = createLivePulseMcpServer({ client, ...timing })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const mcp = new Client({ name: 'test', version: '0.0.0' })
  await Promise.all([server.connect(serverSide), mcp.connect(clientSide)])
  closers.push(async () => {
    await mcp.close()
    await server.close()
  })
  return mcp
}

const textOf = (result: unknown): string =>
  (result as CallToolResult).content.map((c) => (c.type === 'text' ? c.text : '')).join('\n')

afterEach(async () => {
  for (const close of closers.splice(0)) await close()
})

describe('MCP tools', () => {
  it('the MCP directory never imports models, sequelize or services', () => {
    const dir = dirname(fileURLToPath(import.meta.url))
    const sources = readdirSync(dir).filter((name) => name.endsWith('.ts'))
    expect(sources).toContain('tools.ts')
    const forbidden = /from\s+['"]([^'"]*\/(models|services)\/[^'"]*|sequelize|pg)['"]/
    for (const name of sources.filter((n) => !n.endsWith('.test.ts'))) {
      const imports = readFileSync(join(dir, name), 'utf8')
        .split('\n')
        .filter((line) => /^\s*(import|export)\b.*\bfrom\b/.test(line))
      for (const line of imports) expect(line, `${name}: ${line}`).not.toMatch(forbidden)
    }
  })

  it('suggest_polls reports PENDING with the job id when the suggestions are not ready in time', async () => {
    const { client, calls } = fakeClient(({ method }) =>
      method === 'POST'
        ? { jobId: JOB_ID, status: 'PENDING', created: true }
        : {
            jobId: JOB_ID,
            status: 'PENDING',
            errorCode: null,
            message: null,
            outcome: 'PENDING',
            suggestions: [],
          },
    )
    const mcp = await connect(client, { suggestPollIntervalMs: 5, suggestTimeoutMs: 40 })

    const result = await mcp.callTool({ name: 'suggest_polls', arguments: {} })

    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain(UNTRUSTED_NOTE)
    expect(JSON.parse(textOf(result).replace(UNTRUSTED_NOTE, ''))).toEqual({
      status: 'PENDING',
      jobId: JOB_ID,
    })
    expect(calls[0]).toEqual({ method: 'POST', path: `/sessions/${SESSION_ID}/poll-suggestions`, body: {} })
    expect(calls.slice(1).every((c) => c.path === `/sessions/${SESSION_ID}/poll-suggestions/${JOB_ID}`)).toBe(
      true,
    )
  })

  it('suggest_polls returns the suggestions once the job is ready', async () => {
    const ready = {
      jobId: JOB_ID,
      status: 'SUCCEEDED',
      errorCode: null,
      message: null,
      outcome: 'NONE',
      suggestions: [],
    }
    const { client } = fakeClient(({ method }) =>
      method === 'POST' ? { jobId: JOB_ID, status: 'PENDING', created: true } : ready,
    )
    const mcp = await connect(client, { suggestPollIntervalMs: 5, suggestTimeoutMs: 1000 })

    const result = await mcp.callTool({ name: 'suggest_polls', arguments: {} })

    expect(JSON.parse(textOf(result).replace(UNTRUSTED_NOTE, ''))).toEqual(ready)
  })

  it('an unexpected failure is reported without its details', async () => {
    const { client } = fakeClient(() => {
      throw new Error('socket hang up at 10.0.0.1 cookie=lp_presenter_x')
    })
    const mcp = await connect(client)

    const result = await mcp.callTool({ name: 'get_session_report', arguments: {} })

    expect(result.isError).toBe(true)
    expect(JSON.parse(textOf(result))).toEqual({
      code: 'MCP_TOOL_FAILED',
      message: 'The tool failed unexpectedly.',
    })
  })

  it('an API error is reported as its code and message', async () => {
    const { client } = fakeClient(() => {
      throw new LivePulseApiError('SESSION_ENDED', 'This session has ended.', 409)
    })
    const mcp = await connect(client)

    const result = await mcp.callTool({ name: 'list_questions', arguments: {} })

    expect(result.isError).toBe(true)
    expect(JSON.parse(textOf(result))).toEqual({ code: 'SESSION_ENDED', message: 'This session has ended.' })
  })

  it('a tool refuses a session id or any other extra input', async () => {
    const { client, calls } = fakeClient(() => ({}))
    const mcp = await connect(client)

    const report = await mcp.callTool({ name: 'get_session_report', arguments: { sessionId: SESSION_ID } })
    const start = await mcp.callTool({
      name: 'propose_start_poll',
      arguments: { pollId: JOB_ID, sessionId: SESSION_ID },
    })

    expect(report.isError).toBe(true)
    expect(start.isError).toBe(true)
    expect(calls).toEqual([])
  })
})
