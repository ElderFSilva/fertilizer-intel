import { supabase } from './supabaseClient.js'

// Normalize a date value to YYYY-MM-DD, or return null if it can't be parsed.
// Legacy calls sometimes stored dates as display strings like "May 5" which
// are NOT valid SQL dates — those become null in the call_date column (the
// original text stays intact inside the JSON data).
function normalizeDate(val) {
  if (!val) return null
  // Already ISO-ish (YYYY-MM-DD)?
  if (/^\d{4}-\d{2}-\d{2}/.test(String(val))) return String(val).slice(0, 10)
  const d = new Date(val)
  if (isNaN(d.getTime())) return null
  // Reject implausible years (e.g. "May 5" with no year defaults to 2001).
  // Better to leave call_date empty than store a wrong year; the original
  // date text is preserved inside the JSON data regardless.
  const y = d.getFullYear()
  if (y < 2020 || y > 2100) return null
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}


// Guarded write to a localStorage mirror. Refuses to overwrite a NON-empty
// mirror with an empty array — this is the exact failure that wiped sales when
// an empty cloud response clobbered the local copy on load. An empty→empty or
// any non-empty write proceeds normally.
function safeMirrorWrite(key, arr) {
  try {
    if (!arr || arr.length === 0) {
      const existing = localStorage.getItem(key)
      if (existing) {
        const prev = JSON.parse(existing)
        if (Array.isArray(prev) && prev.length > 0) {
          console.warn(`[FertIntel] Skipped overwriting non-empty "${key}" (${prev.length} items) with an empty result.`)
          return
        }
      }
    }
    localStorage.setItem(key, JSON.stringify(arr || []))
  } catch {}
}


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
  const callDate = normalizeDate(entry.date)
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
  const callDate = normalizeDate(clean.date)
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
    return { trader_id: traderId, data: clean, call_date: normalizeDate(clean.date) }
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
  safeMirrorWrite('fertintel_sales', sales)
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
    safeMirrorWrite('fertintel_sales', sales)
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

// ── Profiles (for admin trader-name mapping) ──
// Returns all profile rows the current user is allowed to read. For admin,
// RLS should return every profile; for a trader it may return only their own.
// Selects '*' because the exact profile columns can vary between projects —
// the caller derives a friendly label defensively from whatever is present.
export async function cloudLoadProfiles() {
  const { data, error } = await supabase.from('profiles').select('*')
  if (error) throw error
  return data || []
}

// ── Benchmark loader (single source of truth: Market Data -> Intl Prices) ──
// Reads Amsul CFR Brazil COMPACTED weekly rows (argus + fertecon) from
// intl_publications, normalizes each date to its week's Thursday, and merges
// legacy rows from the old `publications` table for weeks not yet covered.
// Mirrors to the localStorage keys the report chart & AI weekly filter read.
function weekThursdayOf(dateStr) {
  const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00')
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

export async function cloudLoadBenchmarkFromIntl() {
  const bySrc = { argus: {}, fertecon: {} }
  const { data: intl, error: e1 } = await supabase
    .from('intl_publications')
    .select('source, pub_date, price_low, price_high')
    .eq('product', 'amsul')
    .eq('price_point', 'cfr_brazil')
    .eq('grade', 'compacted')
    .eq('frequency', 'weekly')
    .in('source', ['argus', 'fertecon'])
    .order('pub_date', { ascending: true })
  if (e1) throw e1
  ;(intl || []).forEach(r => {
    const th = weekThursdayOf(r.pub_date)
    if (!th) return
    bySrc[r.source][th] = { date: th, low: Number(r.price_low), high: Number(r.price_high != null ? r.price_high : r.price_low) }
  })
  try {
    const { data: legacy } = await supabase
      .from('publications')
      .select('source, pub_date, low, high')
      .order('pub_date', { ascending: true })
    ;(legacy || []).forEach(r => {
      if (!bySrc[r.source]) return
      const th = weekThursdayOf(r.pub_date)
      if (!th || bySrc[r.source][th]) return
      bySrc[r.source][th] = { date: th, low: Number(r.low), high: Number(r.high) }
    })
  } catch {}
  const sortAsc = o => Object.values(o).sort((a, b) => a.date.localeCompare(b.date))
  const argus = sortAsc(bySrc.argus)
  const fertecon = sortAsc(bySrc.fertecon)
  try {
    safeMirrorWrite('fertintel_argus_amsul', argus)
    safeMirrorWrite('fertintel_fertecon_amsul', fertecon)
  } catch {}
  return { argus, fertecon }
}

// Bulk import publications from a backup's argus/fertecon arrays (admin only)
export async function cloudBulkInsertPublications(argusArr, ferteconArr) {
  const rows = []
  ;(argusArr || []).forEach(a => {
    const d = normalizeDate(a.date)
    if (d && a.low != null && a.high != null) rows.push({ source: 'argus', pub_date: d, low: a.low, high: a.high })
  })
  ;(ferteconArr || []).forEach(f => {
    const d = normalizeDate(f.date)
    if (d && f.low != null && f.high != null) rows.push({ source: 'fertecon', pub_date: d, low: f.low, high: f.high })
  })
  if (!rows.length) return 0
  const { error } = await supabase
    .from('publications')
    .upsert(rows, { onConflict: 'source,pub_date' })
  if (error) throw error
  await cloudLoadBenchmarkFromIntl()
  return rows.length
}

// ── Automatic weekly backup (admin-run, cloud-sourced) ──

const LAST_BACKUP_KEY = 'fertintel_last_backup'

// Build a COMPLETE backup object from the cloud (the source of truth) — never
// from the localStorage mirrors, which can be stale/empty. For admin this spans
// every trader; for a trader it's their own calls/sales plus shared publications.
export async function cloudExportAllData() {
  const [calls, sales, pubs] = await Promise.all([
    cloudLoadCalls(),
    cloudLoadSales(),
    cloudLoadBenchmarkFromIntl(),
  ])
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    data: {
      fertintel_calls: calls,
      fertintel_sales: sales,
      fertintel_argus_amsul: pubs.argus || [],
      fertintel_fertecon_amsul: pubs.fertecon || [],
    },
  }
}

// Trigger a browser download of a backup object as a dated JSON file.
export function triggerBackupDownload(backupObj) {
  const blob = new Blob([JSON.stringify(backupObj, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const date = (backupObj.exportedAt || new Date().toISOString()).split('T')[0]
  a.href = url
  a.download = `fertintel-backup-${date}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// YYYY-MM-DD of the most recent Friday on or before `now` (local components).
function mostRecentFridayYMD(now = new Date()) {
  const d = new Date(now)
  const since = (d.getDay() - 5 + 7) % 7  // 0=Sun..5=Fri..6=Sat → days since Friday
  d.setDate(d.getDate() - since)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function lastBackupDate() {
  try { return localStorage.getItem(LAST_BACKUP_KEY) || null } catch { return null }
}

// Run the weekly backup if this week's Friday hasn't been captured yet.
// Admin-only (admin is the only role that can read ALL data). Saves a snapshot
// row into Supabase AND downloads a JSON file. Returns the backup date if it
// ran, otherwise null.
export async function runWeeklyBackupIfDue(role) {
  if (role !== 'admin') return null
  const targetFriday = mostRecentFridayYMD()
  const last = lastBackupDate()
  if (last && last >= targetFriday) return null   // already done for this week
  const backup = await cloudExportAllData()
  // Save into Supabase first (the durable copy); a failure here must not stop
  // the file download, which is the off-platform copy.
  try { await cloudSaveBackup(backup, targetFriday) } catch (e) { /* keep going */ }
  triggerBackupDownload(backup)
  try { localStorage.setItem(LAST_BACKUP_KEY, targetFriday) } catch {}
  return targetFriday
}

// ── Cloud-stored backup snapshots (Supabase `backups` table, admin-only) ──

// Save/refresh the snapshot for a given week into the backups table. One row
// per week (upsert on week_key), so re-running a week refreshes it. Snapshots
// are kept indefinitely.
export async function cloudSaveBackup(backupObj, weekKey) {
  const wk = weekKey || mostRecentFridayYMD()
  const d = backupObj?.data || {}
  const counts = {
    calls: (d.fertintel_calls || []).length,
    sales: (d.fertintel_sales || []).length,
    argus: (d.fertintel_argus_amsul || []).length,
    fertecon: (d.fertintel_fertecon_amsul || []).length,
  }
  let userId = null
  try { const { data } = await supabase.auth.getUser(); userId = data?.user?.id ?? null } catch {}
  const { error } = await supabase
    .from('backups')
    .upsert(
      { week_key: wk, created_by: userId, created_at: new Date().toISOString(), counts, payload: backupObj },
      { onConflict: 'week_key' }
    )
  if (error) throw error
  return { week_key: wk, counts }
}

// Build a fresh snapshot, save it to Supabase, and download the file. Used by
// the "Back up now" button. Admin only (RLS enforces the insert).
export async function cloudBackupNow() {
  const backup = await cloudExportAllData()
  const wk = mostRecentFridayYMD()
  const meta = await cloudSaveBackup(backup, wk)
  triggerBackupDownload(backup)
  try { localStorage.setItem(LAST_BACKUP_KEY, wk) } catch {}
  return meta
}

// List saved snapshots (metadata only — never the heavy payload).
export async function cloudListBackups() {
  const { data, error } = await supabase
    .from('backups')
    .select('id, week_key, created_at, counts')
    .order('week_key', { ascending: false })
  if (error) throw error
  return data || []
}

// Fetch the full payload of one snapshot (for download / inspection).
export async function cloudGetBackupPayload(id) {
  const { data, error } = await supabase
    .from('backups')
    .select('payload')
    .eq('id', id)
    .single()
  if (error) throw error
  return data?.payload || null
}
