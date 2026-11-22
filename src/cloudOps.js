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

// Parcel numbers are text (ops may type anything); sort numerically when they are numbers.
export function byParcelNo(a, b) {
  const na = parseFloat(a.parcel_no), nb = parseFloat(b.parcel_no)
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb
  return String(a.parcel_no).localeCompare(String(b.parcel_no), undefined, { numeric: true })
}

export function nextParcelNo(parcels) {
  let max = 0
  parcels.forEach(p => { const n = parseInt(p.parcel_no, 10); if (!isNaN(n) && n > max) max = n })
  return max + 1
}

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
  return { shipments: sh.data || [], parcels: pa.data || [], sales, profiles }
}

export async function opsCreateShipment({ ref, vessel, laycan, load_ports }) {
  const { data, error } = await supabase
    .from('shipments')
    .insert({ ref: ref.trim(), vessel: vessel.trim(), laycan: (laycan || '').trim() || null, load_ports: (load_ports || '').trim() || null })
    .select('*').single()
  if (error) throw error
  return data
}

// Saves the shipment header. The vessel name is then copied onto every sale
// allocated to it, so the trader's Sales Log shows the nominated vessel.
export async function opsUpdateShipment(id, patch) {
  const clean = { updated_at: new Date().toISOString() }
  ;['ref', 'vessel', 'laycan', 'load_ports', 'status'].forEach(k => {
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

// rows: [{ sale_id, parcel_no, load_port }]
export async function opsAllocate(shipmentId, rows) {
  const payload = rows.map(r => ({
    shipment_id: shipmentId, sale_id: r.sale_id,
    parcel_no: String(r.parcel_no).trim(), load_port: (r.load_port || '').trim() || null,
  }))
  const { error } = await supabase.from('shipment_parcels').insert(payload)
  if (error) throw error
  await opsSyncVessel(shipmentId)
}

export async function opsUpdateParcel(id, patch) {
  const clean = {}
  if (patch.parcel_no !== undefined) clean.parcel_no = String(patch.parcel_no).trim()
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
  if (/shipments_ref_unique/.test(m)) return 'Another shipment already uses that ref.'
  if (/shipment_parcels_shipment_id_parcel_no_key/.test(m)) return 'That parcel number is already used in this shipment.'
  if (/shipment_parcels_sale_id_key/.test(m)) return 'One of these sales is already allocated to a shipment. Reload and try again.'
  if (/violates foreign key/.test(m) && /shipment_parcels/.test(m)) return 'This shipment still has parcels. Remove them first.'
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

// One breakdown row per parcel. Client, product, tons, price and discharge
// port are read live from the trader's sale — they are never copied.
export function breakdownRows(shipment, parcels, saleById) {
  return [...parcels].sort(byParcelNo).map(p => {
    const s = saleById[p.sale_id] || null
    const tons = s ? num(s.volume) : 0
    const price = s ? num(s.donePrice) : 0
    return {
      parcel: p, sale: s,
      lgRef: `${shipment.ref}-${p.parcel_no}`,
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
