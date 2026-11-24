//! Demo helpers: `seed-demo` (fake PII into one pod, guardian setup) and `simulate-clinic` (the clinic's side of the story).
//! Everything written here is fake data for test accounts.

use crate::broker::Broker;
use crate::model::*;
use crate::policy;
use crate::solid::{self, SolidClient};
use crate::util::*;
use anyhow::{bail, Context, Result};
use chrono::Duration;
use serde_json::{json, Value};
use std::sync::Arc;

pub struct Actor {
    pub user: String,
    pub password: String,
}

impl Actor {
    /// Read `<prefix>_USER` and `<prefix>_PASSWORD` from the environment, e.g. DW_ALICE.
    pub fn from_env(prefix: &str, default_user: &str) -> Result<Self> {
        let user = std::env::var(format!("{prefix}_USER")).unwrap_or_else(|_| default_user.to_string());
        let password = std::env::var(format!("{prefix}_PASSWORD")).with_context(|| format!("{prefix}_PASSWORD is not set"))?;
        Ok(Self { user, password })
    }
    pub fn webid(&self, base: &str) -> String {
        format!("{}/apps/solid/~{}/profile/card#me", base.trim_end_matches('/'), self.user)
    }
}

const P: &str = "@prefix skp: <https://w3id.org/skpods/v1#> .\n@prefix schema: <http://schema.org/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n@prefix acl: <http://www.w3.org/ns/auth/acl#> .\n# FAKE DATA for a test account. Never put real people here.\n";

fn acl(auths: &[(&str, &str, &str, bool, &str)]) -> String {
    // (id, agent, target, default, modes)
    let mut t = String::from("@prefix acl: <http://www.w3.org/ns/auth/acl#>.\n");
    for (id, agent, target, def, modes) in auths {
        t.push_str(&format!("<#{id}> a acl:Authorization; acl:agent {}; acl:accessTo {}", ttl_iri(agent), ttl_iri(target)));
        if *def {
            t.push_str(&format!("; acl:default {}", ttl_iri(target)));
        }
        t.push_str(&format!("; acl:mode {modes}.\n"));
    }
    t
}

pub struct SeedReport {
    pub subject: String,
    pub agent: String,
    pub clinic: String,
    pub booking_ref: String,
    pub written: Vec<String>,
}

pub async fn seed_demo(base: &str, owner: &Actor, clinic: &Actor, agent_webid: &str) -> Result<SeedReport> {
    let http = solid::http_client();
    let subject = owner.webid(base);
    let clinic_webid = clinic.webid(base);
    let root = solid::storage_root(&http, &subject).await;
    let (c, eph) = SolidClient::ephemeral(base, &owner.user, &owner.password).await?;
    let res = seed_inner(&c, &root, &subject, &clinic_webid, agent_webid).await;
    eph.cleanup().await;
    let written = res?;
    Ok(SeedReport { subject, agent: agent_webid.into(), clinic: clinic_webid, booking_ref: "BAY-1042".into(), written })
}

async fn seed_inner(c: &Arc<SolidClient>, root: &str, subject: &str, clinic: &str, agent: &str) -> Result<Vec<String>> {
    let mut written = vec![];
    let health = format!("{root}skpods/v1/health/");
    let mut put = |url: String, ct: &'static str, body: String| {
        written.push(url.clone());
        let c = c.clone();
        async move { c.put(&url, ct, body).await.map(|_| ()) }
    };
    let rec = |class: &str, extra: &str| format!("{P}<#it> a skp:HealthRecord ;\n  skp:dataClass \"{class}\" ;\n  schema:name \"Alice Rivera\" ;\n{extra} .\n");
    let files: Vec<(&str, String)> = vec![
        ("dob.ttl", rec("dob", "  schema:birthDate \"1988-04-12\"^^xsd:date")),
        ("allergies.ttl", rec("allergies", "  skp:allergen \"Penicillin\", \"Peanuts\"")),
        ("medications.ttl", rec("medications", "  skp:medication \"Lisinopril 10 mg once daily\", \"Cetirizine 10 mg as needed\"")),
        ("insurance-card.ttl", rec("insurance_member_id", "  skp:insurer \"Harborline Health (fictional)\" ;\n  skp:memberId \"HBL-4417-0098-FAKE\"")),
        ("ssn.ttl", rec("ssn", "  skp:ssn \"000-00-0000\" ;\n  skp:neverShare true")),
    ];
    // Clear leftovers from earlier runs first: a stale per-resource ACL could still carry a grant.
    for (name, _) in &files {
        if *name != "ssn.ttl" {
            let _ = c.delete(&format!("{health}{name}.acl")).await;
        }
    }
    for (name, body) in files {
        put(format!("{health}{name}"), "text/turtle", body).await?;
    }
    // Containers: owner full, agent Control (and Read) over the health container only.
    put(
        format!("{health}.acl"),
        "text/turtle",
        acl(&[("owner", subject, &health, true, "acl:Read, acl:Write, acl:Control"), ("agent", agent, &health, true, "acl:Read, acl:Control")]),
    )
    .await?;
    // The SSN file gets its own ACL: owner only. The guardian cannot read it and cannot grant it, even by mistake.
    let ssn = format!("{health}ssn.ttl");
    put(format!("{ssn}.acl"), "text/turtle", acl(&[("owner", subject, &ssn, false, "acl:Read, acl:Write, acl:Control")])).await?;

    // Providers and booking (the facts the policy checks).
    let start = now() + Duration::hours(20);
    let end = start + Duration::hours(1);
    put(
        format!("{root}skpods/v1/providers/bayview-family-clinic.ttl"),
        "text/turtle",
        format!("{P}<#link> a skp:ProviderLink ;\n  schema:name \"Bayview Family Clinic\" ;\n  skp:client {} ;\n  skp:provider {} ;\n  skp:since \"2026-11-01T09:00:00Z\"^^xsd:dateTime ;\n  skp:status skp:Active .\n", ttl_iri(subject), ttl_iri(clinic)),
    )
    .await?;
    put(
        format!("{root}skpods/v1/bookings/booking-bayview-1042.ttl"),
        "text/turtle",
        format!("{P}<#booking> a schema:Reservation ;\n  schema:identifier \"BAY-1042\" ;\n  schema:name \"Annual check-up at Bayview Family Clinic\" ;\n  schema:provider {} ;\n  schema:underName {} ;\n  schema:startTime {}^^xsd:dateTime ;\n  schema:endTime {}^^xsd:dateTime ;\n  schema:reservationStatus schema:ReservationConfirmed .\n", ttl_iri(clinic), ttl_iri(subject), ttl_lit(&ts(start)), ttl_lit(&ts(end))),
    )
    .await?;
    for dir in ["providers", "bookings"] {
        let u = format!("{root}skpods/v1/{dir}/");
        put(
            format!("{u}.acl"),
            "text/turtle",
            acl(&[("owner", subject, &u, true, "acl:Read, acl:Write, acl:Control"), ("agent", agent, &u, true, "acl:Read")]),
        )
        .await?;
    }
    // Consents container: the guardian writes requests, grants, audit and reads its policy here.
    let cons = format!("{root}skpods/v1/consents/");
    put(
        format!("{cons}.acl"),
        "text/turtle",
        acl(&[("owner", subject, &cons, true, "acl:Read, acl:Write, acl:Control"), ("agent", agent, &cons, true, "acl:Read, acl:Write, acl:Control")]),
    )
    .await?;
    let pol = policy::demo_policy(subject, agent);
    put(format!("{cons}policy.jsonld"), "application/ld+json", serde_json::to_string_pretty(&pol)?).await?;
    Ok(written)
}

// ---------- clinic simulation ----------

pub struct SimOpts {
    pub base: String,
    pub broker: String,
    pub subject: String,
    pub clinic: Actor,
    pub duration: Option<String>,
    pub booking_ref: String,
    /// Act as the owner and approve awaiting items (24h), to run the whole story from one command.
    pub owner: Option<Actor>,
    /// Seconds to wait for a human owner when no owner actor is given.
    pub wait_owner_s: u64,
    /// After the first reads, wait for expiry and read again.
    pub watch_expiry: bool,
}

#[derive(Debug)]
pub struct ItemOutcome {
    pub data_class: String,
    pub action: String,
    pub status: String,
    pub read_http: Option<u16>,
    pub read_after_expiry: Option<u16>,
    pub expires_at: Option<String>,
    pub reason: String,
    pub counter_offer: Option<String>,
    pub grant_id: Option<String>,
}

#[derive(Debug)]
pub struct SimReport {
    pub request_id: String,
    pub items: Vec<ItemOutcome>,
}

async fn broker_call(c: &SolidClient, http: &reqwest::Client, method: &str, url: &str, body: Option<Value>) -> Result<(u16, Value)> {
    let mut rb = http.request(method.parse()?, url);
    for (k, v) in c.auth_headers(method, url).await? {
        rb = rb.header(k, v);
    }
    if let Some(b) = body {
        rb = rb.json(&b);
    }
    let r = rb.send().await?;
    let st = r.status().as_u16();
    Ok((st, r.json().await.unwrap_or(Value::Null)))
}

async fn read_status(c: &SolidClient, url: &str) -> u16 {
    c.get(url).await.map(|r| r.status.as_u16()).unwrap_or(0)
}

pub async fn simulate_clinic(o: &SimOpts, say: &dyn Fn(String)) -> Result<SimReport> {
    let http = solid::http_client();
    let (clinic, eph) = SolidClient::ephemeral(&o.base, &o.clinic.user, &o.clinic.password).await?;
    let r = simulate_inner(o, say, &http, &clinic).await;
    eph.cleanup().await;
    r
}

async fn simulate_inner(o: &SimOpts, say: &dyn Fn(String), http: &reqwest::Client, clinic: &Arc<SolidClient>) -> Result<SimReport> {
    let broker = o.broker.trim_end_matches('/');
    let req = json!({
        "requester": {"webid": o.clinic.webid(&o.base), "name": "Bayview Family Clinic", "kind": "clinic"},
        "subject": o.subject,
        "purpose": "Pre-visit intake for your annual check-up",
        "items": [{"data_class": "dob"}, {"data_class": "allergies"}, {"data_class": "medications"},
                  {"data_class": "insurance_member_id"}, {"data_class": "ssn"}],
        "requested_duration": o.duration,
        "context": {"booking_ref": o.booking_ref},
    });
    say("Clinic: sending consent request (5 items)".into());
    let (st, mut v) = broker_call(clinic, http, "POST", &format!("{broker}/requests"), Some(req)).await?;
    if st != 201 {
        bail!("request rejected: HTTP {st} {}", v["error"].as_str().unwrap_or(""));
    }
    let id = v["id"].as_str().unwrap_or_default().to_string();
    say(format!("Guardian decided request {id}"));

    if v["status"] == "awaiting_owner" {
        if let Some(owner) = &o.owner {
            say("Owner (simulated): approving the items that need a tap, 24h".into());
            let (oc, oeph) = SolidClient::ephemeral(&o.base, &owner.user, &owner.password).await?;
            let decisions: Vec<Value> = v["items"].as_array().unwrap().iter()
                .filter(|i| i["status"] == "awaiting_owner")
                .map(|i| json!({"item_id": i["id"], "action": "approve", "duration": "24h"}))
                .collect();
            let res = broker_call(&oc, http, "POST", &format!("{broker}/requests/{id}/decide"), Some(json!({"decisions": decisions}))).await;
            oeph.cleanup().await;
            let (st, nv) = res?;
            if st != 200 {
                bail!("owner decision failed: HTTP {st} {}", nv["error"].as_str().unwrap_or(""));
            }
            v = nv;
        } else {
            say(format!("Waiting up to {}s for the owner to decide", o.wait_owner_s));
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(o.wait_owner_s);
            while v["status"] == "awaiting_owner" && std::time::Instant::now() < deadline {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                let (_, nv) = broker_call(clinic, http, "GET", &format!("{broker}/requests/{id}"), None).await?;
                v = nv;
            }
        }
    }

    let mut items = vec![];
    for i in v["items"].as_array().cloned().unwrap_or_default() {
        let res = i["resource"].as_str().unwrap_or_default().to_string();
        let st = read_status(clinic, &res).await;
        if let Some(g) = i["grant_id"].as_str() {
            let _ = broker_call(clinic, http, "POST", &format!("{broker}/grants/{g}/access"), Some(json!({"http_status": st}))).await;
        }
        items.push(ItemOutcome {
            data_class: i["data_class"].as_str().unwrap_or_default().into(),
            action: i["decision"]["action"].as_str().unwrap_or_default().into(),
            status: i["status"].as_str().unwrap_or_default().into(),
            read_http: Some(st),
            read_after_expiry: None,
            expires_at: i["decision"]["expires_at"].as_str().map(str::to_string),
            reason: i["decision"]["reason"].as_str().unwrap_or_default().into(),
            counter_offer: i["decision"]["counter_offer"]["message"].as_str().map(str::to_string),
            grant_id: i["grant_id"].as_str().map(str::to_string),
        });
    }
    for it in &items {
        say(format!("  {:<20} {:<9} read -> HTTP {}  {}", it.data_class, it.action, it.read_http.unwrap_or(0), it.expires_at.as_deref().map(|e| format!("access ends {e}")).unwrap_or_default()));
    }
    if o.watch_expiry {
        let last = items.iter().filter_map(|i| i.expires_at.as_deref()).filter_map(|e| chrono::DateTime::parse_from_rfc3339(e).ok()).min();
        if let Some(first_end) = last {
            let wait = (first_end.with_timezone(&chrono::Utc) - now()).num_seconds().max(0) as u64 + 5;
            say(format!("Waiting {wait}s for the first grant to expire, then reading again"));
            tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
            for it in items.iter_mut() {
                if it.status == "granted" {
                    let res = v["items"].as_array().unwrap().iter().find(|x| x["data_class"] == it.data_class.as_str()).and_then(|x| x["resource"].as_str()).unwrap_or_default().to_string();
                    it.read_after_expiry = Some(read_status(clinic, &res).await);
                    say(format!("  {:<20} after expiry read -> HTTP {}", it.data_class, it.read_after_expiry.unwrap_or(0)));
                }
            }
        }
    }
    Ok(SimReport { request_id: id, items })
}

#[allow(dead_code)]
fn _use(_: &Broker, _: &Item) {}
