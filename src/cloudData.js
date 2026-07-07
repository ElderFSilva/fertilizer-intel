import { supabase } from './supabaseClient.js'

// ── Cloud data layer for CALLS ──
// Each row: { id (uuid), trader_id, data (the call object), call_date }
// The rest of the app treats a "call" as the data object plus its id.

// Load all calls for the current user (RLS ensures only their own; admin sees all)
export async function cloudLoadCalls() {
  const { data, error } = await supabase
    .from('calls')
    .select('id, trader_id, data, call_date, created_at')
    .order('call_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  // Flatten: merge the stored object with the row id + trader_id
  return (data || []).map(row => ({
    ...row.data,
    id: row.id,            // uuid from the row (overrides any legacy numeric id inside data)
    trader_id: row.trader_id,
  }))
}

// Insert a new call for the current user
export async function cloudAddCall(entry, traderId) {
  const callDate = entry.date || null
  // strip any legacy id from the payload; the DB assigns a uuid
  const { id, trader_id, ...clean } = entry
  const { data, error } = await supabase
    .from('calls')
    .insert({ trader_id: traderId, data: clean, call_date: callDate })
    .select('id, trader_id, data, call_date')
    .single()
  if (error) throw error
  return { ...data.data, id: data.id, trader_id: data.trader_id }
}

// Update an existing call
export async function cloudEditCall(id, updates, existing) {
  // Merge updates into the existing call object
  const { id: _i, trader_id: _t, ...restExisting } = existing || {}
  const merged = { ...restExisting, ...updates }
  const { id: _i2, trader_id: _t2, ...clean } = merged
  const callDate = clean.date || null
  const { data, error } = await supabase
    .from('calls')
    .update({ data: clean, call_date: callDate, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, trader_id, data, call_date')
    .single()
  if (error) throw error
  return { ...data.data, id: data.id, trader_id: data.trader_id }
}

// Delete a call
export async function cloudDeleteCall(id) {
  const { error } = await supabase.from('calls').delete().eq('id', id)
  if (error) throw error
}

// Bulk insert (used by the JSON import). Chunks to stay under payload limits.
export async function cloudBulkInsertCalls(callObjects, traderId) {
  const rows = callObjects.map(c => {
    const { id, trader_id, ...clean } = c
    return { trader_id: traderId, data: clean, call_date: clean.date || null }
  })
  const CHUNK = 100
  let inserted = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const { error } = await supabase.from('calls').insert(slice)
    if (error) throw error
    inserted += slice.length
  }
  return inserted
}

// ── Cloud data layer for SALES ──

export async function cloudLoadSales() {
  const { data, error } = await supabase
    .from('sales')
    .select('id, trader_id, data, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  const sales = (data || []).map(row => ({
    ...row.data,
    id: row.id,
    trader_id: row.trader_id,
    created_at: row.created_at,
  }))
  // Mirror to localStorage so legacy synchronous readers (report.js,
  // ClientIntel.jsx) that read 'fertintel_sales' keep working unchanged.
  try { localStorage.setItem('fertintel_sales', JSON.stringify(sales)) } catch {}
  return sales
}

// Refresh the localStorage sales mirror from the cloud (for legacy readers)
async function refreshSalesMirror() {
  try {
    const { data } = await supabase
      .from('sales')
      .select('id, trader_id, data, created_at')
      .order('created_at', { ascending: false })
    const sales = (data || []).map(row => ({ ...row.data, id: row.id, trader_id: row.trader_id, created_at: row.created_at }))
    localStorage.setItem('fertintel_sales', JSON.stringify(sales))
  } catch {}
}

export async function cloudAddSale(sale, traderId) {
  const { id, trader_id, created_at, ...clean } = sale
  const { data, error } = await supabase
    .from('sales')
    .insert({ trader_id: traderId, data: clean })
    .select('id, trader_id, data, created_at')
    .single()
  if (error) throw error
  await refreshSalesMirror()
  return { ...data.data, id: data.id, trader_id: data.trader_id, created_at: data.created_at }
}

export async function cloudEditSale(id, patch, existing) {
  const { id: _i, trader_id: _t, created_at: _c, ...restExisting } = existing || {}
  const merged = { ...restExisting, ...patch }
  const { id: _i2, trader_id: _t2, created_at: _c2, ...clean } = merged
  const { data, error } = await supabase
    .from('sales')
    .update({ data: clean, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, trader_id, data, created_at')
    .single()
  if (error) throw error
  await refreshSalesMirror()
  return { ...data.data, id: data.id, trader_id: data.trader_id, created_at: data.created_at }
}

export async function cloudDeleteSale(id) {
  const { error } = await supabase.from('sales').delete().eq('id', id)
  if (error) throw error
  await refreshSalesMirror()
}

export async function cloudBulkInsertSales(saleObjects, traderId) {
  const rows = saleObjects.map(s => {
    const { id, trader_id, created_at, ...clean } = s
    return { trader_id: traderId, data: clean }
  })
  const CHUNK = 100
  let inserted = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const { error } = await supabase.from('sales').insert(slice)
    if (error) throw error
    inserted += slice.length
  }
  return inserted
}

// ── Cloud data layer for PUBLICATIONS (shared, admin-managed) ──

// Load all publications, split into argus/fertecon arrays shaped like the
// legacy localStorage format: [{ date, low, high }]. Also mirrors to
// localStorage so the report chart (which reads those keys) keeps working.
export async function cloudLoadPublications() {
  const { data, error } = await supabase
    .from('publications')
    .select('source, pub_date, low, high')
    .order('pub_date', { ascending: true })
  if (error) throw error
  const argus = []
  const fertecon = []
  ;(data || []).forEach(r => {
    const entry = { date: r.pub_date, low: Number(r.low), high: Number(r.high) }
    if (r.source === 'argus') argus.push(entry)
    else if (r.source === 'fertecon') fertecon.push(entry)
  })
  try {
    localStorage.setItem('fertintel_argus_amsul', JSON.stringify(argus))
    localStorage.setItem('fertintel_fertecon_amsul', JSON.stringify(fertecon))
  } catch {}
  return { argus, fertecon }
}

// Upsert a publication (admin only — RLS enforces). source: 'argus'|'fertecon'
export async function cloudUpsertPublication(source, date, low, high) {
  const { error } = await supabase
    .from('publications')
    .upsert({ source, pub_date: date, low, high }, { onConflict: 'source,pub_date' })
  if (error) throw error
  await cloudLoadPublications() // refresh mirror
}

export async function cloudDeletePublication(source, date) {
  const { error } = await supabase
    .from('publications')
    .delete()
    .eq('source', source)
    .eq('pub_date', date)
  if (error) throw error
  await cloudLoadPublications()
}

// Bulk import publications from a backup's argus/fertecon arrays (admin only)
export async function cloudBulkInsertPublications(argusArr, ferteconArr) {
  const rows = []
  ;(argusArr || []).forEach(a => {
    if (a.date && a.low != null && a.high != null) rows.push({ source: 'argus', pub_date: a.date, low: a.low, high: a.high })
  })
  ;(ferteconArr || []).forEach(f => {
    if (f.date && f.low != null && f.high != null) rows.push({ source: 'fertecon', pub_date: f.date, low: f.low, high: f.high })
  })
  if (!rows.length) return 0
  const { error } = await supabase
    .from('publications')
    .upsert(rows, { onConflict: 'source,pub_date' })
  if (error) throw error
  await cloudLoadPublications()
  return rows.length
}
