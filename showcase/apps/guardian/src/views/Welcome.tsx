import { PodSignIn, ThemeToggle } from '@skpods/ui'
import type { SolidSession } from '@skpods/solid-web'
import { BrandMark } from '@skpods/ui'
import { BoltIcon, ClockIcon, LinkIcon, ShieldIcon } from '../ui'

const STEPS = [
  { icon: <BoltIcon size={20} />, title: 'Rules, not vibes', body: 'You write plain-language rules in your own pod: auto, ask me, or never, per kind of data and kind of requester.' },
  { icon: <ClockIcon size={20} />, title: 'Asks you only when it matters', body: 'Routine requests are handled in seconds. Anything sensitive reaches your phone with a recommendation and the reasoning.' },
  { icon: <LinkIcon size={20} />, title: 'Provable afterwards', body: 'Every ask, decision and read goes into a hash chain you can verify yourself. One red button ends everything.' },
]

export function Welcome({ session }: { session: SolidSession }) {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_34rem_at_50%_0%,rgb(var(--skp-brand)/.22),transparent_70%)]" aria-hidden />
      <header className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-4">
        <BrandMark /> <span className="text-sm font-semibold tracking-tight">SKPods Guardian</span>
        <span className="ml-auto"><ThemeToggle /></span>
      </header>
      <main className="mx-auto max-w-6xl px-5 pb-16 pt-6 sm:pt-14">
        <div className="grid items-center gap-10 lg:grid-cols-[1.15fr_.85fr]">
          <div className="animate-fade-up">
            <p className="inline-flex items-center gap-2 rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand"><ShieldIcon size={14} /> Showcase on SKPods</p>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">An AI agent<br />with a <span className="bg-gradient-to-r from-teal-300 to-amber-300 bg-clip-text text-transparent">leash.</span></h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg">A clinic asks for Alice's date of birth, allergies, medications, insurance ID and SSN. Her guardian answers in seconds, by rules stored in her own pod: yes to some, a tap for one, a firm no to the last.</p>
            <ul className="mt-6 flex flex-wrap gap-2 text-xs text-muted">
              {['Solid-OIDC login', 'WAC grants that expire', 'Hash-chained audit', 'Rules decide, the LLM only explains'].map((t) => <li key={t} className="rounded-full border border-line bg-surface/70 px-3 py-1">{t}</li>)}
            </ul>
          </div>
          <div className="relative mx-auto w-full max-w-sm animate-fade-up">
            <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-brand/10 blur-2xl" aria-hidden />
            <div className="skp-card space-y-4 p-6 shadow-glow">
              <div className="relative mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-teal-700 text-white shadow-glow">
                <span className="ring" /><span className="ring" style={{ animationDelay: '1.2s' }} /><ShieldIcon size={38} />
              </div>
              <div className="text-center">
                <h2 className="text-lg font-bold">Sign in as Alice</h2>
                <p className="mt-1 text-sm text-muted">This demo runs against a Solid server holding fake data only.</p>
              </div>
              <PodSignIn session={session} />
            </div>
          </div>
        </div>
        <div className="mt-16 grid gap-4 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className="skp-card p-5 animate-fade-up" style={{ animationDelay: `${i * 90}ms` }}>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/15 text-brand">{s.icon}</span>
              <h3 className="mt-3 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
