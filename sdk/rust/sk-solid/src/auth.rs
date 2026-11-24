//! Client-credentials login for headless agents. STUB.

use crate::{dpop::DpopKey, Config};

/// A DPoP-bound access token.
pub struct Token {
    pub access_token: String,
    pub expires_in: u64,
}

/// Fetches `/.well-known/openid-configuration` and returns the token endpoint.
pub fn discover_token_endpoint(cfg: &Config) -> crate::Result<String> {
    let _ = cfg;
    todo!("GET <base>/.well-known/openid-configuration, read token_endpoint")
}

/// POSTs `grant_type=client_credentials&scope=webid` to the token endpoint with
/// HTTP Basic (client id and secret) and a DPoP header. Retries once when the
/// server answers with a `DPoP-Nonce` header.
pub fn client_credentials(cfg: &Config, key: &DpopKey) -> crate::Result<Token> {
    let _ = (cfg, key);
    todo!("token request with DPoP and nonce retry")
}
