//! WAC grants and revokes. STUB. Dev tooling, not the consent broker.

use crate::pod::Session;

/// Access modes.
#[derive(Debug, Clone, Copy)]
pub enum Mode {
    Read,
    Append,
    Write,
    Control,
}

/// Grants `grantee` (a WebID) the given modes on `resource` by writing its `.acl`.
/// Merges with the existing ACL so the owner keeps Control.
pub fn grant(s: &Session, resource: &str, grantee: &str, modes: &[Mode], inherit: bool) -> crate::Result<()> {
    let _ = (s, resource, grantee, modes, inherit);
    todo!("read .acl (Link rel=acl), merge authorization, PUT")
}

/// Removes the authorization for `grantee` from the `.acl` of `resource`.
pub fn revoke(s: &Session, resource: &str, grantee: &str) -> crate::Result<()> {
    let _ = (s, resource, grantee);
    todo!()
}
