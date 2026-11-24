//! sk-solid: STUB crate. Every function body is `todo!()` unless noted.
//!
//! Modules: [`dpop`] proofs, [`auth`] client credentials, [`pod`] CRUD,
//! [`acl`] WAC grants, [`seed`] fixtures. Config comes from environment
//! variables only (`SKPODS_BASE`, `SKPODS_CLIENT_ID`, `SKPODS_CLIENT_SECRET`);
//! never put secrets in code or commit them.

pub mod acl;
pub mod auth;
pub mod dpop;
pub mod pod;
pub mod seed;

/// Errors for the whole crate.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("missing environment variable {0}")]
    MissingEnv(&'static str),
    #[error("http status {0} for {1}")]
    Status(u16, String),
    #[error("not implemented: {0}")]
    NotImplemented(&'static str),
}

pub type Result<T> = std::result::Result<T, Error>;

/// Server settings read from the environment.
#[derive(Debug, Clone)]
pub struct Config {
    pub base: String,
    pub client_id: Option<String>,
    pub client_secret: Option<String>,
}

impl Config {
    /// Reads `SKPODS_BASE` (required), `SKPODS_CLIENT_ID`, `SKPODS_CLIENT_SECRET`.
    pub fn from_env() -> Result<Self> {
        let base = std::env::var("SKPODS_BASE").map_err(|_| Error::MissingEnv("SKPODS_BASE"))?;
        Ok(Self {
            base: base.trim_end_matches('/').to_string(),
            client_id: std::env::var("SKPODS_CLIENT_ID").ok(),
            client_secret: std::env::var("SKPODS_CLIENT_SECRET").ok(),
        })
    }

    /// Pod root for a user: `{base}/apps/solid/~{user}/storage/`.
    pub fn pod_root(&self, user: &str) -> String {
        format!("{}/apps/solid/~{}/storage/", self.base, user)
    }
}
