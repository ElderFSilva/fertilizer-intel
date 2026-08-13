// ── Ask the Desk: on-demand advisor for the admin ──
// Same brain as the weekly analysis — same computed signals, desk history,
// track record and lessons — shaped for questions instead of reports.
// Advises only; never writes data. Every Q&A is logged to advisor_log.

import { supabase } from './supabaseClient.js'
import { buildMarketContext } from './marketSignals.js'
import { buildDeskContext } from './deskSignals.js'
import { buildTrackRecord, trackRecordText, buildLessonsText } from './learningLoop.js'

const ADVISOR_SYSTEM = `You are the senior market advisor for a Brazilian Amsul (ammonium sulphate) trading desk, answering the desk head's questions directly.

You receive, freshly computed for every question: external market signals (composite prices, import parity on the desk's own Panamax contract freight, N-unit spread with its empirical distribution, three supply lenses, barter, purchase progress, FX), the desk's internal record (recent calls, open demand, execution capture vs the published market), the system's own graded track record, and desk lessons.

HARD RULES (identical to the weekly analysis - never break them):
- Computed values are AUTHORITATIVE: copy directions, spreads, percentiles and comparisons from the context; never re-derive or invent numbers.
- SUPPLY HAS THREE LENSES (Agrinvest pace, Argus line-up, Siacesp actuals): compare each only within its own source; never sum or cross-compare.
- GRADE DISCIPLINE: "Amsul GR" = "Amsul compacted" (same product); "Amsul STD"/standard is a DIFFERENT product. Never compare prices across grades; unknown-grade offers are flagged, not assumed.
- CALENDAR: composites are same-market-week only (Argus/Fertecon Thu + Agrinvest Fri); Friday-dated weekly data entered Monday is the same week, not stale; absent sources are "pending" when on normal schedule.
- Import parity uses the desk's OWN contract freight, never published freight.
- Comparisons to prior periods always name the exact period ("vs June 2025"), and a single-month figure never appears without its year-to-date companion.
- Sample-size honesty: where the context flags weak evidence, say so and soften the conclusion. If the data does not answer the question, say exactly that - never improvise.
- DESK LESSONS are established desk knowledge; apply them, and if current data contradicts one, flag the tension explicitly.

HOW TO ANSWER:
- Lead with the direct answer in one or two sentences - the way a trusted senior colleague would say it on the desk. Then give the numbers behind it, each traceable to the context.
- Plain desk language: short sentences, translate jargon inline ("higher than 2 of every 3 weeks since 2020", "what it costs us to bring in fresh cargo today"). Keep every figure precise.
- You ADVISE only. You cannot execute, change data, or see anything beyond the provided context. If asked to act, say the decision and the action belong to the desk.
- Price/positioning questions: judge against replacement cost, the composite, percentile, open demand and the desk's own execution capture - and state what would change your answer.
- If the question is about the future beyond what signals support, give the honest frame (what the data leans toward, at what confidence) - never a prediction dressed as fact.`

// Compact digest of the most recent calls (advisor-sized, not the full archive)
function recentCallsDigest(calls, limit = 15) {
  const parse = d => new Date(String(d || '').slice(0, 10) + 'T00:00:00').getTime() || 0
  const recent = [...(calls || [])].sort((a, b) => parse(b.date) - parse(a.date)).slice(0, limit)
  if (!recent.length) return 'No calls logged.'
  return recent.map(c => {
    const prices = Object.entries(c.prices || {})
      .filter(([, v]) => v.value)
      .map(([k, v]) => `${v.grade || k}: ${v.value}${v.trend && v.trend !== 'none' ? ` (${v.trend})` : ''}`)
      .join(', ')
    const demand = (c.demandRows || [])
      .filter(r => r.product || r.volume)
      .map(r => `${r.product || '?'} ${r.volume || '?'}t${r.priceTarget ? ' target ' + r.priceTarget : ''}`)
      .join('; ')
    const comp = (c.competitorOffers || [])
      .filter(o => o.competitor || o.price)
      .map(o => `${o.competitor || '?'} ${o.product || '?'} at ${o.price || '?'}`)
      .join('; ')
    const parts = [`[${c.date}] ${c.client}`]
    if (prices) parts.push(`prices: ${prices}`)
    if (demand) parts.push(`demand: ${demand}`)
    if (comp) parts.push(`competitors: ${comp}`)
    if (c.remarks) parts.push(`remarks: ${c.remarks}`)
    return parts.join(' | ')
  }).join('\n')
}

async function buildAdvisorContext(calls, sales, scope) {
  const [market, desk, record, lessons] = await Promise.all([
    buildMarketContext().catch(() => 'Market data unavailable.'),
    buildDeskContext(calls, sales).catch(() => 'Desk history unavailable.'),
    buildTrackRecord(scope).catch(() => null),
    buildLessonsText().catch(() => ''),
  ])
  const parts = [
    '## MARKET CONTEXT (computed indicators)', market,
    '## DESK HISTORY (computed from calls & sales)', desk,
    '## RECENT CALLS (newest first)', recentCallsDigest(calls),
    '## SYSTEM TRACK RECORD', trackRecordText(record),
  ]
  if (lessons) parts.push('## DESK LESSONS', lessons)
  return parts.join('\n\n')
}


// Retry transient API failures (overloaded/rate-limited) before giving up:
// up to 2 retries with 20s/30s waits — most 529s clear on the next attempt.
async function fetchWithRetry(url, options, retries = 2) {
  const delays = [20000, 30000]
  for (let attempt = 0; ; attempt++) {
    let response
    try {
      response = await fetch(url, options)
    } catch (e) {
      if (attempt >= retries) throw e
      await new Promise(r => setTimeout(r, delays[Math.min(attempt, delays.length - 1)]))
      continue
    }
    if ((response.status === 529 || response.status === 429) && attempt < retries) {
      await new Promise(r => setTimeout(r, delays[Math.min(attempt, delays.length - 1)]))
      continue
    }
    return response
  }
}

// Ask a question. history = [{ role: 'user'|'assistant', content }] from this session.
export async function askAdvisor(question, history, calls, sales, scope) {
  const context = await buildAdvisorContext(calls, sales, scope)
  const messages = [
    ...(history || []).slice(-10).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: question },
  ]
  const response = await fetchWithRetry('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-fable-5',
      max_tokens: 1500,
      system: `${ADVISOR_SYSTEM}\n\n═══ CURRENT DESK CONTEXT (freshly computed for this question) ═══\n\n${context}`,
      messages,
    }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    const detail = typeof err.error === 'string' ? err.error
      : err.error ? JSON.stringify(err.error)
      : err.message || JSON.stringify(err)
    throw new Error(`API ${response.status}: ${detail}`)
  }
  const data = await response.json()
  const answer = (data.content || []).map(b => b.text || '').join('').trim()
  if (!answer) throw new Error('Empty answer from the advisor')

  // Log the exchange (best-effort; never blocks the answer)
  try {
    await supabase.from('advisor_log').insert({ scope: scope || 'global', question, answer })
  } catch { /* logging must never break the chat */ }

  return answer
}
