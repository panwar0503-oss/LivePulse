import type { Request, RequestHandler } from 'express'
import { AppError } from '../errors/app-error.js'

type Entry = { count: number; resetAt: number }

const PRUNE_THRESHOLD = 10_000

type RateLimiterOptions = {
  name: string
  limit: number
  windowMs: number
  now?: () => number
  keyOf?: (req: Request) => string
}

// Counters live in this process only: with several instances each keeps its own count.
// A shared store (Redis) replaces this when the API runs as more than one instance.
export const createRateLimiter = (options: RateLimiterOptions): RequestHandler => {
  const { name, limit, windowMs, now = Date.now, keyOf } = options
  const entries = new Map<string, Entry>()

  return (req, res, next) => {
    const time = now()
    if (entries.size > PRUNE_THRESHOLD) {
      for (const [key, entry] of entries) {
        if (entry.resetAt <= time) entries.delete(key)
      }
    }

    const key = `${name}:${keyOf?.(req) ?? req.ip ?? 'unknown'}`
    let entry = entries.get(key)
    if (!entry || entry.resetAt <= time) {
      entry = { count: 0, resetAt: time + windowMs }
      entries.set(key, entry)
    }
    entry.count += 1

    if (entry.count > limit) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - time) / 1000))))
      next(new AppError(429, 'RATE_LIMITED', 'Too many attempts, try again shortly.'))
      return
    }
    next()
  }
}
