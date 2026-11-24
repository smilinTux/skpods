# SKPods Chat protocol

This is the contract between Pod Chat clients and the optional SKPods relay. Message bodies, files and titles live
only in the authors' pods. The relay carries small hints that something changed, nothing more. With the relay down,
Pod Chat behaves exactly as it does without one (polling).

Frame examples for both sides to test against live in `showcase/apps/pod-chat/protocol/relay-v1.fixtures.json`.

## 1. Pod layout

Every participant writes only into their own pod, under `/skpods/v1/chat/<conversationId>/`, and grants the other
participants Read. Nobody ever shares a file.

| Resource | Meaning |
|---|---|
| `.acl` | Owner plus Read for the other participants |
| `conversation.ttl` | The author's mirror of the conversation descriptor |
| `m-<id>.ttl` | One message by this pod's owner (id is epoch ms plus a random tail) |
| `s-<from>-<to>-<t>.ttl` | Archive: a roll-up of old loose messages by this pod's owner |
| `e-<id>-<ms>.ttl` | An edit of message `<id>`; the newest edit wins |
| `a-<id>.jpg` (or `.png`) | An attachment photo |
| `r-<id>.ttl` | Read receipt: the owner has read up to message `<id>` (older ones are pruned) |
| `left.ttl` | Leave notice with its own ACL, written only after leaving |
| `/skpods/v1/chat-inbox/` | Append-only for contacts; invitations land here |

Prefixes reserved for later plans (do not use them for anything else):

| Prefix or path | Reserved for |
|---|---|
| `x-` | Reactions |
| `v-` | Video |
| `agent/` | Agent-authored material |
| `dropbox/` | Files handed over to a conversation |
| `apps/` | App-specific data |

## 2. Descriptor

The conversation descriptor (`skp:Conversation`) gains one new optional literal, `skp:relayRoom`: 32 lowercase hex
characters, a random 128-bit room id on the relay. The creator generates it when the conversation is created and every
participant's mirror carries it.

Rule: a descriptor with no `skp:relayRoom` means polling only. A client must never attempt to join a relay room for
such a conversation. Old conversations keep working unchanged.

A message written by an agent on its owner's behalf may carry `skp:generatedBy`, the agent's WebID.

## 3. Relay wire protocol v1

All frames are JSON text frames of at most 4096 bytes. Wire protocol version is `1`, sent as `"v":1` in the auth
frame. A frame over 4096 bytes is refused with `too_large`.

### Endpoints

* Room: `wss://<relay>/v1/room/<roomId>`
* Mailbox: `wss://<relay>/v1/me?w=<sha256 hex of the client's WebID>`

The query value `w` is the lowercase hex SHA-256 of the WebID string. The router uses it to pick the mailbox before
authentication, because it cannot see the WebID until the auth frame arrives. After verifying the auth frame, the
mailbox checks that sha256(verified WebID) equals `w`. If it differs, the relay sends `error` `auth_failed` and closes
with 4401. A client therefore can only open its own mailbox.

### DPoP proof

The first frame carries a DPoP proof JWT with `htm` `GET`. The `htu` claim is always built the same way, from the URL
the client dialled: `"https://"` plus host (with `:port` when present) plus path. The schemes `ws` and `wss` both map
to `https`. The query string is excluded from `htu`, as DPoP requires. The relay builds the expected `htu` from the
request `Host` header and path, so local development and production behave identically.

Examples:

* Dialled `wss://relay.example/v1/room/0123456789abcdef0123456789abcdef`, `htu` is
  `https://relay.example/v1/room/0123456789abcdef0123456789abcdef`.
* Dialled `wss://relay.example/v1/me?w=<hex>`, `htu` is `https://relay.example/v1/me`.
* Dialled `ws://localhost:8787/v1/me?w=<hex>`, `htu` is `https://localhost:8787/v1/me`.

The relay refuses a token whose `exp` has passed, a proof older than 60 seconds, a proof whose `jti` was seen before,
a proof signed by a key other than the token's `cnf.jkt`, and a token whose issuer is not listed in the WebID profile.
All of these answer `auth_failed` and never `ready`.

### Frames

| Direction | Frame |
|---|---|
| client to relay, first frame, within 5 s | `{"t":"auth","v":1,"token":"<access token>","proof":"<DPoP proof JWT>"}` |
| relay to client | `{"t":"ready","webid":"<verified WebID>"}` |
| client to relay | `{"t":"ping","kind":"<kind>","url":"<https URL>"}` with kind one of `message`, `edit`, `delete`, `receipt`, `join`, `leave`, `archive` |
| relay to other members | `{"t":"ping","from":"<WebID>","kind":"<kind>","url":"<url>","seq":<int>,"at":<epoch ms>}` |
| client to relay | `{"t":"typing"}` (never stored or queued) |
| relay to other members | `{"t":"typing","from":"<WebID>"}` |
| relay to mailbox client | `{"t":"queued","items":[{"room":"<id>","from":"<WebID>","kind":"<kind>","url":"<url>","seq":<int>,"at":<epoch ms>}]}` |
| relay to client | `{"t":"error","code":"<code>"}` then close |

Client frames must not contain `from`, `seq` or `at`; the relay sets them. The `url` of a ping must be `https`.

### Error codes

| Code | Close code |
|---|---|
| `auth_failed` | 4401 |
| `room_full` | 4403 |
| `too_large` | 4413 |
| `rate_limited` | 4429 |
| `bad_frame` | 4400 |

A room holds at most 50 members.

## 4. Trust rules

* A ping is a hint. A client that gets one re-reads the pod it points at and trusts only what the pod returns.
* The relay sets `from` from the verified WebID. It never trusts a claimed WebID, and a client frame that carries
  `from` is a `bad_frame`.
* Clients ignore pings whose `from` is not a participant of the conversation.
* The relay never receives message bodies, file contents or titles. It never logs access tokens, proofs or ping URLs.
* A room id is a capability stored only in the descriptor, which only participants can read. Someone who learns one
  can receive hints about URLs they cannot read, and the relay still caps members and frame size.

## 5. Interop

### SolidOS LongChat mapping (plan 10)

To be written in plan 10.
