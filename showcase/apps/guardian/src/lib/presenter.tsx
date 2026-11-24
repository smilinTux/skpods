import { useCallback, useEffect, useRef, useState } from 'react'
import type { Guardian } from './useGuardian'
import type { PhoneTab } from '../views/PhonePanel'
import type { ChainCmd } from '../views/ChainView'
import { sleep } from './format'

export type Spot = 'clinic' | 'agent' | 'phone' | 'chain' | null

export interface StageControls {
  setRoute: (r: 'live' | 'policy' | 'audit') => void
  setPhoneTab: (t: PhoneTab) => void
  setCenterTab: (t: 'think' | 'chain') => void
  runChain: (kind: ChainCmd['kind']) => void
}

export interface PresenterState {
  running: boolean
  paused: boolean
  finished: boolean
  caption?: { title: string; body: string }
  spot: Spot
  step: number
  total: number
  cursor?: { x: number; y: number; tap: number }
}

class Cancelled extends Error {}

interface Ctx {
  say: (title: string, body: string, spot: Spot) => void
  wait: (ms: number) => Promise<void>
  until: (cond: () => boolean, timeoutMs?: number) => Promise<boolean>
  click: (selector: string, fallback?: () => void) => Promise<void>
  g: () => Guardian
  stage: StageControls
}

type Step = (c: Ctx) => Promise<void>

const SCRIPT: Step[] = [
  async (c) => {
    c.stage.setRoute('live')
    c.stage.setCenterTab('think')
    c.stage.setPhoneTab('feed')
    await c.g().resetStage()
    c.say('Meet Alice', "She has a check-up at Bayview Family Clinic tomorrow. An AI guardian now stands between her pod and anyone who asks for her data.", 'phone')
    await c.wait(5200)
  },
  async (c) => {
    c.say('The clinic wants pre-visit info', 'Date of birth, allergies, medications, insurance member ID and SSN. The clinic presses send.', 'clinic')
    await c.wait(3200)
    await c.click('[data-pres=send]', () => void c.g().fileRequest())
  },
  async (c) => {
    c.say('Rules decide, not vibes', "The guardian reads Alice's rules from her own pod and walks them, top to bottom, for each item. An LLM may help word an explanation. It never decides.", 'agent')
    await c.until(() => Boolean(c.g().current), 30_000)
    await c.wait(3800)
  },
  async (c) => {
    c.say('Three items need no human', 'The clinic is a known provider with a booked appointment, so date of birth, allergies and medications are approved for 72 hours. Read-only, and the pod enforces it.', 'clinic')
    await c.until(() => (c.g().current?.items.filter((i) => c.g().reads[i.id]?.status === 200).length ?? 0) >= 3, 12_000)
    await c.wait(4200)
  },
  async (c) => {
    c.say('One needs Alice', 'An insurance ID is financial data. The guardian does not decide alone: it pings Alice with a recommendation and its reasoning.', 'phone')
    await c.until(() => Boolean(c.g().current?.items.some((i) => i.status === 'awaiting_owner')), 8000)
    await c.wait(4800)
  },
  async (c) => {
    c.say('Alice taps Approve', 'One tap, 24 hours, as recommended. The guardian writes a read-only rule into her pod.', 'phone')
    await c.wait(1800)
    await c.click('[data-pres=approve]', () => {
      const r = c.g().current
      const it = r?.items.find((i) => i.status === 'awaiting_owner')
      if (r && it) void c.g().decide(r, it.id, 'approve', '24h')
    })
    await c.until(() => !c.g().current?.items.some((i) => i.status === 'awaiting_owner'), 25_000)
    await c.until(() => c.g().current?.items.find((i) => i.data_class === 'insurance_member_id') !== undefined && c.g().reads[c.g().current!.items.find((i) => i.data_class === 'insurance_member_id')!.id]?.status === 200, 12_000)
    await c.wait(3000)
  },
  async (c) => {
    c.say('The SSN? Denied, nobody asked Alice', 'The guardian explains why, and offers the insurance ID instead.', 'clinic')
    await c.wait(4600)
    c.say('The clinic tries the file directly anyway', "It is not the guardian that stops it. Alice's pod itself answers 403.", 'clinic')
    await c.wait(1800)
    await c.click('[data-pres=try-ssn]', () => {
      const it = c.g().current?.items.find((i) => i.data_class === 'ssn')
      if (it) void c.g().tryRead(it.resource, it.id)
    })
    await c.until(() => Boolean(c.g().reads[c.g().current?.items.find((i) => i.data_class === 'ssn')?.id ?? '']), 8000)
    await c.wait(3600)
  },
  async (c) => {
    c.say('Everything is logged, live', 'Each ask, decision and read lands in Alice\'s access log the moment it happens.', 'phone')
    await c.click('[data-pres=tab-access]', () => c.stage.setPhoneTab('access'))
    await c.wait(5200)
  },
  async (c) => {
    c.say('Changed her mind?', "One red button ends every grant. The clinic's screen empties within seconds.", 'phone')
    await c.wait(2400)
    await c.click('[data-pres=revoke-all]', () => void c.g().revokeAll())
    await c.until(() => c.g().activeGrants.length === 0, 30_000)
    await c.until(() => (c.g().current?.items.filter((i) => c.g().reads[i.id]?.ended).length ?? 0) >= 3, 12_000)
    await c.wait(4200)
  },
  async (c) => {
    c.say('Every step is in a hash chain', "Each audit entry carries the hash of the one before it, and a copy lives in Alice's own pod. This check runs in the browser, without trusting the service.", 'chain')
    c.stage.setCenterTab('chain')
    await c.wait(1800)
    await c.click('[data-pres=verify]', () => c.stage.runChain('verify'))
    await c.until(() => Boolean(document.querySelector('[data-testid=chain-result]')), 40_000)
    await c.wait(5200)
  },
  async (c) => {
    c.say('Change one entry and the chain breaks', 'Here a recorded denial is rewritten into an approval, in a private copy. The check names the exact entry.', 'chain')
    await c.wait(1500)
    c.stage.runChain('tamper')
    await c.wait(1000)
    await c.until(() => document.querySelector('[data-testid=chain-result]')?.getAttribute('data-ok') === 'false', 40_000)
    await c.wait(5600)
  },
  async (c) => {
    c.stage.setCenterTab('think')
    c.say('An AI agent with a leash', "The rules live in Alice's pod. The guardian applies them, asks her about the exceptions, explains itself, and she can pull the plug at any moment.", null)
    await c.wait(6500)
  },
]

export function usePresenter(g: Guardian, stage: StageControls) {
  const [st, setSt] = useState<PresenterState>({ running: false, paused: false, finished: false, spot: null, step: 0, total: SCRIPT.length })
  const gRef = useRef(g)
  gRef.current = g
  const stageRef = useRef(stage)
  stageRef.current = stage
  const flags = useRef({ cancel: 0, paused: false, skip: false })
  const runId = useRef(0)

  const guard = () => {
    if (flags.current.cancel !== runId.current) throw new Cancelled()
  }

  const wait = useCallback(async (ms: number) => {
    let left = ms
    while (left > 0) {
      guard()
      if (flags.current.skip) {
        flags.current.skip = false
        return
      }
      if (flags.current.paused) {
        await sleep(120)
        continue
      }
      const d = Math.min(100, left)
      await sleep(d)
      left -= d
    }
  }, [])

  const stop = useCallback(() => {
    flags.current.cancel++
    setSt((s) => ({ ...s, running: false, paused: false, spot: null, cursor: undefined }))
  }, [])

  const start = useCallback(async () => {
    flags.current.cancel++
    const my = (runId.current = flags.current.cancel)
    flags.current.paused = false
    flags.current.skip = false
    setSt({ running: true, paused: false, finished: false, spot: null, step: 0, total: SCRIPT.length })
    const ctx: Ctx = {
      g: () => gRef.current,
      stage: stageRef.current,
      wait,
      say: (title, body, spot) => setSt((s) => ({ ...s, caption: { title, body }, spot })),
      until: async (cond, timeoutMs = 15_000) => {
        const t0 = Date.now()
        while (Date.now() - t0 < timeoutMs) {
          guard()
          if (cond()) return true
          if (flags.current.skip) {
            flags.current.skip = false
            return false
          }
          await sleep(150)
        }
        return false
      },
      click: async (selector, fallback) => {
        guard()
        const el = document.querySelector<HTMLElement>(selector)
        if (!el) return void fallback?.()
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        await sleep(250)
        const r = el.getBoundingClientRect()
        const x = r.left + r.width / 2
        const y = r.top + r.height / 2
        setSt((s) => ({ ...s, cursor: { x, y, tap: s.cursor?.tap ?? 0 } }))
        await wait(1000)
        setSt((s) => ({ ...s, cursor: { x, y, tap: (s.cursor?.tap ?? 0) + 1 } }))
        await wait(260)
        el.click()
        await wait(700)
        setSt((s) => ({ ...s, cursor: s.cursor ? { ...s.cursor, x: x + 80, y: y + 60 } : undefined }))
      },
    }
    try {
      for (let i = 0; i < SCRIPT.length; i++) {
        guard()
        setSt((s) => ({ ...s, step: i }))
        await SCRIPT[i](ctx)
      }
      if (flags.current.cancel === my) setSt((s) => ({ ...s, running: false, finished: true, cursor: undefined }))
    } catch (e) {
      if (!(e instanceof Cancelled)) {
        console.error('presenter', e)
        setSt((s) => ({ ...s, running: false, cursor: undefined }))
      }
    }
  }, [wait])

  const togglePause = useCallback(() => {
    flags.current.paused = !flags.current.paused
    setSt((s) => ({ ...s, paused: flags.current.paused }))
  }, [])
  const skip = useCallback(() => {
    flags.current.skip = true
  }, [])

  useEffect(() => () => void flags.current.cancel++, [])
  return { state: st, start, stop, togglePause, skip }
}
