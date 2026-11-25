import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import {
  DEFAULT_ISSUER,
  DEFAULT_PROVIDER_NAME,
  PodLookupError,
  accountDisplayName,
  fetchProfile,
  forgetAccount,
  listAccounts,
  rememberAccount,
  resolvePodInput,
  type RememberedAccount,
  type SolidSession,
} from '@skpods/solid-web'
import { Avatar } from './Avatar'
import { BrandMark } from './AppShell'
import { Button } from './Button'
import { ErrorState } from './States'
import { cx } from './cx'

export interface PodSignInProps {
  session: SolidSession
  /** Where the big button signs in. Defaults to the shared DEFAULT_ISSUER. */
  defaultIssuer?: string
  /** Shown on the big button: "Sign in with <providerName>". */
  providerName?: string
  /** How many remembered accounts to offer above the big button. */
  maxAccounts?: number
  className?: string
}

const SIGN_IN_TROUBLE = "We couldn't reach the sign-in page for that pod. Try again in a moment, or sign in with skpods.id."

const hostOf = (u: string) => {
  try {
    return new URL(u).host
  } catch {
    return u
  }
}

/**
 * The one sign-in block every showcase app uses: remembered accounts ("Continue as ..."), a big
 * "Sign in with skpods.id" button, and a quiet "Use a different pod" field that accepts a WebID, a handle or a
 * server address. Remember accounts after sign-in with `useRememberAccount(session)`.
 */
export function PodSignIn({ session, defaultIssuer = DEFAULT_ISSUER, providerName = DEFAULT_PROVIDER_NAME, maxAccounts = 3, className }: PodSignInProps) {
  const [accounts, setAccounts] = useState<RememberedAccount[]>(() => listAccounts())
  const [busy, setBusy] = useState<string>()
  const [err, setErr] = useState<{ text: string; inForm: boolean }>()
  const [other, setOther] = useState(false)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const ids = useId()
  const panelId = `${ids}-other`
  const hintId = `${ids}-hint`
  const errId = `${ids}-err`
  const expired = session.state === 'expired'

  useEffect(() => {
    if (other) inputRef.current?.focus()
  }, [other])

  const signIn = async (key: string, issuer: string) => {
    setBusy(key)
    setErr(undefined)
    try {
      await session.login(issuer) // redirects on success
    } catch (e) {
      console.warn('sign-in failed', e)
      setErr({ text: SIGN_IN_TROUBLE, inForm: key === 'other' })
      setBusy(undefined)
    }
  }

  const submitOther = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('other')
    setErr(undefined)
    try {
      const found = await resolvePodInput(value)
      await signIn('other', found.issuer)
    } catch (e) {
      setErr({ text: e instanceof PodLookupError ? e.message : SIGN_IN_TROUBLE, inForm: true })
      setBusy(undefined)
    }
  }

  const forget = (a: RememberedAccount) => setAccounts(forgetAccount(a.webId))
  const shown = accounts.slice(0, maxAccounts)

  return (
    <div className={cx('space-y-3 text-left', className)}>
      {expired && <p role="status" className="rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">Your session ended. Sign in again to continue.</p>}
      {session.error && !expired && <ErrorState title="Sign-in problem" error={session.error} />}

      {shown.length > 0 && (
        <ul className="space-y-2" aria-label="Accounts on this device" data-testid="remembered-accounts">
          {shown.map((a) => {
            const name = accountDisplayName(a)
            return (
              <li key={a.webId} className="flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={() => signIn(a.webId, a.issuer)}
                  disabled={Boolean(busy)}
                  aria-busy={busy === a.webId || undefined}
                  data-testid="continue-as"
                  className="flex min-h-[3.5rem] min-w-0 flex-1 items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2 text-left transition hover:border-brand/60 disabled:opacity-50"
                >
                  <Avatar name={name} seed={a.webId} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">Continue as {name}</span>
                    <span className="block truncate text-xs text-muted">{hostOf(a.webId)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => forget(a)}
                  disabled={Boolean(busy)}
                  aria-label={`Forget ${name} on this device`}
                  title="Forget on this device"
                  data-testid="forget-account"
                  className="flex w-11 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink disabled:opacity-50"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <Button
        className="min-h-[3.75rem] w-full !rounded-2xl !py-4 !text-base sm:!text-lg"
        loading={busy === 'default'}
        disabled={Boolean(busy) && busy !== 'default'}
        onClick={() => signIn('default', defaultIssuer)}
        data-testid="login"
      >
        {busy !== 'default' && <BrandMark size={26} />}
        Sign in with {providerName}
      </Button>

      {err && !err.inForm && <p role="alert" className="text-sm text-danger" data-testid="sign-in-error">{err.text}</p>}

      <div className="text-center">
        <button
          type="button"
          onClick={() => {
            setOther((o) => !o)
            setErr(undefined)
          }}
          aria-expanded={other}
          aria-controls={panelId}
          data-testid="use-other-pod"
          className="rounded-lg px-2 py-2 text-sm font-medium text-muted underline-offset-4 transition hover:text-ink hover:underline"
        >
          {other ? 'Never mind' : 'Use a different pod'}
        </button>
      </div>

      {other && (
        <form id={panelId} onSubmit={submitOther} className="space-y-2 animate-fade-up" noValidate>
          <label htmlFor={`${ids}-input`} className="block text-sm font-medium">
            Your pod, handle or WebID
          </label>
          <input
            ref={inputRef}
            id={`${ids}-input`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="alex@pods.example.com"
            className="w-full rounded-xl border border-line bg-surface-2 px-3 py-3 text-base text-ink"
            type="text"
            inputMode="url"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby={err?.inForm ? `${hintId} ${errId}` : hintId}
            aria-invalid={err?.inForm ? true : undefined}
            data-testid="pod-address"
          />
          <p id={hintId} className="text-xs text-muted">
            Whatever you know works: a handle like alex@pods.example.com, your server like pods.example.com, or your full WebID.
          </p>
          {err?.inForm && <p id={errId} role="alert" className="text-sm text-danger" data-testid="pod-address-error">{err.text}</p>}
          <Button type="submit" variant="secondary" className="w-full !py-3" loading={busy === 'other'} disabled={Boolean(busy) && busy !== 'other'} data-testid="pod-address-continue">
            Continue
          </Button>
        </form>
      )}
    </div>
  )
}

/**
 * Remember the signed-in account on this device (WebID, where it signs in, profile name) so the next visit can
 * offer "Continue as ...". Call once near the top of the app with the current session.
 */
export function useRememberAccount(session: SolidSession | undefined) {
  const webId = session?.state === 'active' ? session.webId : undefined
  const issuer = session?.issuer
  useEffect(() => {
    if (!webId || !issuer) return
    let live = true
    rememberAccount({ webId, issuer })
    fetchProfile(webId).then((p) => {
      if (live && p?.name) rememberAccount({ webId, issuer, name: p.name })
    })
    return () => {
      live = false
    }
  }, [webId, issuer])
}
