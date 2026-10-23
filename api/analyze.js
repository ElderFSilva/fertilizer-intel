// Vercel serverless function — proxies AI analysis requests to Anthropic.
// Security (2026-10-23): caller must be a logged-in FertIntel user (Supabase
// session token verified server-side); body reduced to the app's own shape;
// per-user rate limit; generic errors to the client, details in the server log.
import { verifyUser, sanitizeBody, rateLimited } from './_auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Prefer the server-only name; fall back to the legacy VITE_ name until the
  // Vercel setting is renamed (never referenced from the browser bundle).
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'AI service not configured' })

  const user = await verifyUser(req)
  if (!user) return res.status(401).json({ error: 'Sign in required' })
  if (rateLimited(user.id)) return res.status(429).json({ error: 'Too many requests - try again in a few minutes' })

  const checked = sanitizeBody(req.body)
  if (!checked.ok) {
    console.warn('analyze: rejected body', user.email || user.id, checked.reason)
    return res.status(400).json({ error: 'Invalid request' })
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(checked.body),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      console.error('analyze: upstream', response.status, JSON.stringify(data).slice(0, 500))
      // Pass through only the statuses the client retries on; everything else is generic.
      const status = response.status === 429 || response.status === 529 ? response.status : 502
      return res.status(status).json({ error: status === 502 ? 'AI service error' : 'AI service busy' })
    }
    return res.status(200).json(data)
  } catch (err) {
    console.error('analyze: proxy failure', String(err))
    return res.status(502).json({ error: 'AI service unreachable' })
  }
}
