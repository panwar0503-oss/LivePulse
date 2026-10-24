import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** A random 256-bit token, base64url-encoded (43 characters). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

// A fast hash (no salt/stretching) is safe: tokens carry 256 bits of entropy, so brute force is infeasible.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Constant-time comparison of two hex hashes. Lengths are not secret, so a length mismatch returns early. */
export function safeEqualHash(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
