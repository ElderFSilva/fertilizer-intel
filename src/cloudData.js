import { supabase } from './supabaseClient.js'

// ── Cloud data layer for MARKET DATA (Stage 6.1) ──
// Seven shared, admin-managed tables (RLS: admin-write / authenticated-read):
//   intl_publications, freight_rates, import_volumes, barter_ratios,
//   vessel_lineups, fx_rates, purchase_progress
//
// Unlike calls/sales (which wrap a JSON `data` object), these tables use
// plain typed columns, so a single generic CRUD works for all of them.

// Order column per table (newest first in the UI).
const ORDER_BY = {
  intl_publications: 'pub_date',
  freight_rates: 'rate_date',
  barter_ratios: 'ratio_date',
  fx_rates: 'rate_date',
  purchase_progress: 'report_date',
  supply_snapshots: 'report_date',
  desk_lessons: 'lesson_date',
}

const VALID_TABLES = new Set(Object.keys(ORDER_BY))

function assertTable(table) {
  if (!VALID_TABLES.has(table)) throw new Error(`Unknown market data table: ${table}`)
}

// Load rows, newest first. Limit keeps the payload sane; raise if ever needed.
export async function loadMarketRows(table, limit = 500) {
  assertTable(table)
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .order(ORDER_BY[table], { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

// Insert one row (admin only — RLS enforces).
export async function insertMarketRow(table, row) {
  assertTable(table)
  const { id, created_at, ...clean } = row
  const { data, error } = await supabase
    .from(table)
    .insert(clean)
    .select('*')
    .single()
  if (error) throw error
  return data
}

// Update one row by id (admin only — RLS enforces).
export async function updateMarketRow(table, id, patch) {
  assertTable(table)
  const { id: _i, created_at: _c, ...clean } = patch
  const { data, error } = await supabase
    .from(table)
    .update(clean)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data
}

// Delete one row by id (admin only — RLS enforces).
export async function deleteMarketRow(table, id) {
  assertTable(table)
  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) throw error
}

// ── Aggregate snapshot for the AI layer (Stage 6.3 will consume this) ──
// Loads a compact recent slice of every market table in one call so the AI
// prompt builder doesn't need seven separate awaits.
export async function loadMarketSnapshot() {
  const tables = [...VALID_TABLES]
  const results = await Promise.all(
    tables.map(t => loadMarketRows(t, 120).catch(() => []))
  )
  const snap = {}
  tables.forEach((t, i) => { snap[t] = results[i] })
  return snap
}
