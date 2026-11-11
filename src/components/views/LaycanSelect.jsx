import { monthOptions } from '../../laycan.js'

// Laycan picker: one month out of the next 12, counted from the call's date.
// A value already stored that is not in the list (older free text, or a past
// month on an old call) is kept as its own first option, so opening an old
// call to edit something else never changes its laycan.
export default function LaycanSelect({ value, onChange, refDate, className }) {
  const options = monthOptions(refDate)
  const current = value || ''
  const legacy = current && !options.includes(current)
  return (
    <select className={className} value={current} onChange={e => onChange(e.target.value)}>
      <option value="">— Month —</option>
      {legacy && <option value={current}>{current} (as entered)</option>}
      {options.map(m => <option key={m} value={m}>{m}</option>)}
    </select>
  )
}
