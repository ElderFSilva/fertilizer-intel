import { useState } from 'react'
import styles from './Ops.module.css'
import OpsUnallocated from './OpsUnallocated.jsx'
import { opsCreateShipment, opsErrorText, isTBN, num, fmtN } from '../../cloudOps.js'

const EMPTY = { ref: '', vessel: '', laycan: '', load_ports: '' }

export default function OpsShipments({ shipments, rowsByShipment, unallocated, onOpen, onChanged, allocProps }) {
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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

  async function create() {
    if (!form.ref.trim()) { setError('Shipment ref is required (e.g. LG261201).'); return }
    if (!form.vessel.trim()) { setError('Vessel is required — type the TBN name if not nominated (e.g. TBN December).'); return }
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
          <p className={styles.sub}>Shipments · sales allocated by ops · the trader's sale is never edited here</p>
        </div>
        <button className={styles.btn} onClick={() => { setShowNew(v => !v); setError('') }}>{showNew ? 'Cancel' : '+ New shipment'}</button>
      </header>

      {showNew && (
        <div className={styles.card}>
          <div className={styles.grid4}>
            <div className={styles.field}>
              <label className={styles.label}>Shipment ref *</label>
              <input className={styles.input} placeholder="e.g. LG261201" value={form.ref} onChange={e => set('ref', e.target.value)} autoFocus />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Vessel *</label>
              <input className={styles.input} placeholder="e.g. TBN December" value={form.vessel} onChange={e => set('vessel', e.target.value)} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Laycan</label>
              <input className={styles.input} placeholder="e.g. Dec 1-15" value={form.laycan} onChange={e => set('laycan', e.target.value)} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Load ports</label>
              <input className={styles.input} placeholder="e.g. Taizhou · Qinzhou" value={form.load_ports} onChange={e => set('load_ports', e.target.value)} />
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
        <h2 className={styles.sectionTitle}>Shipments</h2>
        {sorted.length === 0 ? (
          <p className={styles.none}>No shipments yet. Create one with "+ New shipment", or tick sales below and allocate them to a new shipment.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Ref</th>
                  <th className={styles.th}>Vessel</th>
                  <th className={styles.th}>Laycan</th>
                  <th className={styles.th}>Load</th>
                  <th className={styles.th}>Discharge</th>
                  <th className={`${styles.th} ${styles.r}`}>Parcels</th>
                  <th className={`${styles.th} ${styles.r}`}>Tons</th>
                  <th className={`${styles.th} ${styles.r}`}>USD</th>
                  <th className={styles.th}>Status</th>
                  <th className={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(s => {
                  const t = totals(s.id)
                  return (
                    <tr key={s.id} className={`${styles.tr} ${styles.trClick}`} onClick={() => onOpen(s.id)}>
                      <td className={`${styles.td} ${styles.ref}`}>{s.ref}</td>
                      <td className={styles.td}>{s.vessel}{isTBN(s.vessel) && <span className={`${styles.pill} ${styles.pillTbn}`}>TBN</span>}</td>
                      <td className={styles.td}>{s.laycan || '—'}</td>
                      <td className={styles.td}>{s.load_ports || t.loads || '—'}</td>
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
