//! Guardian policy: deterministic rules by data class x requester kind x context.
//!
//! The policy is a JSON-LD file in the owner's pod (`/doorway/v1/consents/policy.jsonld`).
//! Rules are evaluated top to bottom, first match wins. No match means `ask_owner`.
//! Nothing here calls an LLM. Explanations are added later and never change the outcome.

use crate::model::{Action, CounterOffer, Decision, Recommendation, RequesterKind};
use crate::util::{human_duration, parse_duration};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Policy {
    #[serde(rename = "@context", default = "default_context")]
    pub context: serde_json::Value,
    #[serde(rename = "@type", default = "default_type")]
    pub type_: String,
    pub version: u32,
    /// WebID of the person the policy protects.
    pub owner: String,
    /// WebID of the guardian agent acting under this policy.
    pub agent: String,
    /// Extra WebIDs allowed to decide for the owner (attorney-in-fact, parent).
    #[serde(default)]
    pub approvers: Vec<String>,
    /// Pod containers (relative to the storage root) the guardian may touch for grants.
    #[serde(rename = "managedContainers")]
    pub managed_containers: Vec<String>,
    /// data class -> resource path relative to the storage root.
    pub catalog: BTreeMap<String, CatalogEntry>,
    /// Longest access an owner approval may give, e.g. "30d".
    #[serde(rename = "ceiling", default = "default_ceiling")]
    pub ceiling: String,
    pub rules: Vec<Rule>,
}

fn default_ceiling() -> String {
    "30d".into()
}
fn default_type() -> String {
    "GuardianPolicy".into()
}
fn default_context() -> serde_json::Value {
    serde_json::json!({"@vocab": "https://w3id.org/doorway/v1#"})
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogEntry {
    pub path: String,
    pub label: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct When {
    /// The requester has an active dw:ProviderLink in the owner's providers container.
    #[serde(rename = "requesterInProviders", default)]
    pub requester_in_providers: bool,
    /// A confirmed, upcoming booking with this requester exists in the owner's pod
    /// (and matches the booking reference in the request, when one is given).
    #[serde(rename = "hasBooking", default)]
    pub has_booking: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleCounter {
    #[serde(rename = "dataClass")]
    pub data_class: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleRecommend {
    pub action: Action,
    #[serde(default)]
    pub duration: Option<String>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rule {
    pub id: String,
    /// Data classes this rule covers. "*" covers all.
    #[serde(rename = "dataClasses")]
    pub data_classes: Vec<String>,
    /// Optional filter. Empty means any requester kind.
    #[serde(rename = "requesterKinds", default)]
    pub requester_kinds: Vec<RequesterKind>,
    #[serde(default)]
    pub when: When,
    pub action: Action,
    /// For approve: the ceiling for this rule. The request is capped to it.
    #[serde(rename = "maxDuration", default)]
    pub max_duration: Option<String>,
    pub reason: String,
    #[serde(rename = "counterOffer", default)]
    pub counter_offer: Option<RuleCounter>,
    /// For ask_owner: what the guardian recommends to the owner.
    #[serde(default)]
    pub recommend: Option<RuleRecommend>,
}

/// Facts gathered from the pod before the rules run.
#[derive(Debug, Clone, Default)]
pub struct Facts {
    pub requester_in_providers: bool,
    pub has_booking: bool,
    /// Seconds until the matching booking ends, if known.
    pub booking_end_in_s: Option<i64>,
}

pub struct EvalInput<'a> {
    pub requester_kind: &'a RequesterKind,
    pub data_class: &'a str,
    /// Seconds requested, already resolved ("until_booking_end" turned into seconds), or None.
    pub requested_s: Option<i64>,
    pub facts: &'a Facts,
}

impl Rule {
    fn matches(&self, i: &EvalInput) -> bool {
        (self.data_classes.iter().any(|c| c == "*" || c == i.data_class))
            && (self.requester_kinds.is_empty() || self.requester_kinds.contains(i.requester_kind))
            && (!self.when.requester_in_providers || i.facts.requester_in_providers)
            && (!self.when.has_booking || i.facts.has_booking)
    }
}

pub fn evaluate(p: &Policy, i: &EvalInput) -> Decision {
    for r in &p.rules {
        if !r.matches(i) {
            continue;
        }
        return match r.action {
            Action::Approve => {
                let max = r.max_duration.as_deref().and_then(parse_duration);
                let secs = match (i.requested_s, max) {
                    (Some(q), Some(m)) => q.min(m),
                    (Some(q), None) => q,
                    (None, Some(m)) => m,
                    (None, None) => 24 * 3600,
                };
                Decision {
                    action: Action::Approve,
                    duration_s: Some(secs),
                    expires_at: None,
                    reason: format!("{} Access for {}.", r.reason, human_duration(secs)),
                    explanation: None,
                    counter_offer: None,
                    recommendation: None,
                    rule_id: Some(r.id.clone()),
                    decided_by: "guardian".into(),
                }
            }
            Action::Deny => Decision {
                action: Action::Deny,
                duration_s: None,
                expires_at: None,
                reason: r.reason.clone(),
                explanation: None,
                counter_offer: r.counter_offer.as_ref().map(|c| CounterOffer {
                    data_class: c.data_class.clone(),
                    message: c.message.clone(),
                }),
                recommendation: None,
                rule_id: Some(r.id.clone()),
                decided_by: "guardian".into(),
            },
            Action::AskOwner => Decision {
                action: Action::AskOwner,
                duration_s: None,
                expires_at: None,
                reason: r.reason.clone(),
                explanation: None,
                counter_offer: None,
                recommendation: r.recommend.as_ref().map(|rc| Recommendation {
                    action: rc.action,
                    duration_s: rc.duration.as_deref().and_then(parse_duration),
                    reason: rc.reason.clone(),
                }),
                rule_id: Some(r.id.clone()),
                decided_by: "guardian".into(),
            },
        };
    }
    Decision {
        action: Action::AskOwner,
        duration_s: None,
        expires_at: None,
        reason: "No rule in the policy covers this request, so the owner decides.".into(),
        explanation: None,
        counter_offer: None,
        recommendation: None,
        rule_id: None,
        decided_by: "guardian".into(),
    }
}

/// The default policy for the clinic demo.
pub fn demo_policy(owner: &str, agent: &str) -> Policy {
    let cat = |p: &str, l: &str| CatalogEntry { path: p.into(), label: l.into() };
    let mut catalog = BTreeMap::new();
    catalog.insert("dob".into(), cat("doorway/v1/health/dob.ttl", "Date of birth"));
    catalog.insert("allergies".into(), cat("doorway/v1/health/allergies.ttl", "Allergies"));
    catalog.insert("medications".into(), cat("doorway/v1/health/medications.ttl", "Current medications"));
    catalog.insert(
        "insurance_member_id".into(),
        cat("doorway/v1/health/insurance-card.ttl", "Insurance member ID"),
    );
    catalog.insert("ssn".into(), cat("doorway/v1/health/ssn.ttl", "Social Security number"));
    Policy {
        context: default_context(),
        type_: default_type(),
        version: 1,
        owner: owner.into(),
        agent: agent.into(),
        approvers: vec![],
        managed_containers: vec!["doorway/v1/health/".into()],
        catalog,
        ceiling: "30d".into(),
        rules: vec![
            Rule {
                id: "never-share-ssn".into(),
                data_classes: vec!["ssn".into()],
                requester_kinds: vec![],
                when: When::default(),
                action: Action::Deny,
                max_duration: None,
                reason: "A Social Security number is never shared through a consent request. Clinics rarely need it to book or treat a patient.".into(),
                counter_offer: Some(RuleCounter {
                    data_class: "insurance_member_id".into(),
                    message: "Ask for the insurance member ID instead. It covers billing and eligibility checks.".into(),
                }),
                recommend: None,
            },
            Rule {
                id: "basic-health-booked-provider".into(),
                data_classes: vec!["dob".into(), "allergies".into(), "medications".into()],
                requester_kinds: vec![RequesterKind::Clinic],
                when: When { requester_in_providers: true, has_booking: true },
                action: Action::Approve,
                max_duration: Some("72h".into()),
                reason: "The clinic is one of your providers and has a confirmed upcoming booking with you.".into(),
                counter_offer: None,
                recommend: None,
            },
            Rule {
                id: "insurance-ask-owner".into(),
                data_classes: vec!["insurance_member_id".into()],
                requester_kinds: vec![RequesterKind::Clinic],
                when: When { requester_in_providers: true, has_booking: false },
                action: Action::AskOwner,
                max_duration: None,
                reason: "Your insurance member ID is financial data, so it needs your own tap.".into(),
                counter_offer: None,
                recommend: Some(RuleRecommend {
                    action: Action::Approve,
                    duration: Some("24h".into()),
                    reason: "The clinic is one of your providers with an upcoming visit and billing needs the member ID. 24 hours is enough to check eligibility.".into(),
                }),
            },
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p() -> Policy {
        demo_policy("https://x/alice#me", "https://x/agent#me")
    }
    fn run(kind: RequesterKind, class: &str, req: Option<i64>, f: Facts) -> Decision {
        evaluate(&p(), &EvalInput { requester_kind: &kind, data_class: class, requested_s: req, facts: &f })
    }
    fn booked() -> Facts {
        Facts { requester_in_providers: true, has_booking: true, booking_end_in_s: Some(3600) }
    }
    fn known_only() -> Facts {
        Facts { requester_in_providers: true, has_booking: false, booking_end_in_s: None }
    }

    #[test]
    fn booked_known_clinic_gets_72h_for_basics() {
        for c in ["dob", "allergies", "medications"] {
            let d = run(RequesterKind::Clinic, c, None, booked());
            assert_eq!(d.action, Action::Approve, "{c}");
            assert_eq!(d.duration_s, Some(72 * 3600));
        }
    }

    #[test]
    fn request_is_capped_not_inflated() {
        assert_eq!(run(RequesterKind::Clinic, "dob", Some(20), booked()).duration_s, Some(20));
        assert_eq!(run(RequesterKind::Clinic, "dob", Some(30 * 86400), booked()).duration_s, Some(72 * 3600));
    }

    #[test]
    fn unbooked_or_unknown_falls_to_owner() {
        assert_eq!(run(RequesterKind::Clinic, "dob", None, known_only()).action, Action::AskOwner);
        assert_eq!(run(RequesterKind::Clinic, "dob", None, Facts::default()).action, Action::AskOwner);
        assert_eq!(run(RequesterKind::Business, "dob", None, booked()).action, Action::AskOwner);
    }

    #[test]
    fn insurance_asks_owner_with_recommendation() {
        let d = run(RequesterKind::Clinic, "insurance_member_id", None, booked());
        assert_eq!(d.action, Action::AskOwner);
        let r = d.recommendation.unwrap();
        assert_eq!(r.action, Action::Approve);
        assert_eq!(r.duration_s, Some(86400));
    }

    #[test]
    fn ssn_denied_for_everyone_with_counter_offer() {
        for k in [RequesterKind::Clinic, RequesterKind::Business, RequesterKind::Agent] {
            let d = run(k, "ssn", Some(60), booked());
            assert_eq!(d.action, Action::Deny);
            assert_eq!(d.counter_offer.unwrap().data_class, "insurance_member_id");
            assert!(d.duration_s.is_none());
        }
    }

    #[test]
    fn unknown_class_asks_owner() {
        let d = run(RequesterKind::Clinic, "shoe_size", None, booked());
        assert_eq!(d.action, Action::AskOwner);
        assert!(d.rule_id.is_none());
    }

    #[test]
    fn policy_roundtrips_json() {
        let j = serde_json::to_string(&p()).unwrap();
        let back: Policy = serde_json::from_str(&j).unwrap();
        assert_eq!(back.rules.len(), 3);
    }
}
