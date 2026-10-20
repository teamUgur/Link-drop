import { useEffect, useRef, useState } from 'react'
import { ApiError, checkHealth, prepareFile, resolveMedia } from './api.js'
import { formatBytes, formatDuration } from './format.js'
import { Icon } from './Icon.jsx'

const SOURCES = {
  youtube: { name: 'YouTube', short: 'YT', tone: 'bg-red-400' },
  instagram: { name: 'Instagram', short: 'IG', tone: 'bg-pink-400' },
  tiktok: { name: 'TikTok', short: 'TK', tone: 'bg-indigo-400' },
}

const DEFAULT_FORMAT = 'mp4-720'

// Из приложений ссылку часто копируют вместе с текстом («Смотри! https://vm.tiktok.com/…») или без
// схемы (youtube.com/watch…). Достаём первую ссылку и дописываем https:// — иначе сервер ответит
// «некорректный запрос» на то, что человек считает ссылкой. Пунктуацию в конце отрезаем, как и бот.
function extractUrl(text) {
  const value = text.trim()
  const found = value.match(/https?:\/\/[^\s<>"«»]+/i)?.[0] ?? (/^[\w-]+(\.[\w-]+)+\/\S*$/.test(value) ? `https://${value}` : value)
  return found.replace(/[.,;:!?)\]}'…]+$/u, '')
}

const errorText = (error) => (error instanceof ApiError ? error.message : 'Что-то пошло не так, попробуйте ещё раз')

// Скачивание обычной ссылкой, а не Blob из fetch: браузер сам пишет файл на диск и показывает прогресс.
function startBrowserDownload(fileUrl, fileName) {
  const link = document.createElement('a')
  link.href = fileUrl
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
}

function HealthBadge() {
  const [health, setHealth] = useState('checking')

  useEffect(() => {
    const controller = new AbortController()
    checkHealth(controller.signal).then((ok) => setHealth(ok ? 'ok' : 'down'), () => {})
    return () => controller.abort()
  }, [])

  if (health === 'checking') return <span className="font-mono text-[11px] text-muted max-[760px]:text-[10px]">проверяем сервер…</span>
  if (health === 'down') return <span className="inline-flex items-center gap-[7px] font-mono text-[11px] text-error max-[760px]:text-[10px]"><span className="size-1.5 rounded-full bg-error" /> сервер недоступен</span>
  return <span className="inline-flex items-center gap-[7px] font-mono text-[11px] text-success max-[760px]:text-[10px]"><span className="size-1.5 rounded-full bg-success" /> готов к работе</span>
}

function Progress({ progress, format, onCancel }) {
  const estimate = format.sizeBytes
  const percent = progress.started && estimate ? Math.min(99, Math.round((progress.bytes / estimate) * 100)) : null
  let label = 'Ждём свободный слот на сервере…'
  if (progress.started) {
    label = progress.bytes > 0 ? `Готовим файл · ${formatBytes(progress.bytes)}${estimate ? ` из ~${formatBytes(estimate)}` : ''}` : 'Получаем видео с платформы…'
  }

  return (
    <div className="mt-5" role="status" aria-live="polite">
      <div className="mb-2.5 flex items-center justify-between gap-3 font-mono text-xs text-muted">
        <span className="inline-flex items-center gap-[9px]"><span className="size-3 shrink-0 animate-spin-slow rounded-full border-2 border-[#dfe7d8] border-t-[#76953d]" />{label}</span>
        {percent !== null && <span className="text-ink">{percent}%</span>}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#e9eee6]">
        {percent !== null
          ? <div className="h-full rounded-full bg-lime transition-[width] duration-500" style={{ width: `${percent}%` }} />
          : <div className="h-full w-1/3 animate-indeterminate rounded-full bg-lime" />}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-muted">
        <span>Не закрывай вкладку — файл скачается сам, когда будет готов.</span>
        <button className="shrink-0 border-0 bg-transparent px-2.5 py-2 text-xs text-muted transition-colors hover:text-error" type="button" onClick={onCancel}>Отменить</button>
      </div>
    </div>
  )
}

export function DownloadCard() {
  const [url, setUrl] = useState('')
  // idle → resolving → ready → preparing → done; error — ссылку не удалось разобрать.
  const [phase, setPhase] = useState('idle')
  const [error, setError] = useState(null)
  const [media, setMedia] = useState(null)
  const [selectedId, setSelectedId] = useState(DEFAULT_FORMAT)
  const [downloadError, setDownloadError] = useState(null)
  const [progress, setProgress] = useState({ started: false, bytes: 0 })
  const [file, setFile] = useState(null)
  const abortRef = useRef(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const newController = () => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    return abortRef.current
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const value = extractUrl(url)
    if (!value || phase === 'resolving' || phase === 'preparing') return
    setUrl(value)
    if (!/^https?:\/\//i.test(value)) {
      setError('Не вижу ссылки — вставь ссылку на видео из YouTube, Instagram или TikTok')
      setPhase('error')
      return
    }
    const controller = newController()
    setPhase('resolving')
    setError(null)
    setDownloadError(null)
    try {
      const result = await resolveMedia(value, controller.signal)
      setMedia(result)
      setSelectedId(result.formats.some((f) => f.id === DEFAULT_FORMAT) ? DEFAULT_FORMAT : result.formats[0].id)
      setPhase('ready')
    } catch (e) {
      if (e.name === 'AbortError') return
      setError(errorText(e))
      setPhase('error')
    }
  }

  const handleDownload = async () => {
    const format = media.formats.find((f) => f.id === selectedId)
    const controller = newController()
    setPhase('preparing')
    setDownloadError(null)
    setProgress({ started: false, bytes: 0 })
    try {
      const ready = await prepareFile({ url: extractUrl(url), format: format.id }, {
        signal: controller.signal,
        onEvent: (e) => {
          if (e.type === 'started') setProgress({ started: true, bytes: 0 })
          if (e.type === 'progress') setProgress({ started: true, bytes: e.downloadedBytes })
        },
      })
      setFile(ready)
      setPhase('done')
      startBrowserDownload(ready.fileUrl, ready.fileName)
    } catch (e) {
      if (e.name === 'AbortError') {
        setPhase('ready')
        return
      }
      setDownloadError(errorText(e))
      setPhase('ready')
    }
  }

  const handlePaste = async () => {
    try {
      const clipboardUrl = await navigator.clipboard.readText()
      if (clipboardUrl) handleUrlChange(clipboardUrl.trim())
    } catch {
      // Буфер обмена недоступен вне защищённого контекста или без разрешения — человек вставит руками.
    }
  }

  const handleUrlChange = (value) => {
    if (phase === 'preparing') return
    abortRef.current?.abort()
    setUrl(value)
    if (phase !== 'idle') {
      setPhase('idle')
      setMedia(null)
      setError(null)
    }
  }

  const reset = () => {
    abortRef.current?.abort()
    setUrl('')
    setMedia(null)
    setFile(null)
    setError(null)
    setDownloadError(null)
    setPhase('idle')
  }

  const selected = media?.formats.find((f) => f.id === selectedId)
  const source = media ? SOURCES[media.source] : null
  const busy = phase === 'resolving' || phase === 'preparing'

  return (
    <div className="mx-auto w-full max-w-[780px] rounded-[25px] border border-line bg-surface p-5 shadow-[0_24px_80px_rgba(37,55,45,.08)] max-[760px]:rounded-[20px] max-[760px]:p-[13px]">
      <div className="flex items-center justify-between px-1 pb-[17px] pt-[3px] max-[760px]:pb-[14px] max-[760px]:pt-[5px]">
        <span className="font-mono text-xs font-semibold uppercase tracking-[.08em]">Новая загрузка</span>
        <HealthBadge />
      </div>

      <form className="grid grid-cols-[1fr_auto] gap-2.5 max-[760px]:grid-cols-1 max-[760px]:gap-2" onSubmit={handleSubmit}>
        <div className={`flex min-w-0 items-center rounded-[15px] border bg-[#fbfcfb] pl-[17px] pr-2 transition ${phase === 'error' ? 'border-error shadow-[0_0_0_4px_rgba(217,75,72,.1)]' : 'border-line focus-within:border-[#9eb37f] focus-within:shadow-[0_0_0_4px_rgba(199,255,74,.24)]'}`}>
          <span className="mr-[11px] grid w-[22px] shrink-0 place-items-center text-[#7d8a82]"><Icon><path d="M10 13a5 5 0 0 0 7.07.07l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15" /><path d="M14 11a5 5 0 0 0-7.07-.07l-2 2A5 5 0 0 0 7 20l1.15-1.15" /></Icon></span>
          <label className="sr-only" htmlFor="video-url">Ссылка на видео</label>
          <input className="h-[54px] min-w-0 w-full border-0 bg-transparent text-[15px] outline-0 placeholder:text-[#9aa59d] disabled:text-muted" id="video-url" type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={url} onChange={(event) => handleUrlChange(event.target.value)} placeholder="Вставь ссылку на видео" autoComplete="url" disabled={phase === 'preparing'} aria-invalid={phase === 'error'} aria-describedby={phase === 'error' ? 'url-error' : undefined} />
          <button className="shrink-0 border-0 bg-transparent px-2.5 py-2 text-xs text-muted transition-colors hover:text-ink disabled:opacity-50" type="button" onClick={handlePaste} disabled={phase === 'preparing'}>Вставить</button>
        </div>
        <button className="inline-flex min-h-[54px] items-center justify-center gap-2.5 rounded-[14px] border-0 bg-lime px-[23px] font-semibold text-ink transition hover:-translate-y-px hover:bg-lime-hover hover:shadow-[0_10px_24px_rgba(115,145,48,.16)] disabled:cursor-not-allowed disabled:bg-[#e6eadf] disabled:text-[#9da995] disabled:hover:translate-y-0 disabled:hover:shadow-none max-[760px]:w-full" type="submit" disabled={!url.trim() || busy}>
          {phase === 'resolving' ? 'Проверяем…' : 'Найти видео'}
          {phase !== 'resolving' && <Icon><path d="M5 12h13" /><path d="m13 6 6 6-6 6" /></Icon>}
        </button>
      </form>

      {phase === 'error' && <p className="mt-[13px] text-[13px] text-error" id="url-error" role="alert">{error}</p>}
      {phase === 'resolving' && <div className="mt-4 flex items-center gap-[9px] font-mono text-xs leading-[1.4] text-muted" role="status"><span className="size-3 animate-spin-slow rounded-full border-2 border-[#dfe7d8] border-t-[#76953d]" /> Проверяем ссылку и готовим варианты файла</div>}

      {media && (phase === 'ready' || phase === 'preparing' || phase === 'done') && (
        <div className="mt-[18px] rounded-[18px] border border-line bg-[#fbfcfa] p-5 max-[760px]:p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-4 max-[760px]:gap-3">
              {media.thumbnailUrl && <img className="aspect-video w-[132px] shrink-0 rounded-[11px] bg-[#e9eee6] object-cover max-[760px]:w-[96px]" src={media.thumbnailUrl} alt="" referrerPolicy="no-referrer" loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none' }} />}
              <div className="min-w-0">
                <span className="inline-flex items-center gap-[7px] font-mono text-[11px] uppercase tracking-[.06em] text-muted"><span className={`size-[7px] rounded-full ${source?.tone ?? 'bg-muted'}`} /> {source?.name ?? media.source}{media.durationSec != null && <> · {formatDuration(media.durationSec)}</>}</span>
                <h2 className="mt-[7px] line-clamp-2 break-words font-display text-xl font-bold leading-tight tracking-[-.04em] max-[760px]:text-base" title={media.title}>{media.title}</h2>
              </div>
            </div>
            {phase !== 'preparing' && <button className="shrink-0 border-0 bg-transparent px-2.5 py-2 text-xs text-muted transition-colors hover:text-ink" type="button" onClick={reset}>Изменить</button>}
          </div>

          {phase === 'done' && file ? (
            <div className="mt-5" role="status">
              <div className="flex items-center gap-3 rounded-[13px] border border-[#a5bb83] bg-[#f8fcef] p-3.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-lime text-ink"><Icon className="size-4"><path d="m5 12 4 4L19 6" /></Icon></span>
                <span className="flex min-w-0 flex-col gap-1"><strong className="text-sm">Файл готов, загрузка началась</strong><small className="truncate text-[11px] text-muted">{file.fileName} · {formatBytes(file.sizeBytes)}</small></span>
              </div>
              <p className="mt-3 text-[12px] text-muted">Загрузка не началась? <a className="font-semibold text-ink underline underline-offset-2" href={file.fileUrl} download={file.fileName}>Скачать файл</a></p>
              <div className="mt-4 grid grid-cols-2 gap-2 max-[760px]:grid-cols-1">
                <button className="min-h-[48px] rounded-[13px] border border-line bg-surface px-4 text-sm font-semibold transition hover:border-[#a5bb83]" type="button" onClick={() => { setFile(null); setPhase('ready') }}>Другой формат</button>
                <button className="min-h-[48px] rounded-[13px] border-0 bg-lime px-4 text-sm font-semibold transition hover:bg-lime-hover" type="button" onClick={reset}>Скачать другое видео</button>
              </div>
            </div>
          ) : (
            <>
              <div className="my-5 grid gap-2" role="radiogroup" aria-label="Доступные форматы">
                {media.formats.map((format) => {
                  const active = format.id === selectedId
                  const size = formatBytes(format.sizeBytes)
                  return (
                    <button className={`grid grid-cols-[47px_1fr_22px] items-center gap-[11px] rounded-[13px] border p-3.5 text-left transition disabled:cursor-not-allowed ${active ? 'border-[#a5bb83] bg-[#f8fcef]' : 'border-line bg-surface enabled:hover:border-[#a5bb83] disabled:opacity-60'}`} type="button" role="radio" aria-checked={active} key={format.id} onClick={() => setSelectedId(format.id)} disabled={phase === 'preparing'}>
                      <span className="font-mono text-[11px] text-[#657166]">{format.type}</span>
                      <span className="flex flex-col gap-1"><strong className="text-sm">{format.quality}</strong><small className="text-[11px] text-muted">{format.detail}{size && ` · ~${size}`}</small></span>
                      <span className={`grid size-5 place-items-center rounded-full border ${active ? 'border-lime bg-lime text-ink' : 'border-line text-transparent'}`}><Icon className="size-[13px]"><path d="m5 12 4 4L19 6" /></Icon></span>
                    </button>
                  )
                })}
              </div>
              {downloadError && <p className="-mt-1 mb-4 text-[13px] text-error" role="alert">{downloadError}</p>}
              {phase === 'preparing' && selected
                ? <Progress progress={progress} format={selected} onCancel={() => abortRef.current?.abort()} />
                : <button className="inline-flex min-h-[54px] w-full items-center justify-center gap-2.5 rounded-[14px] border-0 bg-lime px-[23px] font-semibold text-ink transition hover:-translate-y-px hover:bg-lime-hover hover:shadow-[0_10px_24px_rgba(115,145,48,.16)]" type="button" onClick={handleDownload} disabled={!selected}><Icon><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></Icon> Скачать {selected?.type} · {selected?.quality}</button>}
            </>
          )}
        </div>
      )}

      <div className="mt-[19px] flex items-center justify-between gap-3.5 border-t border-line px-1 pb-px pt-[17px] text-[11px] text-[#8a958e] max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-2.5">
        <span>Поддерживаемые платформы</span>
        <div className="flex flex-wrap justify-end gap-3 max-[760px]:justify-start" id="platforms">{Object.values(SOURCES).map((item) => <span className="inline-flex items-center gap-[5px] text-[11px] text-[#67736b]" key={item.name}><i className={`grid size-[17px] place-items-center rounded-[5px] font-mono text-[8px] not-italic text-white ${item.tone}`}>{item.short}</i>{item.name}</span>)}</div>
      </div>
    </div>
  )
}
