//! The consent broker and guardian: request intake, policy decisions, WAC grants, expiry, audit, pod mirror.

use crate::config::Config;
use crate::model::*;
use crate::policy::{self, EvalInput, Facts, Policy};
use crate::rdf::{self, parse_turtle, LDP_CONTAINS};
use crate::solid::{self, SolidClient};
use crate::store::Store;
use crate::util::*;
use crate::{audit, llm};
use anyhow::{anyhow, Result};
use chrono::{DateTime, Duration, Utc};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::{broadcast, mpsc};

pub const SKP: &str = "https://w3id.org/skpods/v1#";
const SCHEMA: &str = "http://schema.org/";
const RDF_TYPE: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

#[derive(Debug)]
pub enum BrokerError {
    BadRequest(String),
    Forbidden(String),
    NotFound(String),
    Conflict(String),
    Internal(anyhow::Error),
}
impl From<anyhow::Error> for BrokerError {
    fn from(e: anyhow::Error) -> Self {
        BrokerError::Internal(e)
    }
}
type R<T> = std::result::Result<T, BrokerError>;

pub enum MirrorJob {
    Request(String),
    Grant(String),
    Audit { subject: String, day: String },
}

pub struct Broker {
    pub cfg: Config,
    pub store: Store,
    pub solid: Arc<SolidClient>,
    pub http: reqwest::Client,
    pub events: broadcast::Sender<Value>,
    pub verifier: crate::auth::Verifier,
    acl_lock: tokio::sync::Mutex<()>,
    mirror_tx: mpsc::UnboundedSender<MirrorJob>,
    roots: Mutex<HashMap<String, String>>,
    revoke_backoff: Mutex<HashMap<String, DateTime<Utc>>>,
    inflight: Mutex<std::collections::HashSet<String>>,
    revoking: Mutex<std::collections::HashSet<String>>,
}

impl Broker {
    /// Build the broker and start its background workers (pod mirror, expiry sweeper).
    pub fn start(cfg: Config, store: Store) -> Arc<Self> {
        let solid = SolidClient::new(&cfg.pods_base, solid::Creds { client_id: cfg.client_id.clone(), client_secret: cfg.client_secret.clone() });
        let (mirror_tx, mirror_rx) = mpsc::unbounded_channel();
        let (events, _) = broadcast::channel(256);
        let b = Arc::new(Broker {
            cfg,
            store,
            solid,
            http: solid::http_client(),
            events,
            verifier: Default::default(),
            acl_lock: Default::default(),
            mirror_tx,
            roots: Default::default(),
            revoke_backoff: Default::default(),
            inflight: Default::default(),
            revoking: Default::default(),
        });
        tokio::spawn(mirror_worker(b.clone(), mirror_rx));
        tokio::spawn(sweeper(b.clone()));
        b
    }

    pub async fn agent_webid(&self) -> Result<String> {
        self.solid.webid().await
    }

    pub async fn storage_root(&self, subject: &str) -> String {
        if let Some(r) = self.roots.lock().unwrap().get(subject) {
            return r.clone();
        }
        let r = solid::storage_root(&self.http, subject).await;
        self.roots.lock().unwrap().insert(subject.to_string(), r.clone());
        r
    }

    pub fn policy_url(root: &str) -> String {
        format!("{root}skpods/v1/consents/policy.jsonld")
    }

    pub async fn load_policy(&self, subject: &str) -> R<Policy> {
        let root = self.storage_root(subject).await;
        let r = self.solid.get_as(&Self::policy_url(&root), "application/ld+json").await?;
        if !r.status.is_success() {
            return Err(BrokerError::NotFound(format!(
                "no guardian policy readable for this subject (HTTP {}). The person has not set the guardian up.",
                r.status
            )));
        }
        let p: Policy = serde_json::from_str(&r.body).map_err(|e| BrokerError::BadRequest(format!("policy is not valid: {e}")))?;
        if p.owner != subject {
            return Err(BrokerError::BadRequest("policy owner does not match the subject".into()));
        }
        let me = self.agent_webid().await?;
        if p.agent != me {
            return Err(BrokerError::Forbidden("the policy names a different guardian agent".into()));
        }
        Ok(p)
    }

    // ---------- audit ----------

    pub fn record(&self, subject: &str, event: &str, actor: &str, fields: Value) -> Result<Value> {
        let mut body = fields.as_object().cloned().unwrap_or_default();
        body.insert("event".into(), json!(event));
        body.insert("actor".into(), json!(actor));
        body.insert("ts".into(), json!(ts(now())));
        body.retain(|_, v| !v.is_null());
        let e = self.store.audit_append(subject, Value::Object(body))?;
        let day = e["ts"].as_str().unwrap_or("")[..10].to_string();
        let _ = self.mirror_tx.send(MirrorJob::Audit { subject: subject.into(), day });
        let _ = self.events.send(json!({"type": "audit", "subject": subject, "entry": e}));
        Ok(e)
    }

    fn publish_request(&self, r: &ConsentRequest) {
        let _ = self.mirror_tx.send(MirrorJob::Request(r.id.clone()));
        let _ = self.events.send(json!({"type": "request", "subject": r.subject, "request": r}));
    }
    fn publish_grant(&self, g: &Grant) {
        let _ = self.mirror_tx.send(MirrorJob::Grant(g.id.clone()));
        let _ = self.events.send(json!({"type": "grant", "subject": g.subject, "grant": g}));
    }

    // ---------- pod facts ----------

    async fn list_children(&self, container: &str) -> Vec<String> {
        match self.solid.get(container).await {
            Ok(r) if r.status.is_success() => parse_turtle(&r.body, container)
                .into_iter()
                .filter(|t| t.p == LDP_CONTAINS && t.o_is_iri && !t.o.ends_with(".acl") && !t.o.ends_with('/'))
                .map(|t| t.o)
                .take(40)
                .collect(),
            _ => vec![],
        }
    }

    pub async fn gather_facts(&self, root: &str, subject: &str, requester: &str, booking_ref: Option<&str>) -> Facts {
        let mut f = Facts::default();
        for url in self.list_children(&format!("{root}skpods/v1/providers/")).await {
            if let Ok(r) = self.solid.get(&url).await {
                let tr = parse_turtle(&r.body, &url);
                for s in tr.iter().filter(|t| t.p == RDF_TYPE && t.o == format!("{SKP}ProviderLink")).map(|t| &t.s) {
                    let has = |p: &str, o: &str| tr.iter().any(|t| &t.s == s && t.p == format!("{SKP}{p}") && t.o == o);
                    if has("provider", requester) && has("status", &format!("{SKP}Active")) && has("client", subject) {
                        f.requester_in_providers = true;
                    }
                }
            }
        }
        let now = now();
        for url in self.list_children(&format!("{root}skpods/v1/bookings/")).await {
            if let Ok(r) = self.solid.get(&url).await {
                let tr = parse_turtle(&r.body, &url);
                for s in tr.iter().filter(|t| t.p == RDF_TYPE && t.o == format!("{SCHEMA}Reservation")).map(|t| &t.s) {
                    let one = |p: &str| tr.iter().find(|t| &t.s == s && t.p == format!("{SCHEMA}{p}")).map(|t| t.o.clone());
                    if one("provider").as_deref() != Some(requester) || one("underName").as_deref() != Some(subject) {
                        continue;
                    }
                    if one("reservationStatus").as_deref() != Some(&format!("{SCHEMA}ReservationConfirmed")) {
                        continue;
                    }
                    if let Some(r) = booking_ref {
                        if one("identifier").as_deref() != Some(r) {
                            continue;
                        }
                    }
                    let end = one("endTime").or_else(|| one("startTime")).and_then(|t| DateTime::parse_from_rfc3339(&t).ok());
                    if let Some(end) = end {
                        let left = (end.with_timezone(&Utc) - now).num_seconds();
                        if left > 0 {
                            f.has_booking = true;
                            f.booking_end_in_s = Some(f.booking_end_in_s.map_or(left, |x: i64| x.max(left)));
                        }
                    }
                }
            }
        }
        f
    }

    // ---------- requests ----------

    pub async fn submit_request(&self, nr: NewRequest, verified: Option<String>) -> R<ConsentRequest> {
        let mut requester = nr.requester.clone().ok_or_else(|| BrokerError::BadRequest("requester is required".into()))?;
        if let Some(w) = verified {
            requester.webid = w; // never trust a body WebID over the token
        }
        if requester.webid.is_empty() || requester.name.trim().is_empty() {
            return Err(BrokerError::BadRequest("requester needs a webid and a name".into()));
        }
        if nr.items.is_empty() || nr.items.len() > 20 {
            return Err(BrokerError::BadRequest("1 to 20 items".into()));
        }
        if nr.purpose.trim().is_empty() || nr.purpose.len() > 500 {
            return Err(BrokerError::BadRequest("purpose is required (max 500 characters)".into()));
        }
        let root = self.storage_root(&nr.subject).await;
        let policy = self.load_policy(&nr.subject).await?;
        let id = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();
        let created = now();
        let ctx = nr.context.clone();
        self.record(
            &nr.subject,
            "request_received",
            &requester.webid,
            json!({"request": id, "grantee": requester.webid, "detail": {
                "requester_name": requester.name, "kind": requester.kind.as_str(),
                "purpose": nr.purpose, "items": nr.items.iter().map(|i| i.data_class.clone()).collect::<Vec<_>>(),
                "requested_duration": nr.requested_duration, "booking_ref": ctx.booking_ref }}),
        )?;
        let facts = self.gather_facts(&root, &nr.subject, &requester.webid, ctx.booking_ref.as_deref()).await;
        let requested_s = match nr.requested_duration.as_deref() {
            None => None,
            Some("until_booking_end") => facts.booking_end_in_s,
            Some(s) => Some(parse_duration(s).ok_or_else(|| BrokerError::BadRequest(format!("cannot read duration {s:?}")))?),
        };
        let mut req = ConsentRequest {
            id: id.clone(),
            requester: requester.clone(),
            subject: nr.subject.clone(),
            purpose: nr.purpose.clone(),
            requested_duration: nr.requested_duration.clone(),
            context: ctx,
            created,
            status: "decided".into(),
            items: vec![],
        };
        for (n, it) in nr.items.iter().enumerate() {
            let item_id = format!("{}-{}", id, n + 1);
            let entry = policy.catalog.get(&it.data_class);
            let label = entry.map(|e| e.label.clone()).unwrap_or_else(|| it.data_class.clone());
            let resource = entry.map(|e| format!("{root}{}", e.path)).or_else(|| it.resource.clone()).unwrap_or_default();
            let managed = policy.managed_containers.iter().any(|c| resource.starts_with(&format!("{root}{c}")));
            let mismatch = it.resource.as_ref().map(|r| entry.is_some() && *r != resource).unwrap_or(false);
            let mut decision = if resource.is_empty() || !managed || mismatch {
                Decision {
                    action: Action::Deny,
                    duration_s: None,
                    expires_at: None,
                    reason: if mismatch {
                        "The resource named in the request does not match where this kind of data lives.".into()
                    } else {
                        "This guardian does not manage that data, so it cannot grant access to it.".into()
                    },
                    explanation: None,
                    counter_offer: None,
                    recommendation: None,
                    rule_id: Some("not-managed".into()),
                    decided_by: "guardian".into(),
                }
            } else {
                policy::evaluate(&policy, &EvalInput { requester_kind: &requester.kind, data_class: &it.data_class, requested_s, facts: &facts })
            };
            if llm::enabled(&self.cfg) {
                decision.explanation =
                    llm::explain(&self.cfg, &self.http, &requester.name, requester.kind.as_str(), &nr.purpose, &label, &decision).await;
            }
            let mut item = Item {
                id: item_id,
                data_class: it.data_class.clone(),
                label,
                resource: resource.clone(),
                status: match decision.action {
                    Action::Approve => ItemStatus::Granted,
                    Action::AskOwner => ItemStatus::AwaitingOwner,
                    Action::Deny => ItemStatus::Denied,
                },
                decision: decision.clone(),
                grant_id: None,
            };
            self.record(
                &nr.subject,
                "decision",
                "guardian",
                json!({"request": id, "item": item.id, "data_class": item.data_class, "resource": resource,
                       "grantee": requester.webid,
                       "detail": {"action": decision.action, "rule": decision.rule_id, "duration_s": decision.duration_s,
                                  "reason": decision.reason, "llm_explanation": decision.explanation.is_some()}}),
            )?;
            if decision.action == Action::Approve {
                let secs = decision.duration_s.unwrap_or(3600);
                match self.create_grant(&policy, &req, &mut item, secs, "guardian").await {
                    Ok(g) => {
                        item.decision.expires_at = Some(g.ends);
                    }
                    Err(e) => {
                        tracing::error!("grant failed: {e:#}");
                        item.status = ItemStatus::Error;
                    }
                }
            }
            req.items.push(item);
        }
        req.recompute_status();
        self.store.put_request(&req).map_err(BrokerError::from)?;
        self.publish_request(&req);
        Ok(req)
    }

    /// Insert the grant, write the ACL, audit it. On failure the grant is marked failed and ACL regenerated.
    async fn create_grant(&self, policy: &Policy, req: &ConsentRequest, item: &mut Item, secs: i64, approved_by: &str) -> Result<Grant> {
        let start = now();
        let mut g = Grant {
            id: uuid::Uuid::new_v4().simple().to_string()[..12].to_string(),
            request_id: req.id.clone(),
            item_id: item.id.clone(),
            subject: req.subject.clone(),
            grantee: req.requester.webid.clone(),
            grantee_name: req.requester.name.clone(),
            data_class: item.data_class.clone(),
            resource: item.resource.clone(),
            modes: vec!["Read".into()],
            starts: start,
            ends: start + Duration::seconds(secs),
            status: GrantStatus::Active,
            approved_by: approved_by.to_string(),
            revoked_at: None,
            revoke_reason: None,
            audit_ref: None,
        };
        self.store.put_grant(&g)?;
        if let Err(e) = self.apply_acl(policy, &g.resource).await {
            g.status = GrantStatus::Failed;
            self.store.put_grant(&g)?;
            let _ = self.apply_acl(policy, &g.resource).await;
            self.record(&g.subject, "grant_failed", "guardian", json!({"request": g.request_id, "item": g.item_id, "grant": g.id, "resource": g.resource, "detail": {"error": format!("{e}")}}))?;
            return Err(e);
        }
        let e = self.record(
            &g.subject,
            "grant_written",
            approved_by,
            json!({"request": g.request_id, "item": g.item_id, "grant": g.id, "grantee": g.grantee, "resource": g.resource,
                   "data_class": g.data_class, "detail": {"modes": g.modes, "starts": ts(g.starts), "ends": ts(g.ends)}}),
        )?;
        let root = self.storage_root(&g.subject).await;
        g.audit_ref = Some(format!("{root}skpods/v1/consents/audit/{}.jsonl#{}", &e["ts"].as_str().unwrap_or("")[..10], e["seq"]));
        self.store.put_grant(&g)?;
        item.grant_id = Some(g.id.clone());
        item.status = ItemStatus::Granted;
        self.publish_grant(&g);
        Ok(g)
    }

    /// Regenerate the resource ACL from the owner, agent, approvers and all active grants. No grants: delete it (inherit).
    async fn apply_acl(&self, policy: &Policy, resource: &str) -> Result<()> {
        let _g = self.acl_lock.lock().await;
        let active = self.store.active_grants_for_resource(resource)?;
        if active.is_empty() {
            return self.solid.delete_acl(resource).await;
        }
        let mut t = String::from("@prefix acl: <http://www.w3.org/ns/auth/acl#>.\n");
        let res = ttl_iri(resource);
        let mut admins = vec![policy.owner.clone(), policy.agent.clone()];
        admins.extend(policy.approvers.iter().cloned());
        admins.dedup();
        for (i, a) in admins.iter().enumerate() {
            let modes = if *a == policy.agent { "acl:Read, acl:Control" } else { "acl:Read, acl:Write, acl:Control" };
            t.push_str(&format!(
                "<#admin{i}> a acl:Authorization; acl:agent {}; acl:accessTo {res}; acl:mode {modes}.\n",
                ttl_iri(a)
            ));
        }
        for g in &active {
            t.push_str(&format!(
                "<#grant-{}> a acl:Authorization; acl:agent {}; acl:accessTo {res}; acl:mode acl:Read.\n",
                g.id,
                ttl_iri(&g.grantee)
            ));
        }
        self.solid.write_acl(resource, t).await
    }

    // ---------- owner decisions ----------

    pub async fn can_act_for(&self, subject: &str, webid: &str) -> bool {
        if webid == subject {
            return true;
        }
        self.load_policy(subject).await.map(|p| p.approvers.iter().any(|a| a == webid)).unwrap_or(false)
    }

    pub async fn owner_decide(&self, request_id: &str, decisions: Vec<OwnerDecision>, approver: &str) -> R<ConsentRequest> {
        let mut req = self.store.get_request(request_id)?.ok_or_else(|| BrokerError::NotFound("request".into()))?;
        if !self.can_act_for(&req.subject, approver).await {
            return Err(BrokerError::Forbidden("only the subject or a named approver may decide".into()));
        }
        let policy = self.load_policy(&req.subject).await?;
        let ceiling = parse_duration(&policy.ceiling).unwrap_or(30 * 86400);
        let root = self.storage_root(&req.subject).await;
        for d in &decisions {
            let idx = req.items.iter().position(|i| i.id == d.item_id).ok_or_else(|| BrokerError::NotFound(format!("item {}", d.item_id)))?;
            if req.items[idx].status != ItemStatus::AwaitingOwner {
                return Err(BrokerError::Conflict(format!("item {} is not waiting for the owner", d.item_id)));
            }
            match d.action.as_str() {
                "approve" => {
                    let rec = req.items[idx].decision.recommendation.as_ref().and_then(|r| r.duration_s);
                    let secs = match d.duration.as_deref() {
                        Some("until_booking_end") => {
                            let f = self.gather_facts(&root, &req.subject, &req.requester.webid, req.context.booking_ref.as_deref()).await;
                            f.booking_end_in_s.ok_or_else(|| BrokerError::BadRequest("no upcoming booking to end at".into()))?
                        }
                        Some(s) => parse_duration(s).ok_or_else(|| BrokerError::BadRequest(format!("cannot read duration {s:?}")))?,
                        None => rec.unwrap_or(24 * 3600),
                    }
                    .min(ceiling);
                    let mut item = req.items[idx].clone();
                    item.decision = Decision {
                        action: Action::Approve,
                        duration_s: Some(secs),
                        expires_at: None,
                        reason: d.reason.clone().unwrap_or_else(|| format!("Approved by the owner for {}.", human_duration(secs))),
                        explanation: None,
                        counter_offer: None,
                        recommendation: item.decision.recommendation.clone(),
                        rule_id: item.decision.rule_id.clone(),
                        decided_by: "owner".into(),
                    };
                    self.record(&req.subject, "decision", approver, json!({"request": req.id, "item": item.id, "data_class": item.data_class,
                        "resource": item.resource, "grantee": req.requester.webid, "detail": {"action": "approve", "decided_by": "owner", "duration_s": secs}}))?;
                    match self.create_grant(&policy, &req, &mut item, secs, approver).await {
                        Ok(g) => item.decision.expires_at = Some(g.ends),
                        Err(e) => {
                            tracing::error!("grant failed: {e:#}");
                            item.status = ItemStatus::Error;
                        }
                    }
                    req.items[idx] = item;
                }
                "deny" => {
                    let it = &mut req.items[idx];
                    it.status = ItemStatus::Denied;
                    it.decision.action = Action::Deny;
                    it.decision.decided_by = "owner".into();
                    it.decision.reason = d.reason.clone().unwrap_or_else(|| "Declined by the owner.".into());
                    let (iid, dc, res) = (it.id.clone(), it.data_class.clone(), it.resource.clone());
                    self.record(&req.subject, "decision", approver, json!({"request": req.id, "item": iid, "data_class": dc, "resource": res,
                        "grantee": req.requester.webid, "detail": {"action": "deny", "decided_by": "owner"}}))?;
                }
                other => return Err(BrokerError::BadRequest(format!("action must be approve or deny, got {other:?}"))),
            }
        }
        req.recompute_status();
        self.store.put_request(&req)?;
        self.publish_request(&req);
        Ok(req)
    }

    // ---------- revoke and expiry ----------

    /// Revoke (or expire) one grant. Idempotent. The ACL is rewritten first-class: on failure the grant stays active and is retried.
    pub async fn revoke(&self, grant_id: &str, expired: bool, reason: &str, actor: &str) -> R<Grant> {
        if !self.revoking.lock().unwrap().insert(grant_id.to_string()) {
            // Someone else (the sweeper or the owner) is revoking this grant right now.
            return self.store.get_grant(grant_id)?.ok_or_else(|| BrokerError::NotFound("grant".into()));
        }
        let r = self.revoke_inner(grant_id, expired, reason, actor).await;
        self.revoking.lock().unwrap().remove(grant_id);
        r
    }

    async fn revoke_inner(&self, grant_id: &str, expired: bool, reason: &str, actor: &str) -> R<Grant> {
        let mut g = self.store.get_grant(grant_id)?.ok_or_else(|| BrokerError::NotFound("grant".into()))?;
        if g.status != GrantStatus::Active {
            return Ok(g);
        }
        let policy = self.load_policy(&g.subject).await?;
        g.status = if expired { GrantStatus::Expired } else { GrantStatus::Revoked };
        g.revoked_at = Some(now());
        g.revoke_reason = Some(reason.to_string());
        self.store.put_grant(&g)?;
        if let Err(e) = self.apply_acl(&policy, &g.resource).await {
            g.status = GrantStatus::Active;
            g.revoked_at = None;
            g.revoke_reason = None;
            self.store.put_grant(&g)?;
            return Err(BrokerError::Internal(e));
        }
        self.record(
            &g.subject,
            if expired { "expiry" } else { "revoke" },
            actor,
            json!({"request": g.request_id, "item": g.item_id, "grant": g.id, "grantee": g.grantee, "resource": g.resource,
                   "data_class": g.data_class, "detail": {"reason": reason}}),
        )?;
        // Verify: the ACL we left must not mention the grantee any more.
        let clean = match self.solid.read_acl(&g.resource).await {
            Ok(Some(t)) => !t.contains(&g.grantee) || !self.store.active_grants_for_resource(&g.resource)?.is_empty(),
            Ok(None) => true,
            Err(_) => false,
        };
        self.record(&g.subject, "revoke_verified", "system", json!({"grant": g.id, "resource": g.resource, "detail": {"acl_clean": clean}}))?;
        let mut req = self.store.get_request(&g.request_id)?;
        if let Some(r) = req.as_mut() {
            for it in r.items.iter_mut().filter(|i| i.grant_id.as_deref() == Some(&g.id)) {
                it.status = if expired { ItemStatus::Expired } else { ItemStatus::Revoked };
            }
            self.store.put_request(r)?;
            self.publish_request(r);
        }
        self.publish_grant(&g);
        Ok(g)
    }

    /// An observation reported by the grantee's client. Pods do not push access logs, so this is self-reported.
    pub async fn record_access(&self, grant_id: &str, status: u16, who: &str, verified: bool) -> R<Value> {
        let g = self.store.get_grant(grant_id)?.ok_or_else(|| BrokerError::NotFound("grant".into()))?;
        Ok(self.record(&g.subject, "data_read", who, json!({"grant": g.id, "item": g.item_id, "grantee": g.grantee, "resource": g.resource,
            "data_class": g.data_class, "detail": {"http_status": status, "source": if verified {"grantee-reported-authenticated"} else {"grantee-reported-unauthenticated"}}}))?)
    }

    pub async fn sweep_once(self: &Arc<Self>) {
        let due = match self.store.due_grants(now()) {
            Ok(d) => d,
            Err(e) => {
                tracing::error!("sweep: {e}");
                return;
            }
        };
        for g in due {
            if let Some(t) = self.revoke_backoff.lock().unwrap().get(&g.id) {
                if *t > now() {
                    continue;
                }
            }
            if !self.inflight.lock().unwrap().insert(g.id.clone()) {
                continue;
            }
            let b = self.clone();
            tokio::spawn(async move {
                match b.revoke(&g.id, true, "expired", "system").await {
                    Ok(_) => {
                        b.revoke_backoff.lock().unwrap().remove(&g.id);
                        tracing::info!(grant = %g.id, "expired and revoked");
                    }
                    Err(e) => {
                        tracing::error!(grant = %g.id, "expiry revoke failed, will retry: {e:?}");
                        b.revoke_backoff.lock().unwrap().insert(g.id.clone(), now() + Duration::seconds(5));
                    }
                }
                b.inflight.lock().unwrap().remove(&g.id);
            });
        }
    }

    // ---------- mirror ----------

    async fn do_mirror(&self, job: MirrorJob) -> Result<()> {
        match job {
            MirrorJob::Request(id) => {
                let r = self.store.get_request(&id)?.ok_or_else(|| anyhow!("request gone"))?;
                let root = self.storage_root(&r.subject).await;
                self.solid.put(&format!("{root}skpods/v1/consents/requests/{id}.ttl"), "text/turtle", request_ttl(&r)).await?;
            }
            MirrorJob::Grant(id) => {
                let g = self.store.get_grant(&id)?.ok_or_else(|| anyhow!("grant gone"))?;
                let root = self.storage_root(&g.subject).await;
                self.solid.put(&format!("{root}skpods/v1/consents/grants/{id}.ttl"), "text/turtle", grant_ttl(&g, &root)).await?;
            }
            MirrorJob::Audit { subject, day } => {
                let root = self.storage_root(&subject).await;
                let lines: Vec<String> = self
                    .store
                    .audit_chain(&subject)?
                    .iter()
                    .filter(|e| e["ts"].as_str().map(|t| t.starts_with(&day)).unwrap_or(false))
                    .map(audit::canonical)
                    .collect();
                self.solid.put(&format!("{root}skpods/v1/consents/audit/{day}.jsonl"), "application/x-ndjson", lines.join("\n") + "\n").await?;
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct OwnerDecision {
    pub item_id: String,
    /// "approve" or "deny"
    pub action: String,
    /// "24h", "PT2H", seconds or "until_booking_end". Optional: defaults to the guardian's recommendation, else 24h.
    #[serde(default)]
    pub duration: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}

async fn sweeper(b: Arc<Broker>) {
    let mut tick = tokio::time::interval(std::time::Duration::from_secs(1));
    loop {
        tick.tick().await;
        b.sweep_once().await;
    }
}

async fn mirror_worker(b: Arc<Broker>, mut rx: mpsc::UnboundedReceiver<MirrorJob>) {
    while let Some(job) = rx.recv().await {
        let mut last = None;
        // The first failure is often a race on a brand new container; retry briefly.
        for attempt in 0..3 {
            let j = match &job {
                MirrorJob::Request(i) => MirrorJob::Request(i.clone()),
                MirrorJob::Grant(i) => MirrorJob::Grant(i.clone()),
                MirrorJob::Audit { subject, day } => MirrorJob::Audit { subject: subject.clone(), day: day.clone() },
            };
            match b.do_mirror(j).await {
                Ok(()) => {
                    last = None;
                    break;
                }
                Err(e) => {
                    last = Some(e);
                    tokio::time::sleep(std::time::Duration::from_millis(300 * (attempt + 1))).await;
                }
            }
        }
        if let Some(e) = last {
            tracing::warn!("pod mirror failed: {e:#}");
        }
    }
}

// ---------- Turtle ----------

const PREFIXES: &str = "@prefix skp: <https://w3id.org/skpods/v1#> .\n@prefix schema: <http://schema.org/> .\n@prefix dcterms: <http://purl.org/dc/terms/> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n@prefix acl: <http://www.w3.org/ns/auth/acl#> .\n";

fn status_term(s: &str) -> &'static str {
    match s {
        "granted" => "skp:Granted",
        "denied" => "skp:Denied",
        "revoked" => "skp:Revoked",
        "expired" => "skp:Expired",
        "awaiting_owner" => "skp:Pending",
        _ => "skp:Denied",
    }
}

pub fn request_ttl(r: &ConsentRequest) -> String {
    let mut t = String::from(PREFIXES);
    let overall = if r.status == "awaiting_owner" {
        "skp:Pending"
    } else if r.items.iter().any(|i| matches!(i.status, ItemStatus::Granted | ItemStatus::Revoked | ItemStatus::Expired)) {
        "skp:Granted"
    } else {
        "skp:Denied"
    };
    t.push_str(&format!(
        "<#it> a skp:ConsentRequest ;\n  skp:requester {} ;\n  skp:subject {} ;\n  skp:purpose {} ;\n  skp:status {} ;\n  dcterms:created {}^^xsd:dateTime ;\n  skp:mode acl:Read",
        ttl_iri(&r.requester.webid), ttl_iri(&r.subject), ttl_lit(&r.purpose), overall, ttl_lit(&ts(r.created)),
    ));
    if let Some(d) = r.requested_duration.as_deref().and_then(parse_duration) {
        t.push_str(&format!(" ;\n  skp:requestedDuration {}^^xsd:duration", ttl_lit(&iso_duration(d))));
    }
    if let Some(b) = &r.context.booking_ref {
        t.push_str(&format!(" ;\n  skp:bookingReference {}", ttl_lit(b)));
    }
    for i in &r.items {
        t.push_str(&format!(" ;\n  skp:resource {}", ttl_iri(&i.resource)));
    }
    for i in &r.items {
        let st = serde_json::to_value(i.status).unwrap();
        t.push_str(&format!(
            " ;\n  skp:item [ skp:dataClass {} ; skp:resource {} ; skp:status {} ; skp:decidedBy {} ; skp:reason {}",
            ttl_lit(&i.data_class), ttl_iri(&i.resource), status_term(st.as_str().unwrap_or("")),
            ttl_lit(&i.decision.decided_by), ttl_lit(&i.decision.reason)
        ));
        if let Some(rule) = &i.decision.rule_id {
            t.push_str(&format!(" ; skp:ruleId {}", ttl_lit(rule)));
        }
        t.push_str(" ]");
    }
    t.push_str(" .\n");
    t.push_str(&format!("{} schema:name {} .\n", ttl_iri(&r.requester.webid), ttl_lit(&r.requester.name)));
    t
}

pub fn grant_ttl(g: &Grant, root: &str) -> String {
    let st = serde_json::to_value(g.status).unwrap();
    let term = match st.as_str().unwrap_or("") {
        "active" => "skp:Granted",
        "revoked" => "skp:Revoked",
        "expired" => "skp:Expired",
        _ => "skp:Denied",
    };
    let mut t = String::from(PREFIXES);
    t.push_str(&format!(
        "<#it> a skp:ConsentGrant ;\n  skp:grantedTo {} ;\n  skp:subject {} ;\n  skp:request {} ;\n  skp:resource {} ;\n  skp:mode acl:Read ;\n  skp:validFrom {}^^xsd:dateTime ;\n  skp:validUntil {}^^xsd:dateTime ;\n  skp:status {} ;\n  skp:approver {}",
        ttl_iri(&g.grantee), ttl_iri(&g.subject),
        ttl_iri(&format!("{root}skpods/v1/consents/requests/{}.ttl#it", g.request_id)),
        ttl_iri(&g.resource), ttl_lit(&ts(g.starts)), ttl_lit(&ts(g.ends)), term,
        if g.approved_by.starts_with("http") { ttl_iri(&g.approved_by) } else { ttl_lit(&g.approved_by) }
    ));
    if let Some(r) = g.revoked_at {
        t.push_str(&format!(" ;\n  skp:revokedAt {}^^xsd:dateTime", ttl_lit(&ts(r))));
    }
    if let Some(a) = &g.audit_ref {
        t.push_str(&format!(" ;\n  skp:auditRef {}", ttl_iri(a)));
    }
    t.push_str(" .\n");
    t
}

#[allow(dead_code)]
fn _use(_: &rdf::Tr) {}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn grant_turtle_parses() {
        let g = Grant {
            id: "g1".into(), request_id: "r1".into(), item_id: "r1-1".into(),
            subject: "https://h/a#me".into(), grantee: "https://h/c#me".into(), grantee_name: "C".into(),
            data_class: "dob".into(), resource: "https://h/s/dob.ttl".into(), modes: vec!["Read".into()],
            starts: now(), ends: now() + Duration::hours(1), status: GrantStatus::Active,
            approved_by: "guardian".into(), revoked_at: None, revoke_reason: None, audit_ref: None,
        };
        let t = grant_ttl(&g, "https://h/s/");
        let tr = rdf::parse_turtle(&t, "https://h/s/skpods/v1/consents/grants/g1.ttl");
        assert!(tr.iter().any(|x| x.p == format!("{SKP}grantedTo") && x.o == "https://h/c#me"));
        assert!(tr.iter().any(|x| x.p == format!("{SKP}validUntil")));
    }
}
