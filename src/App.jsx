import { useEffect, useRef, useState } from 'react'

const sources = [
  { name: 'YouTube', short: 'YT', tone: 'bg-red-400' },
  { name: 'Instagram', short: 'IG', tone: 'bg-pink-400' },
  { name: 'TikTok', short: 'TK', tone: 'bg-indigo-400' },
]

const formats = [
  { type: 'MP4', quality: '1080p', detail: '1920 × 1080', size: '84 MB' },
  { type: 'MP4', quality: '720p', detail: '1280 × 720', size: '42 MB' },
  { type: 'MP4', quality: '480p', detail: '854 × 480', size: '26 MB' },
  { type: 'MP3', quality: 'Audio', detail: 'High quality', size: '4.8 MB' },
]

function Icon({ children, className = 'size-[18px]' }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className={`fill-none stroke-current stroke-[1.8] stroke-linecap-round stroke-linejoin-round ${className}`}>{children}</svg>
}

function App() {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('idle')
  const [source, setSource] = useState(null)
  const [selectedFormat, setSelectedFormat] = useState(formats[1])
  const timerRef = useRef(null)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const detectSource = (value) => {
    if (/youtu|youtube/i.test(value)) return sources[0]
    if (/instagram/i.test(value)) return sources[1]
    if (/tiktok/i.test(value)) return sources[2]
    return null
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!url.trim()) return
    const detected = detectSource(url)
    setSource(detected)
    setStatus(detected ? 'processing' : 'error')
    if (detected) timerRef.current = setTimeout(() => setStatus('ready'), 1150)
  }

  const handlePaste = async () => {
    try {
      const clipboardUrl = await navigator.clipboard.readText()
      if (clipboardUrl) setUrl(clipboardUrl)
    } catch {
      // Clipboard access can be unavailable outside a secure browser context.
    }
  }

  const reset = () => {
    setUrl('')
    setSource(null)
    setStatus('idle')
  }

  return (
    <main className="min-h-screen overflow-hidden bg-background text-ink">
      <header className="mx-auto flex h-[88px] w-[calc(100%-64px)] max-w-[1180px] items-center justify-between border-b border-line max-[760px]:h-[72px] max-[760px]:w-[calc(100%-32px)]">
        <a className="inline-flex items-center gap-2.5 font-display text-[19px] font-extrabold tracking-[-.04em]" href="#top" aria-label="Linkdrop home">
          <span className="grid size-[30px] rotate-[-12deg] place-items-center rounded-[9px] bg-lime text-[21px] leading-none">↘</span>
          <span>linkdrop</span>
        </a>
        <nav className="flex items-center gap-7 text-[13px] text-muted max-[760px]:gap-3" aria-label="Main navigation">
          <a className="transition-colors hover:text-ink max-[760px]:hidden" href="#how-it-works">Как это работает</a>
          <a className="transition-colors hover:text-ink max-[760px]:hidden" href="#platforms">Платформы</a>
          <span className="rounded-full bg-[#e7eee7] px-2.5 py-[7px] font-mono text-[10px] text-[#4d5d52]">MAX скоро</span>
        </nav>
      </header>

      <section className="mx-auto w-[calc(100%-64px)] max-w-[1180px] px-0 pb-[82px] pt-[106px] max-[760px]:w-[calc(100%-32px)] max-[760px]:pb-[59px] max-[760px]:pt-[72px]" id="top">
        <div className="mx-auto mb-12 max-w-[710px] text-center max-[760px]:mb-[33px]">
          <p className="mb-[22px] inline-flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[.08em] text-muted"><span className="size-[7px] rounded-full bg-lime shadow-[0_0_0_4px_rgba(199,255,74,.22)]" /> Быстрый доступ к твоим ссылкам</p>
          <h1 className="font-display text-[clamp(46px,6vw,78px)] font-extrabold leading-[.98] tracking-[-.055em] max-[760px]:text-[clamp(43px,12vw,60px)]">Скачивай видео<br /><em className="not-italic text-[#6c7971]">без лишних шагов.</em></h1>
          <p className="mt-[22px] text-[17px] leading-[1.6] text-muted max-[760px]:mx-auto max-[760px]:max-w-[300px] max-[760px]:text-[15px]">Вставь ссылку — выбери формат — получи готовый файл.</p>
        </div>

        <div className="mx-auto w-full max-w-[780px] rounded-[25px] border border-line bg-surface p-5 shadow-[0_24px_80px_rgba(37,55,45,.08)] max-[760px]:rounded-[20px] max-[760px]:p-[13px]">
          <div className="flex items-center justify-between px-1 pb-[17px] pt-[3px] max-[760px]:pb-[14px] max-[760px]:pt-[5px]">
            <span className="font-mono text-xs font-semibold uppercase tracking-[.08em]">Новая загрузка</span>
            <span className="inline-flex items-center gap-[7px] font-mono text-[11px] text-success max-[760px]:text-[10px]"><span className="size-1.5 rounded-full bg-success" /> готов к работе</span>
          </div>

          <form className="grid grid-cols-[1fr_auto] gap-2.5 max-[760px]:grid-cols-1 max-[760px]:gap-2" onSubmit={handleSubmit}>
            <div className={`flex min-w-0 items-center rounded-[15px] border bg-[#fbfcfb] pl-[17px] pr-2 transition ${status === 'error' ? 'border-error shadow-[0_0_0_4px_rgba(217,75,72,.1)]' : 'border-line focus-within:border-[#9eb37f] focus-within:shadow-[0_0_0_4px_rgba(199,255,74,.24)]'}`}>
              <span className="mr-[11px] grid w-[22px] shrink-0 place-items-center text-[#7d8a82]"><Icon><path d="M10 13a5 5 0 0 0 7.07.07l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15" /><path d="M14 11a5 5 0 0 0-7.07-.07l-2 2A5 5 0 0 0 7 20l1.15-1.15" /></Icon></span>
              <label className="sr-only" htmlFor="video-url">Ссылка на видео</label>
              <input className="h-[54px] min-w-0 w-full border-0 bg-transparent text-[15px] outline-0 placeholder:text-[#9aa59d]" id="video-url" type="url" value={url} onChange={(event) => { setUrl(event.target.value); if (status !== 'idle') setStatus('idle') }} placeholder="Вставь ссылку на видео" autoComplete="url" />
              <button className="shrink-0 border-0 bg-transparent px-2.5 py-2 text-xs text-muted transition-colors hover:text-ink" type="button" onClick={handlePaste}>Вставить</button>
            </div>
            <button className="inline-flex min-h-[54px] items-center justify-center gap-2.5 rounded-[14px] border-0 bg-lime px-[23px] font-semibold text-ink transition hover:-translate-y-px hover:bg-lime-hover hover:shadow-[0_10px_24px_rgba(115,145,48,.16)] disabled:cursor-not-allowed disabled:bg-[#e6eadf] disabled:text-[#9da995] max-[760px]:w-full" type="submit" disabled={!url.trim() || status === 'processing'}>
              {status === 'processing' ? 'Обрабатываем…' : 'Скачать'}
              {status !== 'processing' && <Icon><path d="M5 12h13" /><path d="m13 6 6 6-6 6" /></Icon>}
            </button>
          </form>

          {status === 'error' && <p className="mt-[13px] text-[13px] text-error">Похоже, это не ссылка на поддерживаемое видео.</p>}
          {status === 'processing' && <div className="mt-4 flex items-center gap-[9px] font-mono text-xs leading-[1.4] text-muted" role="status"><span className="size-3 animate-spin-slow rounded-full border-2 border-[#dfe7d8] border-t-[#76953d]" /> Проверяем ссылку и готовим варианты файла</div>}

          {status === 'ready' && source && (
            <div className="mt-[18px] rounded-[18px] border border-line bg-[#fbfcfa] p-5">
              <div className="flex items-center justify-between">
                <div><span className="inline-flex items-center gap-[7px] font-mono text-[11px] uppercase tracking-[.06em] text-muted"><span className={`size-[7px] rounded-full ${source.tone}`} /> {source.name}</span><h2 className="mt-[7px] font-display text-2xl font-bold tracking-[-.05em]">Ссылка распознана</h2></div>
                <button className="border-0 bg-transparent px-2.5 py-2 text-xs text-muted transition-colors hover:text-ink" type="button" onClick={reset}>Изменить</button>
              </div>
              <div className="my-5 grid gap-2" aria-label="Доступные форматы">
                {formats.map((format) => <button className={`grid grid-cols-[47px_1fr_22px] items-center gap-[11px] rounded-[13px] border p-3.5 text-left transition ${selectedFormat === format ? 'border-[#a5bb83] bg-[#f8fcef]' : 'border-line bg-surface hover:border-[#a5bb83]'}`} type="button" key={`${format.type}-${format.quality}`} onClick={() => setSelectedFormat(format)}><span className="font-mono text-[11px] text-[#657166]">{format.type}</span><span className="flex flex-col gap-1"><strong className="text-sm">{format.quality}</strong><small className="text-[11px] text-muted">{format.detail} · {format.size}</small></span><span className={`grid size-5 place-items-center rounded-full border ${selectedFormat === format ? 'border-lime bg-lime text-ink' : 'border-line text-transparent'}`}><Icon className="size-[13px]"><path d="m5 12 4 4L19 6" /></Icon></span></button>)}
              </div>
              <button className="inline-flex min-h-[54px] w-full items-center justify-center gap-2.5 rounded-[14px] border-0 bg-lime px-[23px] font-semibold text-ink transition hover:-translate-y-px hover:bg-lime-hover hover:shadow-[0_10px_24px_rgba(115,145,48,.16)]" type="button"><Icon><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></Icon> Скачать {selectedFormat.type} · {selectedFormat.quality}</button>
            </div>
          )}

          <div className="mt-[19px] flex items-center justify-between gap-3.5 border-t border-line px-1 pb-px pt-[17px] text-[11px] text-[#8a958e] max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-2.5">
            <span>Поддерживаемые платформы</span>
            <div className="flex flex-wrap justify-end gap-3 max-[760px]:justify-start" id="platforms">{sources.map((item) => <span className="inline-flex items-center gap-[5px] text-[11px] text-[#67736b]" key={item.name}><i className={`grid size-[17px] place-items-center rounded-[5px] font-mono text-[8px] not-italic text-white ${item.tone}`}>{item.short}</i>{item.name}</span>)}</div>
          </div>
        </div>
        <div className="mx-auto mt-[17px] flex w-full max-w-[780px] items-center justify-between font-mono text-[10px] uppercase tracking-[.06em] text-[#89958d]"><span className="text-[#adbaaf]">01</span><span>Ссылка → готовый файл</span></div>
      </section>

      <section className="mx-auto grid w-[calc(100%-64px)] max-w-[1180px] grid-cols-[repeat(3,1fr)_1.3fr] gap-5 border-y border-line py-[21px] max-[760px]:w-[calc(100%-32px)] max-[760px]:grid-cols-3 max-[760px]:gap-2" aria-label="Service benefits">
        <div className="flex items-center gap-[11px] max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-[7px]"><strong className="font-mono text-[11px] text-[#9aa89d]">01</strong><span className="text-[13px] font-semibold max-[760px]:text-[11px]">Вставь ссылку</span></div>
        <div className="flex items-center gap-[11px] max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-[7px]"><strong className="font-mono text-[11px] text-[#9aa89d]">02</strong><span className="text-[13px] font-semibold max-[760px]:text-[11px]">Выбери формат</span></div>
        <div className="flex items-center gap-[11px] max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-[7px]"><strong className="font-mono text-[11px] text-[#9aa89d]">03</strong><span className="text-[13px] font-semibold max-[760px]:text-[11px]">Скачай файл</span></div>
        <p className="m-0 text-right text-[13px] text-muted max-[760px]:col-span-full max-[760px]:mt-1 max-[760px]:text-left max-[760px]:text-xs">Простой путь без лишнего интерфейса.</p>
      </section>

      <section className="mx-auto grid w-[calc(100%-64px)] max-w-[1180px] grid-cols-[.85fr_1.5fr] gap-[70px] py-[130px] max-[760px]:block max-[760px]:w-[calc(100%-32px)] max-[760px]:py-[92px]" id="how-it-works">
        <div><p className="mb-[19px] inline-flex font-mono text-[11px] uppercase tracking-[.08em] text-muted">Как это работает</p><h2 className="font-display text-[clamp(34px,4vw,50px)] font-bold leading-[1.02] tracking-[-.055em]">Три шага до<br /><em className="not-italic text-[#6c7971]">готового файла.</em></h2></div>
        <div className="grid grid-cols-3 gap-3.5 max-[760px]:mt-[38px] max-[760px]:grid-cols-1 max-[760px]:gap-2">
          <article className="min-h-[174px] border-t-2 border-ink px-[17px] pb-5 pt-[17px] max-[760px]:min-h-0 max-[760px]:px-1 max-[760px]:py-[15px]"><span className="font-mono text-[11px] text-[#9ba79f]">01</span><h3 className="mt-10 font-display text-[17px] font-bold tracking-[-.03em] max-[760px]:mt-[23px]">Вставь ссылку</h3><p className="mt-2.5 text-[13px] leading-[1.55] text-muted">Скопируй ссылку из приложения и добавь её в поле выше.</p></article>
          <article className="min-h-[174px] border-t-2 border-ink px-[17px] pb-5 pt-[17px] max-[760px]:min-h-0 max-[760px]:px-1 max-[760px]:py-[15px]"><span className="font-mono text-[11px] text-[#9ba79f]">02</span><h3 className="mt-10 font-display text-[17px] font-bold tracking-[-.03em] max-[760px]:mt-[23px]">Выбери формат</h3><p className="mt-2.5 text-[13px] leading-[1.55] text-muted">Доступные качества и MP3 появятся после распознавания.</p></article>
          <article className="min-h-[174px] border-t-2 border-ink px-[17px] pb-5 pt-[17px] max-[760px]:min-h-0 max-[760px]:px-1 max-[760px]:py-[15px]"><span className="font-mono text-[11px] text-[#9ba79f]">03</span><h3 className="mt-10 font-display text-[17px] font-bold tracking-[-.03em] max-[760px]:mt-[23px]">Скачай файл</h3><p className="mt-2.5 text-[13px] leading-[1.55] text-muted">Мы подготовим результат, который можно сохранить на устройство.</p></article>
        </div>
      </section>

      <footer className="mx-auto flex w-[calc(100%-64px)] max-w-[1180px] justify-between border-t border-line py-[21px] pb-7 font-mono text-[10px] uppercase tracking-[.05em] text-[#89958d] max-[760px]:w-[calc(100%-32px)] max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-[9px]"> <span>linkdrop / 2026</span><span>Сделано для простых загрузок</span></footer>
    </main>
  )
}

export default App
