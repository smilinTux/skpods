export const ISSUER: string = (import.meta.env.VITE_POD_ISSUER ?? 'https://pods-dev.skstack01.douno.it').replace(/\/$/, '')
/** Where your sk-consent instance listens. Reads are open in the demo, owner actions carry a DPoP token. */
export const CONSENT_URL: string = (import.meta.env.VITE_CONSENT_URL ?? 'http://localhost:8781').replace(/\/$/, '')
/** The resident the facility view asks about (Grandma Rosa in the demo). */
export const RESIDENT_WEBID: string = import.meta.env.VITE_RESIDENT_WEBID ?? `${ISSUER}/apps/solid/~dw-grandma/profile/card#me`
