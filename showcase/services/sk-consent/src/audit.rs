use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

/// Genesis value for the chain of one subject. Fixed and derivable from the subject WebID, so a
/// mirrored copy of the chain can be verified with the entries alone.
pub fn genesis(subject: &str) -> String {
    sha256_hex(format!("sk-consent audit genesis v1:{}", subject).as_bytes())
}

pub fn sha256_hex(b: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(b)))
}

/// Canonical JSON: serde_json's default map is a BTreeMap, so keys are sorted, output is compact.
pub fn canonical(v: &Value) -> String {
    serde_json::to_string(v).expect("json serialises")
}

/// Hash of an entry: SHA-256 over the canonical JSON of the entry without its `hash` field.
pub fn entry_hash(entry: &Value) -> String {
    let mut m: Map<String, Value> = entry.as_object().cloned().unwrap_or_default();
    m.remove("hash");
    sha256_hex(canonical(&Value::Object(m)).as_bytes())
}

/// Build the next entry. `body` holds the event fields (event, ts, actor, request, grant, ...).
pub fn next_entry(subject: &str, seq: i64, prev: &str, body: Value) -> Value {
    let mut m = body.as_object().cloned().unwrap_or_default();
    m.insert("subject".into(), json!(subject));
    m.insert("seq".into(), json!(seq));
    m.insert("prev".into(), json!(prev));
    m.remove("hash");
    let mut v = Value::Object(m);
    let h = entry_hash(&v);
    v.as_object_mut().unwrap().insert("hash".into(), json!(h));
    v
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ChainReport {
    pub subject: String,
    pub entries: usize,
    pub ok: bool,
    pub head: Option<String>,
    pub first_bad_index: Option<i64>,
    pub reason: Option<String>,
}

/// Recompute a chain. `entries` must be ordered by seq. Index in the report is the `seq` of the first bad entry.
pub fn verify_chain(subject: &str, entries: &[Value]) -> ChainReport {
    let mut prev = genesis(subject);
    let mut rep = ChainReport {
        subject: subject.to_string(),
        entries: entries.len(),
        ok: true,
        head: None,
        first_bad_index: None,
        reason: None,
    };
    for (i, e) in entries.iter().enumerate() {
        let bad = |reason: &str| (Some(i as i64), Some(reason.to_string()));
        let (idx, why) = if e["seq"].as_i64() != Some(i as i64) {
            bad("sequence gap or reorder")
        } else if e["subject"].as_str() != Some(subject) {
            bad("entry belongs to another subject")
        } else if e["prev"].as_str() != Some(prev.as_str()) {
            bad("prev hash does not match the previous entry")
        } else if e["hash"].as_str() != Some(entry_hash(e).as_str()) {
            bad("entry content does not match its hash")
        } else {
            (None, None)
        };
        if idx.is_some() {
            rep.ok = false;
            rep.first_bad_index = idx;
            rep.reason = why;
            return rep;
        }
        prev = e["hash"].as_str().unwrap().to_string();
        rep.head = Some(prev.clone());
    }
    rep
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chain(n: usize) -> Vec<Value> {
        let s = "https://example.org/alice#me";
        let mut out: Vec<Value> = vec![];
        let mut prev = genesis(s);
        for i in 0..n {
            let e = next_entry(s, i as i64, &prev, json!({"event": "test", "ts": "2026-01-01T00:00:00.000Z", "n": i}));
            prev = e["hash"].as_str().unwrap().to_string();
            out.push(e);
        }
        out
    }

    #[test]
    fn good_chain_verifies() {
        let c = chain(5);
        let r = verify_chain("https://example.org/alice#me", &c);
        assert!(r.ok && r.entries == 5 && r.head.is_some());
        assert!(verify_chain("https://example.org/alice#me", &[]).ok);
    }

    #[test]
    fn edited_entry_is_found() {
        let mut c = chain(5);
        c[2]["n"] = json!(99);
        let r = verify_chain("https://example.org/alice#me", &c);
        assert!(!r.ok);
        assert_eq!(r.first_bad_index, Some(2));
    }

    #[test]
    fn rehashed_edit_breaks_next_link() {
        let mut c = chain(5);
        c[1]["n"] = json!(99);
        let h = entry_hash(&c[1]);
        c[1]["hash"] = json!(h);
        let r = verify_chain("https://example.org/alice#me", &c);
        assert_eq!(r.first_bad_index, Some(2));
    }

    #[test]
    fn deleted_and_truncated_start() {
        let mut c = chain(4);
        c.remove(1);
        assert_eq!(verify_chain("https://example.org/alice#me", &c).first_bad_index, Some(1));
        let c = chain(4)[1..].to_vec();
        assert_eq!(verify_chain("https://example.org/alice#me", &c).first_bad_index, Some(0));
    }

    #[test]
    fn hash_is_stable() {
        let e = json!({"b": 1, "a": "x", "hash": "ignored"});
        let e2 = json!({"a": "x", "b": 1});
        assert_eq!(entry_hash(&e), entry_hash(&e2));
    }
}
