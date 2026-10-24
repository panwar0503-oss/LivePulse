import type { Express } from 'express'
import type { Sequelize } from 'sequelize'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildTestApp, createTestSequelize, WEB_ORIGIN } from '../helpers/test-app.js'
import { truncateAll } from '../helpers/truncate.js'

type Created = { sessionId: string; roomCode: string; presenterKey: string }

describe('joining a session', () => {
  let sequelize: Sequelize
  let app: Express

  const createSession = async (
    title = 'Town hall',
  ): Promise<{ presenter: ReturnType<typeof request.agent> } & Created> => {
    const presenter = request.agent(app)
    const res = await presenter.post('/api/sessions').set('Origin', WEB_ORIGIN).send({ title })
    expect(res.status).toBe(201)
    return { presenter, ...(res.body.data as Created) }
  }

  beforeAll(() => {
    sequelize = createTestSequelize()
  })

  beforeEach(async () => {
    await truncateAll(sequelize)
    app = buildTestApp(sequelize)
  })

  afterAll(async () => {
    await sequelize.close()
  })

  it('two browsers join the same session with different names', async () => {
    const { roomCode } = await createSession()
    const ana = request.agent(app)
    const ben = request.agent(app)

    const first = await ana.post(`/api/sessions/by-code/${roomCode}/join`).send({ displayName: ' Ana ' })
    const second = await ben.post(`/api/sessions/by-code/${roomCode}/join`).send({ displayName: 'Ben' })

    expect(first.status).toBe(201)
    expect(first.body.data).toEqual({
      participant: { displayName: 'Ana' },
      session: { title: 'Town hall', status: 'ACTIVE', roomCode },
    })
    expect(second.status).toBe(201)
    expect(second.body.data.participant).toEqual({ displayName: 'Ben' })

    const cookie = (first.headers['set-cookie'] as unknown as string[])[0] ?? ''
    expect(cookie).toMatch(/^lp_participant_[0-9a-f-]{36}=/)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/api')

    expect((await ana.get(`/api/sessions/by-code/${roomCode}/participant-me`)).body.data.participant).toEqual(
      {
        displayName: 'Ana',
      },
    )
    expect((await ben.get(`/api/sessions/by-code/${roomCode}/participant-me`)).body.data.participant).toEqual(
      {
        displayName: 'Ben',
      },
    )
  })

  it('refreshing keeps the same identity; a cookie-less browser gets 401 on participant-me; a second join with the same cookie returns 200 with created false', async () => {
    const { roomCode } = await createSession()
    const ana = request.agent(app)
    await ana.post(`/api/sessions/by-code/${roomCode}/join`).send({ displayName: 'Ana' })

    const refreshed = await ana.get(`/api/sessions/by-code/${roomCode.toLowerCase()}/participant-me`)
    expect(refreshed.status).toBe(200)
    expect(refreshed.body.data).toEqual({
      participant: { displayName: 'Ana' },
      session: { title: 'Town hall', status: 'ACTIVE', roomCode },
    })

    const stranger = await request(app).get(`/api/sessions/by-code/${roomCode}/participant-me`)
    expect(stranger.status).toBe(401)
    expect(stranger.body.error.code).toBe('PARTICIPANT_AUTH_REQUIRED')

    const again = await ana.post(`/api/sessions/by-code/${roomCode}/join`).send({ displayName: 'Ana again' })
    expect(again.status).toBe(200)
    expect(again.body.data.participant).toEqual({ displayName: 'Ana' })
    expect(again.headers['set-cookie']).toBeUndefined()
  })

  it('the dashboard count is 2 after two people join', async () => {
    const { presenter, sessionId, roomCode } = await createSession()
    const ana = request.agent(app)
    await ana.post(`/api/sessions/by-code/${roomCode}/join`).send({ displayName: 'Ana' })
    await ana.post(`/api/sessions/by-code/${roomCode}/join`).send({ displayName: 'Ana' })
    await request(app).post(`/api/sessions/by-code/${roomCode}/join`).send({ displayName: 'Ben' })

    const dashboard = await presenter.get(`/api/sessions/${sessionId}`)

    expect(dashboard.status).toBe(200)
    expect(dashboard.body.data.participantCount).toBe(2)
  })

  it('after ending, join is refused with the same message as an unknown code, and ending again changes nothing', async () => {
    const { presenter, sessionId, roomCode } = await createSession()
    const ana = request.agent(app)
    await ana.post(`/api/sessions/by-code/${roomCode}/join`).send({ displayName: 'Ana' })

    const ended = await presenter.post(`/api/sessions/${sessionId}/end`).set('Origin', WEB_ORIGIN)
    expect(ended.status).toBe(200)
    expect(ended.body.data.status).toBe('ENDED')
    expect(ended.body.data.participantCount).toBe(1)

    const refused = await request(app)
      .post(`/api/sessions/by-code/${roomCode}/join`)
      .send({ displayName: 'Ben' })
    const unknown = await request(app).post('/api/sessions/by-code/ZZZZZZ/join').send({ displayName: 'Ben' })
    expect(refused.status).toBe(404)
    expect(unknown.status).toBe(404)
    expect(refused.body.error.code).toBe('SESSION_NOT_OPEN')
    // Identical apart from the per-request id, so a guesser cannot tell ended from unknown.
    expect({ ...refused.body.error, requestId: 'x' }).toEqual({ ...unknown.body.error, requestId: 'x' })

    const endedAgain = await presenter.post(`/api/sessions/${sessionId}/end`)
    expect(endedAgain.status).toBe(200)
    expect(endedAgain.body.data).toEqual(ended.body.data)

    // The public lookup and an existing participant both see the ended state.
    expect((await request(app).get(`/api/sessions/by-code/${roomCode}`)).body.data.status).toBe('ENDED')
    expect((await ana.get(`/api/sessions/by-code/${roomCode}/participant-me`)).body.data.session.status).toBe(
      'ENDED',
    )
  })

  it('only the presenter can end a session', async () => {
    const { sessionId } = await createSession()

    const res = await request(app).post(`/api/sessions/${sessionId}/end`)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('PRESENTER_AUTH_REQUIRED')
  })

  it('a participant identity from one session is rejected by another session', async () => {
    const a = await createSession('Session A')
    const b = await createSession('Session B')
    const joined = await request(app)
      .post(`/api/sessions/by-code/${a.roomCode}/join`)
      .send({ displayName: 'Ana' })
    const setCookie = (joined.headers['set-cookie'] as unknown as string[])[0] ?? ''
    const tokenA = /^lp_participant_[0-9a-f-]{36}=([^;]+);/.exec(setCookie)?.[1] ?? ''
    expect(tokenA.length).toBeGreaterThan(20)

    const own = await request(app)
      .get(`/api/sessions/by-code/${a.roomCode}/participant-me`)
      .set('Cookie', `lp_participant_${a.sessionId}=${tokenA}`)
    expect(own.status).toBe(200)

    // Replay A's token under B's cookie name: the token belongs to A, so B refuses it.
    const res = await request(app)
      .get(`/api/sessions/by-code/${b.roomCode}/participant-me`)
      .set('Cookie', `lp_participant_${b.sessionId}=${tokenA}`)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('PARTICIPANT_AUTH_REQUIRED')
  })

  it('rejects an empty display name and a join sent from a foreign site', async () => {
    const { roomCode } = await createSession()

    const empty = await request(app)
      .post(`/api/sessions/by-code/${roomCode}/join`)
      .send({ displayName: '   ' })
    expect(empty.status).toBe(400)
    expect(empty.body.error.details).toEqual([
      { field: 'displayName', message: 'Display name must be 1–30 characters.' },
    ])

    const foreign = await request(app)
      .post(`/api/sessions/by-code/${roomCode}/join`)
      .set('Origin', 'http://evil.example')
      .send({ displayName: 'Ana' })
    expect(foreign.status).toBe(403)
    expect(foreign.body.error.code).toBe('FORBIDDEN_ORIGIN')
  })
})
