//! Owner and requester authentication: DPoP-bound Solid access tokens.
//!
//! Checks: scheme `DPoP`; access token signature against the issuer JWKS (RS256 or ES256); `iss`; `exp`;
//! DPoP proof signature with the key in its header; `htm`, `htu` (against SKCONSENT_PUBLIC_URL + path), `iat`
//! within 5 minutes, one-time `jti`, `ath` equals the hash of the token, and the proof key thumbprint equals
//! the token's `cnf.jkt`. The identity is the token's `webid` claim.
//!
//! Limits: the JWKS is cached for 10 minutes (key rotation lags by that much); the jti replay cache is in memory
//! and per process; `aud` is not checked; there is no revocation check for tokens (they live about an hour).

use anyhow::{anyhow, bail, Result};
use axum::http::{HeaderMap, Method};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use jsonwebtoken::{jwk::JwkSet, Algorithm, DecodingKey, Validation};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Default)]
pub struct Verifier {
    jwks: tokio::sync::Mutex<Option<(Instant, JwkSet)>>,
    seen: Mutex<HashMap<String, Instant>>,
}

fn thumbprint(jwk: &Value) -> Result<String> {
    let canon = match jwk["kty"].as_str() {
        Some("EC") => format!(
            r#"{{"crv":"{}","kty":"EC","x":"{}","y":"{}"}}"#,
            jwk["crv"].as_str().unwrap_or(""),
            jwk["x"].as_str().unwrap_or(""),
            jwk["y"].as_str().unwrap_or("")
        ),
        Some("RSA") => format!(
            r#"{{"e":"{}","kty":"RSA","n":"{}"}}"#,
            jwk["e"].as_str().unwrap_or(""),
            jwk["n"].as_str().unwrap_or("")
        ),
        _ => bail!("unsupported DPoP key type"),
    };
    Ok(B64.encode(Sha256::digest(canon.as_bytes())))
}

fn allowed(alg: Algorithm) -> bool {
    matches!(alg, Algorithm::RS256 | Algorithm::ES256)
}

impl Verifier {
    async fn jwks(&self, http: &reqwest::Client, issuer: &str, force: bool) -> Result<JwkSet> {
        let mut g = self.jwks.lock().await;
        if !force {
            if let Some((t, s)) = &*g {
                if t.elapsed() < Duration::from_secs(600) {
                    return Ok(s.clone());
                }
            }
        }
        let disc: Value = http.get(format!("{issuer}/.well-known/openid-configuration")).send().await?.json().await?;
        let uri = disc["jwks_uri"].as_str().ok_or_else(|| anyhow!("no jwks_uri"))?;
        let set: JwkSet = http.get(uri).send().await?.json().await?;
        *g = Some((Instant::now(), set.clone()));
        Ok(set)
    }

    /// Returns the verified WebID, or an error describing why not.
    pub async fn verify(
        &self,
        http: &reqwest::Client,
        issuer: &str,
        public_url: &str,
        method: &Method,
        path: &str,
        headers: &HeaderMap,
    ) -> Result<String> {
        let auth = headers.get("authorization").and_then(|v| v.to_str().ok()).ok_or_else(|| anyhow!("missing Authorization"))?;
        let token = auth.strip_prefix("DPoP ").ok_or_else(|| anyhow!("Authorization scheme must be DPoP"))?.trim();
        let proof = headers.get("dpop").and_then(|v| v.to_str().ok()).ok_or_else(|| anyhow!("missing DPoP proof"))?;

        // Access token.
        let th = jsonwebtoken::decode_header(token)?;
        if !allowed(th.alg) {
            bail!("unsupported token algorithm");
        }
        let mut claims: Option<Value> = None;
        for force in [false, true] {
            let set = self.jwks(http, issuer, force).await?;
            let jwk = match &th.kid {
                Some(k) => set.find(k),
                None => set.keys.first(),
            };
            let Some(jwk) = jwk else { continue };
            let mut v = Validation::new(th.alg);
            v.validate_aud = false;
            v.leeway = 30;
            if let Ok(d) = jsonwebtoken::decode::<Value>(token, &DecodingKey::from_jwk(jwk)?, &v) {
                claims = Some(d.claims);
                break;
            }
        }
        let claims = claims.ok_or_else(|| anyhow!("access token signature or expiry invalid"))?;
        if claims["iss"].as_str().map(|s| s.trim_end_matches('/')) != Some(issuer) {
            bail!("token issuer is not the configured pod server");
        }
        let jkt = claims["cnf"]["jkt"].as_str().ok_or_else(|| anyhow!("token is not DPoP bound"))?;
        let webid = claims["webid"].as_str().ok_or_else(|| anyhow!("token has no webid claim"))?.to_string();

        // DPoP proof.
        let ph = jsonwebtoken::decode_header(proof)?;
        if ph.typ.as_deref() != Some("dpop+jwt") || !allowed(ph.alg) {
            bail!("bad DPoP proof header");
        }
        let jwk = ph.jwk.ok_or_else(|| anyhow!("DPoP proof has no jwk"))?;
        let jwk_json = serde_json::to_value(&jwk)?;
        if thumbprint(&jwk_json)? != jkt {
            bail!("DPoP key does not match the token binding");
        }
        let mut v = Validation::new(ph.alg);
        v.required_spec_claims.clear();
        v.validate_exp = false;
        v.validate_aud = false;
        let p = jsonwebtoken::decode::<Value>(proof, &DecodingKey::from_jwk(&jwk)?, &v)?.claims;
        if p["htm"].as_str().map(|m| m.eq_ignore_ascii_case(method.as_str())) != Some(true) {
            bail!("DPoP htm mismatch");
        }
        let want = format!("{public_url}{path}");
        if p["htu"].as_str() != Some(want.as_str()) {
            bail!("DPoP htu mismatch (expected {want})");
        }
        let iat = p["iat"].as_i64().unwrap_or(0);
        if (chrono::Utc::now().timestamp() - iat).abs() > 300 {
            bail!("DPoP proof too old or from the future");
        }
        if p["ath"].as_str() != Some(B64.encode(Sha256::digest(token.as_bytes())).as_str()) {
            bail!("DPoP ath mismatch");
        }
        let jti = p["jti"].as_str().ok_or_else(|| anyhow!("DPoP jti missing"))?.to_string();
        {
            let mut seen = self.seen.lock().unwrap_or_else(|e| e.into_inner());
            seen.retain(|_, t| t.elapsed() < Duration::from_secs(600));
            if seen.insert(jti, Instant::now()).is_some() {
                bail!("DPoP proof replayed");
            }
        }
        Ok(webid)
    }
}
