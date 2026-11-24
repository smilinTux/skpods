// A TypeScript twin of the guardian's rule engine (services/sk-consent/src/policy.rs), used to
// (1) replay a decision as a step by step trace for the thinking timeline and
// (2) turn the plain-language toggles of the policy editor into rules and back.
// The service decides. This code never does: it only explains, and the UI checks that its replay
// agrees with the service's rule id before it claims to have reproduced a decision.
import { CLASSES, CLASS_LABEL, KINDS, KIND_LABEL, KIND_ONE, type DataClass, type Kind } from '../config'
import type { Action, Policy, PolicyRule } from './types'

export type Mode = 'auto' | 'ask' | 'never'
export type Matrix = Record<string, Record<string, Mode>>
export type Durations = Record<string, string>

export interface Facts {
  requesterInProviders: boolean
  hasBooking: boolean
}

export function parseDuration(s?: string): number | undefined {
  if (!s) return undefined
  const t = s.trim()
  let m = t.match(/^(\d+)\s*([smhd])$/i)
  if (m) return Number(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2].toLowerCase() as 's' | 'm' | 'h' | 'd']
  m = t.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i)
  if (m && (m[1] || m[2] || m[3])) return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
  return /^\d+$/.test(t) ? Number(t) : undefined
}

export interface LocalDecision {
  action: Action
  durationS?: number
  ruleId?: string
}

export interface RuleCheck {
  label: string
  ok: boolean
}
export interface RuleStep {
  rule: PolicyRule
  state: 'skipped' | 'matched' | 'unreached'
  checks: RuleCheck[]
}
export interface Trace {
  steps: RuleStep[]
  matched?: PolicyRule
  decision: LocalDecision
}

export function ruleChecks(r: PolicyRule, dataClass: string, kind: string, f: Facts): RuleCheck[] {
  const checks: RuleCheck[] = [{ label: r.dataClasses.includes('*') ? 'any data class' : `data class is ${r.dataClasses.map((c) => CLASS_LABEL[c] ?? c).join(' or ')}`, ok: r.dataClasses.some((c) => c === '*' || c === dataClass) }]
  if (r.requesterKinds?.length) checks.push({ label: `requester is ${r.requesterKinds.map((k) => KIND_ONE[k] ?? k).join(' or ')}`, ok: r.requesterKinds.includes(kind) })
  if (r.when?.requesterInProviders) checks.push({ label: 'requester is on your providers list', ok: f.requesterInProviders })
  if (r.when?.hasBooking) checks.push({ label: 'a confirmed upcoming booking exists', ok: f.hasBooking })
  return checks
}

/** Same semantics as policy::evaluate: top to bottom, first match wins, no match means ask the owner. */
export function trace(p: Policy, dataClass: string, kind: string, f: Facts, requestedS?: number): Trace {
  const steps: RuleStep[] = []
  let matched: PolicyRule | undefined
  for (const r of p.rules) {
    if (matched) {
      steps.push({ rule: r, state: 'unreached', checks: [] })
      continue
    }
    const checks = ruleChecks(r, dataClass, kind, f)
    const ok = checks.every((c) => c.ok)
    steps.push({ rule: r, state: ok ? 'matched' : 'skipped', checks })
    if (ok) matched = r
  }
  if (!matched) return { steps, decision: { action: 'ask_owner' } }
  if (matched.action === 'approve') {
    const max = parseDuration(matched.maxDuration)
    const secs = requestedS !== undefined ? (max !== undefined ? Math.min(requestedS, max) : requestedS) : (max ?? 24 * 3600)
    return { steps, matched, decision: { action: 'approve', durationS: secs, ruleId: matched.id } }
  }
  return { steps, matched, decision: { action: matched.action, ruleId: matched.id } }
}

export const evaluate = (p: Policy, dataClass: string, kind: string, f: Facts, requestedS?: number): LocalDecision => trace(p, dataClass, kind, f, requestedS).decision

// ---------- matrix <-> rules ----------

const FULL: Facts = { requesterInProviders: true, hasBooking: true }

/** Read the toggles out of any policy by asking the engine what a known, booked requester would get. */
export function deriveMatrix(p: Policy): { matrix: Matrix; durations: Durations } {
  const matrix: Matrix = {}
  const durations: Durations = {}
  for (const c of CLASSES) {
    matrix[c] = {}
    for (const k of KINDS) {
      const d = evaluate(p, c, k, FULL)
      matrix[c][k] = d.action === 'approve' ? 'auto' : d.action === 'deny' ? 'never' : 'ask'
      if (d.action === 'approve' && d.durationS && !durations[c]) durations[c] = toDurationString(d.durationS)
    }
    durations[c] ??= '72h'
  }
  return { matrix, durations }
}

export function toDurationString(s: number): string {
  // Hours up to 72 (the editor offers 1h, 24h, 72h, 7d), days beyond that.
  if (s % 3600 === 0 && s <= 72 * 3600) return `${s / 3600}h`
  if (s % 86400 === 0) return `${s / 86400}d`
  if (s % 3600 === 0) return `${s / 3600}h`
  if (s % 60 === 0) return `${s / 60}m`
  return `${s}s`
}

export const DEFAULT_MATRIX: Matrix = Object.fromEntries(
  CLASSES.map((c) => [c, Object.fromEntries(KINDS.map((k) => [k, c === 'ssn' ? 'never' : c !== 'insurance_member_id' && k === 'clinic' ? 'auto' : 'ask']))]),
) as Matrix
export const DEFAULT_DURATIONS: Durations = { dob: '72h', allergies: '72h', medications: '72h', insurance_member_id: '24h', ssn: '24h' }

const DENY_SSN = 'A Social Security number is never shared through a consent request. Clinics rarely need it to book or treat a patient.'
const SSN_COUNTER = { dataClass: 'insurance_member_id', message: 'Ask for the insurance member ID instead. It covers billing and eligibility checks.' }
const INS_REASON = 'Your insurance member ID is financial data, so it needs your own tap.'
const INS_RECOMMEND = 'The clinic is one of your providers with an upcoming visit and billing needs the member ID. 24 hours is enough to check eligibility.'

const listKinds = (ks: string[]) => ks.map((k) => KIND_LABEL[k]?.toLowerCase() ?? k).join(', ')

/** Rules from toggles. The ordering (never, then auto, then ask) means the safest matching rule always wins. */
export function generateRules(m: Matrix, durations: Durations): PolicyRule[] {
  const rules: PolicyRule[] = []
  const kindsWith = (c: string, mode: Mode) => KINDS.filter((k) => m[c]?.[k] === mode) as string[]
  const filter = (ks: string[]) => (ks.length === KINDS.length ? undefined : ks)
  // never first, auto next, ask last
  for (const c of CLASSES) {
    const ks = kindsWith(c, 'never')
    if (!ks.length) continue
    rules.push({
      id: c === 'ssn' ? 'never-share-ssn' : `never-${c}`,
      dataClasses: [c],
      ...(filter(ks) ? { requesterKinds: ks } : {}),
      action: 'deny',
      reason: c === 'ssn' ? DENY_SSN : `Your rules say ${CLASS_LABEL[c].toLowerCase()} is never shared with ${listKinds(ks)}.`,
      ...(c === 'ssn' ? { counterOffer: SSN_COUNTER } : {}),
    })
  }
  for (const c of CLASSES) {
    const ks = kindsWith(c, 'auto')
    if (!ks.length) continue
    const max = durations[c] ?? '72h'
    if (ks.includes('clinic')) {
      rules.push({
        id: c === 'dob' || c === 'allergies' || c === 'medications' ? `auto-${c}-booked-provider` : `auto-${c}-clinic`,
        dataClasses: [c],
        requesterKinds: ['clinic'],
        when: { requesterInProviders: true, hasBooking: true },
        action: 'approve',
        maxDuration: max,
        reason: 'The clinic is one of your providers and has a confirmed upcoming booking with you.',
      })
    }
    const others = ks.filter((k) => k !== 'clinic')
    if (others.length) {
      rules.push({
        id: `auto-${c}-known`,
        dataClasses: [c],
        requesterKinds: others,
        when: { requesterInProviders: true },
        action: 'approve',
        maxDuration: max,
        reason: 'The requester is on your providers list and your rules allow this automatically.',
      })
    }
  }
  for (const c of CLASSES) {
    const ks = kindsWith(c, 'ask')
    if (!ks.length) continue
    const label = CLASS_LABEL[c].toLowerCase()
    rules.push({
      id: c === 'insurance_member_id' ? 'insurance-ask-owner' : `ask-${c}-known`,
      dataClasses: [c],
      ...(filter(ks) ? { requesterKinds: ks } : {}),
      when: { requesterInProviders: true },
      action: 'ask_owner',
      reason: c === 'insurance_member_id' ? INS_REASON : `Your ${label} needs your own tap.`,
      recommend: {
        action: 'approve',
        duration: '24h',
        reason: c === 'insurance_member_id' ? INS_RECOMMEND : `The requester is one of your providers. 24 hours is usually enough for ${label}.`,
      },
    })
    rules.push({
      id: `ask-${c}-stranger`,
      dataClasses: [c],
      ...(filter(ks) ? { requesterKinds: ks } : {}),
      action: 'ask_owner',
      reason: `Your ${label} needs your own tap.`,
      recommend: { action: 'deny', reason: 'This requester is not on your providers list, so I would decline unless you know them.' },
    })
  }
  // An auto cell whose conditions are not met (no booking, unknown requester) falls back to asking, with a reason that says why.
  for (const c of CLASSES) {
    const ks = kindsWith(c, 'auto')
    if (!ks.length) continue
    rules.push({
      id: `ask-${c}-conditions`,
      dataClasses: [c],
      ...(filter(ks) ? { requesterKinds: ks } : {}),
      action: 'ask_owner',
      reason: 'Your rules share this automatically only with a known provider (and, for a clinic, a booked appointment). This request does not meet that, so you decide.',
      recommend: { action: 'deny', reason: 'The usual conditions are not met: I would decline unless you recognise this requester.' },
    })
  }
  return rules
}

export function buildPolicy(base: Policy, m: Matrix, durations: Durations): Policy {
  return { ...base, '@context': base['@context'] ?? { '@vocab': 'https://w3id.org/skpods/v1#' }, '@type': 'GuardianPolicy', version: (base.version ?? 0) + 1, rules: generateRules(m, durations) }
}

// ---------- plain language ----------

const dur = (d?: string) => {
  const s = parseDuration(d)
  if (s === undefined) return '72 hours'
  if (s % 86400 === 0) return s === 86400 ? '24 hours' : `${s / 86400} days`
  if (s % 3600 === 0) return `${s / 3600} hours`
  return `${Math.round(s / 60)} minutes`
}

export function plainWords(m: Matrix, durations: Durations): { cls: DataClass; text: string }[] {
  const out: { cls: DataClass; text: string }[] = []
  for (const c of CLASSES) {
    const label = CLASS_LABEL[c]
    const by = (mode: Mode) => KINDS.filter((k) => m[c][k] === mode) as Kind[]
    const parts: string[] = []
    const auto = by('auto')
    const ask = by('ask')
    const never = by('never')
    if (auto.length) {
      const needs = auto.includes('clinic') ? ' (they must be on your providers list, and a clinic needs a booked appointment)' : ' (they must be on your providers list)'
      parts.push(`${listKinds(auto)} get it automatically for up to ${dur(durations[c])}${needs}`)
    }
    if (ask.length) parts.push(ask.length === KINDS.length ? 'everyone has to ask you first' : `${listKinds(ask)} have to ask you first`)
    if (never.length) parts.push(never.length === KINDS.length ? 'nobody gets it' : `${listKinds(never)} never get it`)
    const text = parts.join('; ')
    out.push({ cls: c, text: `${label}: ${text.charAt(0).toUpperCase() + text.slice(1)}.` })
  }
  return out
}

export function matrixEqual(a: Matrix, b: Matrix, da: Durations, db: Durations): boolean {
  for (const c of CLASSES) {
    for (const k of KINDS) if (a[c][k] !== b[c][k]) return false
    if (KINDS.some((k) => a[c][k] === 'auto') && da[c] !== db[c]) return false
  }
  return true
}
