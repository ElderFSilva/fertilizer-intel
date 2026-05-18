import { useState, useRef, useEffect } from 'react'
import styles from './PortSelect.module.css'

const PORTS = [
  { code: 'Paranaguá', label: 'Paranaguá' },
  { code: 'Aratu', label: 'Aratu' },
  { code: 'Rio Grande', label: 'Rio Grande' },
  { code: 'Santos', label: 'Santos' },
  { code: 'São Francisco do Sul', label: 'São Francisco do Sul' },
  { code: 'Santarém', label: 'Santarém' },
  { code: 'Itaqui', label: 'Itaqui' },
  { code: 'Vitória', label: 'Vitória' },
]

export default function PortSelect({ value, onChange }) {
  const [query, setQuery] = useState(value || '')
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const wrapRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => { setQuery(value || '') }, [value])

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
        setHighlighted(-1)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const q = query.trim().toLowerCase()
  const filtered = q.length === 0 ? PORTS : PORTS.filter(p =>
    p.code.toLowerCase().includes(q) || p.label.toLowerCase().includes(q)
  )

  function handleChange(e) {
    setQuery(e.target.value)
    onChange(e.target.value)
    setOpen(true)
    setHighlighted(-1)
  }

  function handleSelect(port) {
    setQuery(port.code)
    onChange(port.code)
    setOpen(false)
    setHighlighted(-1)
  }

  function handleKeyDown(e) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true)
      setHighlighted(0)
      e.preventDefault()
      return
    }
    if (!open) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(h => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault()
      handleSelect(filtered[highlighted])
    } else if (e.key === 'Escape') {
      setOpen(false)
      setHighlighted(-1)
    }
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <input
        type="text"
        className={styles.input}
        value={query}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Type port name..."
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && filtered.length > 0 && (
        <div className={styles.dropdown} ref={listRef} role="listbox">
          {filtered.map((p, i) => (
            <div
              key={p.code}
              className={`${styles.option} ${i === highlighted ? styles.optionHighlighted : ''}`}
              onMouseDown={e => { e.preventDefault(); handleSelect(p) }}
              onMouseEnter={() => setHighlighted(i)}
              role="option"
              aria-selected={i === highlighted}
            >
              <span className={styles.portLabel}>{p.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
