import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PodStore, type SolidSession } from '@skpods/solid-web'
import { useToast } from '@skpods/ui'
import { money } from './format'
import type { Receipt } from './receipt'
import { addBusiness, loadBusinesses, loadReceipts, pathsFor, pendingInbox, resumeBusiness, setupWallet, stopBusiness, walletExists, type Business, type ReceiptCache, type Wallet } from './wallet'

export type Phase = 'loading' | 'setup' | 'ready' | 'error'

const POLL_MS = 7000

export function useWallet(session: SolidSession) {
  const { toast } = useToast()
  const store = useMemo(() => new PodStore(session.fetch), [session])
  const webId = session.webId!
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState<unknown>()
  const [wallet, setWallet] = useState<Wallet>()
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [busy, setBusy] = useState(false)
  const cache = useRef<ReceiptCache>(new Map())
  const loading = useRef(false)
  const walletRef = useRef<Wallet>()
  walletRef.current = wallet
  const businessesRef = useRef<Business[]>([])
  businessesRef.current = businesses

  const load = useCallback(
    async (w: Wallet, quiet = false) => {
      if (loading.current) return
      loading.current = true
      try {
        const bs = await loadBusinesses(store, w)
        setBusinesses(bs)
        const res = await loadReceipts(store, w, bs, cache.current, { file: true })
        setReceipts(res.receipts)
        if (quiet && res.filed.length) {
          const first = res.filed[0]
          toast({
            title: res.filed.length === 1 ? `New receipt from ${first.issuerName}` : `${res.filed.length} new receipts filed`,
            description: res.filed.length === 1 ? `${first.name}, ${money(first.total, first.currency)}. Kept in your archive.` : 'Moved from your inbox into your private archive.',
            tone: 'success',
          })
        }
      } finally {
        loading.current = false
      }
    },
    [store, toast],
  )

  // first load
  useEffect(() => {
    let dead = false
    ;(async () => {
      try {
        const storage = await store.storageRoot(webId)
        if (!storage) throw new Error('Your profile does not say where your pod storage is (pim:storage).')
        const paths = pathsFor(storage)
        const w: Wallet = { owner: webId, paths }
        if (dead) return
        setWallet(w)
        if (!(await walletExists(store, paths))) return setPhase('setup')
        await load(w)
        if (!dead) setPhase('ready')
      } catch (e) {
        if (!dead) {
          setError(e)
          setPhase('error')
        }
      }
    })()
    return () => {
      dead = true
    }
  }, [store, webId, load])

  // arrivals: poll the inboxes (no notifications on this engine), file what shows up
  useEffect(() => {
    if (phase !== 'ready') return
    const check = async () => {
      const w = walletRef.current
      if (!w || document.hidden || loading.current) return
      try {
        if ((await pendingInbox(store, w, businessesRef.current)) > 0) await load(w, true)
      } catch {
        /* next tick */
      }
    }
    const t = setInterval(check, POLL_MS)
    document.addEventListener('visibilitychange', check) // look straight away when the tab comes back
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', check)
    }
  }, [phase, store, load])

  const run = async <T,>(fn: () => Promise<T>, fail: string): Promise<T | undefined> => {
    setBusy(true)
    try {
      return await fn()
    } catch (e) {
      toast({ title: fail, description: (e as Error).message.slice(0, 180), tone: 'error', duration: 8000 })
    } finally {
      setBusy(false)
    }
  }

  return {
    store,
    phase,
    error,
    wallet,
    businesses,
    receipts,
    busy,
    refresh: () => wallet && run(() => load(wallet, false), 'Could not refresh'),
    setup: () =>
      run(async () => {
        const storage = (await store.storageRoot(webId))!
        const w = await setupWallet(store, webId, storage)
        setWallet(w)
        setPhase('ready')
        toast({ title: 'Your receipts wallet is ready', description: 'A private inbox and archive now exist in your pod.', tone: 'success' })
      }, 'Could not set up the wallet'),
    add: (input: { name: string; webId: string; category?: string }) =>
      run(async () => {
        const b = await addBusiness(store, wallet!, input)
        setBusinesses((l) => [...l.filter((x) => x.key !== b.key), b].sort((a, c) => a.name.localeCompare(c.name)))
        toast({ title: `${b.name} can now send receipts`, description: 'Append only: they can add, never read, change or delete.', tone: 'success' })
        return b
      }, 'Could not add the business'),
    stop: (b: Business) =>
      run(async () => {
        const n = await stopBusiness(store, wallet!, b)
        setBusinesses((l) => l.map((x) => (x.key === n.key ? n : x)))
        toast({ title: `${b.name} can no longer deliver`, description: 'Its append right is gone. Receipts already in your wallet stay yours.', tone: 'success' })
      }, 'Could not stop the business'),
    resume: (b: Business) =>
      run(async () => {
        const n = await resumeBusiness(store, wallet!, b)
        setBusinesses((l) => l.map((x) => (x.key === n.key ? n : x)))
        toast({ title: `${b.name} can deliver again`, tone: 'success' })
      }, 'Could not resume the business'),
  }
}

export type WalletApi = ReturnType<typeof useWallet>
