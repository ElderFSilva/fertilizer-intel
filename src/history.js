// ── History: computed series for the History view and the report chart ──
// Display only. Nothing here is a signal, and nothing is stored: every series
// is recomputed from the publication tables and the positioning log, with the
// same functions the AI context and the Track Record already use, so the
// picture can never disagree with the numbers.

import { loadMarketRows } from './cloudMarketData.js'
import { cloudLoadBenchmarkFromIntl } from './cloudData.js'
import { loadPositioningLog, scoreStances } from './learningLoop.js'

const N_CONTENT = { amsul: 21, urea: 46 }
export const GRADE_BAND_PCT = 1.5   // same as learningLoop THRESHOLD_PCT
export const GRADE_HORIZON_DAYS = 14

const ymd = v => String(v || '').slice(0, 10)
const mid = r => (Number(r.price_low) + Number(r.price_high != null ? r.price_high : r.price_low)) / 2

export function weekThuOf(dateStr) {
  const d = new Date(ymd(dateStr) + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  const day = d.getDay()
  const t = new Date(d)
  t.setDate(d.getDate() - (day === 0 ? 6 : day - 1) + 3)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

export function addDays(dateStr, n) {
  const d = new Date(ymd(dateStr) + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Percentile bands of a value list: { p25, p50, p75, p90, n } (same quantile
// convention as the N-unit block in marketSignals).
export function bands(values) {
  const all = values.filter(v => v != null && !isNaN(v)).sort((a, b) => a - b)
  if (!all.length) return null
  const q = f => all[Math.min(all.length - 1, Math.floor(f * all.length))]
  return { p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9), min: all[0], max: all[all.length - 1], n: all.length }
}

export function percentileOf(value, values) {
  const all = values.filter(v => v != null && !isNaN(v))
  if (!all.length || value == null) return null
  return Math.round(all.filter(v => v <= value).length / all.length * 100)
}

// Weekly FOB China compacted composite (any source, latest per source in the week)
function weeklyFob(pubs) {
  const by = {}
  pubs.filter(r => r.product === 'amsul' && r.price_point === 'fob_china' && r.grade === 'compacted' && r.frequency === 'weekly')
    .forEach(r => {
      const wk = weekThuOf(r.pub_date); if (!wk) return
      const d = ymd(r.pub_date)
      by[wk] = by[wk] || {}
      if (!by[wk][r.source] || by[wk][r.source].d < d) by[wk][r.source] = { d, mid: mid(r) }
    })
  const out = {}
  Object.entries(by).forEach(([wk, s]) => { const v = Object.values(s); out[wk] = v.reduce((a, e) => a + e.mid, 0) / v.length })
  return out
}

function ownFreight(freights) {
  const own = (freights || [])
    .filter(f => f.source === 'own' && f.route === 'china_brazil')
    .sort((a, b) => ymd(b.rate_date).localeCompare(ymd(a.rate_date)))
  const pick = own.find(f => f.rate_type === 'contract') || own.find(f => f.rate_type === 'closed') || own.find(f => f.rate_type === 'quote')
  if (!pick) return null
  return pick.rate_high != null ? (Number(pick.rate_low) + Number(pick.rate_high)) / 2 : Number(pick.rate_low)
}

// Amsul premium per unit N vs urea, aligned by Argus publication date (same
// arithmetic as the N-unit block).
function premiumSeries(pubs) {
  const am = pubs.filter(r => r.source === 'argus' && r.frequency === 'weekly' && r.product === 'amsul' && r.price_point === 'cfr_brazil' && r.grade === 'compacted')
  const ur = pubs.filter(r => r.source === 'argus' && r.frequency === 'weekly' && r.product === 'urea' && r.price_point === 'cfr_brazil')
  const urBy = {}
  ur.forEach(r => { urBy[ymd(r.pub_date)] = mid(r) })
  const out = []
  am.forEach(r => {
    const u = urBy[ymd(r.pub_date)]
    if (u != null) out.push({ date: ymd(r.pub_date), prem: ((mid(r) / N_CONTENT.amsul) / (u / N_CONTENT.urea) - 1) * 100 })
  })
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

// Everything the History view needs, in one call.
export async function buildHistory() {
  const [bench, pubs, freights, log] = await Promise.all([
    cloudLoadBenchmarkFromIntl().catch(() => ({ argus: [], fertecon: [] })),
    loadMarketRows('intl_publications', 5000).catch(() => []),
    loadMarketRows('freight_rates', 200).catch(() => []),
    loadPositioningLog('global').catch(() => []),
  ])

  // CFR: Argus weekly mids, Thursday-keyed, full depth (intl + legacy table)
  const cfr = (bench.argus || []).map(r => ({ date: r.date, mid: (Number(r.low) + Number(r.high)) / 2 }))
  const cfrBands = bands(cfr.map(r => r.mid))
  const fob = weeklyFob(pubs)
  const frt = ownFreight(freights)

  // Stances graded exactly as the Track Record grades them
  const scored = scoreStances(log, pubs)
  const stanceByWeek = {}
  scored.forEach(s => { stanceByWeek[s.week] = s })

  const rows = cfr.map(r => {
    const st = stanceByWeek[r.date] || null
    return {
      date: r.date,
      cfr: r.mid,
      fob: fob[r.date] ?? null,
      repl: fob[r.date] != null && frt != null ? fob[r.date] + frt : null,
      stance: st ? { bias: st.bias, confidence: st.confidence, result: st.result, priceThen: st.priceThen, priceAfter: st.priceAfter, changePct: st.changePct } : null,
    }
  })

  const prem = premiumSeries(pubs)
  const premBands = bands(prem.map(p => p.prem))

  const last = cfr.length ? cfr[cfr.length - 1] : null
  const lastPrem = prem.length ? prem[prem.length - 1] : null
  return {
    rows, cfrBands, freight: frt,
    cfrNow: last ? { date: last.date, mid: last.mid, pct: percentileOf(last.mid, cfr.map(r => r.mid)) } : null,
    prem, premBands,
    premNow: lastPrem ? { date: lastPrem.date, prem: lastPrem.prem, pct: percentileOf(lastPrem.prem, prem.map(p => p.prem)) } : null,
    stancesInLog: scored.length,
  }
}
