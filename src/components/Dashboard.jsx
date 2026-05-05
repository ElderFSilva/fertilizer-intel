import { useState, useEffect } from 'react'
import { loadCalls, addCall, deleteCall, editCall, buildMarketSignals } from '../data.js'
import Sidebar from './Sidebar.jsx'
import Overview from './views/Overview.jsx'
import Calls from './views/Calls.jsx'
import Upload from './views/Upload.jsx'
import PriceTrends from './views/PriceTrends.jsx'
import styles from './Dashboard.module.css'

export default function Dashboard({ onLogout }) {
  const [view, setView] = useState('overview')
  const [calls, setCalls] = useState(loadCalls())

  useEffect(() => { setCalls(loadCalls()) }, [])

  function handleAdd(entry) { setCalls(prev => addCall(prev, entry)) }
  function handleDelete(id) { setCalls(prev => deleteCall(prev, id)) }
  function handleEdit(id, updates) { setCalls(prev => editCall(prev, id, updates)) }

  const signals = buildMarketSignals(calls)

  return (
    <div className={styles.layout}>
      <Sidebar view={view} setView={setView} onLogout={onLogout} signals={signals} />
      <main className={styles.main}>
        {view === 'overview' && <Overview calls={calls} signals={signals} />}
        {view === 'upload' && <Upload onAdd={handleAdd} />}
        {view === 'calls' && <Calls calls={calls} onDelete={handleDelete} onEdit={handleEdit} />}
        {view === 'prices' && <PriceTrends calls={calls} />}
      </main>
    </div>
  )
}
