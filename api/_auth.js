// ── Server-side guard for the AI proxy (security fix 2026-10-23) ──
// Every request to /api/analyze must carry the caller's Supabase session
// token. It is verified against Supabase before anything is forwarded to
// Anthropic, the body is reduced to the exact shape the app sends, and each
// user is rate-limited. Nothing here is reachable as a route (underscore file).

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://llnweyexrqpygpmrqgfr.supabase.co'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsbndleWV4cnFweWdwbXJxZ2ZyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MjIzNjAsImV4cCI6MjA5ODk5ODM2MH0.v5S9RmFgQf5_7_JM6sYMTrd-gcc6tXnlyGIAibG86gg'

export const ALLOWED_MODELS = new Set(['claude-fable-5'])
export const MAX_TOKENS_CAP = 9000
export const MAX_MESSAGES = 12
export const MAX_BODY_BYTES = 600_000       // the weekly analysis prompt is large, but bounded
export const RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 40 }   // per user, per serverless instance

// Verify the bearer token with Supabase Auth. Returns { id, email } or null.
export async function verifyUser(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || ''
  const m = /^Bearer\s+(.+)$/i.exec(h)
  if (!m) return null
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${m[1]}` },
    })
    if (!r.ok) return null
    const u = await r.json()
    return u && u.id ? { id: u.id, email: u.email || null } : null
  } catch { return null }
}

// Reduce the body to the fields the app sends; reject anything else.
// Returns { ok: true, body } or { ok: false, reason }.
export function sanitizeBody(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'bad body' }
  const size = Buffer.byteLength(JSON.stringify(raw))
  if (size > MAX_BODY_BYTES) return { ok: false, reason: 'body too large' }
  const { model, max_tokens, system, messages } = raw
  if (!ALLOWED_MODELS.has(model)) return { ok: false, reason: 'model not allowed' }
  const mt = Number(max_tokens)
  if (!Number.isInteger(mt) || mt < 1 || mt > MAX_TOKENS_CAP) return { ok: false, reason: 'max_tokens out of range' }
  if (system != null && typeof system !== 'string') return { ok: false, reason: 'bad system' }
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) return { ok: false, reason: 'bad messages' }
  for (const msg of messages) {
    if (!msg || (msg.role !== 'user' && msg.role !== 'assistant') || typeof msg.content !== 'string') return { ok: false, reason: 'bad message' }
  }
  const body = { model, max_tokens: mt, messages: messages.map(m => ({ role: m.role, content: m.content })) }
  if (system) body.system = system
  return { ok: true, body }
}

// Per-user rate limit. Serverless instances are short-lived, so this is a
// soft ceiling, not an accounting system - it stops loops and scripts.
const hits = new Map()
export function rateLimited(userId) {
  const now = Date.now()
  const arr = (hits.get(userId) || []).filter(t => now - t < RATE_LIMIT.windowMs)
  if (arr.length >= RATE_LIMIT.max) { hits.set(userId, arr); return true }
  arr.push(now); hits.set(userId, arr)
  return false
}
