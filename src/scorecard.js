// ── Indicator Scorecard (desk ruling 2026-10-22) ──
// Every indicator the app computes is graded against ONE yardstick - the same
// one the AI stance is graded on: the forward 2-week move of the CFR composite
// mid, Thursday to Thursday, ±1.5%. Each indicator has one fixed rule that
// says SELL or HOLD (or nothing). A SELL is correct when the market fell,
// a HOLD when it rose. Read every hit rate against the baselines on the same
// weeks: always-LONG and always-SHORT.
//
// Point-in-time: a rule at week W only sees data dated on/before W.
// Percentiles are computed on the record up to W, never the full record.
//
// Status: EARNED  = >= MIN_WEEKS scored and beats the better baseline by >= EDGE
//         FAILED  = >= MIN_WEEKS scored and below the better baseline
//         UNPROVEN = otherwise (too few weeks, or within EDGE of baseline)
// Nothing here is stored; it is recomputed from the entered tables every time.

import { loadMarketRows } from './cloudMarketData.js'
import { supabase } from './supabaseClient.js'
import { loadPositioningLog, scoreStances, benchSeries, THRESHOLD_PCT, HORIZON_DAYS } from './learningLoop.js'
import { weekThuOf, addDays } from './history.js'

export const MIN_WEEKS = 40
export const EDGE_PTS = 5
const N_CONTENT = { amsul: 21, urea: 46 }

const ymd = v => String(v || '').slice(0, 10)
const mid = r => (Number(r.price_low) + Number(r.price_high != null ? r.price_high : r.price_low)) / 2
const pctChange = (a, b) => (b == null || a == null || b === 0) ? null : ((a - b) / b) * 100

// Percentile of `value` within `values` (all <= date already filtered by caller)
function pctileOf(value, values) {
  if (value == null || !values.length) return null
  return Math.round(values.filter(v => v <= value).length / values.length * 100)
}
// Latest entry of an ascending [{date, v}] series on/before `d`
const at = (series, d) => { let out = null; for (const x of series) { if (x.date <= d) out = x; else break } return out }
// Entry on/before d - n days
const back = (series, d, days) => at(series, addDays(d, -days))

// ── Series builders (all ascending by date) ──

// Argus weekly series, Thursday-keyed: [{date, v}]
function argusWeekly(pubs, product, pricePoint, grade) {
  const by = {}
  pubs.filter(r => r.source === 'argus' && r.frequency === 'weekly' && r.product === product
    && r.price_point === pricePoint && (grade == null || r.grade === grade))
    .forEach(r => { const wk = weekThuOf(r.pub_date); if (!wk) return; const d = ymd(r.pub_date); if (!by[wk] || by[wk].d < d) by[wk] = { d, v: mid(r) } })
  return Object.entries(by).map(([date, x]) => ({ date, v: x.v })).sort((a, b) => a.date.localeCompare(b.date))
}
// Weekly composite of any source for a product/price point/grade
function compositeWeekly(pubs, product, pricePoint, grade) {
  const by = {}
  pubs.filter(r => r.frequency === 'weekly' && r.product === product && r.price_point === pricePoint && (grade == null || r.grade === grade))
    .forEach(r => { const wk = weekThuOf(r.pub_date); if (!wk) return; const d = ymd(r.pub_date); by[wk] = by[wk] || {}; if (!by[wk][r.source] || by[wk][r.source].d < d) by[wk][r.source] = { d, v: mid(r) } })
  return Object.entries(by).map(([date, s]) => { const v = Object.values(s); return { date, v: v.reduce((a, e) => a + e.v, 0) / v.length } })
    .sort((a, b) => a.date.localeCompare(b.date))
}
function premiumWeekly(pubs) {
  const am = argusWeekly(pubs, 'amsul', 'cfr_brazil', 'compacted')
  const ur = argusWeekly(pubs, 'urea', 'cfr_brazil', null)
  const urBy = {}; ur.forEach(x => { urBy[x.date] = x.v })
  return am.filter(x => urBy[x.date] != null)
    .map(x => ({ date: x.date, v: ((x.v / N_CONTENT.amsul) / (urBy[x.date] / N_CONTENT.urea) - 1) * 100 }))
}
function fxWeekly(fx) {
  return (fx || []).filter(r => r.pair === 'usd_brl' && r.rate != null)
    .map(r => ({ date: ymd(r.rate_date), v: Number(r.rate) }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
function barterSeries(barter, condition) {
  return (barter || []).filter(r => r.product === 'amsul' && r.crop === 'corn' && r.condition === condition && r.ratio != null)
    .map(r => ({ date: ymd(r.ratio_date), v: Number(r.ratio) }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
// Line-up: per report, the sum of the two months after the report month
// (within the report's own source; sources are never mixed).
function lineupNext2(snaps) {
  const rows = (snaps || []).filter(r => r.series === 'lineup' && r.product === 'amsul')
  const byRep = {}
  rows.forEach(r => { const k = `${r.source}|${ymd(r.report_date)}`; (byRep[k] = byRep[k] || { source: r.source, date: ymd(r.report_date), months: {} }).months[ymd(r.period)] = Number(r.volume_kt) })
  return Object.values(byRep).map(rep => {
    const m0 = rep.date.slice(0, 7)
    const next = Object.entries(rep.months).filter(([p]) => p.slice(0, 7) > m0).sort(([a], [b]) => a.localeCompare(b)).slice(0, 2)
    if (next.length < 2) return null
    return { date: rep.date, source: rep.source, v: next.reduce((s, [, kt]) => s + kt, 0) }
  }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date))
}
// Agrinvest pace: per report, YoY % of the latest two periods
function paceSeries(snaps) {
  const rows = (snaps || []).filter(r => r.series === 'ytd_pace' && r.product === 'amsul')
  const byRep = {}
  rows.forEach(r => { (byRep[ymd(r.report_date)] = byRep[ymd(r.report_date)] || []).push(r) })
  return Object.entries(byRep).map(([date, list]) => {
    const s = list.sort((a, b) => ymd(b.period).localeCompare(ymd(a.period)))
    if (s.length < 2 || !Number(s[1].volume_kt)) return null
    return { date, v: pctChange(Number(s[0].volume_kt), Number(s[1].volume_kt)) }
  }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date))
}
// Purchase %: per report, average pct across regions for the main crop
function purchaseSeries(progress) {
  const byRep = {}
  ;(progress || []).forEach(r => { if (r.pct == null) return; (byRep[ymd(r.report_date)] = byRep[ymd(r.report_date)] || []).push(Number(r.pct)) })
  return Object.entries(byRep).map(([date, arr]) => ({ date, v: arr.reduce((a, b) => a + b, 0) / arr.length }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ── Indicator definitions: value(ctx, W) -> { value, signal } ──
// signal: 'SELL' | 'HOLD' | null. value is what the trader sees ("76th pct").
const SELL = 'SELL', HOLD = 'HOLD'

export const INDICATORS = [
  {
    key: 'cfr_pct', label: 'CFR percentile', unit: 'pct',
    rule: 'SELL when Argus CFR mid ≥ P75 of its record to date; HOLD when ≤ P25 (needs 52 prior weeks)',
    history: 'Argus 2020→',
    eval(ctx, W) {
      const s = ctx.cfrArgus; const cur = at(s, W); if (!cur) return null
      const prior = s.filter(x => x.date <= W).map(x => x.v)
      if (prior.length < 52) return { value: null, signal: null, note: 'record < 52 weeks' }
      const p = pctileOf(cur.v, prior)
      return { value: p, signal: p >= 75 ? SELL : p <= 25 ? HOLD : null }
    },
  },
  {
    key: 'momentum4', label: 'CFR momentum (4 weeks)', unit: '%',
    rule: 'SELL when the Argus CFR mid fell ≥ 3% over 4 weeks; HOLD when it rose ≥ 3%',
    history: 'Argus 2020→',
    eval(ctx, W) {
      const cur = at(ctx.cfrArgus, W), prev = back(ctx.cfrArgus, W, 28); if (!cur || !prev || prev.date === cur.date) return null
      const v = pctChange(cur.v, prev.v)
      return { value: v, signal: v <= -3 ? SELL : v >= 3 ? HOLD : null }
    },
  },
  {
    key: 'n_premium', label: 'Amsul premium vs urea (per unit N)', unit: 'pct',
    rule: 'SELL when the premium ≥ P90 of its record to date; HOLD when ≤ P25 (needs 52 prior weeks)',
    history: 'Argus 2020→',
    eval(ctx, W) {
      const s = ctx.premium; const cur = at(s, W); if (!cur) return null
      const prior = s.filter(x => x.date <= W).map(x => x.v)
      if (prior.length < 52) return { value: null, signal: null, note: 'record < 52 weeks' }
      const p = pctileOf(cur.v, prior)
      return { value: p, signal: p >= 90 ? SELL : p <= 25 ? HOLD : null }
    },
  },
  {
    key: 'urea_dir', label: 'Urea direction (2 weeks)', unit: '%',
    rule: 'SELL when urea CFR fell ≥ 2% over 2 weeks; HOLD when it rose ≥ 2%',
    history: 'Argus 2020→',
    eval(ctx, W) {
      const cur = at(ctx.urea, W), prev = back(ctx.urea, W, 14); if (!cur || !prev || prev.date === cur.date) return null
      const v = pctChange(cur.v, prev.v)
      return { value: v, signal: v <= -2 ? SELL : v >= 2 ? HOLD : null }
    },
  },
  {
    key: 'parity_spread', label: 'CFR − FOB China spread', unit: 'pct',
    rule: 'SELL when the spread (CFR composite − FOB China composite, freight excluded) ≥ P75 of its record to date; HOLD when ≤ P25 (needs 52 prior weeks)',
    history: 'intl publications 2020→',
    eval(ctx, W) {
      const s = ctx.spread; const cur = at(s, W); if (!cur) return null
      const prior = s.filter(x => x.date <= W).map(x => x.v)
      if (prior.length < 52) return { value: null, signal: null, note: 'record < 52 weeks' }
      const p = pctileOf(cur.v, prior)
      return { value: p, signal: p >= 75 ? SELL : p <= 25 ? HOLD : null }
    },
  },
  {
    key: 'fx', label: 'USD/BRL (4 weeks)', unit: '%',
    rule: 'SELL when BRL weakened ≥ 3% over 4 weeks (USD/BRL up); HOLD when it strengthened ≥ 3%',
    history: 'fx_rates as entered',
    eval(ctx, W) {
      const cur = at(ctx.fx, W), prev = back(ctx.fx, W, 28); if (!cur || !prev || prev.date === cur.date) return null
      const v = pctChange(cur.v, prev.v)
      return { value: v, signal: v >= 3 ? SELL : v <= -3 ? HOLD : null }
    },
  },
  {
    key: 'lineup_2m', label: 'Line-up, next 2 months', unit: 'kt',
    rule: 'SELL when the next two months\' line-up (same source) is above the median of prior reports; HOLD when below (needs 8 prior reports)',
    history: 'Orion Aug 2026→',
    eval(ctx, W) {
      const cur = at(ctx.lineup, W); if (!cur) return null
      const prior = ctx.lineup.filter(x => x.date < cur.date && x.source === cur.source).map(x => x.v)
      if (prior.length < 8) return { value: cur.v, signal: null, note: `${prior.length} prior reports` }
      const sorted = [...prior].sort((a, b) => a - b); const med = sorted[Math.floor(sorted.length / 2)]
      return { value: cur.v, signal: cur.v > med ? SELL : cur.v < med ? HOLD : null }
    },
  },
  {
    key: 'pace_yoy', label: 'Agrinvest pace vs last year', unit: '%',
    rule: 'SELL when the program pace is ≥ 10% ahead of last year; HOLD when ≥ 10% behind',
    history: 'Agrinvest Aug 2026→',
    eval(ctx, W) {
      const cur = at(ctx.pace, W); if (!cur || cur.v == null) return null
      return { value: cur.v, signal: cur.v >= 10 ? SELL : cur.v <= -10 ? HOLD : null }
    },
  },
  {
    key: 'barter_antecipado', label: 'Barter corn×Amsul, antecipado (4 weeks)', unit: '%',
    rule: 'SELL when the ratio rose ≥ 5% over 4 weeks (more corn per tonne - worse for the farmer); HOLD when it fell ≥ 5%',
    history: 'Agrinvest Aug 2026→',
    eval(ctx, W) {
      const cur = at(ctx.barterAnt, W), prev = back(ctx.barterAnt, W, 28); if (!cur || !prev || prev.date === cur.date) return null
      const v = pctChange(cur.v, prev.v)
      return { value: v, signal: v >= 5 ? SELL : v <= -5 ? HOLD : null }
    },
  },
  {
    key: 'barter_aprazo', label: 'Barter corn×Amsul, a prazo (4 weeks)', unit: '%',
    rule: 'SELL when the ratio rose ≥ 5% over 4 weeks; HOLD when it fell ≥ 5%',
    history: 'Agrinvest Aug 2026→',
    eval(ctx, W) {
      const cur = at(ctx.barterPrz, W), prev = back(ctx.barterPrz, W, 28); if (!cur || !prev || prev.date === cur.date) return null
      const v = pctChange(cur.v, prev.v)
      return { value: v, signal: v >= 5 ? SELL : v <= -5 ? HOLD : null }
    },
  },
  {
    key: 'purchase_pct', label: 'Farmer purchase % vs last year', unit: 'pts',
    rule: 'SELL when purchases are ≥ 5 points ahead of the same week last year; HOLD when ≥ 5 points behind',
    history: 'Agrinvest Aug 2026→',
    eval(ctx, W) {
      const cur = at(ctx.purchase, W); if (!cur) return null
      const ly = at(ctx.purchase, addDays(W, -364))
      if (!ly || ly.date < addDays(W, -378)) return { value: cur.v, signal: null, note: 'no same-week figure last year' }
      const v = cur.v - ly.v
      return { value: v, signal: v >= 5 ? SELL : v <= -5 ? HOLD : null }
    },
  },
]

// ── Outcome per week on the shared yardstick ──
function outcomes(bench) {
  const midAt = d => { const c = bench.filter(x => x.date <= d); return c.length ? c[c.length - 1] : null }
  const midFrom = d => bench.find(x => x.date >= d) || null
  return bench.map(w => {
    const start = midAt(w.date), end = midFrom(addDays(w.date, HORIZON_DAYS))
    if (!start || !end || end.date <= start.date) return { date: w.date, mid: w.mid, move: null, cls: 'PENDING' }
    const move = ((end.mid - start.mid) / start.mid) * 100
    const cls = move >= THRESHOLD_PCT ? 'UP' : move <= -THRESHOLD_PCT ? 'DOWN' : 'FLAT'
    return { date: w.date, mid: w.mid, move, cls }
  })
}

function tally(calls) {
  const scored = calls.filter(c => c.cls !== 'PENDING')
  const correct = scored.filter(c => (c.signal === SELL && c.cls === 'DOWN') || (c.signal === HOLD && c.cls === 'UP')).length
  const up = scored.filter(c => c.cls === 'UP').length, down = scored.filter(c => c.cls === 'DOWN').length
  const n = scored.length
  const rate = n ? Math.round(correct / n * 100) : null
  const baseLong = n ? Math.round(up / n * 100) : null
  const baseShort = n ? Math.round(down / n * 100) : null
  const best = n ? Math.max(baseLong, baseShort) : null
  let status = 'UNPROVEN'
  if (n >= MIN_WEEKS && rate != null) status = rate >= best + EDGE_PTS ? 'EARNED' : rate < best ? 'FAILED' : 'UNPROVEN'
  return { n, correct, rate, baseLong, baseShort, best, status, sells: scored.filter(c => c.signal === SELL).length, holds: scored.filter(c => c.signal === HOLD).length }
}

// Pure computation from already-loaded rows.
export function computeScorecard({ pubs, freights, snaps, barter, progress, fx, log }) {
  const bench = benchSeries(pubs)   // CFR composite per week - the yardstick
  const outs = outcomes(bench)
  const cfrComp = compositeWeekly(pubs, 'amsul', 'cfr_brazil', 'compacted')
  const fobComp = compositeWeekly(pubs, 'amsul', 'fob_china', 'compacted')
  const fobBy = {}; fobComp.forEach(x => { fobBy[x.date] = x.v })
  const ctx = {
    cfrArgus: argusWeekly(pubs, 'amsul', 'cfr_brazil', 'compacted'),
    urea: argusWeekly(pubs, 'urea', 'cfr_brazil', null),
    premium: premiumWeekly(pubs),
    spread: cfrComp.filter(x => fobBy[x.date] != null).map(x => ({ date: x.date, v: x.v - fobBy[x.date] })),
    fx: fxWeekly(fx),
    lineup: lineupNext2(snaps),
    pace: paceSeries(snaps),
    barterAnt: barterSeries(barter, 'antecipado'),
    barterPrz: barterSeries(barter, 'a_prazo'),
    purchase: purchaseSeries(progress),
  }
  const latestWeek = outs.length ? outs[outs.length - 1].date : null

  const rows = INDICATORS.map(ind => {
    const calls = []
    let firstCall = null, lastCall = null
    outs.forEach(o => {
      const r = ind.eval(ctx, o.date)
      if (!r || !r.signal) return
      calls.push({ date: o.date, signal: r.signal, value: r.value, cls: o.cls, move: o.move })
      if (!firstCall) firstCall = o.date
      lastCall = o.date
    })
    const t = tally(calls)
    const now = latestWeek ? ind.eval(ctx, latestWeek) : null
    return {
      key: ind.key, label: ind.label, rule: ind.rule, history: ind.history, unit: ind.unit,
      ...t, firstCall, lastCall,
      now: now ? { value: now.value, signal: now.signal, note: now.note || null } : null,
      recent: calls.slice(-8).reverse(),
    }
  })

  // The AI stance on the identical yardstick, over the weeks it made a call
  const stances = scoreStances(log || [], pubs)
  const stanceCalls = stances.filter(s => s.result !== 'pending' && (s.bias === 'LONG' || s.bias === 'SHORT')).map(s => ({
    date: s.week, signal: s.bias === 'SHORT' ? SELL : HOLD, value: null,
    cls: s.changePct >= THRESHOLD_PCT ? 'UP' : s.changePct <= -THRESHOLD_PCT ? 'DOWN' : 'FLAT', move: s.changePct,
  }))
  const stanceRow = { key: 'ai_stance', label: 'AI weekly stance (LONG/SHORT only)', rule: 'SHORT = SELL, LONG = HOLD; NEUTRAL weeks not counted here', history: `positioning log, ${stances.length} stances`, ...tally(stanceCalls), recent: stanceCalls.slice(-8).reverse(), now: null }

  // Overall base rates on every scored week
  const all = outs.filter(o => o.cls !== 'PENDING')
  const base = {
    n: all.length,
    up: all.filter(o => o.cls === 'UP').length,
    down: all.filter(o => o.cls === 'DOWN').length,
    flat: all.filter(o => o.cls === 'FLAT').length,
    from: all.length ? all[0].date : null, to: all.length ? all[all.length - 1].date : null,
  }
  return { rows, stanceRow, base, latestWeek, yardstick: { horizonDays: HORIZON_DAYS, thresholdPct: THRESHOLD_PCT }, minWeeks: MIN_WEEKS, edgePts: EDGE_PTS }
}

export async function loadScorecard() {
  const [pubs, freights, snaps, barter, progress, fx, log] = await Promise.all([
    loadMarketRows('intl_publications', 5000).catch(() => []),
    loadMarketRows('freight_rates', 200).catch(() => []),
    loadMarketRows('supply_snapshots', 2000).catch(() => []),
    loadMarketRows('barter_ratios', 1000).catch(() => []),
    loadMarketRows('purchase_progress', 1000).catch(() => []),
    loadMarketRows('fx_rates', 1000).catch(() => []),
    loadPositioningLog('global').catch(() => []),
  ])
  return computeScorecard({ pubs, freights, snaps, barter, progress, fx, log })
}

// ── Text for the AI prompt: status and record next to each indicator ──
const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]) }
const fmtVal = (r) => {
  const v = r.now?.value
  if (v == null) return r.now?.note ? `n/a (${r.now.note})` : 'n/a'
  if (r.unit === 'pct') return `${ordinal(v)} pct`
  if (r.unit === 'kt') return `${Math.round(v)}k`
  if (r.unit === 'pts') return `${v >= 0 ? '+' : ''}${v.toFixed(1)} pts`
  return `${v >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`
}
export function scorecardText(sc) {
  if (!sc || !sc.rows.length) return null
  const lines = sc.rows.map(r => {
    const rec = r.n ? `${r.rate}% on ${r.n} weeks vs baseline always-LONG ${r.baseLong}% / always-SHORT ${r.baseShort}%` : 'no scored weeks yet'
    const use = r.status === 'FAILED' ? ' -> DO NOT USE FOR THE STANCE'
      : r.status === 'EARNED' ? ' -> usable'
      : ' -> unproven: context only, never a stance driver on its own'
    return `- ${r.label}: now ${fmtVal(r)}${r.now?.signal ? `, rule says ${r.now.signal}` : ', rule says nothing'} | status ${r.status} (${rec})${use}`
  })
  const s = sc.stanceRow
  const stanceLine = s.n ? `AI stance record on the same yardstick: ${s.rate}% on ${s.n} weeks vs always-LONG ${s.baseLong}% / always-SHORT ${s.baseShort}% (${s.status}).` : 'AI stance: no scored weeks yet.'
  const baseLine = sc.base.n ? `Base rates ${sc.base.from}→${sc.base.to} (${sc.base.n} weeks): UP ${Math.round(sc.base.up / sc.base.n * 100)}%, DOWN ${Math.round(sc.base.down / sc.base.n * 100)}%, FLAT ${Math.round(sc.base.flat / sc.base.n * 100)}%.` : ''
  return `### INDICATOR SCORECARD (computed, authoritative - every rule graded on the forward ${sc.yardstick.horizonDays}-day CFR composite move, ±${sc.yardstick.thresholdPct}%; status needs ${sc.minWeeks} scored weeks and ${sc.edgePts} points over the better baseline)
${baseLine}
${lines.join('\n')}
${stanceLine}
RULE: weigh EARNED indicators first; UNPROVEN ones are context; FAILED ones must not drive the stance. An indicator's current reading is only as good as its record.`
}
