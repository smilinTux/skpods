use crate::audit;
use crate::broker::{Broker, BrokerError, OwnerDecision};
use crate::model::*;
use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode, Uri},
    response::{sse::{Event, KeepAlive, Sse}, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use std::convert::Infallible;
use std::sync::Arc;
use tokio_stream::wrappers::BroadcastStream;
use tower_http::cors::{AllowOrigin, CorsLayer};

type S = State<Arc<Broker>>;

pub struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error": self.1}))).into_response()
    }
}
impl From<BrokerError> for ApiError {
    fn from(e: BrokerError) -> Self {
        match e {
            BrokerError::BadRequest(m) => ApiError(StatusCode::BAD_REQUEST, m),
            BrokerError::Forbidden(m) => ApiError(StatusCode::FORBIDDEN, m),
            BrokerError::NotFound(m) => ApiError(StatusCode::NOT_FOUND, m),
            BrokerError::Conflict(m) => ApiError(StatusCode::CONFLICT, m),
            BrokerError::Internal(e) => {
                tracing::error!("internal: {e:#}");
                ApiError(StatusCode::BAD_GATEWAY, "the pod or the store failed; see the service log".into())
            }
        }
    }
}
impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        BrokerError::Internal(e).into()
    }
}
type A<T> = Result<T, ApiError>;

/// Verified WebID of the caller, or (DEMO_INSECURE_OWNER=1 only) the unverified X-Demo-WebID header.
async fn identity(b: &Broker, method: &Method, uri: &Uri, h: &HeaderMap) -> A<Option<(String, bool)>> {
    if h.contains_key("authorization") {
        return match b.verifier.verify(&b.http, &b.cfg.pods_base, &b.cfg.public_url, method, uri.path(), h).await {
            Ok(w) => Ok(Some((w, true))),
            Err(e) => Err(ApiError(StatusCode::UNAUTHORIZED, format!("token rejected: {e}"))),
        };
    }
    if b.cfg.insecure_owner {
        if let Some(w) = h.get("x-demo-webid").and_then(|v| v.to_str().ok()) {
            return Ok(Some((w.to_string(), false)));
        }
    }
    Ok(None)
}

fn need(id: Option<(String, bool)>) -> A<(String, bool)> {
    id.ok_or_else(|| ApiError(StatusCode::UNAUTHORIZED, "authenticate with a DPoP-bound Solid access token".into()))
}

#[derive(Deserialize)]
struct SubjectQ {
    subject: Option<String>,
    status: Option<String>,
}

pub fn router(b: Arc<Broker>) -> Router {
    let extra = b.cfg.cors_origins.clone();
    let localhost = b.cfg.cors_localhost;
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(move |o: &HeaderValue, _| {
            let o = o.to_str().unwrap_or("");
            extra.iter().any(|e| e == o)
                || (localhost && (o.starts_with("http://localhost:") || o.starts_with("http://127.0.0.1:") || o == "http://localhost"))
        }))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE, "dpop".parse().unwrap(), "x-demo-webid".parse().unwrap()])
        .max_age(std::time::Duration::from_secs(600));
    Router::new()
        .route("/healthz", get(healthz))
        .route("/requests", post(post_request).get(list_requests))
        .route("/requests/{id}", get(get_request))
        .route("/requests/{id}/decide", post(decide))
        .route("/grants", get(list_grants))
        .route("/grants/{id}/revoke", post(revoke))
        .route("/grants/{id}/access", post(access))
        .route("/policy", get(get_policy))
        .route("/audit", get(list_audit))
        .route("/audit/verify", get(verify))
        .route("/events", get(events))
        .layer(cors)
        .with_state(b)
}

async fn healthz(State(b): S) -> A<Json<Value>> {
    let agent = b.agent_webid().await.ok();
    Ok(Json(json!({
        "ok": agent.is_some(),
        "version": env!("CARGO_PKG_VERSION"),
        "agent": agent,
        "pods": b.cfg.pods_base,
        "llm_explanations": crate::llm::enabled(&b.cfg),
        "demo_insecure_owner": b.cfg.insecure_owner,
    })))
}

async fn post_request(State(b): S, m: Method, u: Uri, h: HeaderMap, Json(nr): Json<NewRequest>) -> A<(StatusCode, Json<ConsentRequest>)> {
    let who = match identity(&b, &m, &u, &h).await? {
        Some((w, _)) => Some(w),
        None if b.cfg.insecure_owner => None,
        None => return Err(need(None).unwrap_err()),
    };
    let r = b.submit_request(nr, who).await?;
    Ok((StatusCode::CREATED, Json(r)))
}

async fn list_requests(State(b): S, Query(q): Query<SubjectQ>) -> A<Json<Vec<ConsentRequest>>> {
    Ok(Json(b.store.list_requests(q.subject.as_deref())?))
}

async fn get_request(State(b): S, Path(id): Path<String>) -> A<Json<ConsentRequest>> {
    b.store.get_request(&id)?.map(Json).ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "request".into()))
}

#[derive(Deserialize)]
struct DecideBody {
    decisions: Vec<OwnerDecision>,
}

async fn decide(State(b): S, Path(id): Path<String>, m: Method, u: Uri, h: HeaderMap, Json(body): Json<DecideBody>) -> A<Json<ConsentRequest>> {
    let (who, _) = need(identity(&b, &m, &u, &h).await?)?;
    Ok(Json(b.owner_decide(&id, body.decisions, &who).await?))
}

async fn list_grants(State(b): S, Query(q): Query<SubjectQ>) -> A<Json<Vec<Grant>>> {
    Ok(Json(b.store.list_grants(q.subject.as_deref(), q.status.as_deref())?))
}

#[derive(Deserialize, Default)]
struct RevokeBody {
    reason: Option<String>,
}

async fn revoke(State(b): S, Path(id): Path<String>, m: Method, u: Uri, h: HeaderMap, body: Option<Json<RevokeBody>>) -> A<Json<Grant>> {
    let (who, _) = need(identity(&b, &m, &u, &h).await?)?;
    let g = b.store.get_grant(&id)?.ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "grant".into()))?;
    let by_grantee = who == g.grantee;
    if !by_grantee && !b.can_act_for(&g.subject, &who).await {
        return Err(ApiError(StatusCode::FORBIDDEN, "only the subject, a named approver or the grantee may revoke".into()));
    }
    let reason = body.and_then(|Json(x)| x.reason).unwrap_or_else(|| if by_grantee { "released-by-grantee".into() } else { "revoked-by-owner".into() });
    Ok(Json(b.revoke(&id, false, &reason, &who).await?))
}

#[derive(Deserialize)]
struct AccessBody {
    http_status: u16,
}

async fn access(State(b): S, Path(id): Path<String>, m: Method, u: Uri, h: HeaderMap, Json(body): Json<AccessBody>) -> A<Json<Value>> {
    let (who, verified) = match identity(&b, &m, &u, &h).await? {
        Some(x) => x,
        None => ("unauthenticated".to_string(), false),
    };
    Ok(Json(b.record_access(&id, body.http_status, &who, verified).await?))
}

async fn get_policy(State(b): S, Query(q): Query<SubjectQ>) -> A<Json<crate::policy::Policy>> {
    let s = q.subject.ok_or_else(|| ApiError(StatusCode::BAD_REQUEST, "subject is required".into()))?;
    Ok(Json(b.load_policy(&s).await?))
}

async fn list_audit(State(b): S, Query(q): Query<SubjectQ>) -> A<Json<Vec<Value>>> {
    let subjects = match q.subject {
        Some(s) => vec![s],
        None => b.store.audit_subjects()?,
    };
    let mut out = vec![];
    for s in subjects {
        out.extend(b.store.audit_chain(&s)?);
    }
    out.sort_by(|a, c| a["ts"].as_str().cmp(&c["ts"].as_str()));
    Ok(Json(out))
}

async fn verify(State(b): S, Query(q): Query<SubjectQ>) -> A<Json<Value>> {
    let subjects = match q.subject {
        Some(s) => vec![s],
        None => b.store.audit_subjects()?,
    };
    let mut chains = vec![];
    for s in subjects {
        chains.push(audit::verify_chain(&s, &b.store.audit_chain(&s)?));
    }
    let bad = chains.iter().find(|c| !c.ok);
    Ok(Json(json!({
        "ok": bad.is_none(),
        "first_bad_index": bad.and_then(|c| c.first_bad_index),
        "first_bad_subject": bad.map(|c| c.subject.clone()),
        "chains": chains,
    })))
}

async fn events(State(b): S, Query(q): Query<SubjectQ>) -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let subject = q.subject;
    let stream = BroadcastStream::new(b.events.subscribe()).filter_map(move |m| {
        let subject = subject.clone();
        async move {
            let v = m.ok()?;
            if let Some(s) = &subject {
                if v["subject"].as_str() != Some(s.as_str()) {
                    return None;
                }
            }
            let name = v["type"].as_str().unwrap_or("message").to_string();
            Some(Ok(Event::default().event(name).data(v.to_string())))
        }
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}
