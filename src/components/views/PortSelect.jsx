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
  const wrapRef = useRef(null)

  useEffect(() => { setQuery(value || '') }, [value])

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
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
  }

  function handleSelect(port) {
    setQuery(port.code)
    onChange(port.code)
    setOpen(false)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <input
        type="text"
        className={styles.input}
        value={query}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        placeholder="Type port name..."
        autoComplete="off"
        spellCheck={false}
      />
      {open && filtered.length > 0 && (
        <div className={styles.dropdown}>
          {filtered.map(p => (
            <div
              key={p.code}
              className={styles.option}
              onMouseDown={e => { e.preventDefault(); handleSelect(p) }}
            >
              <span className={styles.portLabel}>{p.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
