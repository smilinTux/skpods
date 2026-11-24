# Raw HTTP examples (curl)

Status: **Stub / reference**. These are the exact calls the SDK stubs make, for
debugging and for learning the flow. Dev server only. No secrets here: set the
variables below yourself. Credentials are delivered privately by the SKPods
admin; never commit them.

```bash
export SKPODS_BASE=https://pods-dev.skstack01.douno.it   # prod later: https://pods.skstack01.douno.it
export CLIENT_ID=...        # dw-agent client id (private)
export CLIENT_SECRET=...    # dw-agent client secret (private)
export USER_NAME=dw-agent
export POD="$SKPODS_BASE/apps/solid/~$USER_NAME/storage"
export DPOP=./dpop.py       # needs: pip install cryptography pyjwt
```

`dpop.py METHOD URL [--token T] [--nonce N]` prints a DPoP proof JWT. It keeps one
key in `.dpop-key.pem` (git-ignore it). The access token is bound to that key, so
use the same key for the token request and every later call.

## 1. Discovery

```bash
curl -s "$SKPODS_BASE/.well-known/openid-configuration" | python3 -m json.tool
export TOKEN_ENDPOINT=$(curl -s "$SKPODS_BASE/.well-known/openid-configuration" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token_endpoint"])')
```

Expect HTTP 200 and an `issuer` equal to `$SKPODS_BASE`.

WebID profile (public Turtle):

```bash
curl -s -H 'Accept: text/turtle' "$SKPODS_BASE/apps/solid/~$USER_NAME/profile/card"
# WebID: $SKPODS_BASE/apps/solid/~$USER_NAME/profile/card#me
```

## 2. Token request (client credentials + DPoP)

```bash
curl -s -u "$CLIENT_ID:$CLIENT_SECRET" \
  -H "DPoP: $($DPOP POST "$TOKEN_ENDPOINT")" \
  -d grant_type=client_credentials -d scope=webid \
  "$TOKEN_ENDPOINT" | tee /tmp/skpods-token.json | python3 -m json.tool
export ACCESS_TOKEN=$(python3 -c 'import json; print(json.load(open("/tmp/skpods-token.json"))["access_token"])')
```

Expect HTTP 200 with `token_type` `DPoP` and an `expires_in`. If the server answers
400 or 401 with a `DPoP-Nonce` response header, repeat the call with
`$($DPOP POST "$TOKEN_ENDPOINT" --nonce "<value>")`. Treat the token file as a
secret and delete it when done.

## 3. Read, write, patch, delete

Every resource call carries `Authorization: DPoP <token>` and a fresh proof that
includes the token hash (`--token`).

```bash
R="$POD/skpods-curl-example.ttl"
auth() { echo -H "Authorization: DPoP $ACCESS_TOKEN" -H "DPoP: $($DPOP "$1" "$2" --token "$ACCESS_TOKEN")"; }

# PUT (create or replace). 201 or 204 on success.
curl -i -X PUT $(auth PUT "$R") -H 'Content-Type: text/turtle' \
  --data-binary '<#it> <http://schema.org/name> "curl example" .' "$R"

# GET. 200 with the Turtle.
curl -i $(auth GET "$R") -H 'Accept: text/turtle' "$R"

# PATCH with N3 Patch (replace the name).
curl -i -X PATCH $(auth PATCH "$R") -H 'Content-Type: text/n3' --data-binary '
@prefix solid: <http://www.w3.org/ns/solid/terms#>.
_:p a solid:InsertDeletePatch;
  solid:inserts { <#it> <http://schema.org/description> "patched" . } .' "$R"

# PATCH with SPARQL Update.
curl -i -X PATCH $(auth PATCH "$R") -H 'Content-Type: application/sparql-update' \
  --data-binary 'INSERT DATA { <#it> <http://schema.org/keywords> "demo" }' "$R"

# List a container (look for ldp:contains).
curl -s $(auth GET "$POD/") -H 'Accept: text/turtle' "$POD/"

# DELETE. 200 or 204.
curl -i -X DELETE $(auth DELETE "$R") "$R"
```

The `auth` helper word-splits, so it works for these simple headers. For a nonce
retry, call `$DPOP` again with `--nonce` using the value from the `DPoP-Nonce`
header of the 401 answer.

## 4. ACL write (WAC)

Needs `acl:Control` on the target (you own your pod). Dev convention: the ACL of a
resource is the resource URL plus `.acl`. A general client should read the
`Link: <...>; rel="acl"` header from a HEAD or GET instead.

```bash
curl -I $(auth HEAD "$R") "$R" | grep -i '^link'

A="$R.acl"
curl -i -X PUT $(auth PUT "$A") -H 'Content-Type: text/turtle' --data-binary "
@prefix acl: <http://www.w3.org/ns/auth/acl#> .
<#owner> a acl:Authorization ; acl:agent <$SKPODS_BASE/apps/solid/~$USER_NAME/profile/card#me> ;
  acl:accessTo <$R> ; acl:mode acl:Read, acl:Write, acl:Control .
<#bob> a acl:Authorization ; acl:agent <$SKPODS_BASE/apps/solid/~dw-bob/profile/card#me> ;
  acl:accessTo <$R> ; acl:mode acl:Read ." "$A"
```

Always keep the owner's `acl:Control` authorization in the document, or you lock
yourself out. Revoke by rewriting the `.acl` without the grant.

## 5. Expected 401 and 403

```bash
# 401: no token at all.
curl -i "$SKPODS_BASE/apps/solid/~dw-alice/storage/private/"

# 403: valid token for dw-agent, someone else's private storage.
curl -i $(auth GET "$SKPODS_BASE/apps/solid/~dw-alice/storage/private/") \
  "$SKPODS_BASE/apps/solid/~dw-alice/storage/private/"
```

| Case | Expected |
| --- | --- |
| Anonymous read of a private container | 401 (some servers answer 403) |
| Authenticated as dw-agent, dw-alice's private container | 403 |
| Token used with a different DPoP key, wrong `htu`/`htm`, or reused `jti` | 401 |
| Missing resource | 404 |

See [../../docs/LOGIN-AND-AUTH.md](../../docs/LOGIN-AND-AUTH.md) and
[../../docs/TEST-ACCOUNTS.md](../../docs/TEST-ACCOUNTS.md).
