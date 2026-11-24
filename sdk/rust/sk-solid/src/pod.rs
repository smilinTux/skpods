//! Pod CRUD over Solid HTTP + DPoP. STUB.

use crate::{auth::Token, dpop::DpopKey, Config};

/// Authenticated session: config, key and token.
pub struct Session<'a> {
    pub cfg: &'a Config,
    pub key: &'a DpopKey,
    pub token: &'a Token,
}

/// Body kinds for PATCH.
pub enum PatchKind {
    N3Patch,
    SparqlUpdate,
}

/// GET a resource. `Ok(None)` on 404.
pub fn get(s: &Session, url: &str, accept: &str) -> crate::Result<Option<String>> {
    let _ = (s, url, accept);
    todo!("GET with Authorization: DPoP and a proof that includes ath")
}

/// PUT a resource (creates parent containers).
pub fn put(s: &Session, url: &str, body: &str, content_type: &str) -> crate::Result<()> {
    let _ = (s, url, body, content_type);
    todo!()
}

/// PATCH with N3 Patch (text/n3) or SPARQL Update (application/sparql-update).
pub fn patch(s: &Session, url: &str, body: &str, kind: PatchKind) -> crate::Result<()> {
    let _ = (s, url, body, kind);
    todo!()
}

/// DELETE a resource.
pub fn delete(s: &Session, url: &str) -> crate::Result<()> {
    let _ = (s, url);
    todo!()
}
