import { useState } from 'react'
import styles from './Ops.module.css'
import { opsUpdateShipment, opsDeleteShipment, opsUpdateParcel, opsUnallocate, opsErrorText, isTBN, sumBy, fmtN, fmtP, fmtQ, num, laycanOptions, invoiceStage } from '../../cloudOps.js'
import { exportBreakdownXlsx } from '../../opsExport.js'

// One shipment: the header ops maintains, and the cargo breakdown built live
// from the sales allocated to it.
export default function OpsShipmentDetail({ shipment, rows, traderNames, onBack, onChanged, onAllocate, invoices = [], issues = [], onInvoice }) {
  const initial = { vessel: shipment.vessel || '', laycan: shipment.laycan || '', status: shipment.status || 'open' }
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const dirty = Object.keys(initial).some(k => form[k] !== initial[k])
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setSaved('') }

  const soldOf = {}
  rows.forEach(r => { soldOf[r.parcel.id] = r.soldTons })
  const totTons = rows.reduce((a, r) => a + r.tons, 0)
  const totSold = rows.reduce((a, r) => a + r.soldTons, 0)
  const totUsd = rows.reduce((a, r) => a + r.total, 0)
  const ports = [...new Set(rows.map(r => r.port).filter(Boolean))]
  const loads = [...new Set(rows.map(r => r.loadPort).filter(Boolean))]
  const byClient = sumBy(rows, 'client')
  const byProduct = sumBy(rows, 'product')

  async function save() {
    if (!form.vessel.trim()) { setError('Vessel cannot be empty — type the TBN name if not nominated.'); return }
    setBusy(true); setError('')
    try {
      const patch = {}
      Object.keys(initial).forEach(k => { if (form[k] !== initial[k]) patch[k] = form[k] })
      await opsUpdateShipment(shipment.id, patch)
      setSaved(patch.vessel !== undefined && rows.length
        ? `✓ Saved. Vessel name updated on ${rows.length} sale${rows.length !== 1 ? 's' : ''} in the traders' Sales Log.`
        : '✓ Saved.')
      await onChanged()
    } catch (e) {
      setError(opsErrorText(e, 'Could not save the shipment.'))
    }
    setBusy(false)
  }

  async function saveParcel(parcel, field, value) {
    if (field === 'final_qty') {
      // typing the sold quantity, or clearing the cell, means "no change from the sale"
      const typed = num(value), sold = num(soldOf[parcel.id])
      const next = typed > 0 && typed !== sold ? typed : null
      if (next === (num(parcel.final_qty) > 0 ? num(parcel.final_qty) : null)) return
      setError('')
      try { await opsUpdateParcel(parcel.id, { final_qty: next ?? '' }) } catch (e) { setError(opsErrorText(e, 'Could not save the quantity.')) }
      await onChanged()
      return
    }
    const current = field === 'parcel_no' ? (parcel.parcel_no || '') : (parcel.load_port || '')
    const next = String(value).trim()
    if (next === current) return
    setError('')
    try {
      await opsUpdateParcel(parcel.id, { [field]: next })
    } catch (e) {
      setError(opsErrorText(e, 'Could not save the change.'))
    }
    await onChanged()
  }

  async function remove(parcel) {
    setError('')
    try {
      await opsUnallocate(parcel.id)
      setConfirmRemove(null)
    } catch (e) {
      setError(opsErrorText(e, 'Could not remove the sale from the shipment.'))
    }
    await onChanged()
  }

  async function deleteShipment() {
    setBusy(true); setError('')
    try {
      await opsDeleteShipment(shipment.id)
      await onChanged()
      onBack()
    } catch (e) {
      setError(opsErrorText(e, 'Could not delete the shipment.'))
      setBusy(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <div className={styles.crumb}><button className={styles.linkBtn} onClick={onBack}>Operations › Shipments</button> › {shipment.vessel}</div>
          <h1 className={styles.title}>{shipment.vessel}{isTBN(shipment.vessel) && <span className={`${styles.pill} ${styles.pillTbn}`} style={{ verticalAlign: 'middle' }}>TBN</span>}</h1>
          <p className={styles.sub}>{shipment.laycan ? `Laycan ${shipment.laycan} · ` : ''}{ports.join(' – ') || 'No discharge port yet'} · {rows.length} sale{rows.length !== 1 ? 's' : ''} · {fmtN(totTons)} t · USD {fmtN(totUsd)}</p>
        </div>
        <div className={styles.headerBtns}>
          <button className={styles.ghost} onClick={() => exportBreakdownXlsx(shipment, rows)} disabled={!rows.length}>Export breakdown</button>
          <button className={styles.ghost} onClick={onAllocate}>+ Allocate sales</button>
        </div>
      </header>

      <div className={styles.card}>
        <div className={styles.grid3}>
          <div className={styles.field}>
            <label className={styles.label}>Vessel name · renaming updates every allocated sale</label>
            <input className={styles.input} value={form.vessel} onChange={e => set('vessel', e.target.value)} />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Laycan</label>
            <select className={styles.select} value={form.laycan} onChange={e => set('laycan', e.target.value)}>
              <option value="">Choose month…</option>
              {laycanOptions(form.laycan).map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Status</label>
            <select className={styles.select} value={form.status} onChange={e => set('status', e.target.value)}>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Load ports (from the sales below)</label>
            <input className={`${styles.input} ${styles.readonly}`} value={loads.join(' · ') || '—'} readOnly />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Discharge ports (from the sales)</label>
            <input className={`${styles.input} ${styles.readonly}`} value={ports.join(' · ') || '—'} readOnly />
          </div>
        </div>
        <div className={styles.formRow}>
          <button className={styles.btn} onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save'}</button>
          {dirty && <button className={styles.ghost} onClick={() => { setForm(initial); setError('') }} disabled={busy}>Undo changes</button>}
          {saved && <span className={styles.success}>{saved}</span>}
          {error && <span className={styles.error}>{error}</span>}
          {rows.length === 0 && (
            <button
              className={`${styles.small} ${styles.danger} ${confirmDelete ? styles.dangerOn : ''}`}
              style={{ marginLeft: 'auto' }}
              onClick={() => (confirmDelete ? deleteShipment() : setConfirmDelete(true))}
              disabled={busy}
            >
              {confirmDelete ? 'Click again to delete this shipment' : 'Delete empty shipment'}
            </button>
          )}
        </div>
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          <span>Cargo breakdown · one row per allocated sale</span>
          <span className={styles.note}>tons start as sold · type the final (BL) quantity in the Tons column when it differs</span>
        </h2>
        {rows.length === 0 ? (
          <p className={styles.none}>No sales on this shipment yet. <button className={styles.linkBtn} onClick={onAllocate}>Allocate sales →</button></p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Client</th>
                  <th className={styles.th}>Reference</th>
                  <th className={styles.th}>Load</th>
                  <th className={styles.th}>Discharge</th>
                  <th className={styles.th}>Product</th>
                  <th className={`${styles.th} ${styles.r}`}>Tons</th>
                  <th className={`${styles.th} ${styles.r}`}>USD/t</th>
                  <th className={`${styles.th} ${styles.r}`}>Total USD</th>
                  <th className={styles.th}>Trader</th>
                  <th className={styles.th}>Invoice</th>
                  <th className={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.parcel.id} className={styles.tr}>
                    <td className={styles.td} style={{ fontWeight: 700 }}>{r.client}</td>
                    <td className={styles.td}>
                      <input
                        key={`${r.parcel.id}-no-${r.parcel.parcel_no || ''}`}
                        className={`${styles.cell} ${styles.cellNo}`}
                        defaultValue={r.parcel.parcel_no || ''}
                        placeholder="type reference"
                        title="This sale's reference — type to change"
                        onBlur={e => saveParcel(r.parcel, 'parcel_no', e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                      />
                    </td>
                    <td className={styles.td}>
                      <input
                        key={`${r.parcel.id}-lp-${r.parcel.load_port || ''}`}
                        className={`${styles.cell} ${styles.cellPort}`}
                        defaultValue={r.parcel.load_port || ''}
                        placeholder="load port"
                        onBlur={e => saveParcel(r.parcel, 'load_port', e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                      />
                    </td>
                    <td className={styles.td}>{r.port || '—'}</td>
                    <td className={styles.td}>{r.product || '—'}</td>
                    <td className={`${styles.td} ${styles.r}`}>
                      <input
                        key={`${r.parcel.id}-q-${r.tons}`}
                        className={`${styles.cell} ${styles.cellQty}`}
                        defaultValue={fmtQ(r.tons)}
                        inputMode="decimal"
                        title="Final quantity — type the BL quantity when it differs from the sale"
                        onBlur={e => saveParcel(r.parcel, 'final_qty', e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                      />
                      {r.tons !== r.soldTons && <div className={styles.soldNote}>sold {fmtQ(r.soldTons)}</div>}
                    </td>
                    <td className={`${styles.td} ${styles.r}`}>{fmtP(r.price)}</td>
                    <td className={`${styles.td} ${styles.r}`}>{fmtN(r.total)}</td>
                    <td className={`${styles.td} ${styles.dim}`}>{r.sale ? (traderNames[r.sale.trader_id] || 'Trader') : '—'}</td>
                    <td className={styles.td}>
                      {(() => {
                        const st = invoiceStage(r.parcel.id, invoices, issues)
                        return (
                          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                            {st && <span className={`${styles.pill} ${st === 'commercial' ? styles.pillOpen : st === 'proforma' ? styles.pillPro : styles.pillClosed}`}>{st}</span>}
                            <button className={styles.small} onClick={() => onInvoice && onInvoice(r.parcel.id)}>{st ? 'Open' : 'Invoice'}</button>
                          </span>
                        )
                      })()}
                    </td>
                    <td className={styles.td}>
                      <button
                        className={`${styles.small} ${styles.danger} ${confirmRemove === r.parcel.id ? styles.dangerOn : ''}`}
                        title="Send this sale back to Unallocated. The sale itself is not deleted."
                        onClick={() => (confirmRemove === r.parcel.id ? remove(r.parcel) : setConfirmRemove(r.parcel.id))}
                        onBlur={() => setConfirmRemove(null)}
                      >
                        {confirmRemove === r.parcel.id ? 'Click again' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className={`${styles.td} ${styles.tot}`} colSpan={5}>TOTAL · {rows.length} sale{rows.length !== 1 ? 's' : ''}</td>
                  <td className={`${styles.td} ${styles.tot} ${styles.r}`}>{fmtQ(totTons)}{totTons !== totSold && <div className={styles.soldNote}>sold {fmtQ(totSold)}</div>}</td>
                  <td className={`${styles.td} ${styles.tot}`}></td>
                  <td className={`${styles.td} ${styles.tot} ${styles.r}`}>{fmtN(totUsd)}</td>
                  <td className={`${styles.td} ${styles.tot}`} colSpan={3}></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {rows.length > 0 && (
        <div className={styles.grid2}>
          {[['By client', 'Client', byClient], ['By product', 'Product', byProduct]].map(([title, head, list]) => (
            <section key={title} className={styles.section}>
              <h2 className={styles.sectionTitle}>{title}</h2>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.th}>{head}</th>
                    <th className={`${styles.th} ${styles.r}`}>Tons</th>
                    <th className={`${styles.th} ${styles.r}`}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map(x => (
                    <tr key={x.name} className={styles.tr}>
                      <td className={styles.td}>{x.name}</td>
                      <td className={`${styles.td} ${styles.r}`}>{fmtN(x.tons)}</td>
                      <td className={`${styles.td} ${styles.r} ${styles.dim}`}>{totTons ? (x.tons / totTons * 100).toFixed(1) : '0.0'}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
