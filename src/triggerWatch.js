// ── Trigger-Watch ──
// Every definitive stance carries machine-checkable exit conditions
// (metric / operator / level). This module recomputes the current value of
// each metric from entered data and reports whether any condition is hit.
// Pure arithmetic - no AI involved. It never changes the stance (Monday's
// commitment is immutable); it only refuses to let a falsified stance keep
// wearing a confident face.

import { supabase } from './supabaseClient.js'
import { loadMarketRows } from './cloudMarketData.js'

const ymd = v => String(v).slice(0, 10)

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

const mid = r => (Number(r.price_low) + Number(r.price_high != null ? r.price_high : r.price_low)) / 2

// Same-week composite for a series: latest entry per source within the most
// recent week that has data (mirrors the signal layer's composite rules).
function composite(pubs, product, point, grade) {
  const rows = pubs.filter(r => r.product === product && r.price_point === point
    && (grade == null || r.grade === grade) && r.frequency === 'weekly')
  if (!rows.length) return null
  const anchor = rows.map(r => weekThuOf(r.pub_date)).sort().reverse()[0]
  const bySrc = {}
  rows.filter(r => weekThuOf(r.pub_date) === anchor)
    .sort((a, b) => ymd(b.pub_date).localeCompare(a.pub_date))
    .forEach(r => { if (!bySrc[r.source]) bySrc[r.source] = mid(r) })
  const vals = Object.values(bySrc)
  return vals.length ? { value: vals.reduce((s, v) => s + v, 0) / vals.length, week: anchor, sources: Object.keys(bySrc).sort().join('+') } : null
}

function latestBarter(barter, condition) {
  const rows = barter
    .filter(r => r.product === 'amsul' && r.crop === 'corn' && r.condition === condition)
    .sort((a, b) => ymd(b.ratio_date).localeCompare(ymd(a.ratio_date)))
  return rows.length ? { value: Number(rows[0].ratio), week: weekThuOf(rows[0].ratio_date) } : null
}

// The trigger vocabulary. Every metric here is computed deterministically
// from entered data - the only quantities exit conditions may reference.
export const TRIGGER_METRICS = {
  cfr_composite: 'Amsul CFR Brazil compacted - same-week composite mid (USD/t)',
  fob_composite: 'Amsul FOB China compacted - same-week composite mid (USD/t)',
  parity_spread: 'CFR composite minus replacement cost (USD/t)',
  urea_cfr_mid: 'Urea CFR Brazil granular - same-week composite mid (USD/t)',
  barter_aprazo: 'Corn/Amsul barter a prazo (sc/ton, latest)',
  barter_antecipado: 'Corn/Amsul barter antecipado (sc/ton, latest)',
}

export async function computeTriggerMetrics() {
  const [pubs, freights, barter] = await Promise.all([
    loadMarketRows('intl_publications', 400).catch(() => []),
    loadMarketRows('freight_rates', 100).catch(() => []),
    loadMarketRows('barter_ratios', 100).catch(() => []),
  ])
  const cfr = composite(pubs, 'amsul', 'cfr_brazil', 'compacted')
  const fob = composite(pubs, 'amsul', 'fob_china', 'compacted')
    || composite(pubs, 'amsul', 'fob_china', 'standard')
  const urea = composite(pubs, 'urea', 'cfr_brazil', null)
  const own = freights
    .filter(f => f.source === 'own' && f.route === 'china_brazil')
    .sort((a, b) => ymd(b.rate_date).localeCompare(ymd(a.rate_date)))
  const pick = own.find(f => f.rate_type === 'contract') || own.find(f => f.rate_type === 'closed') || own[0]
  const frt = pick ? (pick.rate_high != null ? (Number(pick.rate_low) + Number(pick.rate_high)) / 2 : Number(pick.rate_low)) : null
  return {
    cfr_composite: cfr ? { ...cfr } : null,
    fob_composite: fob ? { ...fob } : null,
    parity_spread: (cfr && fob && frt != null) ? { value: cfr.value - (fob.value + frt), week: cfr.week } : null,
    urea_cfr_mid: urea ? { ...urea } : null,
    barter_aprazo: latestBarter(barter, 'a_prazo'),
    barter_antecipado: latestBarter(barter, 'antecipado'),
  }
}

const OPS = {
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
}

// Load the current week's definitive stance (or the most recent one) and
// evaluate its exit conditions against freshly computed metrics.
export async function evaluateTriggers(scope = 'global') {
  let stance = null
  try {
    const { data } = await supabase
      .from('positioning_log')
      .select('*')
      .eq('scope', scope)
      .order('generated_at', { ascending: true })
      .limit(400)
    if (data && data.length) {
      // definitive stance per week = first generated; take the latest week's
      const byWeek = {}
      data.forEach(r => {
        const wk = r.week_thursday ? ymd(r.week_thursday) : ymd(r.generated_at)
        if (!byWeek[wk]) byWeek[wk] = r
      })
      const weeks = Object.keys(byWeek).sort()
      stance = byWeek[weeks[weeks.length - 1]]
    }
  } catch { return null }
  if (!stance) return null

  const conds = Array.isArray(stance.exit_conditions) ? stance.exit_conditions : []
  if (!conds.length) return { stance, results: [], anyBreached: false, monitored: false }

  const metrics = await computeTriggerMetrics()
  const results = conds
    .filter(c => c && c.metric && OPS[c.op] && c.level != null)
    .map(c => {
      const m = metrics[c.metric]
      const current = m ? m.value : null
      const breached = current != null && OPS[c.op](current, Number(c.level))
      return {
        metric: c.metric,
        label: TRIGGER_METRICS[c.metric] || c.metric,
        op: c.op,
        level: Number(c.level),
        flips_to: c.flips_to || null,
        current,
        week: m ? m.week : null,
        breached,
      }
    })
  return {
    stance,
    results,
    anyBreached: results.some(r => r.breached),
    monitored: results.length > 0,
  }
}

// Compact text for the AI's weekly context: the standing stance's trigger
// status, so a new Monday stance can never ignore a breach.
export function triggerStatusText(evaluation) {
  if (!evaluation || !evaluation.stance) return ''
  const s = evaluation.stance
  const head = `Standing stance (week of ${ymd(s.week_thursday || s.generated_at)}): ${s.bias} / ${s.confidence}.`
  if (!evaluation.monitored) return `${head} Its exit conditions were prose-only (not machine-monitored).`
  const lines = evaluation.results.map(r =>
    `  ${r.metric} ${r.op} ${r.level} -> current ${r.current != null ? r.current.toFixed(1) : 'no data'} = ${r.breached ? 'BREACHED' : 'not breached'}`)
  const verdict = evaluation.anyBreached
    ? 'AT LEAST ONE EXIT CONDITION WAS BREACHED: the standing stance was falsified by the data. The new stance MUST address this explicitly.'
    : 'No exit condition breached: the standing stance survived its own test.'
  return `${head}\n${lines.join('\n')}\n${verdict}`
}
