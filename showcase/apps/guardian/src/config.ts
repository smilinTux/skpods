import { DEFAULT_ISSUER } from '@skpods/solid-web'

/** The shared default pod provider (VITE_POD_ISSUER overrides it at build time). */
export const POD_ISSUER = DEFAULT_ISSUER
/** Where sk-consent (the broker and guardian) listens. Must equal its SKCONSENT_PUBLIC_URL: DPoP proofs are bound to it. */
export const CONSENT_URL = (import.meta.env?.VITE_CONSENT_URL ?? 'http://127.0.0.1:8782').replace(/\/$/, '')
/** The clinic bridge: a small Node dev tool that plays Bayview Family Clinic with its own credentials. */
export const BRIDGE_URL = (import.meta.env?.VITE_BRIDGE_URL ?? 'http://127.0.0.1:8790').replace(/\/$/, '')

export const CLINIC_NAME = 'Bayview Family Clinic'
export const PATIENT_NAME = 'Alice Rivera'

/** Data classes the guardian knows, in the order a clinic asks for them. */
export const CLASSES = ['dob', 'allergies', 'medications', 'insurance_member_id', 'ssn'] as const
export type DataClass = (typeof CLASSES)[number]

export const KINDS = ['clinic', 'care_facility', 'business', 'person', 'agent'] as const
export type Kind = (typeof KINDS)[number]

export const KIND_LABEL: Record<string, string> = {
  clinic: 'Clinics',
  care_facility: 'Care facilities',
  business: 'Businesses',
  person: 'People',
  agent: 'Other agents',
}
export const KIND_ONE: Record<string, string> = { clinic: 'clinic', care_facility: 'care facility', business: 'business', person: 'person', agent: 'agent' }

export const CLASS_LABEL: Record<string, string> = {
  dob: 'Date of birth',
  allergies: 'Allergies',
  medications: 'Current medications',
  insurance_member_id: 'Insurance member ID',
  ssn: 'Social Security number',
}
export const CLASS_HINT: Record<string, string> = {
  dob: 'Used to match your chart',
  allergies: 'Safety critical at a clinic',
  medications: 'Avoids dangerous interactions',
  insurance_member_id: 'Financial data',
  ssn: 'Identity theft material',
}
export const SENSITIVITY: Record<string, 'low' | 'medium' | 'high' | 'locked'> = {
  dob: 'low',
  allergies: 'low',
  medications: 'medium',
  insurance_member_id: 'high',
  ssn: 'locked',
}
