import { Button, Card, ErrorState, Skeleton, cx, useToast } from '@skpods/ui'
import { useEffect, useMemo, useState } from 'react'
import { CLASSES, CLASS_HINT, CLASS_LABEL, KINDS, KIND_LABEL, SENSITIVITY } from '../config'
import { DEFAULT_DURATIONS, DEFAULT_MATRIX, buildPolicy, deriveMatrix, matrixEqual, plainWords, type Durations, type Matrix, type Mode } from '../lib/policy'
import { loadPolicyDoc, policyUrl, savePolicyDoc } from '../lib/pod'
import type { Policy } from '../lib/types'
import { useGuardian } from '../lib/useGuardian'
import { BoltIcon, CheckIcon, ClockIcon, FileIcon, LockIcon, Pill, ReplayIcon, ShieldIcon, XIcon } from '../ui'

const MODES: { id: Mode; label: string; icon: React.ReactNode; on: string }[] = [
  { id: 'auto', label: 'Auto', icon: <BoltIcon size={13} />, on: 'bg-brand text-brand-ink' },
  { id: 'ask', label: 'Ask me', icon: <ClockIcon size={13} />, on: 'bg-warn text-navy-950' },
  { id: 'never', label: 'Never', icon: <XIcon size={13} />, on: 'bg-danger text-white' },
]
const DURS = ['1h', '24h', '72h', '7d']

function Segmented({ value, onChange, disabled, label }: { value: Mode; onChange: (m: Mode) => void; disabled?: boolean; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-flex rounded-xl bg-surface-2 p-0.5 text-[11px] font-semibold', disabled && 'opacity-60')}>
      {MODES.map((m) => (
        <button key={m.id} type="button" role="radio" aria-checked={value === m.id} disabled={disabled && m.id !== value} onClick={() => onChange(m.id)} data-mode={m.id}
          className={cx('flex items-center gap-1 rounded-[10px] px-2.5 py-1.5 transition', value === m.id ? `${m.on} shadow` : 'text-muted hover:text-ink', disabled && 'cursor-not-allowed')}>
          {m.icon}<span>{m.label}</span>
        </button>
      ))}
    </div>
  )
}

export function PolicyEditor({ onReplay }: { onReplay: () => void }) {
  const g = useGuardian()
  const { toast } = useToast()
  const [base, setBase] = useState<Policy>()
  const [matrix, setMatrix] = useState<Matrix>()
  const [durs, setDurs] = useState<Durations>(DEFAULT_DURATIONS)
  const [saved, setSaved] = useState<{ m: Matrix; d: Durations }>()
  const [err, setErr] = useState<unknown>()
  const [saving, setSaving] = useState(false)
  const [showJson, setShowJson] = useState(false)
  const [confirm, setConfirm] = useState<string>()

  useEffect(() => {
    if (!g.root) return
    loadPolicyDoc(g.store, g.root)
      .then((p) => {
        if (!p) throw new Error('No policy file in your pod yet. Run the demo seed (npm run demo) to create one.')
        const d = deriveMatrix(p)
        setBase(p)
        setMatrix(d.matrix)
        setDurs(d.durations)
        setSaved({ m: structuredClone(d.matrix), d: { ...d.durations } })
      })
      .catch(setErr)
  }, [g.root, g.store])

  const dirty = Boolean(matrix && saved && !matrixEqual(matrix, saved.m, durs, saved.d))
  const draft = useMemo(() => (base && matrix ? buildPolicy(base, matrix, durs) : undefined), [base, matrix, durs])
  const words = useMemo(() => (matrix ? plainWords(matrix, durs) : []), [matrix, durs])

  if (err) return <ErrorState title="Could not load your rules" error={err} />
  if (!matrix || !base || !saved) return <div className="grid gap-4 lg:grid-cols-[1fr_340px]"><Skeleton className="h-96" /><Skeleton className="h-96" /></div>

  const set = (c: string, k: string, m: Mode) => setMatrix((x) => ({ ...x!, [c]: { ...x![c], [k]: m } }))

  const save = async () => {
    if (!draft || !g.root) return
    setSaving(true)
    try {
      await savePolicyDoc(g.store, g.root, draft)
    } catch (e) {
      toast({ title: 'Could not save your rules', description: (e as Error).message, tone: 'error', duration: 8000 })
      setSaving(false)
      return
    }
    // The file is in the pod. Now ask the guardian to read it back, as proof it will follow it from the next request on.
    setBase(draft)
    setSaved({ m: structuredClone(matrix), d: { ...durs } })
    setSaving(false)
    let live: Policy | undefined
    for (let i = 0; i < 3 && !live; i++) {
      try {
        live = await g.reloadPolicy()
      } catch {
        await new Promise((r) => setTimeout(r, 700))
      }
    }
    if (live) toast({ title: 'Saved to your pod', description: `The guardian now reads version ${live.version} (${live.rules.length} rules). The next request follows it.`, tone: 'success' })
    else toast({ title: 'Saved to your pod', description: 'The guardian service has not confirmed that it can read the new version yet. Try the replay in a moment.', tone: 'warn', duration: 8000 })
  }
  const reset = () => {
    setMatrix(structuredClone(DEFAULT_MATRIX))
    setDurs({ ...DEFAULT_DURATIONS })
    setConfirm('Back to the recommended rules. Press Save to put them in your pod.')
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]" data-testid="policy-editor">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your rules</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">Decide, in plain language, what your guardian may do for each kind of data and each kind of requester. It reads this file from <b>your own pod</b> on every request, so a change applies to the very next ask.</p>
        </div>

        {CLASSES.map((c) => {
          const locked = SENSITIVITY[c] === 'locked'
          const anyAuto = KINDS.some((k) => matrix[c][k] === 'auto')
          return (
            <Card key={c} className="!p-0" data-testid={`policy-card-${c}`}>
              <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
                <span className={cx('flex h-9 w-9 items-center justify-center rounded-xl', locked ? 'bg-danger/15 text-danger' : 'bg-brand/15 text-brand')}>{locked ? <LockIcon size={18} /> : <ShieldIcon size={18} />}</span>
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="font-semibold">{CLASS_LABEL[c]}</p>
                  <p className="text-xs text-muted">{CLASS_HINT[c]}</p>
                </div>
                {locked ? <Pill tone="danger"><LockIcon size={11} /> Locked by your pod</Pill> : (
                  <label className={cx('flex items-center gap-2 text-xs text-muted transition', !anyAuto && 'opacity-40')}>
                    Auto lasts up to
                    <select disabled={!anyAuto} value={durs[c]} onChange={(e) => setDurs((d) => ({ ...d, [c]: e.target.value }))} className="rounded-lg border border-line bg-surface-2 px-2 py-1 font-mono text-xs text-ink" aria-label={`Longest automatic access for ${CLASS_LABEL[c]}`}>
                      {(DURS.includes(durs[c]) ? DURS : [...DURS, durs[c]]).map((d) => <option key={d}>{d}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <ul className="divide-y divide-line">
                {KINDS.map((k) => (
                  <li key={k} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                    <span className="text-sm">{KIND_LABEL[k]}</span>
                    <Segmented value={matrix[c][k]} onChange={(m) => set(c, k, m)} disabled={locked} label={`${CLASS_LABEL[c]} for ${KIND_LABEL[k]}`} />
                  </li>
                ))}
              </ul>
              {locked && <p className="border-t border-line bg-surface-2/50 px-5 py-2.5 text-xs text-muted">This file has an owner-only rule in your pod, so even the guardian cannot open it or grant it. The setting stays on Never.</p>}
            </Card>
          )
        })}

        <p className="px-1 text-xs text-muted">Safety rails that always apply: Auto only ever reaches requesters on your providers list, a clinic also needs a booked appointment, and anything that is not Auto falls back to asking you. Access is always read-only and always ends.</p>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <Card title="In plain words" subtitle="Generated from your toggles as you change them" data-testid="plain-words">
          <ul className="space-y-2.5 text-[13px] leading-relaxed">
            {words.map((w) => (
              <li key={w.cls} className="flex gap-2"><span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" /><span>{w.text}</span></li>
            ))}
          </ul>
        </Card>
        <Card padded={false} className="p-5">
          <div className="flex items-center gap-2 text-sm font-semibold"><FileIcon size={16} className="text-brand" /> Where this lives</div>
          <p className="mt-1.5 break-all font-mono text-[11px] text-muted">{g.root ? policyUrl(g.root).replace(/^https?:\/\//, '') : ''}</p>
          <button type="button" onClick={() => setShowJson((s) => !s)} className="mt-2 text-xs font-semibold text-brand hover:underline">{showJson ? 'Hide' : 'Show'} the rules the guardian will read ({draft?.rules.length})</button>
          {showJson && <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[10.5px] leading-relaxed scroll-thin">{JSON.stringify(draft?.rules, null, 2)}</pre>}
        </Card>
        <div className="skp-card space-y-3 p-4">
          <div className="flex items-center gap-2 text-xs" role="status" data-testid="policy-status">
            {dirty ? <><span className="h-2 w-2 rounded-full bg-warn" /> <span className="font-semibold text-warn">Unsaved changes</span></> : <><CheckIcon size={14} className="text-ok" /> <span className="text-muted">Saved. Your pod has these rules (v{base.version}).</span></>}
          </div>
          {confirm && !dirty && <p className="text-xs text-muted">{confirm}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => { setMatrix(structuredClone(saved.m)); setDurs({ ...saved.d }); setConfirm(undefined) }} disabled={!dirty || saving}>Discard</Button>
            <Button onClick={save} loading={saving} disabled={!dirty} data-testid="save-policy">Save to my pod</Button>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
            <button type="button" onClick={reset} className="text-xs text-muted hover:text-ink hover:underline">Use recommended rules</button>
            <Button variant="ghost" className="!px-2.5 !py-1.5 text-xs" onClick={onReplay} data-testid="replay-from-policy"><ReplayIcon size={14} /> Replay the story</Button>
          </div>
        </div>
      </aside>
    </div>
  )
}
