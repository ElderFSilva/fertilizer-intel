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

// Load the snapshot for ONE specific market week, keyed by that week's
// Thursday (the same key used for calls, publications and the stance log).
// Returns null when no analysis was ever generated for that week.
// Newest-first within the week: later regenerations refresh the signals and
// the written analysis, while the definitive stance stays pinned upstream —
// so the newest row of a week carries that week's most complete words.
export async function loadAnalysisSnapshotForWeek(weekThursday) {
  if (!weekThursday) return null
  const { data, error } = await supabase
    .from('analysis_snapshots')
    .select('payload, created_at')
    .eq('week_thursday', weekThursday)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  if (!data || !data.length) return null
  return data[0].payload
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
