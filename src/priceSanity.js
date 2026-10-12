// ── Price entry sanity guard ──
// Catches the two ways a price gets logged wrong (ruling 2026-10-12, after the
// "240-25" typo printed USD 135 as the week's low):
//   1. a malformed range - second number lower than the first, or a range far
//      wider than any real quote ("240-25", "250-240", "200-300");
//   2. a price far from what the desk itself has been logging for that same
//      product and grade in the last 30 days (±25%).
// Warnings only - the trader can still save. Reference = the desk's own
// logged prices (median), so it works for every product and grade and needs
// no publication to be loaded.

import { PRODUCTS } from './data.js'

export const REF_DAYS = 30
export const REF_MIN_ENTRIES = 3
export const DEVIATION_LIMIT = 0.25   // ±25% vs reference
export const RANGE_WIDTH_LIMIT = 0.15 // (hi − lo) / mid

const GRADE_FAMILY = {
  'Amsul GR': 'Amsul', 'Amsul STD': 'Amsul',
  'SSP 20%': 'SSP', 'SSP 19%': 'SSP', 'MC 20%': 'SSP',
  'TSP 45%': 'TSP', 'TSP 46%': 'TSP',
  'NP 10-45': 'NP', 'NP 11-44': 'NP', 'NP 08-40': 'NP', 'NP 08-40+5S': 'NP',
}
const DEFAULT_GRADE = { Amsul: 'Amsul GR', SSP: 'SSP 20%', TSP: 'TSP 45%', NP: 'NP 10-45' }

// "Amsul GR" -> { family: 'Amsul', grade: 'Amsul GR' }; "Urea" -> { family: 'Urea', grade: null }
export function productKey(label) {
  const t = (label || '').trim()
  if (!t) return null
  if (GRADE_FAMILY[t]) return { family: GRADE_FAMILY[t], grade: t }
  if (PRODUCTS.includes(t)) return { family: t, grade: DEFAULT_GRADE[t] || null }
  return null
}

// Read a price cell. Returns { kind, lo, hi, mid } with kind one of
// 'none' (empty), 'single', 'range', 'unreadable'.
export function parsePriceText(val) {
  if (val == null) return { kind: 'none' }
  const s = String(val).trim()
  if (!s) return { kind: 'none' }
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*(?:-|–|—|to|\/)\s*(\d+(?:[.,]\d+)?)/i)
  if (m) {
    const lo = parseFloat(toNum(m[1])), hi = parseFloat(toNum(m[2]))
    if (isNaN(lo) || isNaN(hi)) return { kind: 'unreadable' }
    return { kind: 'range', lo, hi, mid: (lo + hi) / 2, loText: m[1], hiText: m[2] }
  }
  const n = s.match(/\d+(?:[.,]\d+)?/)
  if (!n) return { kind: 'unreadable' }
  const v = parseFloat(toNum(n[0]))
  return isNaN(v) ? { kind: 'unreadable' } : { kind: 'single', lo: v, hi: v, mid: v }
}

const ymdOf = d => {
  if (!d) return null
  const x = new Date(String(d).slice(0, 10) + 'T00:00:00')
  return isNaN(x.getTime()) ? null : x
}

// Median of the desk's own logged prices for this product+grade over the
// REF_DAYS before asOf (exclusive of the call being edited). Null when fewer
// than REF_MIN_ENTRIES.
export function priceReference(calls, label, asOf, excludeCallId = null) {
  const key = productKey(label)
  if (!key || !Array.isArray(calls)) return null
  const end = ymdOf(asOf) || new Date()
  const start = new Date(end); start.setDate(start.getDate() - REF_DAYS)
  const vals = []
  calls.forEach(c => {
    if (excludeCallId && c.id === excludeCallId) return
    const d = ymdOf(c.date); if (!d || d < start || d > end) return
    const pr = c.prices?.[key.family]; if (!pr || !pr.value) return
    if (key.grade) {
      const g = pr.grade || DEFAULT_GRADE[key.family]
      if (g !== key.grade) return
    }
    const p = parsePriceText(pr.value)
    if ((p.kind === 'single' || p.kind === 'range') && p.mid > 0) vals.push(p.mid)
  })
  if (vals.length < REF_MIN_ENTRIES) return null
  vals.sort((a, b) => a - b)
  const mid = Math.floor(vals.length / 2)
  const median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2
  return { ref: median, n: vals.length, label: key.grade || key.family }
}

// For "240-25": the second number is missing a digit. Try it as the leading
// digits ("25" -> 250) and as the trailing digits ("5" -> 245); keep the first
// that lands just above the low end (within the range-width limit).
function suggestHi(loText, hiText) {
  if (hiText.length >= loText.length) return null
  const lo = parseFloat(toNum(loText))
  const cands = [
    hiText + '0'.repeat(loText.length - hiText.length),
    loText.slice(0, loText.length - hiText.length) + hiText,
  ]
  return cands.find(c => { const h = parseFloat(c); return h > lo && (h - lo) / lo <= RANGE_WIDTH_LIMIT }) || null
}

// "1,200" is a thousands separator; "247,5" is a decimal comma.
const toNum = t => /,\d{3}$/.test(t) ? t.replace(',', '') : t.replace(',', '.')

const fmt = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 })

// Returns a warning string or null. `reference` is the result of
// priceReference (may be null - then only the shape checks run).
export function checkPrice(val, reference = null) {
  const p = parsePriceText(val)
  if (p.kind === 'none' || p.kind === 'unreadable') return null
  if (p.kind === 'range') {
    if (p.hi < p.lo) {
      const sug = suggestHi(p.loText, p.hiText)
      return `Range reads ${fmt(p.lo)} → ${fmt(p.hi)} (high to low)${sug ? ` — did you mean ${p.loText}-${sug}?` : ''}`
    }
    if (p.mid > 0 && (p.hi - p.lo) / p.mid > RANGE_WIDTH_LIMIT) {
      return `Range ${fmt(p.lo)}-${fmt(p.hi)} is ${Math.round((p.hi - p.lo) / p.mid * 100)}% wide — check both numbers`
    }
  }
  if (reference && reference.ref > 0) {
    const dev = (p.mid - reference.ref) / reference.ref
    if (Math.abs(dev) > DEVIATION_LIMIT) {
      return `${fmt(p.mid)} is ${dev > 0 ? '+' : ''}${Math.round(dev * 100)}% vs the desk's recent ${reference.label} (median ${fmt(reference.ref)}, ${reference.n} entries in ${REF_DAYS} days)`
    }
  }
  return null
}
