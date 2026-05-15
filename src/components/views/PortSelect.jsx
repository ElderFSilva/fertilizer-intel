import { useState, useRef, useEffect } from 'react'
import styles from './PortSelect.module.css'

const PORTS = [
  { code: 'PNG', label: 'Paranaguá' },
  { code: 'Aratu', label: 'Aratu' },
  { code: 'RIG', label: 'Rio Grande' },
  { code: 'STN', label: 'Santos' },
  { code: 'SFS', label: 'São Francisco do Sul' },
  { code: 'Santarem', label: 'Santarém' },
  { code: 'ITQ', label: 'Itaqui' },
  { code: 'VTR', label: 'Vitória' },
]

export default function PortSelect({ value, onChange, placeholder = 'e.g. PNG or Paranaguá' }) {
  const [query, setQuery] = useState(value || '')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Sync external value changes
  useEffect(() => { setQuery(value || '') }, [value])

  // Close on outside click
  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = query.length >= 1
    ? PORTS.filter(p =>
        p.code.toLowerCase().startsWith(query.toLowerCase()) ||
        p.label.toLowerCase().startsWith(query.toLowerCase()) ||
        p.code.toLowerCase().includes(query.toLowerCase()) ||
        p.label.toLowerCase().includes(query.toLowerCase())
      )
    : PORTS

  function select(port) {
    setQuery(port.code)
    onChange(port.code)
    setOpen(false)
  }

  function handleInput(e) {
    setQuery(e.target.value)
    onChange(e.target.value)
    setOpen(true)
  }

  function handleFocus() { setOpen(true) }

  return (
    <div className={styles.wrap} ref={ref}>
      <input
        className={styles.input}
        value={query}
        onChange={handleInput}
        onFocus={handleFocus}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div className={styles.dropdown}>
          {filtered.map(p => (
            <div key={p.code} className={styles.option} onClick={() => select(p)}>
              <span className={styles.code}>{p.code}</span>
              <span className={styles.portLabel}>{p.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
