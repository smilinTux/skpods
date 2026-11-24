import { describe, expect, it } from 'vitest'
import { cleanName } from '../../src/lib/people'
import { linkify, listStamp } from '../../src/lib/format'

describe('format helpers', () => {
  it('only http(s) links become links', () => {
    expect(linkify('see https://example.org/a. ok')).toEqual([{ text: 'see ' }, { text: 'https://example.org/a', href: 'https://example.org/a' }, { text: '. ok' }])
    expect(linkify('javascript:alert(1)')).toEqual([{ text: 'javascript:alert(1)' }])
  })
  it('list stamps: today shows a time, yesterday a word', () => {
    const now = new Date(2026, 10, 23, 15, 0).getTime()
    expect(listStamp(now - 3600_000, now)).toMatch(/\d/)
    expect(listStamp(now - 86_400_000, now)).toBe('Yesterday')
  })
  it('strips test labels from profile names', () => {
    expect(cleanName('Kid (Test)')).toBe('Kid')
  })
})
