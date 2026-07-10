import { useState, useEffect, useMemo } from 'react'
import { buildMarketSignals } from '../data.js'
import { cloudLoadCalls, cloudAddCall, cloudEditCall, cloudDeleteCall, cloudLoadSales, cloudAddSale, cloudEditSale, cloudDeleteSale, cloudLoadProfiles, runWeeklyBackupIfDue } from '../cloudData.js'
import Sidebar from './Sidebar.jsx'
import Overview from './views/Overview.jsx'
import Calls from './views/Calls.jsx'
import Upload from './views/Upload.jsx'
import Sales from './views/Sales.jsx'
import PriceTrends from './views/PriceTrends.jsx'
import Publication from './views/Publication.jsx'
import styles from './Dashboard.module.css'
import DataBackup from './views/DataBackup.jsx'

export default function Dashboard({ onLogout, user, profile, role }) {
  const [view, setView] = useState('overview')
  const [calls, setCalls] = useState([])
  const [sales, setSales] = useState([])
  const [profiles, setProfiles] = useState([])
  const [traderFilter, setTraderFilter] = useState('all') // 'all' | trader_id (admin only)
  const [backupNotice, setBackupNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const traderId = user?.id
  const isAdmin = role === 'admin'

  async function reloadCalls() {
    try {
      const rows = await cloudLoadCalls()
      setCalls(rows)
      setError('')
    } catch (e) {
      setError('Could not load calls from the cloud.')
    }
  }

  async function reloadAll() {
    try {
      const [c, s] = await Promise.all([cloudLoadCalls(), cloudLoadSales()])
      setCalls(c); setSales(s); setError('')
    } catch (e) {
      setError('Could not load data from the cloud.')
    }
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      setLoading(true)
      try {
        const [c, s] = await Promise.all([cloudLoadCalls(), cloudLoadSales()])
        if (active) { setCalls(c); setSales(s) }
      } catch (e) {
        if (active) setError('Could not load data from the cloud.')
      }
      // Profiles are only needed to label traders in the admin views. Load
      // them separately so a profiles-permission issue never blocks calls/sales.
      try {
        const p = await cloudLoadProfiles()
        if (active) setProfiles(p)
      } catch (e) { /* labels will fall back to short ids */ }
      // Weekly automatic backup (admin only, once per week on/after Friday).
      try {
        const did = await runWeeklyBackupIfDue(role)
        if (active && did) setBackupNotice(`✓ Weekly backup for ${did} saved to Supabase and downloaded to your device.`)
      } catch (e) { /* a backup failure must never block the app */ }
      if (active) setLoading(false)
    })()
    return () => { active = false }
  }, [])

  async function handleAdd(entry) {
    try {
      const saved = await cloudAddCall(entry, traderId)
      setCalls(prev => [saved, ...prev])
    } catch (e) {
      setError('Could not save the call.')
    }
  }

  async function handleDelete(id) {
    try {
      await cloudDeleteCall(id)
      setCalls(prev => prev.filter(c => c.id !== id))
    } catch (e) {
      setError('Could not delete the call.')
    }
  }

  async function handleEdit(id, updates) {
    try {
      const existing = calls.find(c => c.id === id)
      const saved = await cloudEditCall(id, updates, existing)
      setCalls(prev => prev.map(c => c.id === id ? saved : c))
    } catch (e) {
      setError('Could not update the call.')
    }
  }

  async function handleAddSale(sale) {
    const saved = await cloudAddSale(sale, traderId)
    setSales(prev => [saved, ...prev])
    return saved
  }

  async function handleDeleteSale(id) {
    await cloudDeleteSale(id)
    setSales(prev => prev.filter(s => s.id !== id))
  }

  async function handleEditSale(id, patch) {
    const existing = sales.find(s => s.id === id)
    const saved = await cloudEditSale(id, patch, existing)
    setSales(prev => prev.map(s => s.id === id ? saved : s))
    return saved
  }

  // Derive a friendly label for a profile row. Profile columns vary between
  // projects, so read defensively. In this project the identifying value lives
  // in `display_name` (e.g. "trader1@fertintel.com" → "Trader 1"); other field
  // names are also checked so the app keeps working if the schema changes.
  function labelForProfile(p) {
    const src = p.email || p.user_email || p.display_name || p.full_name || p.name || p.username || ''
    const m = String(src).match(/trader\s*0*(\d+)/i)
    if (m) return `Trader ${m[1]}`
    if (/admin/i.test(src) || p.role === 'admin') return 'Admin'
    if (src) return String(src).includes('@') ? String(src).split('@')[0] : String(src)
    return `Trader ${String(p.id).slice(0, 4)}`
  }

  // { trader_id: label } for the admin views. Falls back to short id if a
  // profile isn't readable (e.g. RLS returned only the admin's own row).
  const traderNames = useMemo(() => {
    const map = {}
    profiles.forEach(p => { if (p?.id) map[p.id] = labelForProfile(p) })
    const shortId = id => `Trader ${String(id).slice(0, 4)}`
    ;[...calls, ...sales].forEach(r => {
      if (r.trader_id && !map[r.trader_id]) map[r.trader_id] = shortId(r.trader_id)
    })
    return map
  }, [profiles, calls, sales])

  // Roles by id, so the toggle can exclude the admin's own account.
  const rolesById = useMemo(() => {
    const m = {}
    profiles.forEach(p => { if (p?.id) m[p.id] = p.role })
    return m
  }, [profiles])

  // Toggle options: every non-admin trader that has a profile or any data.
  const traderOptions = useMemo(() => {
    const ids = new Set()
    profiles.forEach(p => { if (p?.id && p.role !== 'admin') ids.add(p.id) })
    ;[...calls, ...sales].forEach(r => { if (r.trader_id) ids.add(r.trader_id) })
    return [...ids]
      .filter(id => rolesById[id] !== 'admin' && id !== traderId)
      .map(id => ({ id, label: traderNames[id] || `Trader ${String(id).slice(0, 4)}` }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [profiles, calls, sales, traderNames, rolesById, traderId])

  // Apply the admin trader filter. Traders always see exactly their own data.
  const filtering = isAdmin && traderFilter !== 'all'
  const visibleCalls = filtering ? calls.filter(c => c.trader_id === traderFilter) : calls
  const visibleSales = filtering ? sales.filter(s => s.trader_id === traderFilter) : sales

  // AI snapshot scope: admin sees a global analysis on "All traders" and a
  // separate per-trader analysis otherwise; a trader always scopes to their own.
  const aiScope = isAdmin ? (traderFilter === 'all' ? 'global' : traderFilter) : (traderId || 'self')
  const aiScopeLabel = isAdmin
    ? (traderFilter === 'all' ? 'All traders' : (traderNames[traderFilter] || 'Trader'))
    : (traderNames[traderId] || 'You')

  const signals = buildMarketSignals(visibleCalls)

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg, #0e0f0c)', color: 'var(--text3, #888)', fontFamily: 'DM Mono, monospace', fontSize: 14 }}>
        ◌ Loading your data…
      </div>
    )
  }

  return (
    <div className={styles.layout}>
      <Sidebar view={view} setView={setView} onLogout={onLogout} signals={signals} role={role} />
      <main className={styles.main}>
        {backupNotice && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '10px 14px', background: 'var(--accent-dim, #c8f06022)', border: '1px solid var(--accent, #c8f060)', color: 'var(--text, #eaeadf)', borderRadius: 8, fontSize: 13, fontFamily: 'DM Mono, monospace' }}>
            <span>{backupNotice}</span>
            <button onClick={() => setBackupNotice('')} style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text3, #888)', cursor: 'pointer', fontSize: 14 }}>✕</button>
          </div>
        )}
        {isAdmin && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16, padding: '10px 12px', background: 'var(--bg2, #16180f)', border: '1px solid var(--border, #2a2d20)', borderRadius: 10 }}>
            <span style={{ fontSize: 11, fontFamily: 'DM Mono, monospace', color: 'var(--text3, #888)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Viewing</span>
            {[{ id: 'all', label: `All traders${traderOptions.length ? ` (${traderOptions.length})` : ''}` }, ...traderOptions].map(opt => {
              const active = traderFilter === opt.id
              return (
                <button
                  key={opt.id}
                  onClick={() => setTraderFilter(opt.id)}
                  style={{
                    fontSize: 12, fontFamily: 'DM Mono, monospace', cursor: 'pointer',
                    padding: '5px 12px', borderRadius: 7,
                    border: `1px solid ${active ? 'var(--accent, #c8f060)' : 'var(--border2, #33362a)'}`,
                    background: active ? 'var(--accent, #c8f060)' : 'transparent',
                    color: active ? '#0e0f0c' : 'var(--text2, #bbb)',
                    fontWeight: active ? 700 : 400,
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
            <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: 'DM Mono, monospace', color: 'var(--text3, #888)' }}>
              read-only · {visibleCalls.length} call{visibleCalls.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}
        {error && (
          <div style={{ background: 'var(--red-dim, #ff6b5b22)', border: '1px solid var(--red, #ff6b5b)', color: 'var(--red, #ff6b5b)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, fontFamily: 'DM Mono, monospace' }}>
            {error}
          </div>
        )}
        {view === 'overview' && <Overview calls={visibleCalls} sales={visibleSales} scope={aiScope} scopeLabel={aiScopeLabel} />}
        {view === 'upload' && !isAdmin && <Upload onAdd={handleAdd} calls={calls} />}
        {view === 'calls' && <Calls calls={visibleCalls} sales={visibleSales} onDelete={handleDelete} onEdit={handleEdit} role={role} traderNames={traderNames} />}
        {view === 'prices' && <PriceTrends calls={visibleCalls} />}
        {view === 'argus' && <Publication calls={visibleCalls} sales={visibleSales} role={role} />}
        {view === 'sales' && <Sales calls={visibleCalls} sales={visibleSales} onAddSale={handleAddSale} onDeleteSale={handleDeleteSale} onEditSale={handleEditSale} role={role} traderNames={traderNames} />}
        {view === 'backup' && <DataBackup traderId={traderId} role={role} onImport={reloadAll} />}
      </main>
    </div>
  )
}
