import { DownloadCard } from './DownloadCard.jsx'
import { Icon } from './Icon.jsx'

// Блок MAX — часть дизайна и показывается всегда (решение Ильи, 2026-10-18). Ссылка на бота задаётся
// при сборке (VITE_MAX_BOT_URL); пока её нет, кнопки ведут на якорь секции, как в исходном макете.
const maxBotUrl = import.meta.env.VITE_MAX_BOT_URL || null
const maxLinkProps = maxBotUrl ? { href: maxBotUrl, target: '_blank', rel: 'noopener noreferrer' } : { href: '#max' }

function App() {
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
          <a className="rounded-full bg-[#e7eee7] px-2.5 py-[7px] font-mono text-[10px] text-[#4d5d52] transition-colors hover:bg-[#dbe6db]" {...maxLinkProps}>уже в MAX</a>
        </nav>
      </header>

      <section className="mx-auto w-[calc(100%-64px)] max-w-[1180px] px-0 pb-[82px] pt-[106px] max-[760px]:w-[calc(100%-32px)] max-[760px]:pb-[59px] max-[760px]:pt-[72px]" id="top">
        <div className="mx-auto mb-12 max-w-[710px] text-center max-[760px]:mb-[33px]">
          <p className="mb-[22px] inline-flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[.08em] text-muted"><span className="size-[7px] rounded-full bg-lime shadow-[0_0_0_4px_rgba(199,255,74,.22)]" /> Быстрый доступ к твоим ссылкам</p>
          <h1 className="font-display text-[clamp(46px,6vw,78px)] font-extrabold leading-[.98] tracking-[-.055em] max-[760px]:text-[clamp(43px,12vw,60px)]">Скачивай видео<br /><em className="not-italic text-[#6c7971]">без лишних шагов.</em></h1>
          <p className="mt-[22px] text-[17px] leading-[1.6] text-muted max-[760px]:mx-auto max-[760px]:max-w-[300px] max-[760px]:text-[15px]">Вставь ссылку — выбери формат — получи готовый файл.</p>
        </div>

        <DownloadCard />
        <div className="mx-auto mt-[17px] flex w-full max-w-[780px] items-center justify-between font-mono text-[10px] uppercase tracking-[.06em] text-[#89958d]"><span className="text-[#adbaaf]">01</span><span>Ссылка → готовый файл</span></div>
      </section>

      <section className="mx-auto w-[calc(100%-64px)] max-w-[1180px] py-[130px] max-[760px]:w-[calc(100%-32px)] max-[760px]:py-[92px]" id="how-it-works">
        <p className="mb-[19px] inline-flex font-mono text-[11px] uppercase tracking-[.08em] text-muted">Простой путь</p>
        <h2 className="font-display text-[clamp(42px,6vw,78px)] font-bold leading-[.98] tracking-[-.065em]">Три шага до<br /><em className="not-italic text-[#6c7971]">готового файла.</em></h2>

        <div className="relative mt-[68px] min-h-[515px] overflow-visible max-[760px]:mt-[52px] max-[760px]:min-h-[470px]">
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 1000 420" preserveAspectRatio="none" aria-hidden="true">
            <path d="M78 52 C390 44 866 73 850 205 C836 322 548 376 350 365" fill="none" stroke="#aab8ae" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>

          <div className="absolute left-0 top-0 flex items-center gap-4 max-[760px]:gap-2" style={{ left: '1%', top: '0%' }}>
            <span className="relative grid size-[78px] shrink-0 place-items-center rounded-full border border-[#aab8ae] bg-[#fbfdf7] shadow-[0_0_0_15px_rgba(199,255,74,.12)] max-[760px]:size-[54px] max-[760px]:shadow-[0_0_0_9px_rgba(199,255,74,.12)]"><span className="size-[18px] rounded-full bg-lime shadow-[0_0_30px_8px_rgba(199,255,74,.48)] max-[760px]:size-[13px]" /></span>
            <div className="min-w-[230px] rounded-[22px] border border-line bg-white/90 px-5 py-4 shadow-[0_18px_45px_rgba(59,77,65,.08)] max-[760px]:min-w-0 max-[760px]:rounded-[16px] max-[760px]:px-3.5 max-[760px]:py-3"><span className="font-mono text-[11px] text-[#9ba79f]">01</span><h3 className="mt-2 font-display text-[24px] font-bold tracking-[-.045em] max-[760px]:text-[16px]">Вставь ссылку</h3></div>
          </div>

          <div className="absolute flex items-center gap-4 max-[760px]:gap-2" style={{ right: '0%', top: '35%' }}>
            <div className="min-w-[230px] rounded-[22px] border border-line bg-white/90 px-5 py-4 text-right shadow-[0_18px_45px_rgba(59,77,65,.08)] max-[760px]:min-w-0 max-[760px]:rounded-[16px] max-[760px]:px-3.5 max-[760px]:py-3"><span className="font-mono text-[11px] text-[#9ba79f]">02</span><h3 className="mt-2 font-display text-[24px] font-bold tracking-[-.045em] max-[760px]:text-[16px]">Выбери формат</h3></div>
            <span className="relative grid size-[78px] shrink-0 place-items-center rounded-full border border-[#aab8ae] bg-[#fbfdf7] shadow-[0_0_0_15px_rgba(199,255,74,.12)] max-[760px]:size-[54px] max-[760px]:shadow-[0_0_0_9px_rgba(199,255,74,.12)]"><span className="size-[18px] rounded-full bg-lime shadow-[0_0_30px_8px_rgba(199,255,74,.48)] max-[760px]:size-[13px]" /></span>
          </div>

          <div className="absolute flex items-center gap-4 max-[760px]:gap-2" style={{ left: '26%', bottom: '0%' }}>
            <span className="relative grid size-[78px] shrink-0 place-items-center rounded-full border border-[#aab8ae] bg-[#fbfdf7] shadow-[0_0_0_15px_rgba(199,255,74,.12)] max-[760px]:size-[54px] max-[760px]:shadow-[0_0_0_9px_rgba(199,255,74,.12)]"><span className="size-[18px] rounded-full bg-lime shadow-[0_0_30px_8px_rgba(199,255,74,.48)] max-[760px]:size-[13px]" /></span>
            <div className="min-w-[230px] rounded-[22px] border border-line bg-white/90 px-5 py-4 shadow-[0_18px_45px_rgba(59,77,65,.08)] max-[760px]:min-w-0 max-[760px]:rounded-[16px] max-[760px]:px-3.5 max-[760px]:py-3"><span className="font-mono text-[11px] text-[#9ba79f]">03</span><h3 className="mt-2 font-display text-[24px] font-bold tracking-[-.045em] max-[760px]:text-[16px]">Скачай файл</h3></div>
          </div>
        </div>
      </section>

      <section id="max" className="mx-auto mb-[42px] grid w-[calc(100%-64px)] max-w-[1180px] grid-cols-2 items-center gap-[150px] py-[125px] max-[900px]:gap-[80px] max-[760px]:w-[calc(100%-32px)] max-[760px]:grid-cols-1 max-[760px]:gap-14 max-[760px]:py-[82px]" aria-labelledby="max-cta-title">
        <div className="grid min-h-[390px] place-items-center max-[760px]:min-h-[260px]">
          <div className="size-[400px] rotate-[-14deg] overflow-hidden rounded-[58px] shadow-[0_22px_45px_rgba(38,55,43,.12)] max-[900px]:size-[330px] max-[900px]:rounded-[48px] max-[760px]:size-[280px] max-[760px]:rounded-[42px]"><img className="size-full object-cover" src="/max-icon.png" alt="Логотип MAX" /></div>
        </div>
        <div className="flex max-w-[560px] flex-col items-start">
          <span className="mb-3 font-mono text-[11px] uppercase tracking-[.08em] text-[#718277]">Теперь и в MAX</span>
          <h2 id="max-cta-title" className="max-w-[560px] font-display text-[clamp(40px,5.4vw,72px)] font-bold leading-[.96] tracking-[-.07em]">Попробуй бота<br /><em className="inline-block rounded-[10px] bg-lime px-[.12em] pb-[.05em] not-italic text-ink shadow-[0_8px_24px_rgba(183,255,53,.18)]">в MAX.</em></h2>
          <p className="mb-7 mt-5 max-w-[440px] text-[17px] leading-[1.5] text-muted">Отправь ссылку в чате и получи готовый файл без лишних переходов.</p>
          <a className="inline-flex min-h-[54px] items-center gap-3 rounded-[13px] bg-ink px-6 text-sm font-semibold !text-white transition hover:-translate-y-px hover:bg-[#27332c]" style={{ color: '#ffffff' }} {...maxLinkProps}>Перейти в MAX <Icon><path d="M5 12h13" /><path d="m13 6 6 6-6 6" /></Icon></a>
        </div>
      </section>

      <footer className="mx-auto flex w-[calc(100%-64px)] max-w-[1180px] justify-between border-t border-line py-[21px] pb-7 font-mono text-[10px] uppercase tracking-[.05em] text-[#89958d] max-[760px]:w-[calc(100%-32px)] max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-[9px]"> <span>linkdrop / 2026</span><span>Скачивай только то, на что у тебя есть права</span></footer>
    </main>
  )
}

export default App
