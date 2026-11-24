import { Button, ErrorState, cx } from '@skpods/ui'
import type { Spot } from '../lib/presenter'
import { useGuardian } from '../lib/useGuardian'
import { ChainView, type ChainCmd } from './ChainView'
import { ClinicPanel } from './ClinicPanel'
import { PhonePanel, type PhoneTab } from './PhonePanel'
import { ThinkingPanel } from './ThinkingPanel'

export type Panel = 'clinic' | 'agent' | 'phone'
const LABELS: Record<Panel, string> = { clinic: 'The clinic', agent: 'The guardian', phone: "Alice's phone" }

export interface TheatreProps {
  spot: Spot
  panel: Panel
  setPanel: (p: Panel) => void
  centerTab: 'think' | 'chain'
  setCenterTab: (t: 'think' | 'chain') => void
  phoneTab: PhoneTab
  setPhoneTab: (t: PhoneTab) => void
  chainCmd?: ChainCmd
  presenting: boolean
}

function Slot({ id, panel, spot, hl, children, label }: { id: Panel; panel: Panel; spot: Spot; hl: Spot[]; children: React.ReactNode; label: string }) {
  const lit = spot && hl.includes(spot)
  return (
    <div className={cx('panel-slot flex min-h-0 flex-col', panel === id ? 'flex' : 'hidden xl:flex', spot && !lit && 'dim')} data-panel={id}>
      <div className="panel-label"><span className={cx('h-1.5 w-1.5 rounded-full', lit ? 'bg-brand animate-pulse-ring' : 'bg-muted/60')} />{label}</div>
      <div className={cx('flex min-h-0 flex-1 flex-col rounded-2xl', lit && 'spot')}>{children}</div>
    </div>
  )
}

export function Theatre(p: TheatreProps) {
  const g = useGuardian()
  return (
    <div className="stage" data-testid="theatre">
      {g.brokerError && (
        <div className="mb-4">
          <ErrorState title="The guardian service is not reachable" error={`${g.brokerError} Start it with: cd showcase/apps/guardian && npm run demo:stack (see the README).`} />
        </div>
      )}
      {g.error && !g.brokerError && (
        <div className="mb-4"><ErrorState title="Something did not work" error={g.error} action={<Button variant="secondary" className="!px-3 !py-1.5 text-xs" onClick={() => g.setError(undefined)}>Dismiss</Button>} /></div>
      )}
      <div role="tablist" aria-label="Screens" className="mb-3 grid grid-cols-3 rounded-xl bg-surface-2 p-1 text-xs font-semibold xl:hidden">
        {(Object.keys(LABELS) as Panel[]).map((k) => (
          <button key={k} role="tab" aria-selected={p.panel === k} data-testid={`panel-tab-${k}`} onClick={() => p.setPanel(k)} className={cx('rounded-lg py-2 transition', p.panel === k ? 'bg-surface text-ink shadow' : 'text-muted')}>
            {LABELS[k]}
            {k === 'phone' && g.current?.items.some((i) => i.status === 'awaiting_owner') && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-warm" aria-label="needs you" />}
          </button>
        ))}
      </div>
      <div className="grid gap-5 xl:h-[calc(100vh-9.6rem)] xl:min-h-[640px] xl:grid-cols-[minmax(340px,1fr)_minmax(420px,1.12fr)_400px]">
        <Slot id="clinic" panel={p.panel} spot={p.spot} hl={['clinic']} label="The clinic's screen">
          <ClinicPanel className="max-h-[calc(100dvh-14rem)] min-h-[28rem] xl:max-h-none xl:flex-1" />
        </Slot>
        <Slot id="agent" panel={p.panel} spot={p.spot} hl={['agent', 'chain']} label="The guardian agent">
          <div className="panel flex-1 max-h-[calc(100dvh-14rem)] min-h-[28rem] xl:max-h-none">
            <div role="tablist" aria-label="Guardian views" className="mx-4 mt-3 grid grid-cols-2 rounded-xl bg-surface-2 p-1 text-xs font-semibold">
              {(['think', 'chain'] as const).map((t) => (
                <button key={t} role="tab" aria-selected={p.centerTab === t} data-testid={`center-tab-${t}`} onClick={() => p.setCenterTab(t)} className={cx('rounded-lg py-1.5 transition', p.centerTab === t ? 'bg-surface text-ink shadow' : 'text-muted')}>{t === 'think' ? 'Thinking' : 'Audit chain'}</button>
              ))}
            </div>
            {p.centerTab === 'think' ? <ThinkingPanel className="min-h-0 flex-1" /> : <ChainView cmd={p.chainCmd} compact />}
          </div>
        </Slot>
        <Slot id="phone" panel={p.panel} spot={p.spot} hl={['phone']} label="Alice's phone">
          <PhonePanel tab={p.phoneTab} setTab={p.setPhoneTab} className="max-h-[calc(100dvh-14rem)] min-h-[32rem] flex-1 xl:max-h-[830px]" />
        </Slot>
      </div>
    </div>
  )
}
