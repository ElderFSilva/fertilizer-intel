// ── Demands: ONE definition of "a standing demand" for the whole app ──
//
// A demand is stored as a row inside a call, so every call that re-logs the
// same standing demand creates a new row. This module is the single place
// that turns those rows back into the desk's real book. Every consumer
// (Overview list, report, AI open-demand context, upload prompt) reads
// through here so they can never disagree.
//
// Desk ruling (2026-09-18):
//   same demand  = client + product + volume + port + laycan (exact match)
//   price target = NOT part of the identity; the latest target is shown
//   read side    = exact-key repeats collapse to one line, latest row wins
//   write side   = same client+product+port+laycan with a DIFFERENT volume
//                  asks the trader: Update (new row supersedes the old one,
//                  old row untouched) or Separate (a second cargo, both count)
//
// Append-only: nothing here ever edits a stored row. A superseding row
// carries `supersedesDemandId`; the superseded row simply stops counting.

export const ACTIVE_DAYS = 45

const dayMs = 86400000
const ymd = v => String(v || '').slice(0, 10)
const norm = v => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

export function volumeNum(v) {
  if (v == null || v === '') return null
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''))
  return isNaN(n) ? null : n
}

function toDate(dateStr) {
  const d = new Date(ymd(dateStr) + 'T00:00:00')
  return isNaN(d.getTime()) ? null : d
}

// Identity WITHOUT volume: the thing a volume change is an update OF.
export function demandIdentity(client, r) {
  return [norm(client), norm(r.product), norm(r.port), norm(r.laycan)].join('|')
}

// Full key: identity + volume. Two rows with the same key are the same demand.
export function demandKey(client, r) {
  return demandIdentity(client, r) + '|' + String(volumeNum(r.volume))
}

// Every demand row across the calls, flattened, with its call's client/date/id.
// Legacy single-field calls (demandProduct/demandVolume) are read as one row.
export function collectDemandRows(calls) {
  const out = []
  ;(calls || []).forEach(c => {
    if (!c || !c.client) return
    const rows = c.demandRows?.length
      ? c.demandRows
      : (c.demandProduct || c.demandVolume)
        ? [{ product: c.demandProduct, volume: c.demandVolume, port: c.demandPort, priceTarget: c.demandPriceTarget }]
        : []
    rows.forEach((r, seq) => {
      if (!r || !(r.product || r.volume)) return
      out.push({ ...r, client: c.client, callDate: ymd(c.date), callId: c.id, _seq: seq })
    })
  })
  return out
}

// The canonical book: one line per standing demand.
//   opts.from / opts.to   - inclusive date window (Date or 'YYYY-MM-DD'); omit for all time
//   opts.soldDemandIds    - Set of demand ids converted to a sale (dropped)
// Superseded ids are resolved against ALL calls passed in, not just the window,
// the same way soldDemandIds already spans all sales: a demand updated or
// converted later is no longer part of the book.
export function canonicalDemands(calls, opts = {}) {
  const all = collectDemandRows(calls)
  const sold = opts.soldDemandIds || new Set()
  const superseded = new Set(all.map(r => r.supersedesDemandId).filter(Boolean))

  const from = opts.from ? (opts.from instanceof Date ? new Date(opts.from) : toDate(opts.from)) : null
  const to = opts.to ? (opts.to instanceof Date ? new Date(opts.to) : toDate(opts.to)) : null
  if (from) from.setHours(0, 0, 0, 0)
  if (to) to.setHours(23, 59, 59, 999)

  // A sale or a volume update retires the WHOLE standing demand, not just the
  // one row it points at: every row of that key dated up to the retired row
  // is gone. A row of the same key logged AFTER that date is a fresh demand.
  const retiredThrough = new Map()
  all.forEach(r => {
    if (!r.id || !(sold.has(r.id) || superseded.has(r.id))) return
    const key = demandKey(r.client, r)
    const prev = retiredThrough.get(key)
    if (!prev || r.callDate > prev) retiredThrough.set(key, r.callDate)
  })

  const byKey = new Map()
  all.forEach(r => {
    if (r.isDuplicate || r.linkedToDemandId) return   // legacy "same demand - link it"
    if (r.closed) return
    const key = demandKey(r.client, r)
    const cutoff = retiredThrough.get(key)
    if (cutoff && r.callDate <= cutoff) return
    const d = toDate(r.callDate)
    if (!d) return
    if (from && d < from) return
    if (to && d > to) return

    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, { ...r, occurrences: 1, firstSeen: r.callDate })
      return
    }
    // Latest row wins (later call date, or later position on the same call);
    // keep the first-seen date so a long-standing demand shows its age.
    const later = r.callDate > prev.callDate || (r.callDate === prev.callDate && r._seq > prev._seq)
    if (later) byKey.set(key, { ...r, occurrences: prev.occurrences + 1, firstSeen: prev.firstSeen < r.callDate ? prev.firstSeen : r.callDate })
    else { prev.occurrences += 1; if (r.callDate < prev.firstSeen) prev.firstSeen = r.callDate }
  })

  return [...byKey.values()]
    .map(({ _seq, ...rest }) => rest)
    .sort((a, b) => b.callDate.localeCompare(a.callDate) || a.client.localeCompare(b.client))
}

// Every ACTIVE line (last ACTIVE_DAYS, relative to the call being logged)
// with the same identity as `row` - the whole book for that client + product
// + port + laycan, newest first. Exact-volume matches included.
export function findActiveIdentityLines(calls, client, row, dateStr) {
  if (!client || !row || !row.product) return []
  const ref = toDate(dateStr) || new Date()
  const from = new Date(ref.getTime() - ACTIVE_DAYS * dayMs)
  const identity = demandIdentity(client, row)
  return canonicalDemands(calls, { from, to: ref })
    .filter(d => demandIdentity(d.client, d) === identity)
    .sort((a, b) => b.callDate.localeCompare(a.callDate))
}

// Write-side check for the upload prompt: active lines with the same identity
// but a DIFFERENT volume. An exact match (same volume) is the same demand and
// needs no prompt on its own. Returns [] when nothing conflicts.
export function findVolumeConflicts(calls, client, row, dateStr) {
  const vol = volumeNum(row && row.volume)
  if (vol == null) return []
  return findActiveIdentityLines(calls, client, row, dateStr).filter(d => volumeNum(d.volume) !== vol)
}
