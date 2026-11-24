// Access control for chat containers, shared by the app and the demo seeder.
// ACLs are only ever written through writeAcl (it refuses owner lockout and invalid Turtle, see ENGINE-NOTES.md),
// and only named agents are granted (acl:agent), never classes or groups.
import { ownerRule, readAcl, writeAcl, type AclRule, type PodStore } from '@skpods/solid-web'
import { inboxUrl } from './paths'

const grant = (id: string, agents: string[], modes: AclRule['modes'], resource: string, inherit: boolean): AclRule => ({
  id,
  agents,
  agentClasses: [],
  agentGroups: [],
  modes,
  accessTo: [resource],
  defaultFor: inherit ? [resource] : [],
})

/** Owner full control, every other participant Read, inherited by every file in the conversation container. */
export function conversationRules(owner: string, container: string, readers: string[]): AclRule[] {
  const others = [...new Set(readers)].filter((w) => w !== owner)
  return [ownerRule(owner, container, true), ...(others.length ? [grant('participants', others, ['Read'], container, true)] : [])]
}

export const writeConversationAcl = (store: PodStore, owner: string, container: string, readers: string[]) =>
  writeAcl(store, container + '.acl', conversationRules(owner, container, readers), owner)

/** After leaving: the container goes back to owner only, so every message disappears for everyone else. */
export const revokeConversationAcl = (store: PodStore, owner: string, container: string) => writeConversationAcl(store, owner, container, [])

/** The leave notice keeps its own rule: it is the one thing that stays readable, so others learn WHY the messages are gone. */
export async function writeLeaveNoticeAcl(store: PodStore, owner: string, resource: string, readers: string[]) {
  const rules = [ownerRule(owner, resource, false), grant('participants', [...new Set(readers)].filter((w) => w !== owner), ['Read'], resource, false)]
  await writeAcl(store, resource + '.acl', rules, owner)
}

/**
 * The invitation inbox: others may only APPEND (POST) to it. They cannot list or read it, so nobody can see who else
 * was invited. Idempotent: rewrites the ACL only when a contact is missing.
 */
export async function ensureInbox(store: PodStore, owner: string, podRoot: string, contacts: string[]): Promise<boolean> {
  const inbox = inboxUrl(podRoot)
  const want = [...new Set(contacts)].filter((w) => w !== owner).sort()
  await store.ensureContainer(inbox)
  const existing = await readAcl(store, inbox + '.acl')
  const have = new Set(existing?.filter((r) => r.modes.includes('Append')).flatMap((r) => r.agents) ?? [])
  if (existing && want.every((w) => have.has(w))) return false
  const merged = [...new Set([...have, ...want])].sort()
  await writeAcl(store, inbox + '.acl', [ownerRule(owner, inbox, true), grant('append', merged, ['Append'], inbox, true)], owner)
  return true
}
