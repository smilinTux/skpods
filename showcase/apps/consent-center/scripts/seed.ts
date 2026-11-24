// Seeds fake data for the Consent Center story into the dw-* test pods, using each account's own client
// credentials (agent flow). Idempotent: every run rewrites the same resources. Never put real data here.
import { agentLogin, type AgentSession } from '@skpods/solid-web/node'
import { PodStore, ownerRule, writeAcl, type AclRule, type AccessMode } from '@skpods/solid-web'

export const BASE = (process.env.SKPODS_BASE ?? 'https://pods-dev.skstack01.douno.it').replace(/\/$/, '')
export const webIdOf = (user: string) => `${BASE}/apps/solid/~${user}/profile/card#me`
export const rootOf = (user: string) => `${BASE}/apps/solid/~${user}/storage/`
export const AGENT_WEBID = process.env.SKCONSENT_AGENT_WEBID ?? webIdOf('dw-agent')

export interface Actor {
  user: string
  webId: string
  root: string
  store: PodStore
  fetch: typeof fetch
  session: AgentSession
}

/** Log in as a test account with the client credentials minted for it (DW_<NAME>_CLIENT_ID / _SECRET). */
export async function actor(name: 'alice' | 'grandma' | 'kid' | 'bob' | 'practitioner' | 'care-facility'): Promise<Actor> {
  const k = name.toUpperCase().replace('-', '_')
  const id = process.env[`DW_${k}_CLIENT_ID`]
  const secret = process.env[`DW_${k}_CLIENT_SECRET`]
  if (!id || !secret) throw new Error(`DW_${k}_CLIENT_ID and DW_${k}_CLIENT_SECRET are not set (source the minted credentials file)`)
  const s = await agentLogin({ issuer: BASE, clientId: id, clientSecret: secret })
  const user = `dw-${name}`
  return { user, webId: s.webId || webIdOf(user), root: rootOf(user), store: new PodStore(s.fetch), fetch: s.fetch, session: s }
}

const P = [
  '@prefix skp: <https://w3id.org/skpods/v1#> .',
  '@prefix schema: <http://schema.org/> .',
  '@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .',
  '# FAKE DATA for a test account. Never put real people here.',
  '',
].join('\n')

const dt = (d: Date) => `"${d.toISOString().replace(/\.\d+Z$/, 'Z')}"^^xsd:dateTime`
const q = (s: string) => JSON.stringify(s)
const ago = (h: number) => new Date(Date.now() - h * 3600_000)
const ahead = (h: number) => new Date(Date.now() + h * 3600_000)

function rule(id: string, agent: string, modes: AccessMode[], target: string, container: boolean): AclRule {
  return { id, agents: [agent], agentClasses: [], agentGroups: [], modes, accessTo: [target], defaultFor: container ? [target] : [] }
}

/** Container ACL: owner full, the guardian agent Read+Control (so it can write grant ACLs), the delegate as given. */
async function containerAcl(a: Actor, container: string, opts: { agent: AccessMode[]; delegate?: { webId: string; modes: AccessMode[] } }) {
  const rules: AclRule[] = [ownerRule(a.webId, container, true)]
  if (opts.agent.length) rules.push(rule('guardian', AGENT_WEBID, opts.agent, container, true))
  if (opts.delegate) rules.push(rule('delegate', opts.delegate.webId, opts.delegate.modes, container, true))
  await writeAcl(a.store, `${container}.acl`, rules, a.webId)
}

async function ownerOnly(a: Actor, resource: string) {
  await writeAcl(a.store, `${resource}.acl`, [ownerRule(a.webId, resource, false)], a.webId)
}

export interface Person {
  user: string
  name: string
  short: string
  role: 'attorney' | 'parent'
}
export const PEOPLE: Person[] = [
  { user: 'dw-grandma', name: 'Rosa Rivera', short: 'Grandma Rosa', role: 'attorney' },
  { user: 'dw-kid', name: 'Theo Rivera', short: 'Theo', role: 'parent' },
]

function policy(owner: string, approver: string, managed: string[], catalog: Record<string, [string, string]>, rules: unknown[]) {
  return JSON.stringify(
    {
      '@context': { '@vocab': 'https://w3id.org/skpods/v1#' },
      '@type': 'GuardianPolicy',
      version: 1,
      owner,
      agent: AGENT_WEBID,
      approvers: [approver],
      managedContainers: managed,
      catalog: Object.fromEntries(Object.entries(catalog).map(([k, [path, label]]) => [k, { path, label }])),
      ceiling: '30d',
      rules,
    },
    null,
    2,
  )
}

export async function seedGrandma(g: Actor, aliceWebId: string, sunriseWebId: string) {
  const v1 = `${g.root}skpods/v1/`
  const care = `${v1}care/`
  const put = (path: string, body: string, ct = 'text/turtle') => g.store.put(`${v1}${path}`, body, ct)

  const entries: Array<[number, string, string, string]> = [
    [1.5, 'meal', 'Marcus T. (care aide)', 'Ate most of lunch, soup and bread. Drank two glasses of water. In good spirits, asked about the garden.'],
    [4, 'mobility', 'Priya N. (nurse)', 'Walked to the dayroom with the frame and no rest stops. Steady. Reminded to use the call button before standing.'],
    [9, 'sleep', 'Priya N. (nurse)', 'Slept well, up once at 3 am for the bathroom. No confusion on waking.'],
    [18, 'medication', 'Marcus T. (care aide)', 'Evening tablets taken with water. No nausea reported.'],
    [26, 'mood', 'Dana K. (activities)', 'Joined the afternoon music hour and sang along. Chatted with a neighbour about her grandchildren.'],
    [32, 'meal', 'Marcus T. (care aide)', 'Small dinner, left the vegetables. Asked for tea with honey, which she enjoyed.'],
    [50, 'health', 'Priya N. (nurse)', 'Blood pressure within her usual range. Feet checked, no sore spots. Moisturiser applied.'],
    [58, 'mood', 'Dana K. (activities)', 'Quiet morning. Looked at family photos Alice brought in and told two stories about the old house.'],
  ]
  const log = entries
    .map(([h, cat, who, text], i) => `<#e${i + 1}> a skp:CareLogEntry ;\n  schema:dateCreated ${dt(ago(h))} ;\n  skp:category ${q(cat)} ;\n  schema:author ${q(who)} ;\n  schema:text ${q(text)} .\n`)
    .join('\n')
  await put('care/care-log.ttl', `${P}<> schema:name "Care log: Rosa Rivera" ;\n  skp:dataClass "care_log" .\n\n${log}`)
  await put(
    'care/medication-schedule.ttl',
    `${P}<#it> a skp:HealthRecord ;\n  skp:dataClass "medication_schedule" ;\n  schema:name "Rosa Rivera" ;\n  skp:medication "Amlodipine 5 mg, morning", "Vitamin D 1000 IU, with lunch", "Melatonin 2 mg, bedtime" .\n`,
  )
  await put(
    'care/family-contacts.ttl',
    `${P}<#alice> a schema:Person ;\n  schema:name "Alice Rivera" ;\n  schema:description "Daughter and attorney-in-fact. First call for anything." ;\n  schema:telephone "+1-555-0100" .\n`,
  )
  await put('care/financial-summary.ttl', `${P}<#it> a skp:HealthRecord ;\n  skp:dataClass "financial_summary" ;\n  schema:description "Pension and account summary (fake)." .\n`)
  await ownerOnly(g, `${care}financial-summary.ttl`)
  await put(
    'care/poa/attorney-in-fact.ttl',
    `${P}<#it> a skp:Delegation ;\n  skp:principal <${g.webId}> ;\n  skp:delegate <${aliceWebId}> ;\n  skp:role skp:AttorneyInFact ;\n  skp:reference "POA-2025-0412 (fictional)" ;\n  skp:validFrom ${dt(new Date('2025-04-12T00:00:00Z'))} .\n`,
  )
  await put(
    'providers/sunrise-care.ttl',
    `${P}<#link> a skp:ProviderLink ;\n  schema:name "Sunrise Care" ;\n  skp:client <${g.webId}> ;\n  skp:provider <${sunriseWebId}> ;\n  skp:since ${dt(new Date('2026-02-01T09:00:00Z'))} ;\n  skp:status skp:Active .\n`,
  )
  await put(
    'bookings/booking-sunrise-2207.ttl',
    `${P}<#booking> a schema:Reservation ;\n  schema:identifier "SUN-2207" ;\n  schema:name "Assisted-living day programme at Sunrise Care" ;\n  schema:provider <${sunriseWebId}> ;\n  schema:underName <${g.webId}> ;\n  schema:startTime ${dt(ago(2))} ;\n  schema:endTime ${dt(ahead(6))} ;\n  schema:reservationStatus schema:ReservationConfirmed .\n`,
  )
  await containerAcl(g, care, { agent: ['Read', 'Control'], delegate: { webId: aliceWebId, modes: ['Read', 'Write', 'Control'] } })
  for (const c of ['providers', 'bookings']) await containerAcl(g, `${v1}${c}/`, { agent: ['Read'], delegate: { webId: aliceWebId, modes: ['Read', 'Control'] } })
  await containerAcl(g, `${v1}consents/`, { agent: ['Read', 'Write', 'Control'], delegate: { webId: aliceWebId, modes: ['Read', 'Control'] } })
  await put(
    'consents/policy.jsonld',
    policy(
      g.webId,
      aliceWebId,
      ['skpods/v1/care/'],
      {
        care_log: ['skpods/v1/care/care-log.ttl', 'Care log'],
        medication_schedule: ['skpods/v1/care/medication-schedule.ttl', 'Medication schedule'],
        family_contacts: ['skpods/v1/care/family-contacts.ttl', 'Family contacts'],
        financial_summary: ['skpods/v1/care/financial-summary.ttl', 'Finances'],
      },
      [
        {
          id: 'never-share-finances',
          dataClasses: ['financial_summary'],
          action: 'deny',
          reason: 'Finances are never shared with a care provider. Billing questions go to the family.',
          counterOffer: { dataClass: 'family_contacts', message: 'Ask for the family contact list instead, so billing can reach Alice directly.' },
        },
        {
          id: 'care-facility-asks-family',
          dataClasses: ['care_log', 'medication_schedule'],
          requesterKinds: ['care_facility'],
          when: { requesterInProviders: true },
          action: 'ask_owner',
          reason: 'Care records are only opened for a short time, and a family member decides.',
          recommend: {
            action: 'approve',
            duration: '24h',
            reason: 'Sunrise Care is her current care facility and has a confirmed booking today. 24 hours covers the shift handover.',
          },
        },
        {
          id: 'family-contacts-ask-family',
          dataClasses: ['family_contacts'],
          action: 'ask_owner',
          reason: 'Contact details of family members need a family decision.',
        },
      ],
    ),
    'application/ld+json',
  )
}

export async function seedKid(k: Actor, aliceWebId: string, clinicWebId: string) {
  const v1 = `${k.root}skpods/v1/`
  const health = `${v1}health/`
  const put = (path: string, body: string, ct = 'text/turtle') => k.store.put(`${v1}${path}`, body, ct)
  await put('health/allergies.ttl', `${P}<#it> a skp:HealthRecord ;\n  skp:dataClass "allergies" ;\n  schema:name "Theo Rivera" ;\n  skp:allergen "Tree nuts", "Bee stings" .\n`)
  await put('health/immunizations.ttl', `${P}<#it> a skp:HealthRecord ;\n  skp:dataClass "immunizations" ;\n  schema:name "Theo Rivera" ;\n  skp:immunization "MMR (2 doses)", "DTaP (5 doses)", "Varicella (2 doses)" .\n`)
  await put('health/home-address.ttl', `${P}<#it> a skp:HealthRecord ;\n  skp:dataClass "home_address" ;\n  schema:address "12 Harbour Lane, Springfield (fictional)" .\n`)
  await ownerOnly(k, `${health}home-address.ttl`)
  await put(
    'providers/bayview-family-clinic.ttl',
    `${P}<#link> a skp:ProviderLink ;\n  schema:name "Bayview Family Clinic" ;\n  skp:client <${k.webId}> ;\n  skp:provider <${clinicWebId}> ;\n  skp:since ${dt(new Date('2026-03-01T09:00:00Z'))} ;\n  skp:status skp:Active .\n`,
  )
  await put(
    'bookings/booking-bayview-2031.ttl',
    `${P}<#booking> a schema:Reservation ;\n  schema:identifier "BAY-2031" ;\n  schema:name "Annual check-up at Bayview Family Clinic" ;\n  schema:provider <${clinicWebId}> ;\n  schema:underName <${k.webId}> ;\n  schema:startTime ${dt(ahead(18))} ;\n  schema:endTime ${dt(ahead(19))} ;\n  schema:reservationStatus schema:ReservationConfirmed .\n`,
  )
  await put(
    'delegations/alice.ttl',
    `${P}<#it> a skp:Delegation ;\n  skp:principal <${k.webId}> ;\n  skp:delegate <${aliceWebId}> ;\n  skp:role skp:Parent ;\n  skp:validUntil ${dt(new Date('2034-06-01T00:00:00Z'))} .\n`,
  )
  await containerAcl(k, health, { agent: ['Read', 'Control'], delegate: { webId: aliceWebId, modes: ['Read', 'Write', 'Control'] } })
  await containerAcl(k, `${v1}delegations/`, { agent: [], delegate: { webId: aliceWebId, modes: ['Read', 'Control'] } })
  for (const c of ['providers', 'bookings']) await containerAcl(k, `${v1}${c}/`, { agent: ['Read'], delegate: { webId: aliceWebId, modes: ['Read', 'Control'] } })
  await containerAcl(k, `${v1}consents/`, { agent: ['Read', 'Write', 'Control'], delegate: { webId: aliceWebId, modes: ['Read', 'Control'] } })
  await put(
    'consents/policy.jsonld',
    policy(
      k.webId,
      aliceWebId,
      ['skpods/v1/health/'],
      {
        allergies: ['skpods/v1/health/allergies.ttl', 'Allergies'],
        immunizations: ['skpods/v1/health/immunizations.ttl', 'Immunization record'],
        home_address: ['skpods/v1/health/home-address.ttl', 'Home address'],
      },
      [
        {
          id: 'never-share-address',
          dataClasses: ['home_address'],
          action: 'deny',
          reason: 'A home address is not shared through a consent request. Parents confirm it in person.',
          counterOffer: { dataClass: 'immunizations', message: 'A school only needs the immunization record to enrol. Ask for that instead.' },
        },
        {
          id: 'booked-clinic-allergies',
          dataClasses: ['allergies'],
          requesterKinds: ['clinic'],
          when: { requesterInProviders: true, hasBooking: true },
          action: 'approve',
          maxDuration: '72h',
          reason: 'Bayview is Theo\'s pediatric clinic and has a confirmed visit.',
        },
        {
          id: 'immunizations-ask-parent',
          dataClasses: ['immunizations'],
          requesterKinds: ['clinic'],
          when: { requesterInProviders: true },
          action: 'ask_owner',
          reason: 'A child\'s medical record is opened by a parent.',
          recommend: { action: 'approve', duration: '24h', reason: 'The clinic is his provider and the visit is tomorrow. 24 hours is enough to prepare the chart.' },
        },
      ],
    ),
    'application/ld+json',
  )
}

/** Alice's pod: who she acts for. The app reads these to know which people to show. */
export async function seedDelegations(a: Actor) {
  const root = a.root
  for (const p of PEOPLE) {
    const principal = webIdOf(p.user)
    await a.store.put(
      `${root}skpods/v1/delegations/${p.user}.ttl`,
      `${P}<#it> a skp:Delegation ;\n  skp:principal <${principal}> ;\n  skp:delegate <${a.webId}> ;\n  skp:role ${p.role === 'attorney' ? 'skp:AttorneyInFact' : 'skp:Parent'} ;\n  schema:name ${q(p.name)} ;\n  schema:alternateName ${q(p.short)} .\n`,
    )
  }
}
