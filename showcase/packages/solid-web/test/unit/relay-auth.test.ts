import { describe, expect, it } from 'vitest'
import { decodeJwt, generateDpopKey, sha256b64url } from '../../src/crypto'
import { relayAuthFromAgent } from '../../src/node'
import type { AgentSession } from '../../src/node'

describe('relayAuthFromAgent', () => {
  it('makes a GET proof for the htu with ath', async () => {
    const key = await generateDpopKey('ES256')
    const agent = { key, accessToken: () => 'agent-token-1' } as unknown as AgentSession
    const { token, proof } = await relayAuthFromAgent(agent)('https://relay.example/v1/me')
    expect(token).toBe('agent-token-1')
    const { header, payload } = decodeJwt(proof)
    expect(header.typ).toBe('dpop+jwt')
    expect(header.jwk).toEqual(key.publicJwk)
    expect(payload.htm).toBe('GET')
    expect(payload.htu).toBe('https://relay.example/v1/me')
    expect(payload.ath).toBe(await sha256b64url('agent-token-1'))
    expect(typeof payload.jti).toBe('string')
    expect(Math.abs(payload.iat - Date.now() / 1000)).toBeLessThan(5)
  })
})
