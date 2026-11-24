use crate::audit;
use crate::model::{ConsentRequest, Grant, GrantStatus};
use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::path::Path;
use std::sync::Mutex;

/// SQLite store. Holds request and grant records (resource URLs and decisions, no pod content) and the audit chains.
pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        Self::init(conn)
    }

    pub fn memory() -> Result<Self> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self> {
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, subject TEXT NOT NULL, created TEXT NOT NULL, json TEXT NOT NULL);
             CREATE INDEX IF NOT EXISTS requests_subject ON requests(subject, created);
             CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY, subject TEXT NOT NULL, resource TEXT NOT NULL,
                 status TEXT NOT NULL, ends TEXT NOT NULL, json TEXT NOT NULL);
             CREATE INDEX IF NOT EXISTS grants_subject ON grants(subject);
             CREATE INDEX IF NOT EXISTS grants_active ON grants(status, ends);
             CREATE TABLE IF NOT EXISTS audit(subject TEXT NOT NULL, seq INTEGER NOT NULL, hash TEXT NOT NULL, json TEXT NOT NULL,
                 PRIMARY KEY(subject, seq));",
        )?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    fn c(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn put_request(&self, r: &ConsentRequest) -> Result<()> {
        self.c().execute(
            "INSERT INTO requests(id,subject,created,json) VALUES(?1,?2,?3,?4)
             ON CONFLICT(id) DO UPDATE SET json=excluded.json",
            params![r.id, r.subject, r.created.to_rfc3339(), serde_json::to_string(r)?],
        )?;
        Ok(())
    }

    pub fn get_request(&self, id: &str) -> Result<Option<ConsentRequest>> {
        let j: Option<String> = self.c().query_row("SELECT json FROM requests WHERE id=?1", [id], |r| r.get(0)).optional()?;
        Ok(j.map(|j| serde_json::from_str(&j)).transpose()?)
    }

    pub fn list_requests(&self, subject: Option<&str>) -> Result<Vec<ConsentRequest>> {
        let c = self.c();
        let mut st = c.prepare("SELECT json FROM requests WHERE (?1 IS NULL OR subject=?1) ORDER BY created DESC")?;
        let rows = st.query_map([subject], |r| r.get::<_, String>(0))?;
        let mut out = vec![];
        for j in rows {
            out.push(serde_json::from_str(&j?)?);
        }
        Ok(out)
    }

    pub fn put_grant(&self, g: &Grant) -> Result<()> {
        self.c().execute(
            "INSERT INTO grants(id,subject,resource,status,ends,json) VALUES(?1,?2,?3,?4,?5,?6)
             ON CONFLICT(id) DO UPDATE SET status=excluded.status, json=excluded.json",
            params![g.id, g.subject, g.resource, status_str(g.status), g.ends.to_rfc3339(), serde_json::to_string(g)?],
        )?;
        Ok(())
    }

    pub fn get_grant(&self, id: &str) -> Result<Option<Grant>> {
        let j: Option<String> = self.c().query_row("SELECT json FROM grants WHERE id=?1", [id], |r| r.get(0)).optional()?;
        Ok(j.map(|j| serde_json::from_str(&j)).transpose()?)
    }

    pub fn list_grants(&self, subject: Option<&str>, status: Option<&str>) -> Result<Vec<Grant>> {
        let c = self.c();
        let mut st = c.prepare(
            "SELECT json FROM grants WHERE (?1 IS NULL OR subject=?1) AND (?2 IS NULL OR status=?2) ORDER BY rowid DESC",
        )?;
        let rows = st.query_map(params![subject, status], |r| r.get::<_, String>(0))?;
        let mut out = vec![];
        for j in rows {
            out.push(serde_json::from_str(&j?)?);
        }
        Ok(out)
    }

    pub fn active_grants_for_resource(&self, resource: &str) -> Result<Vec<Grant>> {
        let c = self.c();
        let mut st = c.prepare("SELECT json FROM grants WHERE resource=?1 AND status='active'")?;
        let rows = st.query_map([resource], |r| r.get::<_, String>(0))?;
        let mut out = vec![];
        for j in rows {
            out.push(serde_json::from_str(&j?)?);
        }
        Ok(out)
    }

    /// Active grants whose end time has passed. This is the persisted revoke schedule: a restart loses nothing.
    pub fn due_grants(&self, now: DateTime<Utc>) -> Result<Vec<Grant>> {
        let all = {
            let c = self.c();
            let mut st = c.prepare("SELECT json FROM grants WHERE status='active'")?;
            let rows = st.query_map([], |r| r.get::<_, String>(0))?;
            let mut v: Vec<Grant> = vec![];
            for j in rows {
                v.push(serde_json::from_str(&j?)?);
            }
            v
        };
        Ok(all.into_iter().filter(|g| g.ends <= now).collect())
    }

    /// Append an entry to the subject's chain. `body` holds the event fields.
    pub fn audit_append(&self, subject: &str, body: Value) -> Result<Value> {
        let c = self.c();
        let last: Option<(i64, String)> = c
            .query_row("SELECT seq, hash FROM audit WHERE subject=?1 ORDER BY seq DESC LIMIT 1", [subject], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()?;
        let (seq, prev) = match last {
            Some((s, h)) => (s + 1, h),
            None => (0, audit::genesis(subject)),
        };
        let e = audit::next_entry(subject, seq, &prev, body);
        c.execute(
            "INSERT INTO audit(subject,seq,hash,json) VALUES(?1,?2,?3,?4)",
            params![subject, seq, e["hash"].as_str().unwrap_or_default(), audit::canonical(&e)],
        )?;
        Ok(e)
    }

    pub fn audit_chain(&self, subject: &str) -> Result<Vec<Value>> {
        let c = self.c();
        let mut st = c.prepare("SELECT json FROM audit WHERE subject=?1 ORDER BY seq")?;
        let rows = st.query_map([subject], |r| r.get::<_, String>(0))?;
        let mut out = vec![];
        for j in rows {
            out.push(serde_json::from_str(&j?)?);
        }
        Ok(out)
    }

    pub fn audit_subjects(&self) -> Result<Vec<String>> {
        let c = self.c();
        let mut st = c.prepare("SELECT DISTINCT subject FROM audit ORDER BY subject")?;
        let rows = st.query_map([], |r| r.get::<_, String>(0))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// Test hook: raw SQL (used to prove tamper detection).
    pub fn raw_exec(&self, sql: &str) -> Result<()> {
        self.c().execute_batch(sql)?;
        Ok(())
    }
}

fn status_str(s: GrantStatus) -> &'static str {
    match s {
        GrantStatus::Active => "active",
        GrantStatus::Revoked => "revoked",
        GrantStatus::Expired => "expired",
        GrantStatus::Failed => "failed",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn chain_in_store_verifies_and_detects_tamper() {
        let s = Store::memory().unwrap();
        let sub = "https://x/alice#me";
        for i in 0..4 {
            s.audit_append(sub, json!({"event": "e", "ts": "2026-01-01T00:00:00.000Z", "i": i})).unwrap();
        }
        s.audit_append("https://x/bob#me", json!({"event": "other"})).unwrap();
        let ch = s.audit_chain(sub).unwrap();
        assert_eq!(ch.len(), 4);
        assert!(audit::verify_chain(sub, &ch).ok);
        s.raw_exec("UPDATE audit SET json = replace(json, '\"i\":2', '\"i\":9') WHERE seq=2 AND subject='https://x/alice#me'").unwrap();
        let r = audit::verify_chain(sub, &s.audit_chain(sub).unwrap());
        assert!(!r.ok);
        assert_eq!(r.first_bad_index, Some(2));
        assert!(audit::verify_chain("https://x/bob#me", &s.audit_chain("https://x/bob#me").unwrap()).ok);
    }
}
