// ── Stage 6.3: Market signal computation layer ──
// Reads the market data tables (Stage 6.1/6.2) and computes the derived
// indicators the AI analysis reasons over: import parity, N-unit spread,
// price percentile vs history, line-up revisions, pace YoY, Siacesp
// seasonality, barter position, remaining demand, FX.
//
// Methodology rules encoded here (agreed with Elder):
// - Three lenses, never crossed: Agrinvest pace, Argus line-up and Siacesp
//   actuals are each only compared within their own source.
// - Parity uses OWN Panamax freight only (contract > closed > quote),
//   never published benchmarks.
// - Honesty: every block reports how fresh its data is; missing data is
//   stated as missing, never invented.

import { loadMarketRows } from './cloudMarketData.js'

const N_CONTENT = { amsul: 21, urea: 46 } // % nitrogen

const mid = r => {
  const lo = Number(r.price_low)
  const hi = r.price_high != null ? Number(r.price_high) : lo
  return (lo + hi) / 2
}
const fmt = (n, d = 0) => n == null || isNaN(n) ? 'n/a'
  : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const pct = (n, d = 1) => n == null || isNaN(n) ? 'n/a' : `${n >= 0 ? '+' : ''}${n.toFixed(d)}%`
const ymd = v => String(v).slice(0, 10)
const daysAgo = v => Math.floor((Date.now() - new Date(ymd(v) + 'T00:00:00').getTime()) / 86400000)
const monthLabel = v => new Date(ymd(v) + 'T00:00:00')
  .toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

function freshness(dateVal, staleAfterDays = 14) {
  if (!dateVal) return 'no data'
  const d = daysAgo(dateVal)
  const tag = d > staleAfterDays ? ' — STALE, treat with caution' : ''
  return `as of ${ymd(dateVal)} (${d}d ago)${tag}`
}

// Latest-first series for a given product/price_point (optionally grade)
function priceSeries(pubs, product, pricePoint, grade = null) {
  return pubs
    .filter(r => r.source === 'argus' && r.frequency === 'weekly'
      && r.product === product && r.price_point === pricePoint
      && (grade == null || r.grade === grade))
    .sort((a, b) => ymd(b.pub_date).localeCompare(ymd(a.pub_date)))
}

function percentileOf(value, values) {
  const arr = values.filter(v => v != null && !isNaN(v)).sort((a, b) => a - b)
  if (!arr.length || value == null) return null
  const below = arr.filter(v => v <= value).length
  return Math.round((below / arr.length) * 100)
}

// ── Individual blocks (each returns a text section or null) ──

function pricesBlock(pubs) {
  const cfr = priceSeries(pubs, 'amsul', 'cfr_brazil', 'compacted')
  if (!cfr.length) return null
  const [now, prev, , , w4] = [cfr[0], cfr[1], cfr[2], cfr[3], cfr[4]]
  const m0 = mid(now)
  const wow = prev ? ((m0 - mid(prev)) / mid(prev)) * 100 : null
  const m4 = w4 ? ((m0 - mid(w4)) / mid(w4)) * 100 : null
  const allMids = cfr.map(mid)
  const pctile = percentileOf(m0, allMids)
  const yr = cfr.filter(r => daysAgo(r.pub_date) <= 365).map(mid)
  const lines = [
    `Amsul CFR Brazil (compacted): ${now.price_low}-${now.price_high} USD/t (mid ${fmt(m0)}), ${freshness(now.pub_date)}.`,
    `  Momentum: ${pct(wow)} week-on-week, ${pct(m4)} over 4 weeks. 52-week range of mids: ${fmt(Math.min(...yr))}-${fmt(Math.max(...yr))}.`,
    `  Historical position: current mid is in the ${pctile}th percentile of the full ${cfr.length}-week Argus history (2020-present).`,
  ]
  const fob = priceSeries(pubs, 'amsul', 'fob_china', 'compacted')
  const fobUse = fob.length ? fob : priceSeries(pubs, 'amsul', 'fob_china', 'standard')
  if (fobUse.length) {
    const f = fobUse[0]
    lines.push(`Amsul FOB China (${f.grade}): ${f.price_low}-${f.price_high} USD/t (mid ${fmt(mid(f))}), ${freshness(f.pub_date)}.`)
  }
  const urea = priceSeries(pubs, 'urea', 'cfr_brazil')
  if (urea.length) {
    const u = urea[0]
    const uPrev = urea[1]
    const uWow = uPrev ? ((mid(u) - mid(uPrev)) / mid(uPrev)) * 100 : null
    lines.push(`Urea CFR Brazil (granular): ${u.price_low}-${u.price_high} USD/t (mid ${fmt(mid(u))}), ${pct(uWow)} WoW, ${freshness(u.pub_date)}.`)
  }
  return `### PRICES (Argus weekly)\n${lines.join('\n')}`
}

function parityBlock(pubs, freights) {
  const fobAll = priceSeries(pubs, 'amsul', 'fob_china', 'compacted')
  const fob = fobAll.length ? fobAll : priceSeries(pubs, 'amsul', 'fob_china', 'standard')
  const cfr = priceSeries(pubs, 'amsul', 'cfr_brazil', 'compacted')
  if (!fob.length || !cfr.length) return null
  // OWN freight only: contract > closed > quote, newest of the best available type
  const own = freights
    .filter(f => f.source === 'own' && f.route === 'china_brazil')
    .sort((a, b) => ymd(b.rate_date).localeCompare(ymd(a.rate_date)))
  const pick = own.find(f => f.rate_type === 'contract')
    || own.find(f => f.rate_type === 'closed')
    || own.find(f => f.rate_type === 'quote')
  if (!pick) return `### IMPORT PARITY\nNot computable: no own China->Brazil freight entered (contract/fixture/quote).`
  const frt = pick.rate_high != null
    ? (Number(pick.rate_low) + Number(pick.rate_high)) / 2 : Number(pick.rate_low)
  const parity = mid(fob[0]) + frt
  const spread = mid(cfr[0]) - parity
  return `### IMPORT PARITY (own Panamax economics — never compare with published freight)
FOB China mid ${fmt(mid(fob[0]))} + own ${pick.rate_type} freight ${fmt(frt)} USD/t (${ymd(pick.rate_date)}) = replacement cost ~${fmt(parity)} USD/t CFR.
Market CFR Brazil mid ${fmt(mid(cfr[0]))} is ${spread >= 0 ? fmt(spread) + ' USD/t ABOVE' : fmt(-spread) + ' USD/t BELOW'} replacement cost.
Interpretation: positive spread = market pricing above our import parity (room to place cargoes); negative = market below replacement (margin pressure on new imports).`
}

function nUnitBlock(pubs) {
  const am = priceSeries(pubs, 'amsul', 'cfr_brazil', 'compacted')
  const ur = priceSeries(pubs, 'urea', 'cfr_brazil')
  if (!am.length || !ur.length) return null
  const aN = mid(am[0]) / N_CONTENT.amsul
  const uN = mid(ur[0]) / N_CONTENT.urea
  const prem = ((aN - uN) / uN) * 100
  // 52-week context of the spread
  const weeks = Math.min(am.length, ur.length, 52)
  const hist = []
  for (let i = 0; i < weeks; i++) {
    if (ymd(am[i].pub_date) === ymd(ur[i].pub_date)) {
      hist.push(((mid(am[i]) / N_CONTENT.amsul) - (mid(ur[i]) / N_CONTENT.urea)) / (mid(ur[i]) / N_CONTENT.urea) * 100)
    }
  }
  const avg = hist.length ? hist.reduce((s, v) => s + v, 0) / hist.length : null
  return `### NITROGEN SUBSTITUTION (Amsul vs Urea, cost per unit N)
Amsul: ${aN.toFixed(2)} USD/unit N | Urea: ${uN.toFixed(2)} USD/unit N -> Amsul trades at ${pct(prem)} vs urea per unit N (sulphur value not included).
52-week average of this premium: ${avg != null ? pct(avg) : 'n/a'}. When Amsul is unusually cheap per unit N vs its own average, substitution demand tends to favor Amsul, and vice versa.`
}

function supplyBlock(snaps) {
  const out = []
  // 1) Argus line-up: latest report vs previous report (revision signal)
  const lineup = snaps.filter(r => r.series === 'lineup' && r.product === 'amsul')
  if (lineup.length) {
    const reports = [...new Set(lineup.map(r => ymd(r.report_date)))].sort().reverse()
    const cur = lineup.filter(r => ymd(r.report_date) === reports[0])
    const prevR = reports[1] ? lineup.filter(r => ymd(r.report_date) === reports[1]) : []
    const months = cur.sort((a, b) => ymd(a.period).localeCompare(ymd(b.period)))
      .map(r => {
        const p = prevR.find(x => ymd(x.period) === ymd(r.period))
        const delta = p ? ` (prev report ${fmt(p.volume_kt)}k, ${Number(r.volume_kt) >= Number(p.volume_kt) ? 'revised UP' : 'revised DOWN'} ${fmt(Math.abs(r.volume_kt - p.volume_kt))}k)` : ''
        return `  ${monthLabel(r.period)}: ${fmt(r.volume_kt)}k tons${delta}`
      })
    const total = cur.reduce((s, r) => s + Number(r.volume_kt), 0)
    out.push(`Argus forward line-up (report ${reports[0]}, ${freshness(reports[0], 10)}) — total visible ${fmt(total)}k tons:\n${months.join('\n')}`)
  } else out.push('Argus line-up: no data entered.')

  // 2) Agrinvest pace YoY (within-source only)
  const pace = snaps.filter(r => r.series === 'ytd_pace' && r.product === 'amsul')
  if (pace.length) {
    const latestRep = [...new Set(pace.map(r => ymd(r.report_date)))].sort().reverse()[0]
    const rows = pace.filter(r => ymd(r.report_date) === latestRep)
      .sort((a, b) => ymd(b.period).localeCompare(ymd(a.period)))
    if (rows.length >= 2) {
      const curY = rows[0], prvY = rows[1]
      const yoy = ((curY.volume_kt - prvY.volume_kt) / prvY.volume_kt) * 100
      out.push(`Agrinvest program pace (report ${latestRep}): Jan-${monthLabel(curY.period)} ${fmt(curY.volume_kt)}k tons vs same window last year ${fmt(prvY.volume_kt)}k -> ${pct(yoy)} YoY. (Arrived + declared; compare only against Agrinvest itself.)`)
    } else if (rows.length === 1) {
      out.push(`Agrinvest program pace (report ${latestRep}): ${fmt(rows[0].volume_kt)}k tons Jan-${monthLabel(rows[0].period)} — prior-year figure not entered, YoY not computable.`)
    }
  } else out.push('Agrinvest pace: no data entered.')

  // 3) Siacesp actuals: latest month vs same month prior year + YTD comparison
  const act = snaps.filter(r => r.series === 'siacesp_actual' && r.product === 'amsul')
  if (act.length) {
    const sorted = act.sort((a, b) => ymd(b.period).localeCompare(ymd(a.period)))
    const latest = sorted[0]
    const lm = new Date(ymd(latest.period) + 'T00:00:00')
    const samePrev = act.find(r => {
      const d = new Date(ymd(r.period) + 'T00:00:00')
      return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear() - 1
    })
    const yr = lm.getFullYear()
    const ytdCur = act.filter(r => new Date(ymd(r.period)).getFullYear() === yr)
      .reduce((s, r) => s + Number(r.volume_kt), 0)
    const monthsCovered = act.filter(r => new Date(ymd(r.period)).getFullYear() === yr).length
    const ytdPrev = act.filter(r => {
      const d = new Date(ymd(r.period) + 'T00:00:00')
      return d.getFullYear() === yr - 1 && d.getMonth() <= lm.getMonth()
    }).reduce((s, r) => s + Number(r.volume_kt), 0)
    let line = `Siacesp customs-cleared actuals: ${monthLabel(latest.period)} = ${fmt(latest.volume_kt)}k tons`
    if (samePrev) line += ` vs ${fmt(samePrev.volume_kt)}k same month last year (${pct(((latest.volume_kt - samePrev.volume_kt) / samePrev.volume_kt) * 100)})`
    if (ytdPrev > 0) line += `. YTD ${monthsCovered} months: ${fmt(ytdCur)}k vs ${fmt(ytdPrev)}k last year (${pct(((ytdCur - ytdPrev) / ytdPrev) * 100)})`
    line += `. (Realized customs data; compare only against Siacesp itself.)`
    out.push(line)
  }

  // 4) Siacesp annual trend
  const ann = snaps.filter(r => r.series === 'siacesp_annual' && r.product === 'amsul')
    .sort((a, b) => ymd(a.period).localeCompare(ymd(b.period)))
  if (ann.length >= 2) {
    const seq = ann.map(r => `${new Date(ymd(r.period)).getFullYear()}: ${fmt(r.volume_kt)}k`).join(', ')
    const last = ann[ann.length - 1], prev = ann[ann.length - 2]
    out.push(`Structural trend (Siacesp annual Amsul imports): ${seq}. Last full year ${pct(((last.volume_kt - prev.volume_kt) / prev.volume_kt) * 100)} YoY — a multi-year growth market.`)
  }

  return `### SUPPLY — THREE SEPARATE LENSES (never sum or cross-compare them)\n${out.join('\n')}`
}

function barterBlock(rows) {
  const am = rows.filter(r => r.product === 'amsul')
  if (!am.length) return null
  const groups = {}
  am.forEach(r => {
    const k = `${r.crop}|${r.condition}|${r.region}`
    ;(groups[k] = groups[k] || []).push(r)
  })
  const lines = Object.values(groups).map(g => {
    g.sort((a, b) => ymd(b.ratio_date).localeCompare(ymd(a.ratio_date)))
    const cur = g[0]
    const hist = g.map(r => Number(r.ratio))
    const avg = hist.reduce((s, v) => s + v, 0) / hist.length
    const dev = ((Number(cur.ratio) - avg) / avg) * 100
    const histNote = g.length < 8
      ? ` [only ${g.length} data points in history — treat the average as weak evidence]`
      : ` (n=${g.length})`
    return `  ${cur.crop} x Amsul, ${cur.condition}, ${cur.region}: ${cur.ratio} sc/ton, ${freshness(cur.ratio_date)}. Vs own history avg ${avg.toFixed(1)}: ${pct(dev)}${histNote}. Higher ratio = worse farmer purchasing power.`
  })
  return `### BARTER RATIOS (farmer purchasing power)\n${lines.join('\n')}`
}

function progressBlock(rows) {
  if (!rows.length) return null
  const latestRep = [...new Set(rows.map(r => ymd(r.report_date)))].sort().reverse()[0]
  const cur = rows.filter(r => ymd(r.report_date) === latestRep)
  const lines = cur.map(r =>
    `  ${r.crop} ${String(r.season).replace('_', '/')} ${r.region}: ${r.pct}% purchased -> ${fmt(100 - r.pct)}% of demand still open.`)
  return `### FARMER PURCHASE PROGRESS (report ${latestRep}, ${freshness(latestRep, 21)})\n${lines.join('\n')}`
}

function fxBlock(rows) {
  const usd = rows.filter(r => r.pair === 'usd_brl')
    .sort((a, b) => ymd(b.rate_date).localeCompare(ymd(a.rate_date)))
  if (!usd.length) return null
  const cur = usd[0], prev = usd[1]
  const chg = prev ? ((cur.rate - prev.rate) / prev.rate) * 100 : null
  return `### FX\nUSD/BRL ${Number(cur.rate).toFixed(3)}, ${freshness(cur.rate_date)}${chg != null ? `, ${pct(chg)} vs previous entry` : ''}. BRL weakening raises fertilizer cost in reais even with stable USD prices (and vice versa).`
}

// ── Main entry: build the full market context text for the AI prompt ──
export async function buildMarketContext() {
  const [pubs, freights, snaps, barter, progress, fx] = await Promise.all([
    loadMarketRows('intl_publications', 2000).catch(() => []),
    loadMarketRows('freight_rates', 200).catch(() => []),
    loadMarketRows('supply_snapshots', 1000).catch(() => []),
    loadMarketRows('barter_ratios', 500).catch(() => []),
    loadMarketRows('purchase_progress', 300).catch(() => []),
    loadMarketRows('fx_rates', 200).catch(() => []),
  ])

  const blocks = [
    pricesBlock(pubs),
    parityBlock(pubs, freights),
    nUnitBlock(pubs),
    supplyBlock(snaps),
    barterBlock(barter),
    progressBlock(progress),
    fxBlock(fx),
  ].filter(Boolean)

  if (!blocks.length) return 'No external market data available yet.'
  return blocks.join('\n\n')
}
