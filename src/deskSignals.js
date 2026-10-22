// ── Desk signals: computed intelligence from the FULL internal history ──
// Closes the two gaps: (1) past weeks' calls were invisible to the AI,
// (2) realized sales were never compared against the market benchmark.
// Same philosophy as marketSignals: code does the arithmetic, the AI
// only interprets pre-computed, authoritative facts.

import { loadMarketRows } from './cloudMarketData.js'
import { canonicalDemands, ACTIVE_DAYS as DEMAND_ACTIVE_DAYS } from './demands.js'

const ymd = v => String(v).slice(0, 10)
const dayMs = 86400000
const daysAgo = v => Math.floor((Date.now() - new Date(ymd(v) + 'T00:00:00').getTime()) / dayMs)
const num = v => {
  if (v == null || v === '') return null
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '').split('-')[0])
  return isNaN(n) ? null : n
}
// range-aware: "470-510" -> 490
const priceNum = v => {
  if (v == null || v === '') return null
  const raw = String(v).replace(/[^0-9.\-]/g, '')
  if (raw.includes('-')) {
    const parts = raw.split('-').map(Number).filter(n => !isNaN(n) && n > 0)
    if (parts.length === 2) return (parts[0] + parts[1]) / 2
  }
  const p = parseFloat(raw)
  return isNaN(p) ? null : p
}
const saleDate = s => ymd(s.dealDate || s.deal_date || s.date || s.created_at || '')
const callDate = c => ymd(c.date || '')
const pct = (n, d = 1) => n == null || isNaN(n) ? 'n/a' : `${n >= 0 ? '+' : ''}${n.toFixed(d)}%`

// ── Breadth windows: current market week to date vs the same span in prior weeks ──
const localYmd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const shift = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
export function breadthWindows(calls, today = new Date()) {
  const dow = today.getDay()                       // 0=Sun..6=Sat
  const sinceMonday = dow === 0 ? 6 : dow - 1
  const monday = shift(today, -sinceMonday); monday.setHours(0, 0, 0, 0)
  const span = Math.min(sinceMonday, 4)            // Sat/Sun -> the full Mon-Fri week
  const count = (startD) => {
    const a = localYmd(startD), b = localYmd(shift(startD, span))
    return new Set(calls.filter(c => { const d = callDate(c); return d >= a && d <= b }).map(c => c.client)).size
  }
  const current = count(monday)
  const prior = [1, 2, 3, 4].map(w => count(shift(monday, -7 * w)))
  const priorAvg = prior.reduce((s, v) => s + v, 0) / prior.length
  const label = span === 4 ? 'full week Mon–Fri' : span === 0 ? 'week to date, Monday only' : `week to date Mon–${DOW[span]}`
  return { current, prior, priorAvg, span, label, weekStart: localYmd(monday) }
}

// ── Client intelligence from ALL calls ──
function clientBlock(calls, soldDemandIds) {
  const valid = calls.filter(c => c.client && callDate(c))
  if (valid.length < 3) return null
  const byClient = {}
  valid.forEach(c => {
    ;(byClient[c.client] = byClient[c.client] || []).push(c)
  })
  Object.values(byClient).forEach(list => list.sort((a, b) => callDate(b).localeCompare(callDate(a))))

  // Breadth (ruling 2026-10-15): market-week aligned, like-for-like.
  // "This week" = Monday -> today of the current Mon-Fri week; the prior four
  // weeks are measured over the SAME weekday span (Mon-Wed vs Mon-Wed), so a
  // Monday-morning run never compares a weekend against full weeks.
  const bw = breadthWindows(valid)
  const activeNow = bw.current
  const avgPrior = bw.priorAvg

  // Open (unsold) demand - ACTIVE window only (last 45 days). Demand lines
  // older than that are stale interest, not the live book; they are counted
  // separately so the AI never presents dead lines as actionable demand.
  // Rows come through canonicalDemands(): the same standing demand re-logged
  // on several calls is ONE line (latest wins), superseded/linked/closed/sold
  // rows are already gone. See demands.js for the desk ruling.
  const ACTIVE_DAYS = DEMAND_ACTIVE_DAYS
  const openDemand = canonicalDemands(valid, { soldDemandIds }).map(d => ({
    client: d.client, date: d.callDate, product: d.product || '?', port: d.port || '',
    volume: num(d.volume), target: priceNum(d.priceTarget), occurrences: d.occurrences,
  }))
  const isGR = d => { const pr = (d.product || '').toLowerCase(); return pr === 'amsul gr' || pr === 'amsul' }
  const isSTD = d => (d.product || '').toLowerCase() === 'amsul std'
  const active = openDemand.filter(d => daysAgo(d.date) <= ACTIVE_DAYS)
  const activeGR = active.filter(isGR)
  const activeSTD = active.filter(isSTD)
  const staleAmsul = openDemand.filter(d => daysAgo(d.date) > ACTIVE_DAYS && (isGR(d) || isSTD(d)))
  const volOf = arr => arr.reduce((sum, d) => sum + (d.volume || 0), 0)

  // Gone quiet: historically active clients (>=3 calls) silent for 21+ days
  const quiet = Object.entries(byClient)
    .filter(([, list]) => list.length >= 3 && daysAgo(callDate(list[0])) >= 21)
    .map(([client, list]) => `${client} (${list.length} calls on record, last contact ${daysAgo(callDate(list[0]))}d ago)`)
    .slice(0, 5)

  const lines = [
    `Full call history: ${valid.length} calls across ${Object.keys(byClient).length} clients.`,
    `Client breadth (${bw.label}): ${activeNow} distinct clients called vs a prior 4-week average of ${avgPrior.toFixed(1)} over the same ${bw.label} span (${avgPrior > 0 ? pct(((activeNow - avgPrior) / avgPrior) * 100) : 'n/a'}). Like-for-like market-week comparison; rising breadth = broadening demand; THIS COMPUTED COMPARISON IS AUTHORITATIVE.`,
  ]
  const fmtLine = d => `${d.client} ${d.volume ? d.volume + 't' : '?t'}${d.port ? ' ' + d.port : ''}${d.target ? ' target ' + d.target : ''} (${d.date}${d.occurrences > 1 ? `, repeated on ${d.occurrences} calls` : ''})`
  if (activeGR.length) {
    lines.push(`ACTIVE open Amsul GR/compacted demand (logged within ${ACTIVE_DAYS}d, not yet converted; each standing demand counted ONCE even when repeated on several calls): ~${Math.round(volOf(activeGR))}t across ${activeGR.length} lines. Most recent: ${activeGR.slice(0, 6).map(fmtLine).join('; ')}.`)
  } else {
    lines.push('No active open Amsul GR demand lines (last 45d).')
  }
  if (activeSTD.length) {
    lines.push(`ACTIVE open Amsul STD demand (DIFFERENT PRODUCT - never judge against compacted benchmarks): ~${Math.round(volOf(activeSTD))}t across ${activeSTD.length} lines: ${activeSTD.slice(0, 4).map(fmtLine).join('; ')}.`)
  }
  if (staleAmsul.length) {
    lines.push(`Stale unconverted Amsul demand older than ${ACTIVE_DAYS}d: ~${Math.round(volOf(staleAmsul))}t across ${staleAmsul.length} lines - historical interest only, NOT the live book; use for re-engagement ideas, never as current demand.`)
  }
  if (quiet.length) lines.push(`Gone quiet (regulars with no contact 21+ days - re-engagement candidates): ${quiet.join('; ')}.`)
  return `### CLIENT INTELLIGENCE (computed from the full call history)\n${lines.join('\n')}`
}

// ── Execution performance: our realized Amsul prices vs the Argus weekly mid ──
function executionBlock(sales, pubs) {
  // Grade discipline: only Amsul GR deals are scored against the compacted CFR
  // benchmark - STD is a different product at a different price.
  const amsulSales = sales.filter(s =>
    (s.product || '').trim().toLowerCase() === 'amsul gr' && num(s.donePrice) != null && saleDate(s))
  if (!amsulSales.length) return null

  // Argus Amsul CFR Brazil compacted weekly mids, newest first
  const bench = pubs
    .filter(r => r.source === 'argus' && r.frequency === 'weekly' && r.product === 'amsul'
      && r.price_point === 'cfr_brazil' && r.grade === 'compacted')
    .sort((a, b) => ymd(b.pub_date).localeCompare(ymd(a.pub_date)))
  const midOf = r => (Number(r.price_low) + Number(r.price_high != null ? r.price_high : r.price_low)) / 2
  // benchmark for a sale = most recent assessment on/before the deal date
  const benchFor = d => {
    const hit = bench.find(r => ymd(r.pub_date) <= d)
    return hit ? midOf(hit) : null
  }

  const recent = amsulSales
    .map(s => ({ d: saleDate(s), price: num(s.donePrice), vol: num(s.volume) || 0 }))
    .sort((a, b) => b.d.localeCompare(a.d))
    .slice(0, 40)
  const last12w = recent.filter(s => daysAgo(s.d) <= 84)
  const scored = last12w.map(s => {
    const b = benchFor(s.d)
    return b ? { ...s, bench: b, capture: s.price - b } : null
  }).filter(Boolean)

  const lines = []
  const totVol = last12w.reduce((s, x) => s + x.vol, 0)
  lines.push(`Realized Amsul GR sales, last 12 weeks: ${last12w.length} deals, ~${Math.round(totVol)}t total.`)
  if (scored.length) {
    const avgCapture = scored.reduce((s, x) => s + x.capture, 0) / scored.length
    const wVol = scored.reduce((s, x) => s + x.vol, 0)
    const wAvg = wVol > 0 ? scored.reduce((s, x) => s + x.capture * x.vol, 0) / wVol : avgCapture
    lines.push(`Execution vs Argus mid at deal date: average ${avgCapture >= 0 ? '+' : ''}${avgCapture.toFixed(0)} USD/t (volume-weighted ${wAvg >= 0 ? '+' : ''}${wAvg.toFixed(0)}). Positive = we sold ABOVE the published market. THIS COMPUTED CAPTURE IS AUTHORITATIVE.`)
    const latest = scored.slice(0, 4).map(s => `${s.d}: ${s.price} vs mid ${s.bench.toFixed(0)} (${s.capture >= 0 ? '+' : ''}${s.capture.toFixed(0)})`).join('; ')
    lines.push(`Latest scored deals: ${latest}.`)
    if (scored.length < 5) lines.push(`[only ${scored.length} scored deals - treat execution averages as weak evidence]`)
  } else {
    lines.push('No deals could be scored against the benchmark (missing overlapping Argus data).')
  }
  return `### EXECUTION (our realized Amsul GR prices vs the published compacted market)\n${lines.join('\n')}`
}

// ── Main entry ──
// ── Sales this week and last, by client (ruling 2026-10-22) ──
// The AI reads every call in full, so it sees "Fertimaxi firm bid 258" - but
// it never saw that Fertimaxi then BOUGHT at 265 on Oct 20, and wrote a
// counter-strategy for a closed deal. This block lists the deals by name so
// a sold negotiation is a fact, not an open bid.
export function recentSalesBlock(sales, today = new Date()) {
  const dow = today.getDay()
  const monday = new Date(today); monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1)); monday.setHours(0, 0, 0, 0)
  const lastMonday = new Date(monday); lastMonday.setDate(monday.getDate() - 7)
  const thisWk = localYmd(monday), lastWk = localYmd(lastMonday)
  const rows = sales.filter(s => saleDate(s) && saleDate(s) >= lastWk)
    .sort((a, b) => saleDate(b).localeCompare(saleDate(a)))
  const fmt = s => {
    const vol = num(s.volume)
    return `[${saleDate(s)}] ${s.client || '?'}: ${s.product || '?'} ${vol != null ? Math.round(vol).toLocaleString('en-US') + 't' : '?t'}${s.port ? ' ' + s.port : ''}${s.laycan ? ' ' + s.laycan : ''} DONE at ${s.donePrice || '?'}${s.offerPrice ? ` (offer ${s.offerPrice}${s.bidPrice ? `, bid ${s.bidPrice}` : ''})` : ''}`
  }
  const cur = rows.filter(s => saleDate(s) >= thisWk)
  const prev = rows.filter(s => saleDate(s) < thisWk)
  const lines = [
    `SALES THIS WEEK (from ${thisWk}): ${cur.length ? cur.map(fmt).join('; ') : 'none logged yet'}.`,
    `SALES LAST WEEK (from ${lastWk}): ${prev.length ? prev.map(fmt).join('; ') : 'none'}.`,
  ]
  const closed = [...new Set(cur.map(s => (s.client || '').trim()).filter(Boolean))]
  if (closed.length) lines.push(`CLOSED NEGOTIATIONS THIS WEEK: ${closed.join(', ')} - their bids/targets in the calls above are history; the done price is the fact.`)
  return `### SALES BY CLIENT (computed from the sales log - authoritative)\n${lines.join('\n')}`
}

export async function buildDeskContext(calls, sales) {
  const safeCalls = Array.isArray(calls) ? calls : []
  const safeSales = Array.isArray(sales) ? sales : []
  const soldDemandIds = new Set(safeSales.map(s => s.linkedDemandId).filter(Boolean))
  let pubs = []
  try { pubs = await loadMarketRows('intl_publications', 800) } catch { pubs = [] }
  const blocks = [
    recentSalesBlock(safeSales),
    clientBlock(safeCalls, soldDemandIds),
    executionBlock(safeSales, pubs),
  ].filter(Boolean)
  if (!blocks.length) return 'No internal history available yet.'
  return blocks.join('\n\n')
}
