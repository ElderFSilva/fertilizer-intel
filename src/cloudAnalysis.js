import { supabase } from './supabaseClient.js'

// ── Shared desk analysis snapshots ──
// The admin generates ONE analysis from all traders' data; it's saved here
// and every user (admin + traders) reads the same newest snapshot.

export async function saveAnalysisSnapshot(result) {
  const { error } = await supabase.from('analysis_snapshots').insert({
    week_thursday: result.weekThursday || null,
    week_label: result.weekLabel || null,
    payload: result,
  })
  if (error) throw error
}

export async function loadLatestAnalysisSnapshot() {
  const { data, error } = await supabase
    .from('analysis_snapshots')
    .select('payload, created_at')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  if (!data || !data.length) return null
  return data[0].payload
}
