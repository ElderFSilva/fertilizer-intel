import { useState, useEffect, useMemo } from 'react'
import Sidebar from './Sidebar.jsx'
import OpsShipments from './views/OpsShipments.jsx'
import OpsUnallocated from './views/OpsUnallocated.jsx'
import OpsShipmentDetail from './views/OpsShipmentDetail.jsx'
import styles from './views/Ops.module.css'
import { opsLoadAll, breakdownRows } from '../cloudOps.js'

// ── Operations environment ──
// Used by the ops team (role 'ops') and by admin through the sidebar switch.
// Shipments are buckets of sales: the trader logs the sale, ops pulls it into
// a shipment, and the shipment's breakdown is built live from those sales.

function labelForProfile(p) {
  const src = p.email || p.user_email || p.display_name || p.full_name || p.name || p.username || ''
  const m = String(src).match(/trader\s*0*(\d+)/i)
  if (m) return `Trader ${m[1]}`
  if (p.role === 'admin') return 'Admin'
  if (src) return String(src).includes('@') ? String(src).split('@')[0] : String(src)
  return `Trader ${String(p.id).slice(0, 4)}`
}

export default function Operations({ onLogout, role, onSwitchEnv }) {
  const [view, setView] = useState('shipments')   // 'shipments' | 'unallocated' | 'detail'
  const [openId, setOpenId] = useState(null)
  const [target, setTarget] = useState('')        // shipment preselected on the allocation bar
  const [data, setData] = useState({ shipments: [], parcels: [], sales: [], profiles: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function reload() {
    try {
      setData(await opsLoadAll())
      setError('')
    } catch (e) {
      setError(/permission denied|does not exist|schema cache/i.test(String(e?.message || ''))
        ? 'Operations tables are not set up yet, or this login has no access to them.'
        : 'Could not load operations data from the cloud.')
    }
  }

  useEffect(() => {
    let active = true
    ;(async () => { await reload(); if (active) setLoading(false) })()
    return () => { active = false }
  }, [])

  const { shipments, parcels, sales, profiles } = data

  const saleById = useMemo(() => {
    const m = {}; sales.forEach(s => { m[s.id] = s }); return m
  }, [sales])

  const parcelsByShipment = useMemo(() => {
    const m = {}; parcels.forEach(p => { (m[p.shipment_id] = m[p.shipment_id] || []).push(p) }); return m
  }, [parcels])

  const rowsByShipment = useMemo(() => {
    const m = {}
    shipments.forEach(sh => { m[sh.id] = breakdownRows(sh, parcelsByShipment[sh.id] || [], saleById) })
    return m
  }, [shipments, parcelsByShipment, saleById])

  const unallocated = useMemo(() => {
    const taken = new Set(parcels.map(p => p.sale_id))
    return sales.filter(s => !taken.has(s.id))
  }, [sales, parcels])

  const traderNames = useMemo(() => {
    const m = {}
    profiles.forEach(p => { if (p?.id) m[p.id] = labelForProfile(p) })
    return m
  }, [profiles])

  function openShipment(id) { setOpenId(id); setView('detail') }
  function goAllocate(shipmentId) { setTarget(shipmentId || ''); setView('unallocated') }
  function nav(v) { setTarget(''); setView(v) }

  const openShipmentRow = shipments.find(s => s.id === openId)

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg, #0e0f0c)', color: 'var(--text3, #888)', fontFamily: 'DM Mono, monospace', fontSize: 14 }}>
        ◌ Loading operations…
      </div>
    )
  }

  const allocProps = { unallocated, shipments, parcelsByShipment, traderNames, onDone: reload, onOpenShipment: openShipment }

  return (
    <div className={styles.layout}>
      <Sidebar
        view={view === 'detail' ? 'shipments' : view}
        setView={nav}
        onLogout={onLogout}
        role={role}
        env="ops"
        onSwitchEnv={onSwitchEnv}
        badges={{ unallocated: unallocated.length }}
      />
      <main className={styles.main}>
        {error && <div className={styles.errorBar}>{error}</div>}
        {view === 'shipments' && (
          <OpsShipments
            shipments={shipments}
            rowsByShipment={rowsByShipment}
            unallocated={unallocated}
            onOpen={openShipment}
            onChanged={reload}
            allocProps={allocProps}
          />
        )}
        {view === 'unallocated' && (
          <OpsUnallocated {...allocProps} initialTarget={target} standalone />
        )}
        {view === 'detail' && openShipmentRow && (
          <OpsShipmentDetail
            key={openShipmentRow.id}
            shipment={openShipmentRow}
            rows={rowsByShipment[openShipmentRow.id] || []}
            traderNames={traderNames}
            onBack={() => setView('shipments')}
            onChanged={reload}
            onAllocate={() => goAllocate(openShipmentRow.id)}
          />
        )}
        {view === 'detail' && !openShipmentRow && (
          <p className={styles.none}>Shipment not found. <button className={styles.linkBtn} onClick={() => setView('shipments')}>Back to shipments</button></p>
        )}
      </main>
    </div>
  )
}
