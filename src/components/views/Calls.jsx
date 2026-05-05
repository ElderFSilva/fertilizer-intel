import { useState } from 'react'
import { PRODUCTS } from '../../data.js'
import styles from './Calls.module.css'

const TREND_OPTIONS = ['up', 'stable', 'down', 'none']
const TREND_LABEL = { up: '↑ Up', stable: '↔ Stable', down: '↓ Down', none: '—' }
const TREND_ICON = { up: '↑', stable: '↔', down: '↓', none: '—' }
const TREND_COLOR = { up: 'var(--accent)', stable: 'var(--blue)', down: 'var(--red)', none: 'var(--text3)' }

function emptyPrices() {
  return Object.fromEntries(PRODUCTS.map(p => [p, { value: '', trend: 'none' }]))
}

export default function Calls({ calls, onDelete, onEdit }) {
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState(null)
  const [savedBanner, setSavedBanner] = useState(false)

  const filtered = calls.filter(c =>
    c.client.toLowerCase().includes(search.toLowerCase()) ||
    (c.remarks || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.demand || '').toLowerCase().includes(search.toLowerCase())
  )

  function startEdit(c) {
    setEditingId(c.id)
    setEditForm({
      client: c.client,
      date: c.date,
      demand: c.demand || '',
      remarks: c.remarks || '',
      prices: { ...emptyPrices(), ...Object.fromEntries(PRODUCTS.map(p => [p, { value: c.prices?.[p]?.value || '', trend: c.prices?.[p]?.trend || 'none' }])) }
    })
    setExpandedId(c.id)
  }

  function cancelEdit() { setEditingId(null); setEditForm(null) }

  function setEditPrice(product, field, val) {
    setEditForm(f => ({ ...f, prices: { ...f.prices, [product]: { ...f.prices[product], [field]: val } } }))
  }

  function saveEdit(id) {
    onEdit(id, editForm)
    setEditingId(null)
    setEditForm(null)
    setSavedBanner(true)
    setTimeout(() => setSavedBanner(false), 3000)
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.title}>All Calls</h1>
        <input className={styles.search} placeholder="Search clients, remarks..." value={search} onChange={e => setSearch(e.target.value)} />
      </header>

      {savedBanner && <div className={styles.savedBanner}>✓ Call updated successfully!</div>}

      {filtered.length === 0 && (
        <p className={styles.empty}>{calls.length === 0 ? 'No calls logged yet.' : 'No results found.'}</p>
      )}

      <div className={styles.list}>
        {filtered.map(c => {
          const open = expandedId === c.id
          const isEditing = editingId === c.id

          return (
            <div key={c.id} className={`${styles.card} ${open ? styles.cardOpen : ''}`}>
              <div className={styles.cardTop} onClick={() => !isEditing && setExpandedId(open ? null : c.id)}>
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

              {open && !isEditing && (
                <div className={styles.detail}>
                  <div className={styles.pricesTable}>
                    {PRODUCTS.map(p => {
                      const pr = c.prices?.[p]
                      if (!pr?.value && (!pr?.trend || pr.trend === 'none')) return null
                      return (
                        <div key={p} className={styles.priceRow}>
                          <span className={styles.priceProduct}>{p}</span>
                          <span className={styles.priceVal}>{pr.value || '—'}</span>
                          <span style={{ color: TREND_COLOR[pr.trend || 'none'] }}>{TREND_ICON[pr.trend || 'none']}</span>
                        </div>
                      )
                    })}
                  </div>
                  {c.demand && <div className={styles.block}><span className={styles.blockLabel}>Demand</span><p className={styles.blockText}>{c.demand}</p></div>}
                  {c.remarks && <div className={styles.block}><span className={styles.blockLabel}>Remarks</span><p className={styles.blockText}>{c.remarks}</p></div>}
                  <div className={styles.actions}>
                    <button className={styles.editBtn} onClick={() => startEdit(c)}>✎ Edit</button>
                    <button className={styles.deleteBtn} onClick={() => onDelete(c.id)}>⊗ Delete</button>
                  </div>
                </div>
              )}

              {open && isEditing && (
                <div className={styles.editForm}>
                  <div className={styles.editRow}>
                    <div className={styles.editField}>
                      <label className={styles.editLabel}>Client</label>
                      <input className={styles.editInput} value={editForm.client} onChange={e => setEditForm(f => ({ ...f, client: e.target.value }))} />
                    </div>
                    <div className={styles.editField}>
                      <label className={styles.editLabel}>Date</label>
                      <input type="date" className={styles.editInput} value={editForm.date} onChange={e => setEditForm(f => ({ ...f, date: e.target.value }))} />
                    </div>
                  </div>

                  <label className={styles.editLabel}>Prices & Trends</label>
                  {PRODUCTS.map(p => (
                    <div key={p} className={styles.editPriceRow}>
                      <span className={styles.editProductLabel}>{p}</span>
                      <input className={styles.editPriceInput} placeholder="Price" value={editForm.prices[p].value} onChange={e => setEditPrice(p, 'value', e.target.value)} />
                      <select className={styles.editTrendSelect} value={editForm.prices[p].trend} onChange={e => setEditPrice(p, 'trend', e.target.value)}>
                        {TREND_OPTIONS.map(t => <option key={t} value={t}>{TREND_LABEL[t]}</option>)}
                      </select>
                    </div>
                  ))}

                  <div className={styles.editField}>
                    <label className={styles.editLabel}>Demand</label>
                    <textarea className={styles.editTextarea} rows={2} value={editForm.demand} onChange={e => setEditForm(f => ({ ...f, demand: e.target.value }))} />
                  </div>
                  <div className={styles.editField}>
                    <label className={styles.editLabel}>Remarks</label>
                    <textarea className={styles.editTextarea} rows={3} value={editForm.remarks} onChange={e => setEditForm(f => ({ ...f, remarks: e.target.value }))} />
                  </div>

                  <div className={styles.editActions}>
                    <button className={styles.cancelEditBtn} onClick={cancelEdit}>Cancel</button>
                    <button className={styles.saveEditBtn} onClick={() => saveEdit(c.id)}>◈ Save Changes</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
