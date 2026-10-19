export function formatBytes(bytes) {
  if (bytes == null) return null
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`
  const mb = bytes / 1024 / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} МБ`
}

export function formatDuration(totalSec) {
  if (totalSec == null) return null
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = String(totalSec % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}
