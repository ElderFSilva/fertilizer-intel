// ── Desk signals: computed intelligence from the FULL internal history ──
// Closes the two gaps: (1) past weeks' calls were invisible to the AI,
// (2) realized sales were never compared against the market benchmark.
// Same philosophy as marketSignals: code does the arithmetic, the AI
// only interprets pre-computed, authoritative facts.

import { loadMarketRows } from './cloudMarketData.js'

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

// ── Client intelligence from ALL calls ──
function clientBlock(calls, soldDemandIds) {
  const valid = calls.filter(c => c.client && callDate(c))
  if (valid.length < 3) return null
  const byClient = {}
  valid.forEach(c => {
    ;(byClient[c.client] = byClient[c.client] || []).push(c)
  })
  Object.values(byClient).forEach(list => list.sort((a, b) => callDate(b).localeCompare(callDate(a))))

  // Breadth: distinct clients active in the last 7 days vs the prior 4-week weekly average
  const now = Date.now()
  const inWindow = (c, fromD, toD) => {
    const t = new Date(callDate(c) + 'T00:00:00').getTime()
    return t > now - fromD * dayMs && t <= now - toD * dayMs
  }
  const activeNow = new Set(valid.filter(c => inWindow(c, 7, 0)).map(c => c.client)).size
  const prior4w = [1, 2, 3, 4].map(w =>
    new Set(valid.filter(c => inWindow(c, (w + 1) * 7, w * 7)).map(c => c.client)).size)
  const avgPrior = prior4w.reduce((s, v) => s + v, 0) / 4

  // Open (unsold) demand across history
  const openDemand = []
  valid.forEach(c => {
    ;(c.demandRows || []).forEach(r => {
      if ((r.product || r.volume) && !(r.id && soldDemandIds.has(r.id))) {
        openDemand.push({ client: c.client, date: callDate(c), product: r.product || '?', volume: num(r.volume), target: priceNum(r.priceTarget) })
      }
    })
  })
  openDemand.sort((a, b) => b.date.localeCompare(a.date))
  const openAmsul = openDemand.filter(d => (d.product || '').toLowerCase().includes('amsul'))
  const openVol = openAmsul.reduce((s, d) => s + (d.volume || 0), 0)

  // Gone quiet: historically active clients (>=3 calls) silent for 21+ days
  const quiet = Object.entries(byClient)
    .filter(([, list]) => list.length >= 3 && daysAgo(callDate(list[0])) >= 21)
    .map(([client, list]) => `${client} (${list.length} calls on record, last contact ${daysAgo(callDate(list[0]))}d ago)`)
    .slice(0, 5)

  const lines = [
    `Full call history: ${valid.length} calls across ${Object.keys(byClient).length} clients.`,
    `Client breadth: ${activeNow} distinct clients active in the last 7 days vs a prior 4-week average of ${avgPrior.toFixed(1)}/week (${avgPrior > 0 ? pct(((activeNow - avgPrior) / avgPrior) * 100) : 'n/a'}). Rising breadth = broadening demand; THIS COMPUTED COMPARISON IS AUTHORITATIVE.`,
  ]
  if (openAmsul.length) {
    const recent = openAmsul.slice(0, 6).map(d =>
      `${d.client} ${d.volume ? d.volume + 't' : '?t'}${d.target ? ' target ' + d.target : ''} (${d.date})`).join('; ')
    lines.push(`Open Amsul demand on the book (logged, not yet converted to sales): ~${Math.round(openVol)}t across ${openAmsul.length} demand lines. Most recent: ${recent}.`)
  } else {
    lines.push('No open Amsul demand lines on the book.')
  }
  if (quiet.length) lines.push(`Gone quiet (regulars with no contact 21+ days - re-engagement candidates): ${quiet.join('; ')}.`)
  return `### CLIENT INTELLIGENCE (computed from the full call history)\n${lines.join('\n')}`
}

// ── Execution performance: our realized Amsul prices vs the Argus weekly mid ──
function executionBlock(sales, pubs) {
  const amsulSales = sales.filter(s =>
    (s.product || '').toLowerCase().includes('amsul') && num(s.donePrice) != null && saleDate(s))
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
  lines.push(`Realized Amsul sales, last 12 weeks: ${last12w.length} deals, ~${Math.round(totVol)}t total.`)
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
  return `### EXECUTION (our realized prices vs the published market)\n${lines.join('\n')}`
}

// ── Main entry ──
export async function buildDeskContext(calls, sales) {
  const safeCalls = Array.isArray(calls) ? calls : []
  const safeSales = Array.isArray(sales) ? sales : []
  const soldDemandIds = new Set(safeSales.map(s => s.linkedDemandId).filter(Boolean))
  let pubs = []
  try { pubs = await loadMarketRows('intl_publications', 800) } catch { pubs = [] }
  const blocks = [
    clientBlock(safeCalls, soldDemandIds),
    executionBlock(safeSales, pubs),
  ].filter(Boolean)
  if (!blocks.length) return 'No internal history available yet.'
  return blocks.join('\n\n')
}
