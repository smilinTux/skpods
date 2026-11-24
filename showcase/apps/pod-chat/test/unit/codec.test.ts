import { describe, expect, it } from 'vitest'
import {
  classify, compareIds, decodeConversation, decodeEdit, decodeInvitation, decodeLeft, decodeMessages, editFile, encodeConversation, encodeEdit, encodeInvitation,
  encodeLeft, encodeMessage, encodeSegment, idTime, listChildren, messageFile, newMessageId, receiptFile, segmentFile,
} from '../../src/lib/codec'

const ME = 'https://pod.test/apps/solid/~dw-alice/profile/card#me'
const URL_ = 'https://pod.test/apps/solid/~dw-alice/storage/skpods/v1/chat/c-1/m-x.ttl'

describe('file names', () => {
  it('round trips ids and classifies every file kind', () => {
    const id = newMessageId(1_732_400_000_123)
    expect(id).toMatch(/^1732400000123-[a-z0-9]{6}$/)
    expect(idTime(id)).toBe(1_732_400_000_123)
    expect(classify(messageFile(id))).toEqual({ kind: 'message', id })
    expect(classify(editFile(id, 1_732_400_999_000))).toEqual({ kind: 'edit', id, at: 1_732_400_999_000 })
    expect(classify(receiptFile(id))).toEqual({ kind: 'receipt', upTo: id })
    expect(classify(`a-${id}.jpg`)).toEqual({ kind: 'attachment', id, ext: 'jpg' })
    expect(classify(segmentFile(1_732_400_000_000, 1_732_400_100_000))).toMatchObject({ kind: 'segment', first: 1_732_400_000_000 })
    expect(classify('left.ttl')).toEqual({ kind: 'left' })
    expect(classify('conversation.ttl')).toEqual({ kind: 'descriptor' })
    expect(classify('random.txt')).toEqual({ kind: 'other' })
  })
  it('orders ids by send time', () => {
    const a = newMessageId(1_000_000_000_000)
    const b = newMessageId(1_000_000_000_001)
    expect(compareIds(a, b)).toBe(-1)
    expect(compareIds(b, a)).toBe(1)
  })
})

describe('turtle codec', () => {
  it('round trips a message with awkward text and an attachment', () => {
    const id = newMessageId(1_732_400_000_000)
    const text = 'He said "hi" \\ and\nthen http://example.org/x; <b>no html</b> é 你好'
    const m = { id, author: ME, text, createdAt: 1_732_400_000_000, attachment: { url: 'https://pod.test/a.jpg', type: 'image/jpeg', width: 800, height: 600 } }
    const ttl = encodeMessage(URL_, m)
    expect(decodeMessages(ttl, URL_)).toEqual([m])
  })
  it('a text that looks like an IRI stays a literal', () => {
    const id = newMessageId()
    const [back] = decodeMessages(encodeMessage(URL_, { id, author: ME, text: 'https://evil.example/', createdAt: 5 }), URL_)
    expect(back.text).toBe('https://evil.example/')
  })
  it('segments hold many messages and decode in full', () => {
    const ms = [1, 2, 3].map((i) => ({ id: newMessageId(1_700_000_000_000 + i), author: ME, text: `m${i}`, createdAt: 1_700_000_000_000 + i }))
    expect(decodeMessages(encodeSegment(URL_, ms), URL_).sort((a, b) => a.createdAt - b.createdAt)).toEqual(ms)
  })
  it('edits, leave notices, conversations and invitations round trip', () => {
    expect(decodeEdit(encodeEdit(URL_, { id: 'x', text: 'fixed', at: 1_732_400_000_000 }, ME), URL_)).toEqual({ id: 'x', text: 'fixed', at: 1_732_400_000_000 })
    expect(decodeLeft(encodeLeft(URL_, ME, 1_732_400_000_000), URL_)).toBe(1_732_400_000_000)
    const meta = { id: 'c-1', title: 'Family', kind: 'group' as const, creator: ME, participants: [ME, 'https://pod.test/apps/solid/~dw-bob/profile/card#me'], createdAt: 1_732_400_000_000 }
    expect(decodeConversation(encodeConversation(URL_, meta), URL_)).toEqual(meta)
    const inv = { descriptor: URL_, sender: ME, title: 'Family', at: 1_732_400_000_000 }
    expect(decodeInvitation(encodeInvitation(URL_, inv), URL_)).toEqual({ url: URL_, ...inv })
  })
  it('lists container children and hides .acl', () => {
    const c = 'https://pod.test/x/chat/c-1/'
    const ttl = `@prefix ldp: <http://www.w3.org/ns/ldp#> .\n<${c}> ldp:contains <${c}m-1.ttl>, <${c}.acl>, <m-2.ttl> .`
    expect(listChildren(ttl, c)).toEqual([`${c}m-1.ttl`, `${c}m-2.ttl`])
  })
})
