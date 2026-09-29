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

// Dates arrive as JS Dates (cellDates) or as text. Return 'YYYY-MM-DD' or null.
function ymd(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  }
  const s = String(v).trim()
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : ymd(d)
}

export function monthOf(dateStr) {
  return dateStr ? dateStr.slice(0, 7) + '-01' : null
}

// Parse the file bytes. Returns { parcels, skipped, headersMissing, sheet }.
// Only Discharge + Amsul rows become parcels; everything else is counted in
// `skipped` so the preview can say what was left out.
export function parseLineupFile(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true })
  const sheetName = wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
  if (!grid.length) return { parcels: [], skipped: 0, headersMissing: REQUIRED, sheet: sheetName }

  const headerRow = grid[0].map(h => clean(h).toLowerCase())
  const colIdx = {}
  headerRow.forEach((h, i) => { if (HEADERS[h] && colIdx[HEADERS[h]] == null) colIdx[HEADERS[h]] = i })
  const headersMissing = REQUIRED.filter(k => colIdx[k] == null)
  if (headersMissing.length) return { parcels: [], skipped: 0, headersMissing, sheet: sheetName }

  const get = (row, key) => (colIdx[key] == null ? null : row[colIdx[key]])
  const parcels = []
  let skipped = 0
  grid.slice(1).forEach((row, i) => {
    if (!row || row.every(c => c == null || c === '')) return
    const operation = clean(get(row, 'operation'))
    const cargo = clean(get(row, 'cargo'))
    const qty = num(get(row, 'qty_t'))
    const etb = ymd(get(row, 'etb'))
    if (!/^discharge$/i.test(operation) || !AMSUL_MATCH.test(cargo) || qty == null || !etb) { skipped++; return }
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
  return { parcels, skipped, headersMissing: [], sheet: sheetName }
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
