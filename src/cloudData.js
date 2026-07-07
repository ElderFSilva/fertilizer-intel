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
