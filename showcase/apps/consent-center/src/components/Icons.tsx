import type { ReactNode } from 'react'

function I({ children, size = 18, className }: { children: ReactNode; size?: number; className?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {children}
    </svg>
  )
}
type P = { size?: number; className?: string }
export const InboxIcon = (p: P) => <I {...p}><path d="M3 13l2.5-7.5A2 2 0 0 1 7.4 4h9.2a2 2 0 0 1 1.9 1.5L21 13" /><path d="M3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5h-5l-1.5 2h-5L8 13z" /></I>
export const KeyIcon = (p: P) => <I {...p}><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2L20 3M16 7l3 3M14 9l2 2" /></I>
export const ChainIcon = (p: P) => <I {...p}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></I>
export const ShieldIcon = (p: P) => <I {...p}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></I>
export const LockIcon = (p: P) => <I {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></I>
export const UnlockIcon = (p: P) => <I {...p}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></I>
export const FolderIcon = (p: P) => <I {...p}><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></I>
export const FileIcon = (p: P) => <I {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></I>
export const CheckIcon = (p: P) => <I {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></I>
export const XIcon = (p: P) => <I {...p}><path d="M6 6l12 12M18 6L6 18" /></I>
export const SparkIcon = (p: P) => <I {...p}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></I>
export const ClockIcon = (p: P) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></I>
export const EyeIcon = (p: P) => <I {...p}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></I>
export const ExternalIcon = (p: P) => <I {...p}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></I>
export const CopyIcon = (p: P) => <I {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></I>
export const ChevronIcon = (p: P) => <I {...p}><path d="M9 6l6 6-6 6" /></I>
export const PodIcon = (p: P) => <I {...p}><path d="M12 3c4.5 0 7 3 7 6.8 0 4.4-3.2 8-7 9.7-3.8-1.7-7-5.3-7-9.7C5 6 7.5 3 12 3z" /><circle cx="12" cy="10" r="2.4" /></I>
export const BrokenLinkIcon = (p: P) => <I {...p}><path d="M9.5 14.5l-1 1a4 4 0 0 1-5.7-5.7l2-2" /><path d="M14.5 9.5l1-1a4 4 0 0 1 5.7 5.7l-2 2" /><path d="M8 4V2M4 8H2M16 22v-2M22 16h-2" /></I>
export const PlayIcon = (p: P) => <I {...p}><path d="M7 5l12 7-12 7z" /></I>
