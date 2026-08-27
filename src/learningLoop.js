// ── Learning loop: the app grades its own past stances and remembers lessons ──
// 1) scoreStances: every logged LONG/NEUTRAL/SHORT call is scored against what
//    the Argus Amsul CFR Brazil (compacted) mid actually did over the following
//    ~2 weeks. Nothing is stored — outcomes are recomputed from source data on
//    every run, so the scorecard can never drift from the evidence.
// 2) buildTrackRecord: the scorecard, as data (for the UI) and as text (for the
//    AI prompt, so confidence is calibrated by the record, not by feeling).
// 3) buildLessonsText: desk-taught lessons, injected into every analysis.
//
// Scoring rule (documented, fixed): over the following 2 weeks,
//   LONG    correct if the mid moved >= +1.5%
//   SHORT   correct if the mid moved <= -1.5%
//   NEUTRAL correct if the mid stayed within +/-1.5%
// Stances younger than 2 weeks are PENDING.

import { supabase } from './supabaseClient.js'
import { loadMarketRows } from './cloudMarketData.js'

const ymd = v => String(v).slice(0, 10)
const THRESHOLD_PCT = 1.5
const HORIZON_DAYS = 14

function addDays(dateStr, n) {
  const d = new Date(ymd(dateStr) + 'T00:00:00')
  d.setDate(d.getDate() + n)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// Argus Amsul CFR compacted weekly mids, ascending by date
function benchSeries(pubs) {
  return pubs
    .filter(r => r.source === 'argus' && r.frequency === 'weekly' && r.product === 'amsul'
      && r.price_point === 'cfr_brazil' && r.grade === 'compacted')
    .map(r => ({
      date: ymd(r.pub_date),
      mid: (Number(r.price_low) + Number(r.price_high != null ? r.price_high : r.price_low)) / 2,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// Latest assessment on/before a date; earliest assessment on/after a date
const midAt = (series, d) => { const c = series.filter(x => x.date <= d); return c.length ? c[c.length - 1] : null }
const midFrom = (series, d) => series.find(x => x.date >= d) || null

export async function loadPositioningLog(scope) {
  let q = supabase.from('positioning_log').select('*').order('generated_at', { ascending: false }).limit(200)
  if (scope) q = q.eq('scope', scope)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export function scoreStances(log, pubs) {
  const series = benchSeries(pubs)
  // One stance per week per scope: keep the latest generated for each week_thursday
  const seen = new Set()
  const rows = []
  for (const r of log) {
    const week = r.week_thursday ? ymd(r.week_thursday) : ymd(r.generated_at)
    const key = `${r.scope}|${week}`
    if (seen.has(key)) continue
    seen.add(key)
    const start = midAt(series, week)
    const end = midFrom(series, addDays(week, HORIZON_DAYS))
    let result = 'pending'
    let changePct = null
    if (start && end && end.date > start.date) {
      changePct = ((end.mid - start.mid) / start.mid) * 100
      if (r.bias === 'LONG') result = changePct >= THRESHOLD_PCT ? 'correct' : 'wrong'
      else if (r.bias === 'SHORT') result = changePct <= -THRESHOLD_PCT ? 'correct' : 'wrong'
      else result = Math.abs(changePct) < THRESHOLD_PCT ? 'correct' : 'wrong'
    }
    rows.push({
      week, bias: r.bias, confidence: r.confidence,
      priceThen: start ? start.mid : null,
      priceAfter: end ? end.mid : null,
      changePct, result,
      rationale: r.rationale, trigger: r.trigger_condition,
    })
  }
  return rows
}

function tally(rows, pred) {
  const set = rows.filter(r => r.result !== 'pending' && pred(r))
  const correct = set.filter(r => r.result === 'correct').length
  return { correct, total: set.length }
}

export function summarize(rows) {
  const overall = tally(rows, () => true)
  const pending = rows.filter(r => r.result === 'pending').length
  const byBias = {}
  ;['LONG', 'SHORT', 'NEUTRAL'].forEach(b => { byBias[b] = tally(rows, r => r.bias === b) })
  const byConf = {}
  ;['low', 'moderate', 'high'].forEach(c => { byConf[c] = tally(rows, r => (r.confidence || '').toLowerCase() === c) })
  return { overall, pending, byBias, byConf }
}

export async function buildTrackRecord(scope, sales = null) {
  const [log, pubs] = await Promise.all([
    loadPositioningLog(scope),
    loadMarketRows('intl_publications', 2000).catch(() => []),
  ])
  const rows = scoreStances(log, pubs)
  const summary = summarize(rows)
  const behavior = Array.isArray(sales) ? scoreDeskBehavior(rows, pubs, sales) : null
  return { rows, summary, behavior }
}


// ── Stance vs desk behavior: did the desk act on the call, and did acting work? ──
// For each stance week, examine Amsul GR sales in the following HORIZON_DAYS:
//  - followed?  SHORT: sold >= 1.25x trailing-12w weekly baseline volume.
//               LONG: sold <= 0.75x baseline OR sold only at capture >= 0.
//               NEUTRAL: exempt (n/a).
//  - capture:   volume-weighted realized price vs Argus mid at each deal date.
//  - hindsight: sale VWAP vs the mid at the end of the window
//               (positive = selling beat waiting).
// Recomputed from source data on every run - nothing stored.
const saleDateOf = s => ymd(s.dealDate || s.deal_date || s.date || s.created_at || '')
const saleNum = v => { const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? null : n }
const isGRSale = s => (s.product || '').trim().toLowerCase() === 'amsul gr'

export function scoreDeskBehavior(stanceRows, pubs, sales) {
  const series = benchSeries(pubs)
  const grSales = (sales || []).filter(s => isGRSale(s) && saleNum(s.donePrice) != null && saleDateOf(s))
    .map(s => ({ d: saleDateOf(s), price: saleNum(s.donePrice), vol: saleNum(s.volume) || 0 }))
  const volBetween = (a, b) => grSales.filter(x => x.d > a && x.d <= b)
  const today = ymd(new Date().toISOString())

  // EXCLUSIVE attribution: a stance governs from its week until the next
  // stance takes over (capped at HORIZON_DAYS). Every sale belongs to exactly
  // one stance - the one in force on its deal date. No overlapping windows.
  const ordered = [...stanceRows].sort((a, b) => b.week.localeCompare(a.week)) // newest first
  const rows = ordered.map((r, idx) => {
    const start = r.week
    const nextWeek = idx > 0 ? ordered[idx - 1].week : null
    const cap = addDays(start, HORIZON_DAYS)
    const end = [nextWeek, cap, today].filter(Boolean).sort()[0]
    const periodDays = Math.max(0, Math.round((new Date(end + 'T00:00:00') - new Date(start + 'T00:00:00')) / 86400000))
    const win = volBetween(start, end)
    const vol = win.reduce((s, x) => s + x.vol, 0)
    const weeklyRate = periodDays >= 1 ? vol / (periodDays / 7) : 0
    // baseline: trailing 12 weeks before the stance, as a weekly rate
    const baseWin = volBetween(addDays(start, -84), start)
    const baseWeekly = baseWin.reduce((s, x) => s + x.vol, 0) / 12
    const scored = win.map(x => {
      const m = midAt(series, x.d)
      const after = midFrom(series, addDays(x.d, HORIZON_DAYS))
      return m ? { ...x, capture: x.price - m.mid, hind: after ? x.price - after.mid : null } : null
    }).filter(Boolean)
    const wVol = scored.reduce((s, x) => s + x.vol, 0)
    const capture = wVol > 0 ? scored.reduce((s, x) => s + x.capture * x.vol, 0) / wVol : null
    const hindScored = scored.filter(x => x.hind != null)
    const hVol = hindScored.reduce((s, x) => s + x.vol, 0)
    const hindsight = hVol > 0 ? hindScored.reduce((s, x) => s + x.hind * x.vol, 0) / hVol : null
    let followed = 'n/a'
    if (r.bias === 'SHORT' || r.bias === 'LONG') {
      const isLatest = idx === 0
      if (isLatest && periodDays < 7) followed = 'pending'
      else if (r.bias === 'SHORT') followed = baseWeekly > 0 ? (weeklyRate >= 1.25 * baseWeekly ? 'followed' : 'ignored') : (vol > 0 ? 'followed' : 'ignored')
      else followed = (weeklyRate <= 0.75 * baseWeekly || (capture != null && capture >= 0)) ? 'followed' : 'ignored'
    }
    return {
      week: r.week, bias: r.bias, confidence: r.confidence, result: r.result,
      periodDays, soldVol: Math.round(vol), deals: win.length,
      baseWeekly: Math.round(baseWeekly), capture, hindsight, followed,
    }
  })
  const actionable = rows.filter(r => r.followed === 'followed' || r.followed === 'ignored')
  const followedRows = actionable.filter(r => r.followed === 'followed')
  const avg = (arr, k) => { const v = arr.map(r => r[k]).filter(x => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null }
  return {
    rows,
    summary: {
      actionable: actionable.length,
      followed: followedRows.length,
      avgCaptureFollowed: avg(followedRows, 'capture'),
      avgHindsightFollowed: avg(followedRows, 'hindsight'),
    },
  }
}

export function deskBehaviorText(behavior) {
  if (!behavior || !behavior.summary.actionable) return ''
  const b = behavior.summary
  const parts = [
    `Stance-vs-desk: of ${b.actionable} actionable stances (LONG/SHORT), the desk acted in line with ${b.followed}.`,
  ]
  if (b.avgCaptureFollowed != null) parts.push(`When following, execution captured ${b.avgCaptureFollowed >= 0 ? '+' : ''}${b.avgCaptureFollowed.toFixed(0)} USD/t vs the mid at deal date.`)
  if (b.avgHindsightFollowed != null) parts.push(`Hindsight: sales made while following beat the 2-weeks-later mid by ${b.avgHindsightFollowed >= 0 ? '+' : ''}${b.avgHindsightFollowed.toFixed(0)} USD/t on average (positive = acting beat waiting).`)
  if (b.actionable < 4) parts.push(`[only ${b.actionable} actionable stances - weak evidence, do not over-adjust]`)
  return parts.join(' ')
}

// Compact text for the AI prompt
export function trackRecordText(record) {
  if (!record || !record.rows.length) return 'No stance history yet - this is an early call; keep confidence at low or moderate.'
  const { summary, rows } = record
  const o = summary.overall
  const parts = [
    `Scored stances: ${o.correct} of ${o.total} correct (${o.total ? Math.round(o.correct / o.total * 100) + '%' : 'n/a'}), ${summary.pending} pending. Scoring rule: Argus CFR mid move over the following 2 weeks, +/-${THRESHOLD_PCT}% threshold.`,
  ]
  const biasBits = Object.entries(summary.byBias).filter(([, v]) => v.total > 0)
    .map(([b, v]) => `${b} ${v.correct}/${v.total}`)
  if (biasBits.length) parts.push(`By bias: ${biasBits.join(', ')}.`)
  const confBits = Object.entries(summary.byConf).filter(([, v]) => v.total > 0)
    .map(([c, v]) => `${c} ${v.correct}/${v.total}`)
  if (confBits.length) parts.push(`By stated confidence: ${confBits.join(', ')}.`)
  const recent = rows.filter(r => r.result !== 'pending').slice(0, 4)
    .map(r => `${r.week}: ${r.bias}/${r.confidence} -> market ${r.changePct >= 0 ? '+' : ''}${r.changePct.toFixed(1)}% -> ${r.result.toUpperCase()}`)
  if (recent.length) parts.push(`Most recent scored: ${recent.join('; ')}.`)
  if (o.total < 6) parts.push(`[only ${o.total} scored stances - the record itself is weak evidence; do not over-adjust on it]`)
  return parts.join('\n')
}

// Desk lessons: admin-taught knowledge, injected into every analysis
export async function buildLessonsText() {
  try {
    const rows = await loadMarketRows('desk_lessons', 100)
    if (!rows.length) return ''
    return rows
      .sort((a, b) => ymd(a.lesson_date).localeCompare(ymd(b.lesson_date)))
      .map(r => `- [${ymd(r.lesson_date)}] ${r.lesson}`)
      .join('\n')
  } catch { return '' }
}
