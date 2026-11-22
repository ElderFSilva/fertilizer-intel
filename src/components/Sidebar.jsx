import styles from './Sidebar.module.css'

const NAV = [
  { id: 'overview', icon: '◈', label: 'Overview' },
  { id: 'upload', icon: '⊕', label: 'Upload Call' },
  { id: 'calls', icon: '◧', label: 'All Calls' },
  { id: 'sales', icon: '✓', label: 'Sales Log' },
  { id: 'argus', icon: '📰', label: 'Publication vs Mrkt' },
  { id: 'market', icon: '⇅', label: 'Market Data' },
  { id: 'record', icon: '◆', label: 'Track Record' },
  { id: 'advisor', icon: '❯', label: 'Ask the Desk', adminOnly: true },
  { id: 'backup', icon: '⊞', label: 'Data Backup' },
]

// The Operations environment has its own menu — none of the trading tabs.
const NAV_OPS = [
  { id: 'shipments', icon: '⚓', label: 'Shipments' },
  { id: 'unallocated', icon: '⇥', label: 'Unallocated sales' },
]

export default function Sidebar({ view, setView, onLogout, signals = [], role, env = 'trading', onSwitchEnv, badges = {} }) {
  const isAdmin = role === 'admin'
  const isOpsEnv = env === 'ops'
  // Admin runs a read-only aggregate environment — hide call entry (admin
  // cannot write calls; RLS would block it anyway).
  const nav = isOpsEnv
    ? NAV_OPS
    : NAV.filter(n => !(isAdmin && n.id === 'upload') && !(n.adminOnly && !isAdmin))

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <span className={styles.mark}>⬡</span>
        <span className={styles.name}>FertIntel</span>
        {isAdmin && (
          <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--accent, #c8f060)', border: '1px solid var(--accent, #c8f060)', borderRadius: 4, padding: '2px 5px', fontFamily: 'DM Mono, monospace' }}>ADMIN</span>
        )}
        {role === 'ops' && (
          <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--accent, #c8f060)', border: '1px solid var(--accent, #c8f060)', borderRadius: 4, padding: '2px 5px', fontFamily: 'DM Mono, monospace' }}>OPS</span>
        )}
      </div>

      {/* Environment switch — admin only. Ops logins never see the trading side. */}
      {isAdmin && onSwitchEnv && (
        <div className={styles.envSwitch}>
          <button className={`${styles.envBtn} ${!isOpsEnv ? styles.envOn : ''}`} onClick={() => onSwitchEnv('trading')}>Trading</button>
          <button className={`${styles.envBtn} ${isOpsEnv ? styles.envOn : ''}`} onClick={() => onSwitchEnv('ops')}>Operations</button>
        </div>
      )}

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
            {badges[n.id] > 0 && (
              <span className={styles.badge}>{badges[n.id]}</span>
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
