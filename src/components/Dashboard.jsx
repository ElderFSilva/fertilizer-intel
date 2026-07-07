import { useState, useEffect } from 'react'
import { buildMarketSignals } from '../data.js'
import { cloudLoadCalls, cloudAddCall, cloudEditCall, cloudDeleteCall, cloudLoadSales, cloudAddSale, cloudEditSale, cloudDeleteSale } from '../cloudData.js'
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const traderId = user?.id

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

  const signals = buildMarketSignals(calls)

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg, #0e0f0c)', color: 'var(--text3, #888)', fontFamily: 'DM Mono, monospace', fontSize: 14 }}>
        ◌ Loading your data…
      </div>
    )
  }

  return (
    <div className={styles.layout}>
      <Sidebar view={view} setView={setView} onLogout={onLogout} signals={signals} />
      <main className={styles.main}>
        {error && (
          <div style={{ background: 'var(--red-dim, #ff6b5b22)', border: '1px solid var(--red, #ff6b5b)', color: 'var(--red, #ff6b5b)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, fontFamily: 'DM Mono, monospace' }}>
            {error}
          </div>
        )}
        {view === 'overview' && <Overview calls={calls} sales={sales} signals={signals} />}
        {view === 'upload' && <Upload onAdd={handleAdd} calls={calls} />}
        {view === 'calls' && <Calls calls={calls} sales={sales} onDelete={handleDelete} onEdit={handleEdit} />}
        {view === 'prices' && <PriceTrends calls={calls} />}
        {view === 'argus' && <Publication calls={calls} role={role} />}
        {view === 'sales' && <Sales calls={calls} sales={sales} onAddSale={handleAddSale} onDeleteSale={handleDeleteSale} onEditSale={handleEditSale} />}
        {view === 'backup' && <DataBackup traderId={traderId} role={role} onImport={reloadAll} />}
      </main>
    </div>
  )
}
