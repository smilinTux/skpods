// Pod layout for chat. Everything lives under /skpods/v1/ in the AUTHOR's own pod.
export const CHAT = 'skpods/v1/chat/'
export const INBOX = 'skpods/v1/chat-inbox/'

export const chatRoot = (podRoot: string) => podRoot + CHAT
export const convUrl = (podRoot: string, convId: string) => `${podRoot}${CHAT}${convId}/`
export const inboxUrl = (podRoot: string) => podRoot + INBOX
export const descriptorUrl = (podRoot: string, convId: string) => `${convUrl(podRoot, convId)}conversation.ttl`
export const leftUrl = (podRoot: string, convId: string) => `${convUrl(podRoot, convId)}left.ttl`

/** Short user label from a WebID like https://host/apps/solid/~dw-alice/profile/card#me. */
export function slugOf(webId: string): string {
  const m = webId.match(/~([^/]+)\//)
  return m ? decodeURIComponent(m[1]) : webId.replace(/^https?:\/\//, '').split('/')[0]
}
