//! Fixture seeding for pods-dev (fake data only). STUB.

use crate::Config;

/// Writes example fixtures into the test users' pods
/// and registers them in Type Indexes. With `reset`, deletes the fixture
/// containers first so the run is repeatable.
pub fn seed(cfg: &Config, reset: bool) -> crate::Result<()> {
    let _ = (cfg, reset);
    todo!("log in per test user, PUT fixtures under /skpods/v1/, write Type Index entries")
}
