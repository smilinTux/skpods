import { Avatar, cx } from '@skpods/ui'
import type { PodStore } from '@skpods/solid-web'
import { nameOf } from '../lib/codec'
import { clock, linkify } from '../lib/format'
import type { Item, Person } from '../lib/model'
import { slugOf } from '../lib/paths'
import { AuthedImage } from './AuthedImage'
import { Check, Clock, Lock } from './icons'
import { authorColor } from './Faces'

type MsgItem = Extract<Item, { t: 'msg' }>

export interface BubbleProps {
  item: MsgItem
  store: PodStore
  group: boolean
  podView: boolean
  who: (webId: string) => Person
  selected: boolean
  onSelect: () => void
  onOpenImage: (src: string) => void
  onRetry: () => void
  onDiscard: () => void
  meLeft: boolean
}

function Text({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((p, i) =>
        p.href ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className="underline decoration-1 underline-offset-2 hover:opacity-80" onClick={(e) => e.stopPropagation()}>
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}

export function Bubble({ item, store, group, podView, who, selected, onSelect, onOpenImage, onRetry, onDiscard, meLeft }: BubbleProps) {
  const { msg, mine, startsRun, endsRun, seenBy } = item
  const author = who(msg.author)
  const radius = mine ? cx('rounded-2xl', startsRun ? '' : 'rounded-tr-md', endsRun ? 'rounded-br-md' : 'rounded-br-md') : cx('rounded-2xl', startsRun ? '' : 'rounded-tl-md', endsRun ? 'rounded-bl-md' : 'rounded-bl-md')
  const hasImage = Boolean(msg.attachment)
  return (
    <div className={cx('flex items-end gap-2 animate-rise', mine ? 'flex-row-reverse' : 'flex-row', startsRun ? 'mt-2.5' : 'mt-0.5')} data-testid="message" data-mine={mine} data-id={msg.id}>
      {!mine && group ? (
        <span className="w-7 shrink-0">{endsRun ? <Avatar name={author.name} seed={author.webId} size="sm" /> : null}</span>
      ) : null}
      <div className={cx('flex max-w-[82%] flex-col sm:max-w-[68%]', mine ? 'items-end' : 'items-start')}>
        {!mine && group && startsRun && <span className={cx('mb-0.5 ml-3 text-xs font-semibold', authorColor(author.webId))}>{author.name}</span>}
        <button
          type="button"
          onClick={onSelect}
          aria-expanded={selected}
          aria-label={`${mine ? 'You' : author.name}, ${clock(msg.createdAt)}: ${msg.text || 'photo'}`}
          className={cx(
            'relative max-w-full select-text overflow-hidden text-left text-[15px] leading-snug shadow-sm transition active:scale-[.99]',
            radius,
            mine ? (meLeft ? 'border border-dashed border-line bg-surface-2 text-ink' : 'bg-teal-700 text-white dark:bg-brand dark:text-brand-ink') : 'border border-line bg-surface text-ink',
            msg.status === 'sending' && 'opacity-70',
            msg.status === 'failed' && 'ring-2 ring-danger/60',
            selected && 'ring-2 ring-brand/70',
            hasImage ? 'p-1' : 'px-3.5 py-2',
          )}
        >
          {msg.attachment && (
            <AuthedImage store={store} url={msg.attachment.url} preview={msg.previewUrl} alt={msg.text ? msg.text.slice(0, 60) : 'Photo'} width={msg.attachment.width} height={msg.attachment.height} className="w-[min(16rem,70vw)]" onOpen={onOpenImage} />
          )}
          {msg.text && (
            <p className={cx('whitespace-pre-wrap break-words', hasImage && 'px-2.5 pb-1.5 pt-1.5')}>
              <Text text={msg.text} />
            </p>
          )}
        </button>
        {endsRun && (
          <div className={cx('mt-1 flex items-center gap-1.5 px-1 text-[11px] text-muted', mine && 'flex-row-reverse')}>
            <span>{clock(msg.createdAt)}</span>
            {msg.editedAt && <span title={`Edited ${clock(msg.editedAt)}`} data-testid="edited">edited</span>}
            {mine && msg.status === 'sending' && <Clock width={12} height={12} aria-label="Sending" />}
            {mine && msg.status === 'sent' && seenBy.length === 0 && <Check width={13} height={13} aria-label="Written to your pod" />}
          </div>
        )}
        {mine && seenBy.length > 0 && (
          <div className="mt-0.5 flex items-center gap-1 px-1 text-[11px] text-teal-700 dark:text-brand" data-testid="seen-by" title={`Seen by ${seenBy.map((w) => who(w).name).join(', ')}`}>
            <span className="flex -space-x-1.5">
              {seenBy.slice(0, 4).map((w) => (
                <Avatar key={w} name={who(w).name} seed={w} size="sm" className="!h-4 !w-4 !text-[8px]" />
              ))}
            </span>
            Seen
          </div>
        )}
        {msg.status === 'failed' && (
          <div className="mt-1 flex items-center gap-2 px-1 text-xs text-danger" role="alert">
            Not sent
            <button className="font-semibold underline" onClick={onRetry}>Retry</button>
            <button className="text-muted underline" onClick={onDiscard}>Discard</button>
          </div>
        )}
        {podView && (
          <div className={cx('mt-1 flex max-w-full items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted', mine && 'self-end')} data-testid="pod-tag" title={msg.fileUrl}>
            <Lock width={10} height={10} />
            <span className="truncate">~{slugOf(msg.author)} / {msg.fileUrl ? nameOf(msg.fileUrl) : 'writing…'}</span>
          </div>
        )}
      </div>
    </div>
  )
}
