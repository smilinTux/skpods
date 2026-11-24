//! DPoP proofs (RFC 9449), ES256. STUB.

/// One ES256 key pair used for the token request and all following requests.
pub struct DpopKey {
    // TODO: p256::ecdsa::SigningKey
}

impl DpopKey {
    /// Generates a fresh P-256 key.
    pub fn generate() -> Self {
        todo!("generate p256 SigningKey")
    }

    /// Public JWK (kty, crv, x, y) as JSON.
    pub fn public_jwk(&self) -> serde_json::Value {
        todo!("export x/y as base64url")
    }

    /// Signs a proof JWT with typ=dpop+jwt and claims htm, htu (no query or
    /// fragment), iat, jti, plus `ath` (base64url SHA-256 of the access token)
    /// for resource requests and `nonce` when the server sent a DPoP-Nonce.
    pub fn proof(
        &self,
        method: &str,
        url: &str,
        access_token: Option<&str>,
        nonce: Option<&str>,
    ) -> crate::Result<String> {
        let _ = (method, url, access_token, nonce);
        todo!("build header + claims, sign ES256 (r||s), join with dots")
    }
}
