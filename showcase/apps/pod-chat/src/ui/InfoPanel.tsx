import { Avatar, Button, cx } from '@skpods/ui'
import { useState } from 'react'
import type { ChatEngine, ConvDetail } from '../lib/engine'
import { clock, dayLabel } from '../lib/format'
import { slugOf } from '../lib/paths'
import { Close, Copy, Database, Exit, Eye, Lock, Refresh } from './icons'

const STATUS: Record<string, { label: string; tone: string; hint: string }> = {
  active: { label: 'Sharing', tone: 'bg-ok/10 text-ok border-ok/30', hint: 'Their pod lets you read their messages.' },
  left: { label: 'Left', tone: 'bg-surface-2 text-muted border-line', hint: 'They revoked access. Their messages are still in their pod, you just cannot read them.' },
  hidden: { label: 'Not sharing', tone: 'bg-warn/10 text-warn border-warn/30', hint: 'They have not joined yet, have not opened Pod Chat once (their pod has to trust this app), or revoked access without a leave notice. The pod answers "forbidden" in every case.' },
  unknown: { label: 'Checking', tone: 'bg-surface-2 text-muted border-line', hint: '' },
  error: { label: 'Unreachable', tone: 'bg-danger/10 text-danger border-danger/30', hint: 'Could not reach their pod.' },
}

export function InfoPanel({ engine, d, me, podView, setPodView, onClose, onLeave, onToast }: { engine: ChatEngine; d: ConvDetail; me: string; podView: boolean; setPodView: (v: boolean) => void; onClose: () => void; onLeave: () => void; onToast: (t: { title: string; tone?: 'success' | 'error' | 'info'; description?: string }) => void }) {
  const [busy, setBusy] = useState(false)
  const [confirmErase, setConfirmErase] = useState(false)
  const rejoin = async () => {
    setBusy(true)
    try {
      await engine.rejoin(d.meta.id)
      onToast({ title: 'You are back', description: 'Your messages are readable again.', tone: 'success' })
    } catch (e) {
      onToast({ title: 'Could not rejoin', description: (e as Error).message, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }
  const erase = async () => {
    setBusy(true)
    try {
      await engine.eraseMyCopy(d.meta.id)
      location.hash = '#/'
    } catch (e) {
      onToast({ title: 'Could not erase', description: (e as Error).message, tone: 'error' })
      setBusy(false)
    }
  }
  return (
    <aside className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-bg md:static md:z-auto md:w-[22rem] md:shrink-0 md:border-l md:border-line" aria-label="Conversation info" data-testid="info-panel">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-bg/90 px-4 py-3 backdrop-blur">
        <h2 className="text-base font-semibold">Where this chat lives</h2>
        <button type="button" className="skp-btn-ghost ml-auto !p-2" onClick={onClose} aria-label="Close info"><Close /></button>
      </div>
      <div className="space-y-6 p-4 pb-24">
        <p className="text-sm text-muted">
          Nobody hosts this conversation. Each person's messages are files in <strong className="text-ink">their own pod</strong>, and Pod Chat stitches the pods together while you read.
        </p>

        <section aria-labelledby="who-h">
          <h3 id="who-h" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">People and their pods</h3>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {d.peers.map((p) => {
              const s = STATUS[p.status] ?? STATUS.unknown
              const you = p.webId === me
              return (
                <li key={p.webId} className="flex items-center gap-3 p-3" data-testid="peer-row" data-peer={slugOf(p.webId)} data-status={you && d.left ? 'left' : p.status}>
                  <Avatar name={p.name} seed={p.webId} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{p.name}{you && ' (you)'}</p>
                    <p className="truncate font-mono text-[11px] text-muted" title={p.webId}>pod ~{slugOf(p.webId)}</p>
                    {p.status === 'left' && p.leftAt ? <p className="text-[11px] text-muted">Left {dayLabel(p.leftAt).toLowerCase()} at {clock(p.leftAt)}</p> : null}
                  </div>
                  <div className="text-right">
                    <span title={s.hint} className={cx('inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium', you && d.left ? STATUS.left.tone : s.tone)}>{you ? (d.left ? 'You left' : 'You') : s.label}</span>
                    {p.status === 'active' && <p className="mt-0.5 text-[11px] text-muted">{p.count} message{p.count === 1 ? '' : 's'}</p>}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>

        <section aria-labelledby="mine-h">
          <h3 id="mine-h" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Your messages are stored at</h3>
          <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 p-3">
            <Database className="shrink-0 text-brand" />
            <code className="min-w-0 flex-1 break-all text-[11px] leading-snug" data-testid="my-container">{d.myContainer}</code>
            <button type="button" className="skp-btn-ghost !p-2" aria-label="Copy address" onClick={() => { void navigator.clipboard?.writeText(d.myContainer); onToast({ title: 'Address copied', tone: 'info' }) }}><Copy width={16} height={16} /></button>
          </div>
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-line bg-surface p-3">
            <Eye className="shrink-0 text-muted" />
            <span className="flex-1 text-sm">
              <span className="font-medium">Pod view</span>
              <span className="block text-xs text-muted">Tag every bubble with the pod and file it comes from.</span>
            </span>
            <button type="button" role="switch" aria-checked={podView} aria-label="Pod view" data-testid="pod-view" onClick={() => setPodView(!podView)} className={cx('relative h-6 w-11 shrink-0 rounded-full transition', podView ? 'bg-teal-700 dark:bg-brand' : 'bg-line')}>
              <span className={cx('absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', podView && 'translate-x-5')} />
            </button>
          </div>
        </section>

        <section aria-labelledby="ctl-h">
          <h3 id="ctl-h" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Your control</h3>
          {d.left ? (
            <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
              <p className="flex items-center gap-2 text-sm font-semibold"><Lock width={16} height={16} /> You left this conversation</p>
              <p className="text-sm text-muted">Your messages are still in your pod, but nobody else can read them. Rejoin and they come back at once.</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={rejoin} loading={busy} data-testid="rejoin"><Refresh width={16} height={16} /> Rejoin</Button>
                {!confirmErase ? (
                  <Button variant="danger" onClick={() => setConfirmErase(true)}>Erase my copy</Button>
                ) : (
                  <Button variant="danger" onClick={erase} loading={busy} data-testid="erase">Really erase everything I wrote</Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-2xl border border-line bg-surface p-4">
              <p className="text-sm text-muted">Leave whenever you like. Access to your messages is revoked in your pod: they stay yours, and vanish for everyone else.</p>
              <Button variant="danger" onClick={onLeave} data-testid="leave"><Exit width={16} height={16} /> Leave conversation</Button>
            </div>
          )}
        </section>
      </div>
    </aside>
  )
}
