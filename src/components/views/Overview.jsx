import { PRODUCTS, buildDemandSummary } from '../../data.js'
import styles from './Overview.module.css'

const SIGNAL_STYLE = {
  warning: { color: 'var(--amber)', icon: '⚠' },
  alert: { color: 'var(--red)', icon: '◉' },
  opportunity: { color: 'var(--accent)', icon: '◈' },
}

export default function Overview({ calls, signals }) {
  const demandMap = buildDemandSummary(calls)
  const clients = Object.keys(demandMap)
  const recentCalls = calls.slice(0, 5)

  // Count product mentions
  const productActivity = PRODUCTS.map(p => ({
    name: p,
    count: calls.filter(c => c.prices?.[p]?.value || c.prices?.[p]?.trend !== 'none').length,
  })).sort((a, b) => b.count - a.count)

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Market Overview</h1>
          <p className={styles.sub}>{calls.length} calls logged · {clients.length} clients tracked</p>
        </div>
        <div className={styles.dateChip}>
          {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </div>
      </header>

      {signals.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>⬡ Market Signals</h2>
          <div className={styles.signals}>
            {signals.map((s, i) => {
              const st = SIGNAL_STYLE[s.type] || SIGNAL_STYLE.warning
              return (
                <div key={i} className={styles.signal} style={{ borderColor: st.color + '44' }}>
                  <span style={{ color: st.color, fontSize: 18 }}>{st.icon}</span>
                  <p style={{ color: 'var(--text)' }}>{s.text}</p>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {calls.length === 0 && (
        <div className={styles.empty}>
          <p>No calls logged yet.</p>
          <p className={styles.emptySub}>Go to <strong>Upload Call</strong> to add your first entry.</p>
        </div>
      )}

      <div className={styles.grid}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>◧ Recent Calls</h2>
          {recentCalls.length === 0 ? <p className={styles.none}>No calls yet.</p> : (
            <div className={styles.callList}>
              {recentCalls.map(c => (
                <div key={c.id} className={styles.callCard}>
                  <div className={styles.callTop}>
                    <span className={styles.callClient}>{c.client}</span>
                    <span className={styles.callDate}>{c.date}</span>
                  </div>
                  {c.demand && <p className={styles.callDemand}>{c.demand}</p>}
                  {c.remarks && <p className={styles.callRemarks}>{c.remarks}</p>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>◎ Product Activity</h2>
          <div className={styles.productList}>
            {productActivity.map(p => (
              <div key={p.name} className={styles.productRow}>
                <span className={styles.productName}>{p.name}</span>
                <div className={styles.barWrap}>
                  <div
                    className={styles.bar}
                    style={{ width: calls.length ? `${(p.count / calls.length) * 100}%` : '0%' }}
                  />
                </div>
                <span className={styles.productCount}>{p.count}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {clients.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>◈ Client Demand Status</h2>
          <div className={styles.clientGrid}>
            {clients.map(cl => {
              const d = demandMap[cl]
              const status = d.active > 0 ? 'active' : d.potential > 0 ? 'potential' : 'none'
              const label = status === 'active' ? 'Active' : status === 'potential' ? 'Potential' : 'No Demand'
              const color = status === 'active' ? 'var(--accent)' : status === 'potential' ? 'var(--amber)' : 'var(--red)'
              return (
                <div key={cl} className={styles.clientCard}>
                  <span className={styles.clientName}>{cl}</span>
                  <span className={styles.clientStatus} style={{ color, borderColor: color + '44' }}>{label}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
