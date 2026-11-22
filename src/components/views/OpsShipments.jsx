import { useState } from 'react'
import styles from './Ops.module.css'
import OpsUnallocated from './OpsUnallocated.jsx'
import { opsCreateShipment, opsErrorText, isTBN, num, fmtN, laycanOptions } from '../../cloudOps.js'

const EMPTY = { vessel: '', laycan: '' }

// A shipment is a vessel. It is created with the vessel name (or the TBN name)
// and a laycan month; sales are then allocated to it.
export default function OpsShipments({ shipments, rowsByShipment, unallocated, onOpen, onChanged, allocProps }) {
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fVessel, setFVessel] = useState('')
  const [fLaycan, setFLaycan] = useState('')

  const open = shipments.filter(s => s.status !== 'closed')
  const totals = id => {
    const rows = rowsByShipment[id] || []
    return {
      n: rows.length,
      tons: rows.reduce((a, r) => a + r.tons, 0),
      usd: rows.reduce((a, r) => a + r.total, 0),
      ports: [...new Set(rows.map(r => r.port).filter(Boolean))].join(' · '),
      loads: [...new Set(rows.map(r => r.loadPort).filter(Boolean))].join(' · '),
    }
  }
  const allocatedOpenTons = open.reduce((a, s) => a + totals(s.id).tons, 0)
  const unallocTons = unallocated.reduce((a, s) => a + num(s.volume), 0)

  // Open shipments first, newest first inside each block
  const sorted = [...shipments].sort((a, b) =>
    (a.status === 'closed') - (b.status === 'closed') || String(b.created_at).localeCompare(String(a.created_at)))

  const vesselNames = [...new Set(shipments.map(s => s.vessel).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const laycans = [...new Set(shipments.map(s => s.laycan).filter(Boolean))]
  const shown = sorted.filter(s => (!fVessel || s.vessel === fVessel) && (!fLaycan || s.laycan === fLaycan))

  async function create() {
    if (!form.vessel.trim()) { setError('Vessel name is required — type the TBN name if not nominated (e.g. TBN December).'); return }
    if (!form.laycan) { setError('Choose the laycan month.'); return }
    setBusy(true)
    try {
      const sh = await opsCreateShipment(form)
      setForm(EMPTY); setShowNew(false); setError('')
      await onChanged()
      onOpen(sh.id)
    } catch (e) {
      setError(opsErrorText(e, 'Could not create the shipment.'))
    }
    setBusy(false)
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Operations</h1>
          <p className={styles.sub}>Shipments by vessel · sales allocated by ops · the trader's sale is never edited here</p>
        </div>
        <button className={styles.btn} onClick={() => { setShowNew(v => !v); setError('') }}>{showNew ? 'Cancel' : '+ New shipment'}</button>
      </header>

      {showNew && (
        <div className={styles.card}>
          <div className={styles.grid3}>
            <div className={styles.field}>
              <label className={styles.label}>Vessel name *</label>
              <input className={styles.input} placeholder="e.g. MV COTINGA or TBN December" value={form.vessel} onChange={e => set('vessel', e.target.value)} autoFocus />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Laycan *</label>
              <select className={styles.select} value={form.laycan} onChange={e => set('laycan', e.target.value)}>
                <option value="">Choose month…</option>
                {laycanOptions().map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div className={styles.formRow}>
            <button className={styles.btn} onClick={create} disabled={busy}>{busy ? 'Saving…' : 'Create shipment'}</button>
            {error && <span className={styles.error}>{error}</span>}
          </div>
        </div>
      )}

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statNum}>{open.length}</div>
          <div className={styles.statLbl}>Open shipments</div>
        </div>
        <div className={styles.statCard}>
          <div className={`${styles.statNum} ${unallocated.length ? styles.statAmber : ''}`}>{unallocated.length}</div>
          <div className={styles.statLbl}>Unallocated sales · {fmtN(unallocTons)} t</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statNum}>{fmtN(allocatedOpenTons)} t</div>
          <div className={styles.statLbl}>Allocated · open shipments</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statNum}>{open.filter(s => isTBN(s.vessel)).length}</div>
          <div className={styles.statLbl}>Vessels still TBN</div>
        </div>
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          <span>Shipments</span>
          {shipments.length > 0 && (
            <span className={styles.filters}>
              <select className={`${styles.select} ${styles.filterSelect}`} value={fVessel} onChange={e => setFVessel(e.target.value)}>
                <option value="">All vessels</option>
                {vesselNames.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <select className={`${styles.select} ${styles.filterSelect}`} value={fLaycan} onChange={e => setFLaycan(e.target.value)}>
                <option value="">All laycans</option>
                {laycans.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
              {(fVessel || fLaycan) && <button className={styles.small} onClick={() => { setFVessel(''); setFLaycan('') }}>Clear</button>}
            </span>
          )}
        </h2>
        {sorted.length === 0 ? (
          <p className={styles.none}>No shipments yet. Create one with "+ New shipment", or tick sales below and allocate them to a new vessel.</p>
        ) : shown.length === 0 ? (
          <p className={styles.none}>No shipment matches the filter.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Vessel</th>
                  <th className={styles.th}>Laycan</th>
                  <th className={styles.th}>Load</th>
                  <th className={styles.th}>Discharge</th>
                  <th className={`${styles.th} ${styles.r}`}>Sales</th>
                  <th className={`${styles.th} ${styles.r}`}>Tons</th>
                  <th className={`${styles.th} ${styles.r}`}>USD</th>
                  <th className={styles.th}>Status</th>
                  <th className={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {shown.map(s => {
                  const t = totals(s.id)
                  return (
                    <tr key={s.id} className={`${styles.tr} ${styles.trClick}`} onClick={() => onOpen(s.id)}>
                      <td className={`${styles.td} ${styles.ref}`}>{s.vessel}{isTBN(s.vessel) && <span className={`${styles.pill} ${styles.pillTbn}`}>TBN</span>}</td>
                      <td className={styles.td}>{s.laycan || '—'}</td>
                      <td className={styles.td}>{t.loads || '—'}</td>
                      <td className={styles.td}>{t.ports || '—'}</td>
                      <td className={`${styles.td} ${styles.r}`}>{t.n}</td>
                      <td className={`${styles.td} ${styles.r}`}>{fmtN(t.tons)}</td>
                      <td className={`${styles.td} ${styles.r}`}>{fmtN(t.usd)}</td>
                      <td className={styles.td}><span className={`${styles.pill} ${s.status === 'closed' ? styles.pillClosed : styles.pillOpen}`}>{s.status}</span></td>
                      <td className={styles.td}><button className={styles.small} onClick={e => { e.stopPropagation(); onOpen(s.id) }}>Open</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <OpsUnallocated {...allocProps} />
    </div>
  )
}
