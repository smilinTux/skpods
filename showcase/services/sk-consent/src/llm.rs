//! Optional friendly explanations through an OpenAI-compatible endpoint. Default off.
//! The rules engine decides. This module only rewords a decision that is already made, and its failure is harmless.

use crate::config::Config;
use crate::model::{Action, Decision};
use serde_json::json;
use std::time::Duration;

pub fn enabled(cfg: &Config) -> bool {
    cfg.llm_base_url.is_some() && cfg.llm_model.is_some()
}

pub async fn explain(
    cfg: &Config,
    http: &reqwest::Client,
    requester: &str,
    kind: &str,
    purpose: &str,
    label: &str,
    d: &Decision,
) -> Option<String> {
    let (base, model) = (cfg.llm_base_url.as_ref()?, cfg.llm_model.as_ref()?);
    let outcome = match d.action {
        Action::Approve => format!("approved for {} seconds", d.duration_s.unwrap_or(0)),
        Action::AskOwner => "sent to the owner to decide".to_string(),
        Action::Deny => "denied".to_string(),
    };
    let mut facts = format!(
        "Requester: {requester} ({kind}). Purpose: {purpose}. Item: {label}. Outcome: {outcome}. Rule reason: {}",
        d.reason
    );
    if let Some(c) = &d.counter_offer {
        facts.push_str(&format!(" Counter offer: {}", c.message));
    }
    if let Some(r) = &d.recommendation {
        facts.push_str(&format!(" Recommendation to the owner: {}", r.reason));
    }
    let body = json!({
        "model": model,
        "temperature": 0.3,
        "max_tokens": 120,
        "messages": [
            {"role": "system", "content": "You are a privacy guardian agent speaking to the data owner. In one or two plain, friendly sentences, explain the decision that was already made. Never change or contradict the outcome. No dashes as punctuation."},
            {"role": "user", "content": facts}
        ]
    });
    let mut rb = http.post(format!("{}/chat/completions", base.trim_end_matches('/'))).timeout(Duration::from_secs(6)).json(&body);
    if let Some(k) = &cfg.llm_api_key {
        rb = rb.bearer_auth(k);
    }
    let r = rb.send().await.ok()?;
    if !r.status().is_success() {
        return None;
    }
    let v: serde_json::Value = r.json().await.ok()?;
    let t = v["choices"][0]["message"]["content"].as_str()?.trim().replace(['\u{2014}', '\u{2013}'], ", ");
    (!t.is_empty()).then_some(t)
}
