import { useState, useRef, useEffect } from 'react'
import styles from './DataBackup.module.css'
import { cloudBulkInsertCalls, cloudBulkInsertSales, cloudBulkInsertPublications, cloudExportAllData, triggerBackupDownload, lastBackupDate, cloudBackupNow, cloudListBackups, cloudGetBackupPayload } from '../../cloudData.js'

export default function DataBackup({ onImport, traderId, role }) {
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [downloadingId, setDownloadingId] = useState(null)
  const fileRef = useRef(null)

  const isAdmin = role === 'admin'
  const lastBackup = lastBackupDate()

  async function loadHistory() {
    if (!isAdmin) return
    setHistoryLoading(true)
    try { setHistory(await cloudListBackups()) } catch { /* table may not exist yet */ }
    setHistoryLoading(false)
  }

  useEffect(() => { loadHistory() }, [])

  async function handleExport() {
    setExporting(true)
    setMessage(null)
    try {
      if (isAdmin) {
        const meta = await cloudBackupNow()   // saves to Supabase AND downloads
        const t = meta?.counts ? Object.values(meta.counts).reduce((n, x) => n + (x || 0), 0) : 0
        setMessage({ type: 'success', text: `✓ Backup saved to Supabase and downloaded — ${t} records.` })
        await loadHistory()
      } else {
        const backup = await cloudExportAllData()   // traders: file only
        triggerBackupDownload(backup)
        const total = Object.values(backup.data).reduce((n, arr) => n + (arr?.length || 0), 0)
        setMessage({ type: 'success', text: `✓ Backup downloaded — ${total} records exported from the cloud.` })
      }
    } catch (err) {
      setMessage({ type: 'error', text: `✗ Backup failed — ${err.message || err}` })
    }
    setExporting(false)
    setTimeout(() => setMessage(null), 5000)
  }

  async function handleDownloadSnapshot(id, weekKey) {
    setDownloadingId(id)
    try {
      const payload = await cloudGetBackupPayload(id)
      if (payload) triggerBackupDownload(payload)
    } catch (err) {
      setMessage({ type: 'error', text: `✗ Could not download snapshot — ${err.message || err}` })
    }
    setDownloadingId(null)
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
            <h3 className={styles.actionTitle}>{isAdmin ? 'Back Up Now (Supabase + File)' : 'Export Full Backup'}</h3>
            <p className={styles.actionDesc}>
              {isAdmin
                ? 'Save a complete snapshot (calls, sales, publications) into Supabase and download a copy as a JSON file.'
                : 'Download a complete copy of all cloud data (calls, sales, publications) as a JSON file.'}
              {isAdmin && ' A snapshot is also saved automatically once a week (on/after Friday) when you open the app.'}
              {lastBackup && ` Last automatic backup: ${lastBackup}.`}
            </p>
          </div>
          <button className={styles.exportBtn} onClick={handleExport} disabled={exporting}>
            {exporting ? '◌ Exporting…' : '↓ Download Backup'}
          </button>
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

      {isAdmin && (
        <div style={{ marginTop: 24 }}>
          <p style={{ fontSize: 12, fontFamily: 'DM Mono, monospace', color: 'var(--text3, #888)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Backup History (stored in Supabase)
          </p>
          {historyLoading ? (
            <p style={{ fontSize: 13, color: 'var(--text3, #888)' }}>◌ Loading snapshots…</p>
          ) : history.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text3, #888)' }}>
              No snapshots yet. Click “Back Up Now”, or one will be created automatically on/after Friday.
            </p>
          ) : (
            <div style={{ border: '1px solid var(--border, #2a2d20)', borderRadius: 10, overflow: 'hidden' }}>
              {history.map((b, i) => (
                <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderTop: i ? '1px solid var(--border, #2a2d20)' : 'none', fontFamily: 'DM Mono, monospace', fontSize: 13 }}>
                  <span style={{ color: 'var(--accent, #c8f060)', fontWeight: 700, minWidth: 96 }}>{b.week_key}</span>
                  <span style={{ color: 'var(--text3, #888)', fontSize: 11 }}>
                    {b.counts ? `${b.counts.calls || 0} calls · ${b.counts.sales || 0} sales · ${(b.counts.argus || 0) + (b.counts.fertecon || 0)} pubs` : ''}
                  </span>
                  <span style={{ marginLeft: 'auto', color: 'var(--text3, #666)', fontSize: 11 }}>
                    {b.created_at ? new Date(b.created_at).toLocaleString() : ''}
                  </span>
                  <button
                    onClick={() => handleDownloadSnapshot(b.id, b.week_key)}
                    disabled={downloadingId === b.id}
                    style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, cursor: 'pointer', padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border2, #33362a)', background: 'transparent', color: 'var(--text2, #bbb)' }}
                  >
                    {downloadingId === b.id ? '◌' : '↓ Download'}
                  </button>
                </div>
              ))}
            </div>
          )}
          <p style={{ fontSize: 11, color: 'var(--text3, #666)', marginTop: 8 }}>
            To restore a snapshot, download it and use “Import to Cloud” (best when recovering into an empty or partial table). All snapshots are kept indefinitely.
          </p>
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
