import { pino } from 'pino'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRedisClients, type RedisClients } from '../../src/db/redis.js'

const redisUrl = process.env.REDIS_URL

if (!redisUrl) {
  console.warn('Skipping Redis client tests: REDIS_URL must be set.')
}

describe.skipIf(!redisUrl)('redis clients against real Redis', () => {
  let redis: RedisClients
  let healthyBeforeConnect: boolean

  beforeAll(async () => {
    redis = createRedisClients(redisUrl ?? '', pino({ level: 'silent' }))
    healthyBeforeConnect = redis.isHealthy()
    await redis.connect()
  })

  afterAll(async () => {
    await redis.disconnect()
  })

  it('creates a publisher and a subscriber that are separate from the command client', async () => {
    const { client } = redis
    const { pubClient, subClient } = redis.adapterClients

    expect(new Set([client, pubClient, subClient]).size).toBe(3)
    expect(await client.ping()).toBe('PONG')
    expect(await pubClient.ping()).toBe('PONG')
    expect(await subClient.ping()).toBe('PONG')
  })

  it('reports healthy after connecting and not sooner', () => {
    expect(healthyBeforeConnect).toBe(false)
    expect(redis.isHealthy()).toBe(true)
  })

  it('stops sending broadcasts while Redis is down instead of queueing them', () => {
    expect(redis.adapterClients.pubClient.options?.disableOfflineQueue).toBe(true)
    // The command client keeps queueing so a brief blip does not fail readiness pings mid-flight.
    expect(redis.client.options?.disableOfflineQueue).not.toBe(true)
  })

  // Simulated with emitted events: proves the transition logic, not detection of a real outage.
  it('notifies listeners only on health transitions', () => {
    const seen: boolean[] = []
    const unsubscribe = redis.onStatusChange((healthy) => seen.push(healthy))

    redis.client.emit('error', new Error('x'))
    redis.client.emit('error', new Error('x'))
    expect(seen).toEqual([false])
    expect(redis.isHealthy()).toBe(false)

    redis.client.emit('ready')
    redis.client.emit('ready')
    expect(seen).toEqual([false, true])
    expect(redis.isHealthy()).toBe(true)

    unsubscribe()
    redis.client.emit('error', new Error('x'))
    expect(seen).toEqual([false, true])
    redis.client.emit('ready')
  })

  it('disconnects all three clients and returns without throwing', async () => {
    const { client } = redis
    const { pubClient, subClient } = redis.adapterClients

    await expect(redis.disconnect()).resolves.toBeUndefined()
    expect([client.isOpen, pubClient.isOpen, subClient.isOpen]).toEqual([false, false, false])
    expect(redis.isHealthy()).toBe(false)
    await expect(redis.disconnect()).resolves.toBeUndefined()
  })
})
