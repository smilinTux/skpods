// Files the sample consent requests as the requesters themselves (each with its own DPoP token).
import { dpopFetchFor } from './dpop'
import { actor, webIdOf } from './seed'

export interface Filed {
  id: string
  subject: string
  requester: string
  status: string
}

async function post(broker: string, who: Awaited<ReturnType<typeof actor>>, body: unknown) {
  const f = dpopFetchFor(who, broker)
  const r = await f(`${broker}/requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j: any = await r.json().catch(() => ({}))
  if (r.status !== 201) throw new Error(`POST /requests failed: ${r.status} ${j.error ?? ''}`)
  return j
}

export async function fileSunriseRequest(broker: string, items = ['care_log', 'medication_schedule', 'financial_summary'], requestedDuration = '24h') {
  const care = await actor('care-facility')
  return post(broker, care, {
    requester: { webid: care.webId, name: 'Sunrise Care', kind: 'care_facility' },
    subject: webIdOf('dw-grandma'),
    purpose: 'Shift handover and today\'s care plan for Rosa Rivera, who joined our day programme this morning.',
    items: items.map((data_class) => ({ data_class })),
    requested_duration: requestedDuration,
    context: { booking_ref: 'SUN-2207' },
  })
}

export async function fileRequests(broker: string, log: (s: string) => void = () => {}): Promise<Filed[]> {
  const out: Filed[] = []
  const add = (r: any) => out.push({ id: r.id, subject: r.subject, requester: r.requester.name, status: r.status })

  const r1 = await fileSunriseRequest(broker)
  log(`Sunrise Care asked Grandma Rosa for 24h: ${r1.status}`)
  add(r1)

  const practitioner = await actor('practitioner')
  const r2 = await post(broker, practitioner, {
    requester: { webid: practitioner.webId, name: 'Bayview Family Clinic', kind: 'clinic' },
    subject: webIdOf('dw-kid'),
    purpose: 'Chart preparation for Theo\'s annual check-up tomorrow.',
    items: [{ data_class: 'allergies' }, { data_class: 'immunizations' }],
    requested_duration: '72h',
    context: { booking_ref: 'BAY-2031' },
  })
  log(`Bayview asked for Theo's record: ${r2.status}`)
  add(r2)

  const bob = await actor('bob')
  const r3 = await post(broker, bob, {
    requester: { webid: bob.webId, name: 'Maple Grove Elementary', kind: 'business' },
    subject: webIdOf('dw-kid'),
    purpose: 'Enrolment paperwork for the new school year.',
    items: [{ data_class: 'allergies' }, { data_class: 'home_address' }],
    requested_duration: '7d',
  })
  log(`Maple Grove asked for Theo's record: ${r3.status}`)
  add(r3)

  const r4 = await post(broker, practitioner, {
    requester: { webid: practitioner.webId, name: 'Bayview Family Clinic', kind: 'clinic' },
    subject: webIdOf('dw-alice'),
    purpose: 'Pre-visit intake for your annual check-up.',
    items: [{ data_class: 'dob' }, { data_class: 'insurance_member_id' }, { data_class: 'ssn' }],
    requested_duration: '72h',
    context: { booking_ref: 'BAY-1042' },
  })
  log(`Bayview asked Alice: ${r4.status}`)
  add(r4)
  return out
}
