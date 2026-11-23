import { supabase } from './supabaseClient.js'

// ── Cloud data layer for the OPERATIONS environment ──
// Ops (and admin) read every sale but never edit one. The only thing written
// back to a sale is the vessel name, through the ops_sync_vessel() database
// function. Nothing here touches the localStorage mirrors the trading side uses.

export const num = v => {
  if (v == null || v === '') return 0
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return isNaN(n) ? 0 : n
}

export const normVessel = v => (v || '').trim().replace(/\s+/g, ' ').toLowerCase()
export const isTBN = v => /\btbn\b/i.test(v || '') || /to be nominated/i.test(v || '')

// Each sale on a shipment carries its own reference, typed by ops (e.g. LG261001-10).
// Sort by that reference, numbers in natural order; sales with no reference yet go last.
export function byParcelNo(a, b) {
  const ra = (a.parcel_no || '').trim(), rb = (b.parcel_no || '').trim()
  if (!ra || !rb) return (ra ? 0 : 1) - (rb ? 0 : 1) || String(a.created_at).localeCompare(String(b.created_at))
  return ra.localeCompare(rb, undefined, { numeric: true, sensitivity: 'base' })
}

// ── Laycan: a month picked from a list, never typed ──
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Months from 6 back to 18 ahead, e.g. "Nov 2026". A value already saved on
// the shipment that is not in the list (older text) stays selectable.
export function laycanOptions(current) {
  const now = new Date()
  const out = []
  for (let i = -6; i <= 18; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    out.push(`${MONTHS[d.getMonth()]} ${d.getFullYear()}`)
  }
  const cur = (current || '').trim()
  if (cur && !out.includes(cur)) out.unshift(cur)
  return out
}

// Best guess of the laycan month from what the trader typed on the sale
// ("Dec 1-15", "TBN December"). Ops can always pick another month.
export function guessLaycan(text, saleDate) {
  const m = String(text || '').toLowerCase().match(/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/)
  if (!m) return ''
  const mi = MONTHS.findIndex(x => x.toLowerCase() === m[0])
  const base = saleDate ? new Date(String(saleDate).slice(0, 10) + 'T00:00:00') : new Date()
  const ref = isNaN(base.getTime()) ? new Date() : base
  // A month well before the sale date means next year (a December sale for "Jan")
  const year = mi < ref.getMonth() - 2 ? ref.getFullYear() + 1 : ref.getFullYear()
  return `${MONTHS[mi]} ${year}`
}

// A shipment IS its vessel: "SMIRNI · Nov 2026"
export const shipmentLabel = s => `${s.vessel}${s.laycan ? ` · ${s.laycan}` : ''}`

export async function opsLoadAll() {
  const [sh, pa, sa] = await Promise.all([
    supabase.from('shipments').select('*').order('created_at', { ascending: false }),
    supabase.from('shipment_parcels').select('*'),
    supabase.from('sales').select('id, trader_id, data, created_at').order('created_at', { ascending: false }),
  ])
  if (sh.error) throw sh.error
  if (pa.error) throw pa.error
  if (sa.error) throw sa.error
  const sales = (sa.data || []).map(r => ({ ...r.data, id: r.id, trader_id: r.trader_id, created_at: r.created_at }))
  let profiles = []
  try {
    const { data } = await supabase.from('profiles').select('*')
    profiles = data || []
  } catch { /* trader labels fall back to a short id */ }
  // Invoice tables: each read stands alone, so Operations still opens if the
  // invoice SQL has not been run yet (invoicesReady tells the screens).
  const safe = async q => { try { const { data, error } = await q; return error ? null : (data || []) } catch { return null } }
  const [invoices, issues, presets, settingsRows] = await Promise.all([
    safe(supabase.from('ops_invoices').select('*')),
    safe(supabase.from('ops_invoice_issues').select('*').order('created_at', { ascending: true })),
    safe(supabase.from('ops_invoice_presets').select('*').order('label', { ascending: true })),
    safe(supabase.from('ops_settings').select('*')),
  ])
  const invoiceSettings = (settingsRows || []).find(r => r.key === 'invoice')?.value || {}
  return {
    shipments: sh.data || [], parcels: pa.data || [], sales, profiles,
    invoices: invoices || [], issues: issues || [], presets: presets || [], invoiceSettings,
    invoicesReady: invoices !== null && issues !== null && settingsRows !== null,
  }
}

// ── Invoices ──

export async function opsSaveInvoice(parcelId, data) {
  const { error } = await supabase
    .from('ops_invoices')
    .upsert({ parcel_id: parcelId, data, updated_at: new Date().toISOString() }, { onConflict: 'parcel_id' })
  if (error) throw error
}

// Freezes the invoice exactly as issued. Issued invoices are never edited or deleted.
export async function opsIssueInvoice(parcelId, kind, issuedOn, snapshot) {
  const { error } = await supabase
    .from('ops_invoice_issues')
    .insert({ parcel_id: parcelId, kind, issued_on: issuedOn, snapshot })
  if (error) throw error
}

export async function opsSaveInvoiceSettings(value) {
  const { error } = await supabase
    .from('ops_settings')
    .upsert({ key: 'invoice', value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw error
}

// Latest stage reached by a sale's invoice: 'commercial' | 'proforma' | 'draft' | ''
export function invoiceStage(parcelId, invoices, issues) {
  const mine = issues.filter(i => i.parcel_id === parcelId)
  if (mine.some(i => i.kind === 'commercial')) return 'commercial'
  if (mine.some(i => i.kind === 'proforma')) return 'proforma'
  return invoices.some(i => i.parcel_id === parcelId) ? 'draft' : ''
}

export async function opsCreateShipment({ vessel, laycan }) {
  const { data, error } = await supabase
    .from('shipments')
    .insert({ vessel: vessel.trim(), laycan: (laycan || '').trim() || null })
    .select('*').single()
  if (error) throw error
  return data
}

// Saves the shipment header. The vessel name is then copied onto every sale
// allocated to it, so the trader's Sales Log shows the nominated vessel.
export async function opsUpdateShipment(id, patch) {
  const clean = { updated_at: new Date().toISOString() }
  ;['vessel', 'laycan', 'status'].forEach(k => {
    if (patch[k] !== undefined) clean[k] = typeof patch[k] === 'string' ? (patch[k].trim() || null) : patch[k]
  })
  const { data, error } = await supabase.from('shipments').update(clean).eq('id', id).select('*').single()
  if (error) throw error
  if (patch.vessel !== undefined) await opsSyncVessel(id)
  return data
}

export async function opsDeleteShipment(id) {
  const { error } = await supabase.from('shipments').delete().eq('id', id)
  if (error) throw error
}

export async function opsSyncVessel(shipmentId) {
  const { error } = await supabase.rpc('ops_sync_vessel', { p_shipment: shipmentId })
  if (error) throw error
}

// rows: [{ sale_id, ref, load_port }] — ref is the sale's own reference, typed by ops (may be blank for now)
export async function opsAllocate(shipmentId, rows) {
  const payload = rows.map(r => ({
    shipment_id: shipmentId, sale_id: r.sale_id,
    parcel_no: String(r.ref || '').trim() || null, load_port: (r.load_port || '').trim() || null,
  }))
  const { error } = await supabase.from('shipment_parcels').insert(payload)
  if (error) throw error
  await opsSyncVessel(shipmentId)
}

export async function opsUpdateParcel(id, patch) {
  const clean = {}
  if (patch.parcel_no !== undefined) clean.parcel_no = String(patch.parcel_no || '').trim() || null
  if (patch.load_port !== undefined) clean.load_port = (patch.load_port || '').trim() || null
  const { error } = await supabase.from('shipment_parcels').update(clean).eq('id', id)
  if (error) throw error
}

// Back to "unallocated". The sale itself is left exactly as it is.
export async function opsUnallocate(parcelId) {
  const { error } = await supabase.from('shipment_parcels').delete().eq('id', parcelId)
  if (error) throw error
}

// Plain-words message for the errors ops will actually meet.
export function opsErrorText(e, fallback) {
  const m = String(e?.message || '')
  if (/shipment_parcels_shipment_id_parcel_no_key/.test(m)) return 'That reference is already used on this vessel.'
  if (/shipment_parcels_sale_id_key/.test(m)) return 'One of these sales is already allocated to a shipment. Reload and try again.'
  if (/ops_invoice_issues/.test(m) && /violates foreign key/.test(m)) return 'This sale has an issued invoice, so it stays on this vessel.'
  if (/violates foreign key/.test(m) && /shipment_parcels/.test(m)) return 'This shipment still has sales on it. Remove them first.'
  if (/permission denied|row-level security|not allowed/i.test(m)) return 'This login has no access to Operations.'
  return fallback || 'Could not save to the cloud.'
}

// ── Pure helpers shared by the Operations views ──

export const fmtN = n => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
export const fmtP = n => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })

export function fmtSaleDate(d) {
  if (!d) return '—'
  const x = new Date(String(d).slice(0, 10) + 'T00:00:00')
  return isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export const saleDateOf = s => s.date || (s.created_at ? String(s.created_at).slice(0, 10) : '')

// One breakdown row per allocated sale. Client, product, tons, price and discharge
// port are read live from the trader's sale — they are never copied.
export function breakdownRows(shipment, parcels, saleById) {
  return [...parcels].sort(byParcelNo).map(p => {
    const s = saleById[p.sale_id] || null
    const tons = s ? num(s.volume) : 0
    const price = s ? num(s.donePrice) : 0
    return {
      parcel: p, sale: s,
      lgRef: (p.parcel_no || '').trim(),
      client: s ? (s.client || '—') : '(sale not found)',
      loadPort: p.load_port || '',
      port: s?.port || '',
      product: s?.product || '',
      tons, price, total: tons * price,
    }
  })
}

export function sumBy(rows, key) {
  const m = {}
  rows.forEach(r => { const k = r[key] || '—'; m[k] = (m[k] || 0) + r.tons })
  return Object.entries(m).map(([name, tons]) => ({ name, tons })).sort((a, b) => b.tons - a.tons)
}
