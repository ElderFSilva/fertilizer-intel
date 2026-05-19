import styles from './Sidebar.module.css'

const NAV = [
  { id: 'overview', icon: '◈', label: 'Overview' },
  { id: 'upload', icon: '⊕', label: 'Upload Call' },
  { id: 'calls', icon: '◧', label: 'All Calls' },
  { id: 'prices', icon: '◎', label: 'Price Trends' },
  { id: 'argus', icon: '📰', label: 'Publication vs Mrkt' },
  { id: 'backup', icon: '⊞', label: 'Data Backup' },
]

export default function Sidebar({ view, setView, onLogout, signals }) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <span className={styles.mark}>⬡</span>
        <span className={styles.name}>FertIntel</span>
      </div>

      <nav className={styles.nav}>
        {NAV.map(n => (
          <button
            key={n.id}
            className={`${styles.navBtn} ${view === n.id ? styles.active : ''}`}
            onClick={() => setView(n.id)}
          >
            <span className={styles.icon}>{n.icon}</span>
            <span>{n.label}</span>
            {n.id === 'overview' && signals.length > 0 && (
              <span className={styles.badge}>{signals.length}</span>
            )}
          </button>
        ))}
      </nav>

      <button className={styles.logout} onClick={onLogout}>
        ⎋ Logout
      </button>
    </aside>
  )
}
