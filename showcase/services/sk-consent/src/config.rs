use anyhow::{bail, Context, Result};
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct Config {
    pub bind: String,
    pub db_path: PathBuf,
    /// Base URL of the Solid server (also its OIDC issuer), no trailing slash.
    pub pods_base: String,
    pub client_id: String,
    pub client_secret: String,
    /// Public URL of this service as browsers and clients call it. Used to check the DPoP `htu` of owner tokens.
    pub public_url: String,
    pub cors_origins: Vec<String>,
    /// Allow any http://localhost:* and http://127.0.0.1:* origin (dev).
    pub cors_localhost: bool,
    /// DEV ONLY. Skip token verification and trust the X-Demo-WebID header.
    pub insecure_owner: bool,
    pub llm_base_url: Option<String>,
    pub llm_model: Option<String>,
    pub llm_api_key: Option<String>,
}

fn env(k: &str) -> Option<String> {
    std::env::var(k).ok().filter(|v| !v.trim().is_empty())
}

/// Read KEY=VALUE lines from an env-style file (no export, no quoting rules beyond trimming quotes).
fn read_env_file(p: &str) -> Result<Vec<(String, String)>> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(p).with_context(|| format!("credentials file {p}"))?.permissions().mode();
        if mode & 0o077 != 0 {
            tracing::warn!("credentials file {p} is readable by others (mode {:o}); chmod 600 it", mode & 0o777);
        }
    }
    let t = std::fs::read_to_string(p).with_context(|| format!("credentials file {p}"))?;
    Ok(t.lines()
        .filter_map(|l| {
            let l = l.trim();
            if l.starts_with('#') {
                return None;
            }
            let (k, v) = l.split_once('=')?;
            Some((k.trim().to_string(), v.trim().trim_matches('"').trim_matches('\'').to_string()))
        })
        .collect())
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let pods_base = env("SKPODS_BASE").unwrap_or_default().trim_end_matches('/').to_string();
        if pods_base.is_empty() {
            bail!("SKPODS_BASE is not set (for example https://pods-dev.example.org)");
        }
        let (mut id, mut secret) = (env("SKCONSENT_CLIENT_ID"), env("SKCONSENT_CLIENT_SECRET"));
        if id.is_none() || secret.is_none() {
            if let Some(f) = env("SKCONSENT_CREDS_FILE") {
                for (k, v) in read_env_file(&f)? {
                    match k.as_str() {
                        "SKCONSENT_CLIENT_ID" => id = Some(v),
                        "SKCONSENT_CLIENT_SECRET" => secret = Some(v),
                        _ => {}
                    }
                }
            }
        }
        let (Some(client_id), Some(client_secret)) = (id, secret) else {
            bail!("agent credentials missing: set SKCONSENT_CREDS_FILE (0600 file with SKCONSENT_CLIENT_ID and SKCONSENT_CLIENT_SECRET) or the two variables");
        };
        let bind = env("SKCONSENT_BIND").unwrap_or_else(|| "127.0.0.1:8787".into());
        let public_url = env("SKCONSENT_PUBLIC_URL").unwrap_or_else(|| format!("http://{bind}")).trim_end_matches('/').to_string();
        Ok(Config {
            bind,
            db_path: env("SKCONSENT_DB").unwrap_or_else(|| "sk-consent.db".into()).into(),
            pods_base,
            client_id,
            client_secret,
            public_url,
            cors_origins: env("SKCONSENT_CORS_ORIGINS")
                .map(|s| s.split(',').map(|x| x.trim().trim_end_matches('/').to_string()).filter(|x| !x.is_empty()).collect())
                .unwrap_or_default(),
            cors_localhost: env("SKCONSENT_CORS_LOCALHOST").map(|v| v != "0").unwrap_or(true),
            insecure_owner: env("DEMO_INSECURE_OWNER").map(|v| v == "1").unwrap_or(false),
            llm_base_url: env("GUARDIAN_LLM_BASE_URL"),
            llm_model: env("GUARDIAN_LLM_MODEL"),
            llm_api_key: env("GUARDIAN_LLM_API_KEY"),
        })
    }
}
