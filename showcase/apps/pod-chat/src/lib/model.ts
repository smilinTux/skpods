import type { Attachment, ConvMeta } from './codec'

export interface Person {
  webId: string
  name: string
  /** Pod root (pim:storage), resolved lazily. */
  root?: string
}

export type PeerStatus = 'unknown' | 'active' | 'hidden' | 'left' | 'error'

/** A message as the UI shows it. */
export interface Msg {
  id: string
  author: string
  text: string
  createdAt: number
  editedAt?: number
  attachment?: Attachment
  /** Local-only preview of an attachment that is still uploading. */
  previewUrl?: string
  status: 'sent' | 'sending' | 'failed'
  /** Resource the message was read from (for the "pod view"). */
  fileUrl?: string
}

export interface Ghost {
  id: string
  author: string
  at: number
  reason: 'hidden' | 'deleted'
}

export interface PeerView {
  webId: string
  status: PeerStatus
  leftAt?: number
  msgs: Msg[]
  ghosts: Ghost[]
  /** Newest message id this person has seen (their read receipt). */
  readUpTo?: string
}

export type Entry =
  | { t: 'msg'; msg: Msg }
  | { t: 'ghost'; author: string; reason: Ghost['reason']; count: number; at: number; key: string }
  | { t: 'system'; kind: 'left' | 'created'; who: string; at: number; key: string }

export type Item =
  | { t: 'day'; key: string; at: number }
  | { t: 'msg'; key: string; msg: Msg; mine: boolean; startsRun: boolean; endsRun: boolean; seenBy: string[] }
  | Exclude<Entry, { t: 'msg' }>

export interface ConvInfo {
  meta: ConvMeta
}
