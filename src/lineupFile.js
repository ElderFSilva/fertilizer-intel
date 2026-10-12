// ── Orion line-up file: parse, validate, summarise ──
// The Orion "Fertilizers_Base_ETBETS" export is one row per parcel (vessel x
// receiver x cargo). This module turns the .xls into clean parcel rows for
// storage and the per-month totals the line-up series needs.
//
// Desk rulings (2026-09-29): month key = ETB; Amsul only for now; every
// upload is an append-only snapshot dated by the admin (one per date).

import * as XLSX from 'xlsx'

// Header names as Orion prints them -> our column names. Matching is by
// header text (trimmed, case-insensitive), so column order does not matter.
const HEADERS = {
  'batch group': 'batch_group',
  'port': 'port',
  'terminal': 'terminal',
  'berth': 'berth',
  'vessel': 'vessel',
  'type of operation': 'operation',
  'receiver/shipper': 'receiver',
  'charterer nome': 'charterer',
  'cargo': 'cargo',
  'qtty': 'qty_t',
  'total vessel volume': 'vessel_total_t',
  'origin/destiny': 'origin',
  'eta': 'eta',
  'etb': 'etb',
  'ets': 'ets',
  'region': 'region',
  'imo': 'imo',
}
const REQUIRED = ['batch_group', 'port', 'vessel', 'operation', 'receiver', 'charterer', 'cargo', 'qty_t', 'etb']

export const AMSUL_MATCH = /amm\.?\s*sulph/i   // "Amm. Sulphate", "Amm. Sulphate in Big Bags"

const clean = v => (v == null ? '' : String(v).trim().replace(/\s+/g, ' '))

// Numbers arrive as numbers or as "61185,000"-style strings.
function num(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return isNaN(v) ? null : v
  const s = String(v).replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, '')
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

// Month abbreviations as Orion prints them in text exports: Portuguese
// (fev, abr, mai, ago, set, out, dez) and English. Both three-letter.
const MONTHS = {
  jan: 1, feb: 2, fev: 2, mar: 3, apr: 4, abr: 4, may: 5, mai: 5, jun: 6, jul: 7,
  aug: 8, ago: 8, sep: 9, set: 9, oct: 10, out: 10, nov: 11, dec: 12, dez: 12,
}
const pad = n => String(n).padStart(2, '0')
const valid = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100 ? `${y}-${pad(m)}-${pad(d)}` : null

// Dates arrive as JS Dates (cellDates, the Sep 28 2026 export) or as text
// (the Oct 5 2026 export: "01/out/26"). Accepted text forms:
//   YYYY-MM-DD · dd/mmm/yy · dd/mmm/yyyy (pt or en month) · dd/mm/yyyy
// Returns 'YYYY-MM-DD', or null when the cell is empty or unreadable.
// The two cases are told apart by the caller (see parseLineupFile), so an
// unreadable date is reported instead of silently dropped.
export function ymd(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
  }
  if (typeof v === 'number') {   // Excel serial, in case cellDates is off
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    return isNaN(d.getTime()) ? null : `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  const s = String(v).trim().toLowerCase()
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return valid(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[\/\-. ]([a-zç]{3})[a-zç]*[\/\-. ](\d{2}|\d{4})$/)   // 01/out/26, 16-dez-2026
  if (m) {
    const mo = MONTHS[m[2]]
    if (!mo) return null
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    return valid(y, mo, +m[1])
  }
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/)   // 01/10/2026 (day first)
  if (m) return valid(+m[3], +m[2], +m[1])
  return null
}
const isBlank = v => v == null || String(v).trim() === ''

export function monthOf(dateStr) {
  return dateStr ? dateStr.slice(0, 7) + '-01' : null
}

// Parse the file bytes. Returns { parcels, skipped, badDates, headersMissing, sheet }.
// Only Discharge + Amsul rows become parcels; everything else is counted in
// `skipped` so the preview can say what was left out. An Amsul discharge row
// whose ETB cell is filled but unreadable goes to `badDates` (row number +
// raw text) — the upload view blocks storing while that list is non-empty.
// Blank ETB is a genuine no-date row and is skipped as before.
export function parseLineupFile(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true })
  const sheetName = wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
  if (!grid.length) return { parcels: [], skipped: 0, badDates: [], headersMissing: REQUIRED, sheet: sheetName }

  const headerRow = grid[0].map(h => clean(h).toLowerCase())
  const colIdx = {}
  headerRow.forEach((h, i) => { if (HEADERS[h] && colIdx[HEADERS[h]] == null) colIdx[HEADERS[h]] = i })
  const headersMissing = REQUIRED.filter(k => colIdx[k] == null)
  if (headersMissing.length) return { parcels: [], skipped: 0, badDates: [], headersMissing, sheet: sheetName }

  const get = (row, key) => (colIdx[key] == null ? null : row[colIdx[key]])
  const parcels = []
  const badDates = []
  let skipped = 0
  grid.slice(1).forEach((row, i) => {
    if (!row || row.every(c => c == null || c === '')) return
    const operation = clean(get(row, 'operation'))
    const cargo = clean(get(row, 'cargo'))
    const qty = num(get(row, 'qty_t'))
    if (!/^discharge$/i.test(operation) || !AMSUL_MATCH.test(cargo) || qty == null) { skipped++; return }
    const rawEtb = get(row, 'etb')
    const etb = ymd(rawEtb)
    if (!etb) {
      if (!isBlank(rawEtb)) badDates.push({ row_no: i + 2, value: String(rawEtb).trim() })
      skipped++
      return
    }
    parcels.push({
      row_no: i + 2,   // spreadsheet row number, for tracing a parcel back to the file
      batch_group: clean(get(row, 'batch_group')),
      vessel: clean(get(row, 'vessel')),
      imo: clean(get(row, 'imo')),
      port: clean(get(row, 'port')),
      terminal: clean(get(row, 'terminal')),
      berth: clean(get(row, 'berth')),
      receiver: clean(get(row, 'receiver')),
      charterer: clean(get(row, 'charterer')),
      cargo,
      qty_t: qty,
      vessel_total_t: num(get(row, 'vessel_total_t')),
      origin: clean(get(row, 'origin')),
      region: clean(get(row, 'region')),
      eta: ymd(get(row, 'eta')),
      etb,
      ets: ymd(get(row, 'ets')),
    })
  })
  return { parcels, skipped, badDates, headersMissing: [], sheet: sheetName }
}

// Per-ETB-month totals: [{ period: 'YYYY-MM-01', kt, parcels, vessels }], ascending.
export function monthlyTotals(parcels) {
  const by = new Map()
  parcels.forEach(p => {
    const period = monthOf(p.etb)
    const m = by.get(period) || { period, tons: 0, parcels: 0, vessels: new Set() }
    m.tons += p.qty_t
    m.parcels += 1
    m.vessels.add(p.batch_group || p.imo || p.vessel)
    by.set(period, m)
  })
  return [...by.values()]
    .map(m => ({ period: m.period, kt: Math.round(m.tons / 1000), parcels: m.parcels, vessels: m.vessels.size }))
    .sort((a, b) => a.period.localeCompare(b.period))
}

// Months that have NOT started as of `asOf` (YYYY-MM-DD): these are the only
// ones written to the line-up series - the freeze rule, enforced in code.
export function futureMonths(totals, asOf) {
  const cur = monthOf(asOf)
  return totals.filter(t => t.period > cur)
}

// Distinct party names in the file, with role and tons, for classification.
export function partiesIn(parcels) {
  const acc = new Map()
  const add = (role, name, tons) => {
    if (!name) return
    const k = `${role}|${name.toLowerCase()}`
    const e = acc.get(k) || { role, name, tons: 0 }
    e.tons += tons
    acc.set(k, e)
  }
  parcels.forEach(p => { add('receiver', p.receiver, p.qty_t); add('charterer', p.charterer, p.qty_t) })
  return [...acc.values()].sort((a, b) => b.tons - a.tons)
}
