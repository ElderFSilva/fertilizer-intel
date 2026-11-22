import { useState, useMemo, useEffect } from 'react'
import styles from './Ops.module.css'
import { opsCreateShipment, opsAllocate, opsErrorText, nextParcelNo, normVessel, num, fmtN, fmtSaleDate, saleDateOf } from '../../cloudOps.js'

const NEW = '__new__'

// Every sale not yet on a shipment, grouped by the vessel text the trader
// typed (e.g. "TBN November"). Ops ticks sales and pulls them into a shipment.
export default function OpsUnallocated({ unallocated, shipments, parcelsByShipment, traderNames, onDone, onOpenShipment, initialTarget = '', standalone = false }) {
  const [selected, setSelected] = useState(() => new Set())
  const [target, setTarget] = useState(initialTarget)
  const [loadPort, setLoadPort] = useState('')
  const [newShip, setNewShip] = useState({ ref: '', vessel: '', laycan: '', load_ports: '' })
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => { setTarget(initialTarget) }, [initialTarget])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return unallocated
    return unallocated.filter(s =>
      [s.client, s.vessel, s.port, s.product, s.laycan, traderNames[s.trader_id]].some(x => (x || '').toLowerCase().includes(q)))
  }, [unallocated, search, traderNames])

  // Group by vessel text; the group with the most recent sale comes first.
  const groups = useMemo(() => {
    const m = {}
    filtered.forEach(s => {
      const key = normVessel(s.vessel) || '(no vessel typed)'
      if (!m[key]) m[key] = { key, label: (s.vessel || '').trim() || '(no vessel typed)', sales: [], latest: '' }
      m[key].sales.push(s)
      const d = saleDateOf(s)
      if (d > m[key].latest) m[key].latest = d
    })
    const list = Object.values(m)
    list.forEach(g => g.sales.sort((a, b) => saleDateOf(b).localeCompare(saleDateOf(a))))
    return list.sort((a, b) => b.latest.localeCompare(a.latest))
  }, [filtered])

  const selectedSales = unallocated.filter(s => selected.has(s.id))
  const selTons = selectedSales.reduce((a, s) => a + num(s.volume), 0)

  function toggle(id) {
    setDone('')
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleGroup(g) {
    setDone('')
    setSelected(prev => {
      const n = new Set(prev)
      const all = g.sales.every(s => n.has(s.id))
      g.sales.forEach(s => { all ? n.delete(s.id) : n.add(s.id) })
      return n
    })
  }

  // Choosing "new shipment" pre-fills vessel and laycan from the first ticked sale.
  function chooseTarget(v) {
    setTarget(v); setError('')
    if (v === NEW) {
      const first = selectedSales[0]
      setNewShip(n => ({ ...n, vessel: n.vessel || (first?.vessel || '').trim(), laycan: n.laycan || (first?.laycan || '').trim() }))
    }
  }

  async function allocate() {
    if (!selectedSales.length) return
    if (!target) { setError('Choose the shipment to allocate to.'); return }
    if (target === NEW) {
      if (!newShip.ref.trim()) { setError('Shipment ref is required (e.g. LG261201).'); return }
      if (!newShip.vessel.trim()) { setError('Vessel is required — type the TBN name if not nominated.'); return }
    }
    setBusy(true); setError('')
    try {
      let shipmentId = target
      let ref = shipments.find(s => s.id === target)?.ref
      if (target === NEW) {
        const sh = await opsCreateShipment(newShip)
        shipmentId = sh.id; ref = sh.ref
      }
      // Numbers follow the order the sales were made, oldest first.
      const ordered = [...selectedSales].sort((a, b) =>
        saleDateOf(a).localeCompare(saleDateOf(b)) || String(a.created_at).localeCompare(String(b.created_at)))
      const start = nextParcelNo(parcelsByShipment[shipmentId] || [])
      await opsAllocate(shipmentId, ordered.map((s, i) => ({ sale_id: s.id, parcel_no: start + i, load_port: loadPort })))
      setDone(`✓ ${ordered.length} sale${ordered.length !== 1 ? 's' : ''} allocated to ${ref}.`)
      setSelected(new Set()); setLoadPort(''); setNewShip({ ref: '', vessel: '', laycan: '', load_ports: '' })
      setTarget(target === NEW ? shipmentId : target)
      await onDone()
    } catch (e) {
      setError(opsErrorText(e, 'Could not allocate the sales.'))
      await onDone()
    }
    setBusy(false)
  }

  const openFirst = [...shipments].sort((a, b) => (a.status === 'closed') - (b.status === 'closed') || String(b.created_at).localeCompare(String(a.created_at)))
  const setN = (k, v) => setNewShip(n => ({ ...n, [k]: v }))

  return (
    <div className={styles.wrap}>
      {standalone && (
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Unallocated sales</h1>
            <p className={styles.sub}>{unallocated.length} sale{unallocated.length !== 1 ? 's' : ''} not on a shipment · {fmtN(unallocated.reduce((a, s) => a + num(s.volume), 0))} t</p>
          </div>
        </header>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          <span>Unallocated sales · grouped by the vessel text the trader typed</span>
          <input className={styles.search} placeholder="Search client, vessel, port, product…" value={search} onChange={e => setSearch(e.target.value)} />
        </h2>

        {done && (
          <p className={styles.success}>
            {done}{' '}
            {target && target !== NEW && <button className={styles.linkBtn} onClick={() => onOpenShipment(target)}>Open shipment →</button>}
          </p>
        )}

        {unallocated.length === 0 ? (
          <p className={styles.none}>Every sale is on a shipment.</p>
        ) : groups.length === 0 ? (
          <p className={styles.none}>No unallocated sale matches the search.</p>
        ) : groups.map(g => {
          const all = g.sales.every(s => selected.has(s.id))
          return (
            <div key={g.key}>
              <div className={styles.group} onClick={() => toggleGroup(g)}>
                <input type="checkbox" className={styles.chk} checked={all} readOnly />
                <span>Trader typed vessel: <b>{g.label}</b></span>
                <span className={styles.groupCount}>{g.sales.length} sale{g.sales.length !== 1 ? 's' : ''} · {fmtN(g.sales.reduce((a, s) => a + num(s.volume), 0))} t</span>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <tbody>
                    {g.sales.map(s => (
                      <tr key={s.id} className={`${styles.tr} ${styles.trClick}`} onClick={() => toggle(s.id)}>
                        <td className={styles.td} style={{ width: 34 }}><input type="checkbox" className={styles.chk} checked={selected.has(s.id)} readOnly /></td>
                        <td className={styles.td}>{fmtSaleDate(saleDateOf(s))}</td>
                        <td className={styles.td} style={{ fontWeight: 700 }}>{s.client || '—'}</td>
                        <td className={styles.td}>{s.product || '—'}</td>
                        <td className={`${styles.td} ${styles.r}`}>{fmtN(num(s.volume))} t</td>
                        <td className={`${styles.td} ${styles.r}`}>{s.donePrice || '—'}</td>
                        <td className={styles.td}>{s.port || '—'}</td>
                        <td className={styles.td}>{s.laycan || '—'}</td>
                        <td className={`${styles.td} ${styles.dim}`}>{traderNames[s.trader_id] || 'Trader'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}

        {unallocated.length > 0 && (
          <p className={styles.note}>Allocating gives each sale the next parcel number (-1, -2…) and writes the shipment's vessel name onto the sale. Numbers and the shipment ref can be retyped at any time.</p>
        )}
      </section>

      {selectedSales.length > 0 && (
        <div className={styles.allocBar}>
          <div className={styles.allocTop}>
            <span className={styles.allocCount}>{selectedSales.length} selected · {fmtN(selTons)} t →</span>
            <div className={styles.allocField}>
              <label className={styles.label}>Allocate to shipment</label>
              <select className={styles.select} value={target} onChange={e => chooseTarget(e.target.value)}>
                <option value="">Choose…</option>
                {openFirst.map(s => <option key={s.id} value={s.id}>{s.ref} · {s.vessel}{s.status === 'closed' ? ' (closed)' : ''}</option>)}
                <option value={NEW}>+ New shipment…</option>
              </select>
            </div>
            <div className={styles.allocField}>
              <label className={styles.label}>Load port (can be changed per parcel later)</label>
              <input className={styles.input} placeholder="e.g. Taizhou" value={loadPort} onChange={e => setLoadPort(e.target.value)} />
            </div>
            <button className={styles.btn} onClick={allocate} disabled={busy}>{busy ? 'Allocating…' : 'Allocate'}</button>
            <button className={styles.ghost} onClick={() => { setSelected(new Set()); setError('') }} disabled={busy}>Clear</button>
          </div>
          {target === NEW && (
            <div className={styles.grid4}>
              <div className={styles.field}>
                <label className={styles.label}>New shipment ref *</label>
                <input className={styles.input} placeholder="e.g. LG261201" value={newShip.ref} onChange={e => setN('ref', e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Vessel *</label>
                <input className={styles.input} placeholder="e.g. TBN December" value={newShip.vessel} onChange={e => setN('vessel', e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Laycan</label>
                <input className={styles.input} placeholder="e.g. Dec 1-15" value={newShip.laycan} onChange={e => setN('laycan', e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Load ports</label>
                <input className={styles.input} placeholder="e.g. Taizhou · Qinzhou" value={newShip.load_ports} onChange={e => setN('load_ports', e.target.value)} />
              </div>
            </div>
          )}
          {error && <span className={styles.error}>{error}</span>}
        </div>
      )}
    </div>
  )
}
