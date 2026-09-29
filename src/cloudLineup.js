// ── Cloud layer for the Orion line-up snapshots (Stage 1) ──
// lineup_parcels : append-only, one snapshot per snapshot_date (admin insert, all read)
// lineup_parties : receiver/charterer name -> segment (admin write, all read)

import { supabase } from './supabaseClient.js'
import { insertMarketRow } from './cloudMarketData.js'

export const SEGMENTS = [
  { v: 'unknown', l: '— not classified —' },
  { v: 'blender_distributor', l: 'Blender / distributor' },
  { v: 'producer', l: 'Producer' },
  { v: 'coop', l: 'Cooperative' },
  { v: 'trader', l: 'Trader' },
  { v: 'terminal', l: 'Terminal / warehouse' },
  { v: 'own', l: 'Own desk' },
]

// Dates already stored, newest first, with parcel counts.
export async function listSnapshots() {
  const { data, error } = await supabase
    .from('lineup_parcels')
    .select('snapshot_date')
    .order('snapshot_date', { ascending: false })
    .limit(5000)
  if (error) throw error
  const counts = {}
  ;(data || []).forEach(r => { counts[r.snapshot_date] = (counts[r.snapshot_date] || 0) + 1 })
  return Object.entries(counts).map(([snapshot_date, parcels]) => ({ snapshot_date, parcels }))
    .sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date))
}

export async function snapshotExists(snapshotDate) {
  const { count, error } = await supabase
    .from('lineup_parcels')
    .select('id', { count: 'exact', head: true })
    .eq('snapshot_date', snapshotDate)
  if (error) throw error
  return (count || 0) > 0
}

// Store one snapshot. Refuses if the date already holds rows (append-only:
// a wrong file is removed by SQL, never overwritten).
export async function insertSnapshot(snapshotDate, parcels) {
  if (await snapshotExists(snapshotDate)) {
    throw new Error(`A snapshot dated ${snapshotDate} already exists. Pick the file's real date, or remove that snapshot in SQL first.`)
  }
  const rows = parcels.map(p => ({ ...p, snapshot_date: snapshotDate }))
  for (let i = 0; i < rows.length; i += 400) {
    const { error } = await supabase.from('lineup_parcels').insert(rows.slice(i, i + 400))
    if (error) throw error
  }
  return rows.length
}

// Write the monthly totals for months not yet started into the line-up
// series (source 'orion'), dated by the snapshot. Skips a month already
// entered for that report date so a re-run never duplicates.
export async function writeLineupTotals(snapshotDate, months) {
  const written = []
  for (const m of months) {
    const { data: dup, error } = await supabase
      .from('supply_snapshots')
      .select('id')
      .eq('series', 'lineup').eq('product', 'amsul').eq('source', 'orion')
      .eq('report_date', snapshotDate).eq('period', m.period)
      .limit(1)
    if (error) throw error
    if (dup && dup.length) continue
    await insertMarketRow('supply_snapshots', {
      series: 'lineup', product: 'amsul', source: 'orion',
      report_date: snapshotDate, period: m.period, volume_kt: m.kt,
    })
    written.push(m)
  }
  return written
}

export async function listParties() {
  const { data, error } = await supabase.from('lineup_parties').select('*').order('name')
  if (error) throw error
  return data || []
}

export async function upsertParty(name, role, segment) {
  const { data, error } = await supabase
    .from('lineup_parties')
    .upsert({ name, role, segment, updated_at: new Date().toISOString() }, { onConflict: 'name,role' })
    .select('*')
    .single()
  if (error) throw error
  return data
}
