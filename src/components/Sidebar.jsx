import styles from './Sidebar.module.css'

const NAV = [
  { id: 'overview', icon: '◈', label: 'Overview' },
  { id: 'upload', icon: '⊕', label: 'Upload Call' },
  { id: 'calls', icon: '◧', label: 'All Calls' },
  { id: 'sales', icon: '✓', label: 'Sales Log' },
  { id: 'prices', icon: '◎', label: 'Price Trends' },
  { id: 'argus', icon: '📰', label: 'Publication vs Mrkt' },
  { id: 'market', icon: '⇅', label: 'Market Data' },
  { id: 'backup', icon: '⊞', label: 'Data Backup' },
]

export default function Sidebar({ view, setView, onLogout, signals, role }) {
  const isAdmin = role === 'admin'
  // Admin runs a read-only aggregate environment — hide call entry (admin
  // cannot write calls; RLS would block it anyway).
  const nav = NAV.filter(n => !(isAdmin && n.id === 'upload'))

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <span className={styles.mark}>⬡</span>
        <span className={styles.name}>FertIntel</span>
        {isAdmin && (
          <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--accent, #c8f060)', border: '1px solid var(--accent, #c8f060)', borderRadius: 4, padding: '2px 5px', fontFamily: 'DM Mono, monospace' }}>ADMIN</span>
        )}
      </div>

      <nav className={styles.nav}>
        {nav.map(n => (
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
