import { useState } from 'react'
import { PRODUCTS } from '../../data.js'
import styles from './Calls.module.css'

const TREND_ICON = { up: '↑', stable: '↔', down: '↓', none: '—' }
const TREND_COLOR = { up: 'var(--accent)', stable: 'var(--blue)', down: 'var(--red)', none: 'var(--text3)' }

export default function Calls({ calls, onDelete }) {
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState(null)

  const filtered = calls.filter(c =>
    c.client.toLowerCase().includes(search.toLowerCase()) ||
    (c.remarks || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.demand || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>All Calls</h1>
        <input
          className={styles.search}
          placeholder="Search clients, remarks..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </header>

      {filtered.length === 0 && (
        <p className={styles.empty}>{calls.length === 0 ? 'No calls logged yet.' : 'No results found.'}</p>
      )}

      <div className={styles.list}>
        {filtered.map(c => {
          const open = expandedId === c.id
          return (
            <div key={c.id} className={`${styles.card} ${open ? styles.cardOpen : ''}`}>
              <div className={styles.cardTop} onClick={() => setExpandedId(open ? null : c.id)}>
                <div className={styles.meta}>
                  <span className={styles.client}>{c.client}</span>
                  <span className={styles.date}>{c.date}</span>
                </div>
                <div className={styles.pills}>
                  {PRODUCTS.filter(p => c.prices?.[p]?.trend && c.prices[p].trend !== 'none').map(p => (
                    <span key={p} className={styles.pill} style={{ color: TREND_COLOR[c.prices[p].trend] }}>
                      {p} {TREND_ICON[c.prices[p].trend]}
                    </span>
                  ))}
                </div>
                <button className={styles.chevron}>{open ? '▲' : '▼'}</button>
              </div>

              {open && (
                <div className={styles.detail}>
                  <div className={styles.pricesTable}>
                    {PRODUCTS.map(p => {
                      const pr = c.prices?.[p]
                      if (!pr?.value && (!pr?.trend || pr.trend === 'none')) return null
                      return (
                        <div key={p} className={styles.priceRow}>
                          <span className={styles.priceProduct}>{p}</span>
                          <span className={styles.priceVal}>{pr.value || '—'}</span>
                          <span style={{ color: TREND_COLOR[pr.trend || 'none'] }}>
                            {TREND_ICON[pr.trend || 'none']}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                  {c.demand && (
                    <div className={styles.block}>
                      <span className={styles.blockLabel}>Demand</span>
                      <p className={styles.blockText}>{c.demand}</p>
                    </div>
                  )}
                  {c.remarks && (
                    <div className={styles.block}>
                      <span className={styles.blockLabel}>Remarks</span>
                      <p className={styles.blockText}>{c.remarks}</p>
                    </div>
                  )}
                  <button className={styles.deleteBtn} onClick={() => onDelete(c.id)}>⊗ Delete this call</button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
