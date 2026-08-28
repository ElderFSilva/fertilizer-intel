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

// Same-week COMPOSITE Amsul CFR compacted mids (argus + fertecon + agrinvest
// as available each week), keyed by the week's Thursday, ascending.
// The stance is FORMED from the composite, so it is GRADED against the
// composite - never a single source. Membership per week is disclosed.
function weekThuOf(dateStr) {
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

function benchSeries(pubs) {
  const weeks = {}
  pubs
    .filter(r => r.frequency === 'weekly' && r.product === 'amsul'
      && r.price_point === 'cfr_brazil' && r.grade === 'compacted')
    .forEach(r => {
      const wk = weekThuOf(r.pub_date)
      if (!wk) return
      const w = (weeks[wk] = weeks[wk] || {})
      const prev = w[r.source]
      if (!prev || ymd(r.pub_date) > prev.d) {
        w[r.source] = { d: ymd(r.pub_date), mid: (Number(r.price_low) + Number(r.price_high != null ? r.price_high : r.price_low)) / 2 }
      }
    })
  return Object.entries(weeks)
    .map(([date, srcs]) => {
      const entries = Object.entries(srcs)
      return {
        date,
        mid: entries.reduce((s2, [, v]) => s2 + v.mid, 0) / entries.length,
        sources: entries.map(([k]) => k).sort().join('+'),
      }
    })
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
      srcThen: start ? start.sources : null,
      srcAfter: end ? end.sources : null,
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

export async function buildTrackRecord(scope) {
  const [log, pubs] = await Promise.all([
    loadPositioningLog(scope),
    loadMarketRows('intl_publications', 2000).catch(() => []),
  ])
  const rows = scoreStances(log, pubs)
  const summary = summarize(rows)
  return { rows, summary }
}


// Compact text for the AI prompt
export function trackRecordText(record) {
  if (!record || !record.rows.length) return 'No stance history yet - this is an early call; keep confidence at low or moderate.'
  const { summary, rows } = record
  const o = summary.overall
  const parts = [
    `Scored stances: ${o.correct} of ${o.total} correct (${o.total ? Math.round(o.correct / o.total * 100) + '%' : 'n/a'}), ${summary.pending} pending. Scoring rule: same-week COMPOSITE CFR mid (argus/fertecon/agrinvest as available) move over the following 2 weeks, +/-${THRESHOLD_PCT}% threshold.`,
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
