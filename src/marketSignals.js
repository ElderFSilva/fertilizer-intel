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
import { supabase } from './supabaseClient.js'

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
const yearOf = v => Number(ymd(v).slice(0, 4)) // timezone-proof: no Date parsing
const monthLabel = v => new Date(ymd(v) + 'T00:00:00')
  .toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

function freshness(dateVal, staleAfterDays = 10) {
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

// Latest fresh assessment per source for a series (dedup by source, <=21d old).
// SAME-WEEK RULE: the composite only blends sources whose latest entry falls in
// the most recent week that has any data. Sources still on an older week are
// returned as `stale` - shown as lagging context, never blended or compared
// against current-week sources as "divergence".
function weekKeyOf(dateStr) {
  const d = new Date(ymd(dateStr) + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  const day = d.getDay()
  const monday = new Date(d)
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  monday.setDate(monday.getDate() + 3)
  const y = monday.getFullYear()
  const m = String(monday.getMonth() + 1).padStart(2, '0')
  const dd = String(monday.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function latestPerSource(pubs, benchRows, product, pricePoint, grade) {
  const out = {}
  pubs
    .filter(r => r.product === product && r.price_point === pricePoint && r.grade === grade
      && r.frequency === 'weekly' && daysAgo(r.pub_date) <= 21)
    .sort((a, b) => ymd(b.pub_date).localeCompare(ymd(a.pub_date)))
    .forEach(r => { if (!out[r.source]) out[r.source] = { src: r.source, mid: mid(r), low: r.price_low, high: r.price_high, date: ymd(r.pub_date) } })
  if (product === 'amsul' && pricePoint === 'cfr_brazil' && grade === 'compacted' && benchRows) {
    benchRows
      .filter(r => daysAgo(r.pub_date) <= 21)
      .sort((a, b) => ymd(b.pub_date).localeCompare(ymd(a.pub_date)))
      .forEach(r => {
        if (!out[r.source]) out[r.source] = { src: r.source, mid: (Number(r.low) + Number(r.high)) / 2, low: r.low, high: r.high, date: ymd(r.pub_date) }
      })
  }
  const all = Object.values(out)
  if (!all.length) return { current: [], stale: [] }
  const anchorWeek = all.map(e => weekKeyOf(e.date)).sort().reverse()[0]
  return {
    anchorWeek,
    current: all.filter(e => weekKeyOf(e.date) === anchorWeek),
    stale: all.filter(e => weekKeyOf(e.date) !== anchorWeek),
  }
}

// ── Publication calendar (desk facts) ──
// Prices: argus & fertecon publish THURSDAY; agrinvest publishes FRIDAY.
// Weekly datasets (pace, barter, line-up, FX, purchase %) are dated FRIDAY
// and entered on MONDAY. ENTRY_GRACE_DAYS covers the Monday entry routine.
const PUB_DAY = { argus: 4, fertecon: 4, agrinvest: 5, profercy: 4 } // 4=Thu, 5=Fri
const ENTRY_GRACE_DAYS = 3

// Classify a source absent from the anchor week: PENDING (its publication +
// entry window hasn't closed yet) vs MISSING (past grace - a genuine gap).
function classifyAbsent(src, anchorWeekThu) {
  const pubDay = PUB_DAY[src] ?? 4
  const pubDate = new Date(ymd(anchorWeekThu) + 'T00:00:00')
  pubDate.setDate(pubDate.getDate() + (pubDay - 4)) // Thu-anchored week key
  const deadline = new Date(pubDate)
  deadline.setDate(deadline.getDate() + ENTRY_GRACE_DAYS)
  const dayName = pubDay === 5 ? 'Friday' : 'Thursday'
  if (Date.now() <= deadline.getTime()) return { status: 'pending', note: `publishes ${dayName}, entered by Monday - pending, not comparable` }
  return { status: 'missing', note: `publishes ${dayName} - past entry window, genuinely missing this week` }
}

function staleNote(stale, anchorWeekThu) {
  if (!stale.length) return ''
  const parts = stale.map(e => {
    const c = classifyAbsent(e.src, anchorWeekThu)
    return `${e.src} prior week ${fmt(e.mid)} (${e.date}); this week's ${c.note}`
  })
  return ` Sources not yet in this week's composite: ${parts.join(' | ')}.`
}

function _staleNote_unused(stale) {
  if (!stale.length) return ''
  return ` Lagging sources (older week, NOT in composite, not comparable): ${stale.map(e => `${e.src} ${fmt(e.mid)} (${e.date})`).join(', ')}.`
}

function compositeOf(entries) {
  if (!entries.length) return null
  return entries.reduce((s, e) => s + e.mid, 0) / entries.length
}

function sourceList(entries) {
  return entries.map(e => `${e.src} ${fmt(e.mid)} (${e.date})`).join(', ')
}

function pricesBlock(pubs, benchRows) {
  const cfrArgus = priceSeries(pubs, 'amsul', 'cfr_brazil', 'compacted')
  const cfrLps = latestPerSource(pubs, benchRows, 'amsul', 'cfr_brazil', 'compacted')
  const cfrSources = cfrLps.current
  if (!cfrSources.length && !cfrArgus.length) return null
  const comp = compositeOf(cfrSources)
  const lines = []
  if (cfrSources.length) {
    const div = cfrSources.length > 1 ? Math.max(...cfrSources.map(e => e.mid)) - Math.min(...cfrSources.map(e => e.mid)) : 0
    lines.push(`Amsul CFR Brazil COMPACTED - composite reference ${fmt(comp)} USD/t from ${cfrSources.length} SAME-WEEK source(s): ${sourceList(cfrSources)}.${div > 5 ? ` Same-week sources diverge by ${fmt(div)} USD/t - that disagreement is itself information (note it).` : ''}${staleNote(cfrLps.stale, cfrLps.anchorWeek)}`)
  }
  // Momentum + percentile computed on the Argus series (only series with 2020-present depth)
  if (cfrArgus.length) {
    const m0 = mid(cfrArgus[0])
    const prev = cfrArgus[1]
    const w4 = cfrArgus[4]
    const wow = prev ? ((m0 - mid(prev)) / mid(prev)) * 100 : null
    const m4 = w4 ? ((m0 - mid(w4)) / mid(w4)) * 100 : null
    const pctile = percentileOf(m0, cfrArgus.map(mid))
    lines.push(`Momentum & history (Argus series, the only one with 2020-present depth): ${pct(wow)} week-on-week, ${pct(m4)} over 4 weeks; current Argus mid ${fmt(m0)} sits in the ${pctile}th percentile of ${cfrArgus.length} weeks.`)
  }
  // Standard grade, if entered - ALWAYS labeled, never mixed with compacted
  const stdSources = latestPerSource(pubs, null, 'amsul', 'cfr_brazil', 'standard').current
  if (stdSources.length) {
    const stdComp = compositeOf(stdSources)
    lines.push(`Amsul CFR Brazil STANDARD (different product - never compare to compacted): composite ${fmt(stdComp)} USD/t [${sourceList(stdSources)}]. Compacted-over-standard spread: ${comp != null ? fmt(comp - stdComp) + ' USD/t' : 'n/a'}.`)
  }
  // FOB China - composite per grade
  const fobC = latestPerSource(pubs, null, 'amsul', 'fob_china', 'compacted').current
  const fobS = latestPerSource(pubs, null, 'amsul', 'fob_china', 'standard').current
  if (fobC.length) lines.push(`Amsul FOB China COMPACTED: composite ${fmt(compositeOf(fobC))} USD/t [${sourceList(fobC)}].`)
  if (fobS.length) lines.push(`Amsul FOB China STANDARD: composite ${fmt(compositeOf(fobS))} USD/t [${sourceList(fobS)}].`)
  const urea = priceSeries(pubs, 'urea', 'cfr_brazil')
  if (urea.length) {
    const u = urea[0]
    const uPrev = urea[1]
    const uWow = uPrev ? ((mid(u) - mid(uPrev)) / mid(uPrev)) * 100 : null
    lines.push(`Urea CFR Brazil (granular): ${u.price_low}-${u.price_high} USD/t (mid ${fmt(mid(u))}), ${pct(uWow)} WoW, ${freshness(u.pub_date)}.`)
  }
  return `### PRICES (multi-source, grade-separated)\n${lines.join('\n')}`
}

function parityBlock(pubs, freights, benchRows) {
  const fobC = latestPerSource(pubs, null, 'amsul', 'fob_china', 'compacted').current
  const fobS = latestPerSource(pubs, null, 'amsul', 'fob_china', 'standard').current
  const fobEntries = fobC.length ? fobC : fobS
  const fobGrade = fobC.length ? 'COMPACTED' : 'STANDARD'
  const cfrEntries = latestPerSource(pubs, benchRows, 'amsul', 'cfr_brazil', 'compacted').current
  if (!fobEntries.length || !cfrEntries.length) return null
  const own = freights
    .filter(f => f.source === 'own' && f.route === 'china_brazil')
    .sort((a, b) => ymd(b.rate_date).localeCompare(ymd(a.rate_date)))
  const pick = own.find(f => f.rate_type === 'contract')
    || own.find(f => f.rate_type === 'closed')
    || own.find(f => f.rate_type === 'quote')
  if (!pick) return `### IMPORT PARITY\nNot computable: no own China->Brazil freight entered (contract/fixture/quote).`
  const frt = pick.rate_high != null
    ? (Number(pick.rate_low) + Number(pick.rate_high)) / 2 : Number(pick.rate_low)
  const fob = compositeOf(fobEntries)
  const cfr = compositeOf(cfrEntries)
  const parity = fob + frt
  const spread = cfr - parity
  return `### IMPORT PARITY (composite benchmarks + own Panamax freight - never published freight)
FOB China ${fobGrade} composite ${fmt(fob)} [${sourceList(fobEntries)}] + own ${pick.rate_type} freight ${fmt(frt)} USD/t (${ymd(pick.rate_date)}) = replacement cost ~${fmt(parity)} USD/t CFR (${fobGrade}-basis).
CFR Brazil COMPACTED composite ${fmt(cfr)} [${sourceList(cfrEntries)}] is ${spread >= 0 ? fmt(spread) + ' USD/t ABOVE' : fmt(-spread) + ' USD/t BELOW'} replacement cost.${fobGrade === 'STANDARD' ? '\nGRADE CAVEAT: replacement is computed on STANDARD FOB (no compacted FOB entered) vs COMPACTED CFR - the true compacted replacement is higher by the compaction margin; treat the spread as an upper bound.' : ''}
Interpretation: positive spread = market pricing above our import parity; negative = new imports underwater.`
}

function nUnitBlock(pubs) {
  const am = priceSeries(pubs, 'amsul', 'cfr_brazil', 'compacted')
  const ur = priceSeries(pubs, 'urea', 'cfr_brazil')
  if (!am.length || !ur.length) return null
  // Align the two series by publication date (full history, 2020-present)
  const urByDate = {}
  ur.forEach(r => { urByDate[ymd(r.pub_date)] = mid(r) })
  const series = [] // newest first: { date, prem }
  am.forEach(r => {
    const u = urByDate[ymd(r.pub_date)]
    if (u != null) series.push({ date: ymd(r.pub_date), prem: ((mid(r) / N_CONTENT.amsul) / (u / N_CONTENT.urea) - 1) * 100 })
  })
  if (series.length < 2) return null
  series.sort((a, b) => b.date.localeCompare(a.date))
  const cur = series[0]
  const prev = series[1]
  const wow = cur.prem - prev.prem
  const w8 = series[Math.min(8, series.length - 1)]
  const trendDelta = cur.prem - w8.prem
  const trend = Math.abs(trendDelta) < 1 ? 'STABLE' : trendDelta > 0 ? 'WIDENING' : 'NARROWING'
  // Empirical distribution over the full aligned history
  const all = series.map(x => x.prem).sort((a, b) => a - b)
  const q = f => all[Math.min(all.length - 1, Math.floor(f * all.length))]
  const median = q(0.5), p75 = q(0.75), p90 = q(0.9)
  const pctile = Math.round(all.filter(v => v <= cur.prem).length / all.length * 100)
  const sharePos = Math.round(all.filter(v => v > 0).length / all.length * 100)
  const level = pctile >= 90 ? 'TOP DECILE of history - historically expensive'
    : pctile >= 50 ? 'above the historical median but within the normal band'
    : 'BELOW the historical median - historically cheap for Amsul'
  return `### NITROGEN SUBSTITUTION (Amsul vs Urea, nominal cost per unit N - empirical framework)
Current nominal premium: ${cur.prem >= 0 ? '+' : ''}${cur.prem.toFixed(1)}% (${cur.date}). Week-on-week ${wow >= 0 ? '+' : ''}${wow.toFixed(1)}pp; 8-week trend: ${trend} (${trendDelta >= 0 ? '+' : ''}${trendDelta.toFixed(1)}pp). THESE COMPUTED VALUES ARE AUTHORITATIVE.
Empirical distribution (${series.length} aligned weeks, 2020-present, recomputed live): Amsul traded at a nominal premium in ${sharePos}% of all weeks; median ${median >= 0 ? '+' : ''}${median.toFixed(1)}%, P75 ${p75 >= 0 ? '+' : ''}${p75.toFixed(1)}%, P90 ${p90 >= 0 ? '+' : ''}${p90.toFixed(1)}%.
Current position: ${pctile}th percentile -> ${level}.
Structural reason (context): Amsul carries ~24% sulphur not fully priced in, and urea loses N to volatilization in tropical conditions - which is why the market has sustained these premiums historically while Amsul import demand grew every year.
INTERPRETATION RULE: substitution caution is warranted ONLY if the premium is at/above its 90th percentile AND the trend is WIDENING, or if internal calls explicitly report clients switching to urea/blends. Below the median, the premium argues FOR Amsul, not against it.`
}

function supplyBlock(snaps) {
  const out = []
  // 1) Forward line-up: revisions are computed WITHIN each source only.
  // Different providers (Argus assessed line-up vs port-agency counts) are
  // different measuring sticks - a change of source is never a "revision".
  const lineup = snaps.filter(r => r.series === 'lineup' && r.product === 'amsul')
  if (lineup.length) {
    const bySource = {}
    lineup.forEach(r => { (bySource[r.source] = bySource[r.source] || []).push(r) })
    // Headline lens = the source with the most recent report; others = separate lenses
    const sources = Object.entries(bySource).map(([src, rows]) => {
      const reports = [...new Set(rows.map(r => ymd(r.report_date)))].sort().reverse()
      return { src, rows, reports, latest: reports[0] }
    }).sort((a, b) => b.latest.localeCompare(a.latest))
    sources.forEach((S, idx) => {
      const cur = S.rows.filter(r => ymd(r.report_date) === S.reports[0])
      const prevR = S.reports[1] ? S.rows.filter(r => ymd(r.report_date) === S.reports[1]) : []
      const months = cur.sort((a, b) => ymd(a.period).localeCompare(ymd(b.period)))
        .map(r => {
          const p = prevR.find(x => ymd(x.period) === ymd(r.period))
          const delta = p ? ` (prev ${S.src} report ${fmt(p.volume_kt)}k, ${Number(r.volume_kt) >= Number(p.volume_kt) ? 'revised UP' : 'revised DOWN'} ${fmt(Math.abs(r.volume_kt - p.volume_kt))}k)` : ''
          return `  ${monthLabel(r.period)}: ${fmt(r.volume_kt)}k tons${delta}`
        })
      const total = cur.reduce((sum, r) => sum + Number(r.volume_kt), 0)
      const label = idx === 0 ? 'PRIMARY line-up lens' : 'secondary line-up lens (different provider - never compare volumes against the primary)'
      out.push(`${label} [source: ${S.src}] (report ${S.reports[0]}, ${freshness(S.reports[0], 10)}) - total visible ${fmt(total)}k tons:\n${months.join('\n')}`)
    })
  } else out.push('Line-up: no data entered.')

  // 2) Agrinvest pace YoY (within-source only)
  const pace = snaps.filter(r => r.series === 'ytd_pace' && r.product === 'amsul')
  if (pace.length) {
    const latestRep = [...new Set(pace.map(r => ymd(r.report_date)))].sort().reverse()[0]
    const rows = pace.filter(r => ymd(r.report_date) === latestRep)
      .sort((a, b) => ymd(b.period).localeCompare(ymd(a.period)))
    if (rows.length >= 2) {
      const curY = rows[0], prvY = rows[1]
      const yoy = ((curY.volume_kt - prvY.volume_kt) / prvY.volume_kt) * 100
      out.push(`Agrinvest program pace (report ${latestRep}): Jan-${monthLabel(curY.period)} ${fmt(curY.volume_kt)}k tons vs ${fmt(prvY.volume_kt)}k in Jan-${monthLabel(prvY.period)} -> ${pct(yoy)} vs the same window of ${yearOf(prvY.period)}. (Arrived + declared; compare only against Agrinvest itself.)`)
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
    const yr = yearOf(latest.period)
    const ytdCur = act.filter(r => yearOf(r.period) === yr)
      .reduce((s, r) => s + Number(r.volume_kt), 0)
    const monthsCovered = act.filter(r => yearOf(r.period) === yr).length
    const ytdPrev = act.filter(r => {
      const d = new Date(ymd(r.period) + 'T00:00:00')
      return d.getFullYear() === yr - 1 && d.getMonth() <= lm.getMonth()
    }).reduce((s, r) => s + Number(r.volume_kt), 0)
    let line = `Siacesp customs-cleared actuals: ${monthLabel(latest.period)} = ${fmt(latest.volume_kt)}k tons`
    if (samePrev) {
      const prevLabel = monthLabel(samePrev.period)
      line += ` vs ${fmt(samePrev.volume_kt)}k in ${prevLabel} (${pct(((latest.volume_kt - samePrev.volume_kt) / samePrev.volume_kt) * 100)} vs ${prevLabel})`
    }
    if (ytdPrev > 0) line += `. Jan-${monthLabel(latest.period).split(' ')[0]} total: ${fmt(ytdCur)}k in ${yr} vs ${fmt(ytdPrev)}k in ${yr - 1} (${pct(((ytdCur - ytdPrev) / ytdPrev) * 100)} vs same months of ${yr - 1})`
    line += `. (Realized customs data; compare only against Siacesp itself.)`
    out.push(line)
  }

  // 4) Siacesp annual trend
  const ann = snaps.filter(r => r.series === 'siacesp_annual' && r.product === 'amsul')
    .sort((a, b) => ymd(a.period).localeCompare(ymd(b.period)))
  if (ann.length >= 2) {
    const seq = ann.map(r => `${yearOf(r.period)}: ${fmt(r.volume_kt)}k`).join(', ')
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
    const prev = g[1]
    let line = `  ${cur.crop} x Amsul, ${cur.condition}, ${cur.region}: ${cur.ratio} sc/ton, ${freshness(cur.ratio_date)}.`
    if (prev) {
      const d = Number(cur.ratio) - Number(prev.ratio)
      const dir = d < 0 ? 'IMPROVED for the farmer (fewer bags per ton)'
        : d > 0 ? 'WORSENED for the farmer (more bags per ton)' : 'UNCHANGED'
      line += ` Week-on-week vs ${prev.ratio} (${ymd(prev.ratio_date)}): ${dir}, ${d >= 0 ? '+' : ''}${d.toFixed(1)} sc/ton (${pct((d / Number(prev.ratio)) * 100)}). THIS COMPUTED DIRECTION IS AUTHORITATIVE.`
    } else {
      line += ` No previous data point; weekly direction not computable.`
    }
    const bench = g.find(r => r.ref_avg_4y != null && r.ref_avg_4y !== '')
    if (bench) {
      const dev = ((Number(cur.ratio) - Number(bench.ref_avg_4y)) / Number(bench.ref_avg_4y)) * 100
      line += ` Level vs Agrinvest 4-year average (${Number(bench.ref_avg_4y).toFixed(1)}): ${pct(dev)} (${dev > 0 ? 'MORE EXPENSIVE than the historical norm' : 'CHEAPER than the historical norm'}). Level and weekly direction are independent facts - both can be true at once.`
    } else if (g.length >= 8) {
      const hist = g.slice(1).map(r => Number(r.ratio))
      const avg = hist.reduce((sum, v) => sum + v, 0) / hist.length
      const dev = ((Number(cur.ratio) - avg) / avg) * 100
      line += ` Level vs own ${hist.length}-point history (${avg.toFixed(1)}): ${pct(dev)}.`
    } else {
      line += ` [no 4-year benchmark entered and own history n=${g.length} is too thin - cite the weekly direction only]`
    }
    return line
  })
  return `### BARTER RATIOS (farmer purchasing power - LOWER ratio is BETTER for the farmer)\n${lines.join('\n')}`
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
  const loadBench = async () => {
    const { data, error } = await supabase
      .from('publications')
      .select('source, pub_date, low, high')
      .order('pub_date', { ascending: false })
      .limit(60)
    if (error) return []
    return data || []
  }
  const [pubs, freights, snaps, barter, progress, fx, benchRows] = await Promise.all([
    loadMarketRows('intl_publications', 2000).catch(() => []),
    loadMarketRows('freight_rates', 200).catch(() => []),
    loadMarketRows('supply_snapshots', 1000).catch(() => []),
    loadMarketRows('barter_ratios', 500).catch(() => []),
    loadMarketRows('purchase_progress', 300).catch(() => []),
    loadMarketRows('fx_rates', 200).catch(() => []),
    loadBench().catch(() => []),
  ])

  const blocks = [
    pricesBlock(pubs, benchRows),
    parityBlock(pubs, freights, benchRows),
    nUnitBlock(pubs),
    supplyBlock(snaps),
    barterBlock(barter),
    progressBlock(progress),
    fxBlock(fx),
  ].filter(Boolean)

  if (!blocks.length) return 'No external market data available yet.'
  const calendarNote = `### PUBLICATION CALENDAR (dating convention - treat as fact)
Prices: Argus & Fertecon publish Thursday; Agrinvest publishes Friday (entered by Monday).
Supply pace, line-up, barter, FX and purchase % are dated FRIDAY and entered MONDAY - they belong to the SAME market week as that week's Thursday/Friday prices. A Friday-dated figure is NOT older than Thursday's prices, and Monday entry lag is NOT staleness. Sources marked "pending" are on normal calendar schedule - never call them lagging, stale or divergent.`
  return [calendarNote, ...blocks].join('\n\n')
}
