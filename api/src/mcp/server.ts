import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { destination, pino } from 'pino'
import { loadMcpEnv, type McpEnv } from './env.js'
import { createLivePulseClient } from './livepulse-client.js'
import { createLivePulseMcpServer } from './tools.js'

// stdout is the MCP protocol channel: every log line goes to stderr (fd 2), never console.log.
const logger = pino({ name: 'livepulse-mcp', level: 'info' }, destination(2))

const main = async (): Promise<void> => {
  let env: McpEnv
  try {
    env = loadMcpEnv()
  } catch (error) {
    // loadMcpEnv names the variables only; no value is ever printed.
    const reason = error instanceof Error ? error.message : 'Invalid MCP configuration'
    process.stderr.write(`livepulse-mcp: ${reason}\n`)
    process.exitCode = 1
    return
  }

  const client = createLivePulseClient({ ...env, logger })
  const server = createLivePulseMcpServer({ client })
  await server.connect(new StdioServerTransport())
  logger.info({ sessionId: env.sessionId }, 'livepulse mcp server ready')
}

main().catch((error: unknown) => {
  logger.error({ err: error instanceof Error ? error.message : 'unknown' }, 'livepulse mcp server failed')
  process.exitCode = 1
})
