// ── Orion line-up file: upload + parties (lives inside the Line-up tab) ──
// Admin only. Pick the .xls → preview → confirm. On confirm the parcels are
// stored as an append-only snapshot and the totals of months NOT yet started
// are written into the line-up series as source 'orion' (freeze rule).

import { useEffect, useState } from 'react'
import { parseLineupFile, monthlyTotals, futureMonths, partiesIn } from '../../lineupFile.js'
import { listSnapshots, insertSnapshot, writeLineupTotals, listParties, upsertParty, SEGMENTS } from '../../cloudLineup.js'
import styles from './MarketData.module.css'

function todayYMD() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const monthLabel = p => new Date(p + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'
const fmtKt = v => `${Number(v).toLocaleString('en-US')}k`

export default function LineupUpload({ onWritten }) {
  const [snapshotDate, setSnapshotDate] = useState(todayYMD())
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState(null)      // { parcels, skipped, headersMissing }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [snapshots, setSnapshots] = useState([])
  const [parties, setParties] = useState([])
  const [showClassified, setShowClassified] = useState(false)

  async function refresh() {
    try {
      const [s, p] = await Promise.all([listSnapshots(), listParties()])
      setSnapshots(s); setParties(p)
    } catch { /* tables not created yet: the sections just stay empty */ }
  }
  useEffect(() => { refresh() }, [])

  async function handleFile(e) {
    const f = e.target.files?.[0]
    setError(''); setDone(''); setParsed(null); setFileName(f ? f.name : '')
    if (!f) return
    try {
      const buf = await f.arrayBuffer()
      const r = parseLineupFile(buf)
      if (r.headersMissing.length) { setError(`File is missing column(s): ${r.headersMissing.join(', ')}. Is this the Orion "Fertilizers_Base_ETBETS" export?`); return }
      if (!r.parcels.length) { setError('No Amsul discharge rows found in this file.'); return }
      setParsed(r)
    } catch {
      setError('Could not read this file. It must be the Orion .xls/.xlsx export.')
    }
  }

  const totals = parsed ? monthlyTotals(parsed.parcels) : []
  const future = parsed ? futureMonths(totals, snapshotDate) : []
  const partyKey = p => `${p.role}|${p.name.toLowerCase()}`
  const known = new Map(parties.map(p => [partyKey(p), p]))
  const inFile = parsed ? partiesIn(parsed.parcels) : []
  const unclassifiedInFile = inFile.filter(p => !known.get(partyKey(p)) || known.get(partyKey(p)).segment === 'unknown')

  async function handleConfirm() {
    if (!parsed) return
    setBusy(true); setError(''); setDone('')
    try {
      const n = await insertSnapshot(snapshotDate, parsed.parcels)
      const written = await writeLineupTotals(snapshotDate, future)
      setDone(`Stored ${n} parcels as the ${fmtDate(snapshotDate)} snapshot. Line-up series: ${written.length ? written.map(m => `${monthLabel(m.period)} ${fmtKt(m.kt)}`).join(', ') : 'nothing new to write'}.`)
      setParsed(null); setFileName('')
      await refresh()
      if (onWritten) onWritten()
    } catch (e) {
      setError(e?.message || 'Could not store the snapshot (admin only).')
    }
    setBusy(false)
  }

  async function classify(p, segment) {
    try {
      const saved = await upsertParty(p.name, p.role, segment)
      setParties(prev => {
        const rest = prev.filter(x => partyKey(x) !== partyKey(saved))
        return [...rest, saved].sort((a, b) => a.name.localeCompare(b.name))
      })
    } catch {
      setError('Could not save the classification (admin only).')
    }
  }

  // Parties list: names from the current file first (unclassified on top), then the rest of the table.
  const listed = (() => {
    const seen = new Set()
    const out = []
    inFile.forEach(p => { const k = partyKey(p); seen.add(k); out.push({ ...p, segment: known.get(k)?.segment || 'unknown' }) })
    parties.forEach(p => { const k = partyKey(p); if (!seen.has(k)) out.push({ name: p.name, role: p.role, tons: null, segment: p.segment }) })
    return out
  })()
  const unclassified = listed.filter(p => p.segment === 'unknown')
  const classified = listed.filter(p => p.segment !== 'unknown')

  return (
    <>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>⇪ Upload Orion line-up file</h2>
        <div className={styles.formWrap}>
          <div className={styles.formField}>
            <label className={styles.label}>Snapshot date *</label>
            <input type="date" className={styles.input} value={snapshotDate} onChange={e => setSnapshotDate(e.target.value)} />
          </div>
          <div className={styles.formField}>
            <label className={styles.label}>Orion file (.xls)</label>
            <input type="file" accept=".xls,.xlsx" className={styles.input} onChange={handleFile} disabled={busy} />
          </div>
        </div>

        {parsed && (
          <div className={styles.tableScroll}>
            <p className={styles.hint}>
              {fileName}: {parsed.parcels.length} Amsul discharge parcels ({parsed.skipped} other rows ignored). Month key = ETB.
            </p>
            <table className={styles.table}>
              <thead><tr>
                <th className={styles.th}>ETB month</th><th className={styles.th}>Total</th><th className={styles.th}>Vessels</th><th className={styles.th}>Parcels</th><th className={styles.th}>Line-up series</th>
              </tr></thead>
              <tbody>
                {totals.map(t => {
                  const isFuture = future.some(f => f.period === t.period)
                  return (
                    <tr key={t.period} className={styles.tr}>
                      <td className={styles.td}>{monthLabel(t.period)}</td>
                      <td className={styles.td}>{fmtKt(t.kt)} Tons</td>
                      <td className={styles.td}>{t.vessels}</td>
                      <td className={styles.td}>{t.parcels}</td>
                      <td className={styles.td} style={{ color: isFuture ? 'var(--accent)' : 'var(--text3)' }}>
                        {isFuture ? 'will be written (orion)' : 'not written — month started (frozen)'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {unclassifiedInFile.length > 0 && (
              <p className={styles.hint} style={{ marginTop: 8 }}>
                {unclassifiedInFile.length} receiver/charterer name(s) in this file are not classified yet — see Parties below. Classification can be done after storing.
              </p>
            )}
            <div className={styles.formActions} style={{ marginTop: 10 }}>
              <button className={styles.cancelBtn} onClick={() => { setParsed(null); setFileName('') }} disabled={busy}>Discard</button>
              <button className={styles.saveBtn} onClick={handleConfirm} disabled={busy}>
                {busy ? 'Storing…' : `◈ Store snapshot ${fmtDate(snapshotDate)}`}
              </button>
            </div>
          </div>
        )}

        {error && <p className={styles.error}>{error}</p>}
        {done && <p className={styles.success}>✓ {done}</p>}

        {snapshots.length > 0 && (
          <p className={styles.hint}>
            Stored snapshots: {snapshots.slice(0, 8).map(s => `${fmtDate(s.snapshot_date)} (${s.parcels})`).join(' · ')}{snapshots.length > 8 ? ' · …' : ''}
          </p>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>◎ Parties — who is who</h2>
        <p className={styles.hint}>Receiver = the buyer the cargo is consigned to. Charterer = the seller. Classify once; the name stays classified.</p>
        {unclassified.length === 0 && listed.length === 0 && <p className={styles.none}>Upload a file to see its receivers and charterers.</p>}
        {unclassified.length === 0 && listed.length > 0 && <p className={styles.success}>✓ Every name is classified.</p>}
        {unclassified.length > 0 && (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead><tr><th className={styles.th}>Name</th><th className={styles.th}>Role</th><th className={styles.th}>Tons in file</th><th className={styles.th}>Segment</th></tr></thead>
              <tbody>
                {unclassified.map(p => (
                  <tr key={partyKey(p)} className={styles.tr}>
                    <td className={styles.td}>{p.name}</td>
                    <td className={styles.td}>{p.role}</td>
                    <td className={styles.td}>{p.tons != null ? Number(p.tons).toLocaleString('en-US') : '—'}</td>
                    <td className={styles.td}>
                      <select className={styles.input} value="unknown" onChange={e => classify(p, e.target.value)}>
                        {SEGMENTS.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {classified.length > 0 && (
          <>
            <button className={styles.cancelBtn} style={{ alignSelf: 'flex-start' }} onClick={() => setShowClassified(v => !v)}>
              {showClassified ? 'Hide' : 'Show'} classified ({classified.length})
            </button>
            {showClassified && (
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead><tr><th className={styles.th}>Name</th><th className={styles.th}>Role</th><th className={styles.th}>Segment</th></tr></thead>
                  <tbody>
                    {classified.map(p => (
                      <tr key={partyKey(p)} className={styles.tr}>
                        <td className={styles.td}>{p.name}</td>
                        <td className={styles.td}>{p.role}</td>
                        <td className={styles.td}>
                          <select className={styles.input} value={p.segment} onChange={e => classify(p, e.target.value)}>
                            {SEGMENTS.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </>
  )
}
