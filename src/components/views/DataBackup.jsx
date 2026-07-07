import { useState, useRef } from 'react'
import styles from './DataBackup.module.css'
import { cloudBulkInsertCalls, cloudBulkInsertSales, cloudBulkInsertPublications } from '../../cloudData.js'

const STORAGE_KEYS = [
  { key: 'fertintel_calls', label: 'Call Notes' },
  { key: 'fertintel_sales', label: 'Sales' },
  { key: 'fertintel_argus_amsul', label: 'Argus Publications' },
  { key: 'fertintel_fertecon_amsul', label: 'Fertecon Publications' },
]

export default function DataBackup({ onImport, traderId, role }) {
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState(null)
  const fileRef = useRef(null)

  const isAdmin = role === 'admin'

  function handleExport() {
    const backup = { version: 2, exportedAt: new Date().toISOString(), data: {} }
    STORAGE_KEYS.forEach(({ key }) => {
      try {
        const raw = localStorage.getItem(key)
        backup.data[key] = raw ? JSON.parse(raw) : []
      } catch { backup.data[key] = [] }
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

  function handleImportClick() { fileRef.current?.click() }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setMessage(null)

    try {
      const text = await file.text()
      const backup = JSON.parse(text)
      if (!backup.data) throw new Error('Invalid backup file format.')

      const calls = backup.data['fertintel_calls'] || []
      const sales = backup.data['fertintel_sales'] || []
      const argus = backup.data['fertintel_argus_amsul'] || []
      const fertecon = backup.data['fertintel_fertecon_amsul'] || []

      if (isAdmin) {
        // Admin imports the SHARED publications only.
        const n = await cloudBulkInsertPublications(argus, fertecon)
        setMessage({ type: 'success', text: `✓ Imported ${n} publication entries to the shared cloud.` })
      } else {
        // Trader imports their OWN calls + sales.
        let nCalls = 0, nSales = 0
        if (calls.length) nCalls = await cloudBulkInsertCalls(calls, traderId)
        if (sales.length) nSales = await cloudBulkInsertSales(sales, traderId)
        setMessage({ type: 'success', text: `✓ Imported ${nCalls} calls and ${nSales} sales to your cloud account.` })
      }
      if (onImport) await onImport()
    } catch (err) {
      setMessage({ type: 'error', text: `✗ Import failed — ${err.message || err}` })
    }
    setImporting(false)
    e.target.value = ''
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.info}>
        <span className={styles.infoIcon}>☁</span>
        <p className={styles.infoText}>
          {isAdmin
            ? 'As admin, importing a backup loads the SHARED Argus/Fertecon publications into the cloud for everyone. (Calls & sales belong to individual traders.)'
            : 'Importing a backup loads your calls and sales into your cloud account. Your data is stored securely in the cloud and synced across devices.'}
        </p>
      </div>

      <div className={styles.actions}>
        <div className={styles.actionCard}>
          <div className={styles.actionIcon}>↓</div>
          <div className={styles.actionContent}>
            <h3 className={styles.actionTitle}>Export Backup</h3>
            <p className={styles.actionDesc}>Download the currently loaded data as a JSON file (safety copy).</p>
          </div>
          <button className={styles.exportBtn} onClick={handleExport}>↓ Download Backup</button>
        </div>

        <div className={styles.actionCard}>
          <div className={styles.actionIcon}>↑</div>
          <div className={styles.actionContent}>
            <h3 className={styles.actionTitle}>{isAdmin ? 'Import Publications to Cloud' : 'Import My Data to Cloud'}</h3>
            <p className={styles.actionDesc}>
              {isAdmin
                ? 'Upload a backup — the Argus/Fertecon publications will be added to the shared cloud.'
                : 'Upload a backup — your calls and sales will be added to your cloud account.'}
            </p>
          </div>
          <button className={styles.importBtn} onClick={handleImportClick} disabled={importing}>
            {importing ? '◌ Importing...' : '↑ Import to Cloud'}
          </button>
          <input type="file" accept=".json" ref={fileRef} className={styles.fileInput} onChange={handleFileChange} />
        </div>
      </div>

      {message && (
        <div className={`${styles.message} ${message.type === 'error' ? styles.messageError : styles.messageSuccess}`}>
          {message.text}
        </div>
      )}

      <div className={styles.keyList}>
        <p className={styles.keyListTitle}>{isAdmin ? 'Admin import affects:' : 'Your import affects:'}</p>
        {(isAdmin
          ? [{ label: 'Argus Publications' }, { label: 'Fertecon Publications' }]
          : [{ label: 'Call Notes' }, { label: 'Sales' }]
        ).map(({ label }) => (
          <span key={label} className={styles.keyChip}>{label}</span>
        ))}
      </div>
    </div>
  )
}
