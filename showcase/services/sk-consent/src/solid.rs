//! Solid client: client-credentials login, DPoP (ES256), token refresh, GET/PUT/DELETE, `.acl` via Link rel=acl.
//!
//! Verified against pods-dev: the server advertises RS256 for DPoP in discovery, but the
//! client-credentials flow accepts ES256 proofs (the Python reference does too). If a server rejects
//! ES256, this client has no RS256 fallback yet.

use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use p256::ecdsa::{signature::Signer, Signature, SigningKey};
use reqwest::{header::HeaderMap, Method, StatusCode};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct Creds {
    pub client_id: String,
    pub client_secret: String,
}

struct Token {
    access: String,
    refresh_at: Instant,
    webid: String,
}

pub struct SolidClient {
    http: reqwest::Client,
    pub base: String,
    token_endpoint: Mutex<Option<String>>,
    creds: Creds,
    key: SigningKey,
    jwk: Value,
    token: Mutex<Option<Token>>,
    acl_cache: std::sync::Mutex<std::collections::HashMap<String, String>>,
}

pub struct Resp {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: String,
    pub url: String,
}

pub fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("http client")
}

fn strip_frag_query(url: &str) -> String {
    let u = url.split('#').next().unwrap_or(url);
    u.split('?').next().unwrap_or(u).to_string()
}

impl SolidClient {
    pub fn new(base: &str, creds: Creds) -> Arc<Self> {
        let key = SigningKey::random(&mut rand_core::OsRng);
        let pt = key.verifying_key().to_encoded_point(false);
        let jwk = json!({
            "kty": "EC", "crv": "P-256",
            "x": B64.encode(pt.x().expect("x")),
            "y": B64.encode(pt.y().expect("y")),
        });
        Arc::new(Self {
            http: http_client(),
            base: base.trim_end_matches('/').to_string(),
            token_endpoint: Mutex::new(None),
            creds,
            key,
            jwk,
            token: Mutex::new(None),
            acl_cache: Default::default(),
        })
    }

    /// Mint client credentials with the Nextcloud user name and password (or app password).
    /// The returned secret is a credential: the caller decides where it goes.
    pub async fn mint(base: &str, user: &str, password: &str, name: &str) -> Result<(Creds, String)> {
        let r = http_client()
            .post(format!("{}/apps/solid/client-credentials", base.trim_end_matches('/')))
            .basic_auth(user, Some(password))
            .header("OCS-APIRequest", "true")
            .json(&json!({ "name": name }))
            .send()
            .await?;
        let st = r.status();
        let v: Value = r.json().await.unwrap_or(Value::Null);
        if !st.is_success() {
            bail!("client-credentials mint for {user} failed: HTTP {st}");
        }
        let id = v["client_id"].as_str().ok_or_else(|| anyhow!("no client_id in mint response"))?;
        let sec = v["client_secret"].as_str().ok_or_else(|| anyhow!("no client_secret in mint response"))?;
        let webid = v["webid"].as_str().unwrap_or_default().to_string();
        Ok((Creds { client_id: id.into(), client_secret: sec.into() }, webid))
    }

    pub async fn revoke_minted(base: &str, user: &str, password: &str, client_id: &str) -> Result<()> {
        http_client()
            .delete(format!("{}/apps/solid/client-credentials/{}", base.trim_end_matches('/'), client_id))
            .basic_auth(user, Some(password))
            .header("OCS-APIRequest", "true")
            .send()
            .await?;
        Ok(())
    }

    /// Mint ephemeral credentials for a demo identity and build a client. Call `cleanup` when done.
    pub async fn ephemeral(base: &str, user: &str, password: &str) -> Result<(Arc<Self>, Ephemeral)> {
        let (c, _) = Self::mint(base, user, password, "sk-consent demo (ephemeral)").await?;
        let eph = Ephemeral {
            base: base.into(),
            user: user.into(),
            password: password.into(),
            client_id: c.client_id.clone(),
        };
        Ok((Self::new(base, c), eph))
    }

    /// DPoP proof JWT (ES256) for one request.
    pub fn proof(&self, method: &str, url: &str, access_token: Option<&str>, nonce: Option<&str>) -> String {
        let header = json!({ "typ": "dpop+jwt", "alg": "ES256", "jwk": self.jwk });
        let mut claims = json!({
            "htm": method.to_ascii_uppercase(),
            "htu": strip_frag_query(url),
            "iat": chrono::Utc::now().timestamp(),
            "jti": uuid::Uuid::new_v4().to_string(),
        });
        if let Some(t) = access_token {
            claims["ath"] = json!(B64.encode(Sha256::digest(t.as_bytes())));
        }
        if let Some(n) = nonce {
            claims["nonce"] = json!(n);
        }
        let signing_input = format!(
            "{}.{}",
            B64.encode(serde_json::to_vec(&header).unwrap()),
            B64.encode(serde_json::to_vec(&claims).unwrap())
        );
        let sig: Signature = self.key.sign(signing_input.as_bytes());
        format!("{}.{}", signing_input, B64.encode(sig.to_bytes()))
    }

    async fn token_endpoint(&self) -> Result<String> {
        let mut g = self.token_endpoint.lock().await;
        if let Some(t) = &*g {
            return Ok(t.clone());
        }
        let d: Value = self
            .http
            .get(format!("{}/.well-known/openid-configuration", self.base))
            .send()
            .await?
            .json()
            .await
            .context("discovery document")?;
        let t = d["token_endpoint"].as_str().map(str::to_string).unwrap_or_else(|| format!("{}/apps/solid/token", self.base));
        *g = Some(t.clone());
        Ok(t)
    }

    async fn fetch_token(&self) -> Result<Token> {
        let ep = self.token_endpoint().await?;
        let mut nonce: Option<String> = None;
        for _ in 0..2 {
            let mut rb = self
                .http
                .post(&ep)
                .basic_auth(&self.creds.client_id, Some(&self.creds.client_secret))
                .header("DPoP", self.proof("POST", &ep, None, nonce.as_deref()))
                .form(&[("grant_type", "client_credentials"), ("scope", "webid")]);
            rb = rb.header("Accept", "application/json");
            let r = rb.send().await?;
            let st = r.status();
            let n = r.headers().get("dpop-nonce").and_then(|v| v.to_str().ok()).map(str::to_string);
            let v: Value = r.json().await.unwrap_or(Value::Null);
            if st.is_success() {
                let access = v["access_token"].as_str().ok_or_else(|| anyhow!("no access_token"))?.to_string();
                let exp = v["expires_in"].as_u64().unwrap_or(3600);
                // Refresh at 80 percent of the lifetime (about 48 minutes for a 1 hour token).
                let refresh_at = Instant::now() + Duration::from_secs(exp * 8 / 10);
                let webid = jwt_claim(&access, "webid").unwrap_or_default();
                return Ok(Token { access, refresh_at, webid });
            }
            if n.is_some() && nonce.is_none() {
                nonce = n;
                continue;
            }
            bail!("token request failed: HTTP {st} {}", v["error"].as_str().unwrap_or(""));
        }
        bail!("token request failed after nonce retry")
    }

    /// Returns a valid access token, refreshing (client credentials have no refresh token: ask again).
    async fn access(&self, force: bool) -> Result<String> {
        let mut g = self.token.lock().await;
        let need = force || g.as_ref().map(|t| Instant::now() >= t.refresh_at).unwrap_or(true);
        if need {
            *g = Some(self.fetch_token().await?);
        }
        Ok(g.as_ref().unwrap().access.clone())
    }

    /// WebID the token acts as (the `webid` claim).
    pub async fn webid(&self) -> Result<String> {
        self.access(false).await?;
        Ok(self.token.lock().await.as_ref().map(|t| t.webid.clone()).unwrap_or_default())
    }

    /// Headers (Authorization, DPoP) to call some other DPoP-aware service with this identity.
    pub async fn auth_headers(&self, method: &str, url: &str) -> Result<Vec<(&'static str, String)>> {
        let t = self.access(false).await?;
        Ok(vec![
            ("Authorization", format!("DPoP {t}")),
            ("DPoP", self.proof(method, url, Some(&t), None)),
        ])
    }

    pub async fn request(
        &self,
        method: Method,
        url: &str,
        content_type: Option<&str>,
        accept: Option<&str>,
        body: Option<String>,
    ) -> Result<Resp> {
        let mut force = false;
        let mut nonce: Option<String> = None;
        for attempt in 0..3 {
            let tok = self.access(force).await?;
            let mut rb = self
                .http
                .request(method.clone(), url)
                .header("Authorization", format!("DPoP {tok}"))
                .header("DPoP", self.proof(method.as_str(), url, Some(&tok), nonce.as_deref()));
            if let Some(c) = content_type {
                rb = rb.header("Content-Type", c);
            }
            if let Some(a) = accept {
                rb = rb.header("Accept", a);
            }
            if let Some(b) = &body {
                rb = rb.body(b.clone());
            }
            let r = rb.send().await.with_context(|| format!("{method} {url}"))?;
            let status = r.status();
            let headers = r.headers().clone();
            if status == StatusCode::UNAUTHORIZED && attempt < 2 {
                if let Some(n) = headers.get("dpop-nonce").and_then(|v| v.to_str().ok()) {
                    nonce = Some(n.to_string());
                } else {
                    force = true; // token probably expired or was invalidated: get a new one once
                }
                continue;
            }
            let body = r.text().await.unwrap_or_default();
            return Ok(Resp { status, headers, body, url: url.to_string() });
        }
        bail!("{method} {url}: unauthorized after retries")
    }

    pub async fn get(&self, url: &str) -> Result<Resp> {
        self.request(Method::GET, url, None, Some("text/turtle, application/ld+json;q=0.8, */*;q=0.5"), None).await
    }

    pub async fn get_as(&self, url: &str, accept: &str) -> Result<Resp> {
        self.request(Method::GET, url, None, Some(accept), None).await
    }

    pub async fn put(&self, url: &str, content_type: &str, body: String) -> Result<Resp> {
        let r = self.request(Method::PUT, url, Some(content_type), None, Some(body)).await?;
        if !r.status.is_success() {
            bail!("PUT {url} -> {}", r.status);
        }
        Ok(r)
    }

    /// DELETE. 404 counts as success (already gone).
    pub async fn delete(&self, url: &str) -> Result<StatusCode> {
        let r = self.request(Method::DELETE, url, None, None, None).await?;
        if !(r.status.is_success() || r.status == StatusCode::NOT_FOUND) {
            bail!("DELETE {url} -> {}", r.status);
        }
        Ok(r.status)
    }

    /// Find the `.acl` URL of a resource from its Link rel="acl" header (HEAD, then GET, then convention).
    pub async fn acl_url(&self, resource: &str) -> Result<String> {
        if let Some(u) = self.acl_cache.lock().unwrap().get(resource) {
            return Ok(u.clone());
        }
        let mut found = None;
        for m in [Method::HEAD, Method::GET] {
            if let Ok(r) = self.request(m, resource, None, Some("text/turtle"), None).await {
                if let Some(u) = acl_from_link(&r.headers, resource) {
                    found = Some(u);
                    break;
                }
            }
        }
        let u = found.unwrap_or_else(|| format!("{}.acl", resource.trim_end_matches('/')));
        self.acl_cache.lock().unwrap().insert(resource.to_string(), u.clone());
        Ok(u)
    }

    pub async fn read_acl(&self, resource: &str) -> Result<Option<String>> {
        let acl = self.acl_url(resource).await?;
        let r = self.request(Method::GET, &acl, None, Some("text/turtle"), None).await?;
        Ok(r.status.is_success().then_some(r.body))
    }

    pub async fn write_acl(&self, resource: &str, turtle: String) -> Result<()> {
        let acl = self.acl_url(resource).await?;
        self.put(&acl, "text/turtle", turtle).await?;
        Ok(())
    }

    pub async fn delete_acl(&self, resource: &str) -> Result<()> {
        let acl = self.acl_url(resource).await?;
        self.delete(&acl).await?;
        Ok(())
    }
}

pub struct Ephemeral {
    base: String,
    user: String,
    password: String,
    client_id: String,
}

impl Ephemeral {
    pub async fn cleanup(self) {
        let _ = SolidClient::revoke_minted(&self.base, &self.user, &self.password, &self.client_id).await;
    }
}

pub fn acl_from_link(h: &HeaderMap, resource: &str) -> Option<String> {
    for v in h.get_all("link") {
        let s = v.to_str().ok()?;
        for part in split_links(s) {
            if part.contains("rel=\"acl\"") || part.contains("rel=acl") {
                let start = part.find('<')? + 1;
                let end = part.find('>')?;
                let href = &part[start..end];
                return url::Url::parse(resource).ok()?.join(href).ok().map(|u| u.to_string());
            }
        }
    }
    None
}

fn split_links(s: &str) -> Vec<&str> {
    // Links are comma separated, but commas can sit inside <...>; split on ", <".
    let mut out = vec![];
    let mut last = 0;
    let b = s.as_bytes();
    let mut i = 0;
    while i + 2 < b.len() {
        if b[i] == b',' && s[i + 1..].trim_start().starts_with('<') {
            out.push(&s[last..i]);
            last = i + 1;
        }
        i += 1;
    }
    out.push(&s[last..]);
    out
}

/// Read a claim from a JWT payload WITHOUT verifying it. Only for tokens this process just obtained
/// from the issuer over TLS.
pub fn jwt_claim(jwt: &str, claim: &str) -> Option<String> {
    let p = jwt.split('.').nth(1)?;
    let v: Value = serde_json::from_slice(&B64.decode(p).ok()?).ok()?;
    v[claim].as_str().map(str::to_string)
}

/// Resolve the storage root of a WebID: pim:storage in the profile, else the pods-dev shape.
pub async fn storage_root(http: &reqwest::Client, webid: &str) -> String {
    let doc = webid.split('#').next().unwrap_or(webid);
    if let Ok(r) = http.get(doc).header("Accept", "text/turtle").send().await {
        if r.status().is_success() {
            if let Ok(t) = r.text().await {
                for tr in crate::rdf::parse_turtle(&t, doc) {
                    if tr.p == crate::rdf::PIM_STORAGE && tr.o_is_iri {
                        return tr.o;
                    }
                }
            }
        }
    }
    // Fallback: <host>/apps/solid/~user/profile/card#me -> <host>/apps/solid/~user/storage/
    match doc.rfind("/profile/") {
        Some(i) => format!("{}/storage/", &doc[..i]),
        None => format!("{}/", doc.trim_end_matches('/')),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links() {
        let mut h = HeaderMap::new();
        h.insert(
            "link",
            r#"</.well-known/solid>; rel="http://www.w3.org/ns/solid#storageDescription", <dob.ttl.acl>; rel="acl""#.parse().unwrap(),
        );
        assert_eq!(
            acl_from_link(&h, "https://h/p/dob.ttl").as_deref(),
            Some("https://h/p/dob.ttl.acl")
        );
    }

    #[test]
    fn proof_has_expected_shape() {
        let c = SolidClient::new("https://h", Creds { client_id: "a".into(), client_secret: "b".into() });
        let p = c.proof("get", "https://h/x?y=1#f", Some("tok"), None);
        let parts: Vec<_> = p.split('.').collect();
        assert_eq!(parts.len(), 3);
        let claims: Value = serde_json::from_slice(&B64.decode(parts[1]).unwrap()).unwrap();
        assert_eq!(claims["htm"], "GET");
        assert_eq!(claims["htu"], "https://h/x");
        assert!(claims["ath"].is_string());
        let h: Value = serde_json::from_slice(&B64.decode(parts[0]).unwrap()).unwrap();
        assert_eq!(h["alg"], "ES256");
        assert_eq!(h["typ"], "dpop+jwt");
    }
}
