import { cx } from '@skpods/ui'
import { useEffect, useState } from 'react'
import type { PresenterState } from '../lib/presenter'
import { CursorIcon, PauseIcon, PlayIcon, ReplayIcon, SkipIcon, XIcon } from '../ui'

/** On wide screens the caption sits under the guardian's column only, so the clinic and the phone stay fully visible. */
function useCenterBox(active: boolean) {
  const [box, setBox] = useState<{ left: number; width: number }>()
  useEffect(() => {
    if (!active) return
    const measure = () => {
      const el = document.querySelector('[data-panel=agent]')
      const wide = matchMedia('(min-width: 1280px)').matches
      if (!el || !wide) return setBox(undefined)
      const r = el.getBoundingClientRect()
      setBox({ left: r.left, width: r.width })
    }
    measure()
    addEventListener('resize', measure)
    const t = setInterval(measure, 1000)
    return () => {
      removeEventListener('resize', measure)
      clearInterval(t)
    }
  }, [active])
  return box
}

export function PresenterOverlay({ p, onPause, onSkip, onStop, onReplay }: { p: PresenterState; onPause: () => void; onSkip: () => void; onStop: () => void; onReplay: () => void }) {
  const box = useCenterBox(p.running || p.finished)
  if (!p.running && !p.finished) return null
  return (
    <>
      {p.cursor && (
        <>
          <div className="cursor" style={{ transform: `translate(${p.cursor.x - 6}px, ${p.cursor.y - 4}px)` }} aria-hidden><CursorIcon /></div>
          {p.cursor.tap > 0 && <div key={p.cursor.tap} className="tap-ripple" style={{ left: p.cursor.x, top: p.cursor.y }} aria-hidden />}
        </>
      )}
      <div className={cx('pointer-events-none fixed bottom-0 z-[80] flex justify-center px-3 pb-4 sm:pb-6', box ? '' : 'inset-x-0')} style={box ? { left: box.left, width: box.width } : undefined} role="region" aria-label="Presenter captions" data-testid="presenter" data-finished={p.finished}>
        <div className="pointer-events-auto w-full max-w-3xl rounded-2xl border border-brand/40 bg-navy-950/92 p-4 text-white shadow-[0_20px_60px_-10px_rgb(0_0_0/.7)] backdrop-blur-xl sm:p-5">
          <div key={p.caption?.title} className="caption min-h-[5.2rem]">
            <p className="text-lg font-extrabold tracking-tight text-white sm:text-[22px]" data-testid="caption-title">{p.caption?.title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-white/80 sm:text-[15px]" data-testid="caption-body">{p.caption?.body}</p>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex flex-1 gap-1" aria-label={`Step ${p.step + 1} of ${p.total}`}>
              {Array.from({ length: p.total }, (_, i) => <span key={i} className={cx('h-1 flex-1 rounded-full transition-colors duration-500', i < p.step ? 'bg-brand' : i === p.step ? (p.finished ? 'bg-brand' : 'bg-white/80') : 'bg-white/20')} />)}
            </div>
            {p.finished ? (
              <button type="button" onClick={onReplay} className="skp-btn-primary !px-3 !py-1.5 text-xs"><ReplayIcon size={14} /> Play again</button>
            ) : (
              <>
                <button type="button" onClick={onPause} aria-label={p.paused ? 'Resume' : 'Pause'} className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20">{p.paused ? <PlayIcon size={15} /> : <PauseIcon size={15} />}</button>
                <button type="button" onClick={onSkip} aria-label="Skip ahead" className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20"><SkipIcon size={15} /></button>
              </>
            )}
            <button type="button" onClick={onStop} aria-label="Exit presenter mode" className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20"><XIcon size={15} /></button>
          </div>
        </div>
      </div>
    </>
  )
}
