import { NS, PodStore, all, iri, one, parseTurtle, rdfType } from '@skpods/solid-web'
import type { Store } from 'n3'
import { CLINIC_NAME } from '../config'
import type { Policy } from './types'

export interface ProviderLink {
  url: string
  name: string
  webid: string
  active: boolean
}
export interface Booking {
  url: string
  ref: string
  name: string
  provider: string
  start: string
  end: string
  confirmed: boolean
}
export interface PodFacts {
  providers: ProviderLink[]
  booking?: Booking
}

const SKP = NS.skp
const SCHEMA = NS.schema

const subjectsOf = (s: Store, cls: string) => s.getSubjects(iri(rdfType), iri(cls), null).map((t) => t.value)

export async function loadFacts(store: PodStore, root: string): Promise<PodFacts> {
  const providers: ProviderLink[] = []
  for (const e of await store.list(`${root}skpods/v1/providers/`).catch(() => [])) {
    if (e.isContainer) continue
    const g = await store.getTurtle(e.url).catch(() => undefined)
    if (!g) continue
    for (const sub of subjectsOf(g, SKP + 'ProviderLink')) {
      providers.push({ url: e.url, name: one(g, sub, SCHEMA + 'name') ?? 'Provider', webid: one(g, sub, SKP + 'provider') ?? '', active: (one(g, sub, SKP + 'status') ?? '').endsWith('Active') })
    }
  }
  let booking: Booking | undefined
  for (const e of await store.list(`${root}skpods/v1/bookings/`).catch(() => [])) {
    if (e.isContainer) continue
    const g = await store.getTurtle(e.url).catch(() => undefined)
    if (!g) continue
    for (const sub of subjectsOf(g, SCHEMA + 'Reservation')) {
      const b: Booking = {
        url: e.url,
        ref: one(g, sub, SCHEMA + 'identifier') ?? '',
        name: one(g, sub, SCHEMA + 'name') ?? 'Appointment',
        provider: one(g, sub, SCHEMA + 'provider') ?? '',
        start: one(g, sub, SCHEMA + 'startTime') ?? '',
        end: one(g, sub, SCHEMA + 'endTime') ?? '',
        confirmed: (one(g, sub, SCHEMA + 'reservationStatus') ?? '').endsWith('ReservationConfirmed'),
      }
      if (!booking || b.start > booking.start) booking = b
    }
  }
  return { providers, booking }
}

export const policyUrl = (root: string) => `${root}skpods/v1/consents/policy.jsonld`

export async function loadPolicyDoc(store: PodStore, root: string): Promise<Policy | undefined> {
  const r = await store.get(policyUrl(root), 'application/ld+json')
  return r ? (JSON.parse(r.text) as Policy) : undefined
}

export async function savePolicyDoc(store: PodStore, root: string, p: Policy): Promise<void> {
  await store.put(policyUrl(root), JSON.stringify(p, null, 2), 'application/ld+json')
}

/**
 * The demo booking starts 20 hours after seeding, so it goes stale. Alice owns her pod, so the app can move it:
 * same file and shape that `sk-consent seed-demo` writes (schema:Reservation, confirmed).
 */
export async function refreshBooking(store: PodStore, root: string, subject: string, clinicWebId: string): Promise<void> {
  const start = new Date(Date.now() + 20 * 3600_000)
  const end = new Date(start.getTime() + 3600_000)
  const ttl = `@prefix skp: <${SKP}> .
@prefix schema: <${SCHEMA}> .
@prefix xsd: <${NS.xsd}> .
# FAKE DATA for a test account. Never put real people here.
<#booking> a schema:Reservation ;
  schema:identifier "BAY-1042" ;
  schema:name "Annual check-up at ${CLINIC_NAME}" ;
  schema:provider <${clinicWebId}> ;
  schema:underName <${subject}> ;
  schema:startTime "${start.toISOString()}"^^xsd:dateTime ;
  schema:endTime "${end.toISOString()}"^^xsd:dateTime ;
  schema:reservationStatus schema:ReservationConfirmed .
`
  await store.put(`${root}skpods/v1/bookings/booking-bayview-1042.ttl`, ttl, 'text/turtle')
}

// ---------- what the clinic received, as people read it ----------
export interface ReceivedValue {
  label: string
  value: string
}

const P = {
  dob: SCHEMA + 'birthDate',
  allergen: SKP + 'allergen',
  medication: SKP + 'medication',
  insurer: SKP + 'insurer',
  memberId: SKP + 'memberId',
}

export function receivedValues(dataClass: string, text: string, resource: string): ReceivedValue[] {
  try {
    const g = parseTurtle(text, resource)
    const it = `${resource}#it`
    switch (dataClass) {
      case 'dob':
        return all(g, it, P.dob).map((v) => ({ label: 'Born', value: new Date(v + 'T12:00:00Z').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) }))
      case 'allergies':
        return all(g, it, P.allergen).map((v) => ({ label: 'Allergic to', value: v }))
      case 'medications':
        return all(g, it, P.medication).map((v) => ({ label: 'Taking', value: v }))
      case 'insurance_member_id':
        return [...all(g, it, P.insurer).map((v) => ({ label: 'Insurer', value: v })), ...all(g, it, P.memberId).map((v) => ({ label: 'Member ID', value: v }))]
      default:
        return []
    }
  } catch {
    return [{ label: 'Received', value: '(could not parse)' }]
  }
}
