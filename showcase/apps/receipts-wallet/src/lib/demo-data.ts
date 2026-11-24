// Fake businesses and fake receipts for the demo seed and the console presets. Everything here is invented.
// pods-dev only has a handful of test accounts, so the plumber and the pharmacy are played by two spare ones.
import type { LineInput, ReceiptKind } from './receipt'

export interface DemoBusiness {
  id: string
  name: string
  category: string
  /** Test account that plays this business on pods-dev (env DW_<ENVKEY>_USER overrides the user name). */
  envKey: string
  user: string
  blurb: string
}

export const DEMO_BUSINESSES: DemoBusiness[] = [
  { id: 'bayview', name: 'Bayview Family Clinic', category: 'Medical', envKey: 'PRACTITIONER', user: 'dw-practitioner', blurb: 'Copays and lab work' },
  { id: 'sunrise', name: 'Sunrise Care Residence', category: 'Senior care', envKey: 'CARE_FACILITY', user: 'dw-care-facility', blurb: 'Day care and therapy' },
  { id: 'harbor', name: 'Harbor Light Plumbing', category: 'Home services', envKey: 'BOB', user: 'dw-bob', blurb: 'Repairs and call-outs' },
  { id: 'corner', name: 'Corner Pharmacy', category: 'Pharmacy', envKey: 'AGENT', user: 'dw-agent', blurb: 'Prescriptions and over the counter' },
]

export interface DemoReceipt {
  business: string
  kind: ReceiptKind
  identifier: string
  /** YYYY-MM-DD, delivered at 15:00 UTC. */
  date: string
  name: string
  description?: string
  lines: LineInput[]
  taxRate: number
  paymentMethod: string
  paymentRef: string
}

const L = (name: string, qty: number, unit: number): LineInput => ({ name, qty, unit })

export const DEMO_RECEIPTS: DemoReceipt[] = [
  // Harbor Light Plumbing (home services, taxed)
  { business: 'harbor', kind: 'Invoice', identifier: 'HLP-2026-0142', date: '2026-08-14', name: 'Kitchen faucet replacement', description: 'Replaced a dripping faucet and the two shutoff valves under the sink.', lines: [L('Labor, hours', 1.5, 95), L('Single handle faucet', 1, 142), L('Quarter turn shutoff valve', 2, 12.5)], taxRate: 0.0825, paymentMethod: 'Credit card', paymentRef: 'ref:pm-hlp-4c1a' },
  { business: 'harbor', kind: 'Invoice', identifier: 'HLP-2026-0187', date: '2026-09-22', name: 'Water heater flush and anode check', lines: [L('Labor, hours', 1, 95), L('Anode rod', 1, 38)], taxRate: 0.0825, paymentMethod: 'Credit card', paymentRef: 'ref:pm-hlp-4c1a' },
  { business: 'harbor', kind: 'Invoice', identifier: 'HLP-2026-0233', date: '2026-10-18', name: 'Main line drain clearing', lines: [L('Service call', 1, 85), L('Drain cable work, hours', 1.5, 110)], taxRate: 0.0825, paymentMethod: 'Bank transfer', paymentRef: 'ref:ach-hlp-77d2' },
  { business: 'harbor', kind: 'Invoice', identifier: 'HLP-2026-0261', date: '2026-11-12', name: 'Leak repair under bathroom sink', lines: [L('Labor, hours', 0.75, 95), L('P-trap kit', 1, 16.4)], taxRate: 0.0825, paymentMethod: 'Credit card', paymentRef: 'ref:pm-hlp-4c1a' },
  // Bayview Family Clinic (copays, no tax)
  { business: 'bayview', kind: 'Invoice', identifier: 'BFC-20260806-014', date: '2026-08-06', name: 'Annual physical, copay', lines: [L('Office visit copay', 1, 30)], taxRate: 0, paymentMethod: 'Credit card', paymentRef: 'ref:pm-bfc-91ee' },
  { business: 'bayview', kind: 'Invoice', identifier: 'BFC-20260903-052', date: '2026-09-03', name: 'Specialist referral visit, copay', lines: [L('Specialist visit copay', 1, 55)], taxRate: 0, paymentMethod: 'Health savings account', paymentRef: 'ref:hsa-bfc-02ab' },
  { business: 'bayview', kind: 'Invoice', identifier: 'BFC-20260924-077', date: '2026-09-24', name: 'Lab work, patient share', lines: [L('Lab panel, patient share', 1, 42.15), L('Blood draw', 1, 8)], taxRate: 0, paymentMethod: 'Credit card', paymentRef: 'ref:pm-bfc-91ee' },
  { business: 'bayview', kind: 'Invoice', identifier: 'BFC-20261015-103', date: '2026-10-15', name: 'Follow-up visit, copay', lines: [L('Office visit copay', 1, 30)], taxRate: 0, paymentMethod: 'Credit card', paymentRef: 'ref:pm-bfc-91ee' },
  { business: 'bayview', kind: 'Invoice', identifier: 'BFC-20261117-131', date: '2026-11-17', name: 'Flu shot and visit, copay', lines: [L('Flu vaccine administration', 1, 25), L('Office visit copay', 1, 30)], taxRate: 0, paymentMethod: 'Health savings account', paymentRef: 'ref:hsa-bfc-02ab' },
  // Sunrise Care Residence (monthly care invoices)
  { business: 'sunrise', kind: 'Invoice', identifier: 'SCR-2026-08', date: '2026-08-01', name: 'Day care, August', description: 'Respite day care for Grandma Rivera, eight attended days.', lines: [L('Day care, per day', 8, 78), L('Midday meal', 8, 9.5)], taxRate: 0, paymentMethod: 'Bank transfer', paymentRef: 'ref:ach-scr-5501' },
  { business: 'sunrise', kind: 'Invoice', identifier: 'SCR-2026-09', date: '2026-09-01', name: 'Day care, September', lines: [L('Day care, per day', 10, 78), L('Midday meal', 10, 9.5)], taxRate: 0, paymentMethod: 'Bank transfer', paymentRef: 'ref:ach-scr-5501' },
  { business: 'sunrise', kind: 'Invoice', identifier: 'SCR-2026-10', date: '2026-10-01', name: 'Day care, October', lines: [L('Day care, per day', 9, 78), L('Midday meal', 9, 9.5), L('Transport, one way', 4, 12)], taxRate: 0, paymentMethod: 'Bank transfer', paymentRef: 'ref:ach-scr-5501' },
  { business: 'sunrise', kind: 'Invoice', identifier: 'SCR-2026-11', date: '2026-11-01', name: 'Day care, November', lines: [L('Day care, per day', 11, 78), L('Midday meal', 11, 9.5), L('Transport, one way', 6, 12)], taxRate: 0, paymentMethod: 'Bank transfer', paymentRef: 'ref:ach-scr-5501' },
  { business: 'sunrise', kind: 'Invoice', identifier: 'SCR-2026-PT-014', date: '2026-11-14', name: 'Physical therapy sessions', lines: [L('Physical therapy session', 2, 65)], taxRate: 0, paymentMethod: 'Insurance claim', paymentRef: 'ref:clm-scr-8834' },
  // Corner Pharmacy (orders)
  { business: 'corner', kind: 'Order', identifier: 'CP-88213', date: '2026-08-09', name: 'Prescription refills', lines: [L('Lisinopril 10 mg, 90 day', 1, 12), L('Atorvastatin 20 mg, 90 day', 1, 14.4)], taxRate: 0, paymentMethod: 'Health savings account', paymentRef: 'ref:hsa-cp-33f0' },
  { business: 'corner', kind: 'Order', identifier: 'CP-88542', date: '2026-08-27', name: 'Allergy relief', lines: [L('Allergy tablets, 30 count', 1, 18.99), L('Saline nasal spray', 1, 6.49)], taxRate: 0.0825, paymentMethod: 'Credit card', paymentRef: 'ref:pm-cp-b7c3' },
  { business: 'corner', kind: 'Order', identifier: 'CP-89107', date: '2026-09-12', name: 'Prescription refill', lines: [L('Metformin 500 mg, 90 day', 1, 9.8)], taxRate: 0, paymentMethod: 'Health savings account', paymentRef: 'ref:hsa-cp-33f0' },
  { business: 'corner', kind: 'Order', identifier: 'CP-89874', date: '2026-10-10', name: 'Prescription refills', lines: [L('Lisinopril 10 mg, 90 day', 1, 12), L('Atorvastatin 20 mg, 90 day', 1, 14.4)], taxRate: 0, paymentMethod: 'Health savings account', paymentRef: 'ref:hsa-cp-33f0' },
  { business: 'corner', kind: 'Order', identifier: 'CP-90377', date: '2026-11-05', name: 'Cold season supplies', lines: [L('Vitamin D3, 120 count', 1, 11.99), L('Cough syrup', 1, 9.49), L('Hand sanitizer', 2, 3.25)], taxRate: 0.0825, paymentMethod: 'Credit card', paymentRef: 'ref:pm-cp-b7c3' },
  { business: 'corner', kind: 'Order', identifier: 'CP-90712', date: '2026-11-19', name: 'Prescription refill and organizer', lines: [L('Metformin 500 mg, 90 day', 1, 9.8), L('Weekly pill organizer', 1, 7.99)], taxRate: 0.0825, paymentMethod: 'Credit card', paymentRef: 'ref:pm-cp-b7c3' },
]

export interface Preset {
  label: string
  name: string
  category: string
  taxRate: number
  paymentMethod: string
  lines: LineInput[]
}

/** One click starting points for the business console. */
export const PRESETS: Preset[] = [
  { label: 'Visit copay', name: 'Office visit, copay', category: 'Medical', taxRate: 0, paymentMethod: 'Credit card', lines: [L('Office visit copay', 1, 30)] },
  { label: 'Visit and labs', name: 'Visit and lab work, patient share', category: 'Medical', taxRate: 0, paymentMethod: 'Health savings account', lines: [L('Office visit copay', 1, 30), L('Lab panel, patient share', 1, 42.15)] },
  { label: 'Day care week', name: 'Day care, one week', category: 'Senior care', taxRate: 0, paymentMethod: 'Bank transfer', lines: [L('Day care, per day', 5, 78), L('Midday meal', 5, 9.5)] },
  { label: 'Plumbing call-out', name: 'Plumbing call-out', category: 'Home services', taxRate: 0.0825, paymentMethod: 'Credit card', lines: [L('Service call', 1, 85), L('Labor, hours', 1, 95)] },
  { label: 'Prescription', name: 'Prescription refill', category: 'Pharmacy', taxRate: 0, paymentMethod: 'Health savings account', lines: [L('Prescription refill, 90 day', 1, 12)] },
]
