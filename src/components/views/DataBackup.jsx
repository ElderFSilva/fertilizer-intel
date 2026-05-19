import { useState, useRef } from 'react'
import styles from './DataBackup.module.css'

const STORAGE_KEYS = [
  { key: 'fertintel_calls', label: 'Call Notes' },
  { key: 'fertintel_argus_amsul', label: 'Argus Publications' },
  { key: 'fertintel_fertecon_amsul', label: 'Fertecon Publications' },
]

export default function DataBackup({ onImport }) {
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState(null)
  const fileRef = useRef(null)

  function handleExport() {
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {}
    }
    STORAGE_KEYS.forEach(({ key }) => {
      try {
        const raw = localStorage.getItem(key)
        backup.data[key] = raw ? JSON.parse(raw) : []
      } catch {
        backup.data[key] = []
      }
    })

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const date = new Date().toISOString().split('T')[0]
    a.href = url
    a.download = `fertintel-backup-${date}.json`
    a.click()
    URL.revokeObjectURL(url)

    setMessage({ type: 'success', text: `✓ Backup downloaded — ${Object.values(backup.data).flat().length} records exported.` })
    setTimeout(() => setMessage(null), 5000)
  }

  function handleImportClick() {
    fileRef.current?.click()
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const backup = JSON.parse(ev.target.result)

        if (!backup.data) throw new Error('Invalid backup file format.')

        let imported = 0
        STORAGE_KEYS.forEach(({ key }) => {
          if (backup.data[key] !== undefined) {
            localStorage.setItem(key, JSON.stringify(backup.data[key]))
            imported += backup.data[key]?.length || 0
          }
        })

        setMessage({ type: 'success', text: `✓ Import successful — ${imported} records restored. Refresh the page to see your data.` })
        if (onImport) onImport()
      } catch (err) {
        setMessage({ type: 'error', text: `✗ Import failed — ${err.message}` })
      }
      setImporting(false)
      e.target.value = ''
    }
    reader.readAsText(file)
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.info}>
        <span className={styles.infoIcon}>⚠</span>
        <p className={styles.infoText}>
          Your data is stored in this browser only. Export a backup regularly to avoid losing your call history if the browser cache is cleared.
        </p>
      </div>

      <div className={styles.actions}>
        <div className={styles.actionCard}>
          <div className={styles.actionIcon}>↓</div>
          <div className={styles.actionContent}>
            <h3 className={styles.actionTitle}>Export Backup</h3>
            <p className={styles.actionDesc}>Download all your calls, Argus and Fertecon data as a JSON file.</p>
          </div>
          <button className={styles.exportBtn} onClick={handleExport}>
            ↓ Download Backup
          </button>
        </div>

        <div className={styles.actionCard}>
          <div className={styles.actionIcon}>↑</div>
          <div className={styles.actionContent}>
            <h3 className={styles.actionTitle}>Import Backup</h3>
            <p className={styles.actionDesc}>Restore data from a previously exported backup file. This will overwrite existing data.</p>
          </div>
          <button className={styles.importBtn} onClick={handleImportClick} disabled={importing}>
            {importing ? '◌ Importing...' : '↑ Import Backup'}
          </button>
          <input
            type="file"
            accept=".json"
            ref={fileRef}
            className={styles.fileInput}
            onChange={handleFileChange}
          />
        </div>
      </div>

      {message && (
        <div className={`${styles.message} ${message.type === 'error' ? styles.messageError : styles.messageSuccess}`}>
          {message.text}
        </div>
      )}

      <div className={styles.keyList}>
        <p className={styles.keyListTitle}>What gets backed up:</p>
        {STORAGE_KEYS.map(({ label }) => (
          <span key={label} className={styles.keyChip}>{label}</span>
        ))}
      </div>
    </div>
  )
}
