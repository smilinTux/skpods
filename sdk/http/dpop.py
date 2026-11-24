#!/usr/bin/env python3
"""Print a DPoP proof JWT for use with curl. STUB-level helper, dev only.

Needs:  pip install cryptography pyjwt

  dpop.py METHOD URL [--token ACCESS_TOKEN] [--nonce NONCE]

The ES256 key is kept in $DPOP_KEY_FILE (default ./.dpop-key.pem, created on
first use, mode 0600). A DPoP-bound access token only works with the key it was
issued for, so reuse the same key file for the token request and every call
that uses the token. Add .dpop-key.pem to .gitignore; never commit it.

Example:
  curl -H "DPoP: $(./dpop.py POST "$TOKEN_ENDPOINT")" ...
"""
import argparse
import base64
import hashlib
import os
import sys
import time
import uuid
from urllib.parse import urlsplit, urlunsplit

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def load_key(path):
    if os.path.exists(path):
        with open(path, "rb") as f:
            return serialization.load_pem_private_key(f.read(), password=None)
    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(pem)
    return key


def proof(key, method, url, token=None, nonce=None):
    nums = key.public_key().public_numbers()
    jwk = {"kty": "EC", "crv": "P-256",
           "x": b64(nums.x.to_bytes(32, "big")), "y": b64(nums.y.to_bytes(32, "big"))}
    s = urlsplit(url)
    htu = urlunsplit((s.scheme, s.netloc, s.path, "", ""))  # no query, no fragment
    claims = {"htm": method.upper(), "htu": htu, "iat": int(time.time()), "jti": str(uuid.uuid4())}
    if token:
        claims["ath"] = b64(hashlib.sha256(token.encode()).digest())
    if nonce:
        claims["nonce"] = nonce
    return jwt.encode(claims, key, algorithm="ES256", headers={"typ": "dpop+jwt", "jwk": jwk})


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("method")
    ap.add_argument("url")
    ap.add_argument("--token", default=os.environ.get("ACCESS_TOKEN"))
    ap.add_argument("--nonce", default=os.environ.get("DPOP_NONCE"))
    a = ap.parse_args()
    key = load_key(os.environ.get("DPOP_KEY_FILE", ".dpop-key.pem"))
    sys.stdout.write(proof(key, a.method, a.url, a.token, a.nonce))


if __name__ == "__main__":
    main()
