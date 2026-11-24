use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RequesterKind {
    Clinic,
    CareFacility,
    Business,
    Person,
    Agent,
}

impl RequesterKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            RequesterKind::Clinic => "clinic",
            RequesterKind::CareFacility => "care_facility",
            RequesterKind::Business => "business",
            RequesterKind::Person => "person",
            RequesterKind::Agent => "agent",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Requester {
    #[serde(default)]
    pub webid: String,
    pub name: String,
    pub kind: RequesterKind,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Context {
    /// Booking reference the requester claims, e.g. "BAY-1042".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub booking_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// What the requester sends for one data item.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemRequest {
    pub data_class: String,
    /// Optional. When absent the guardian resolves the class through the policy catalog.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NewRequest {
    #[serde(default)]
    pub requester: Option<Requester>,
    pub subject: String,
    pub purpose: String,
    pub items: Vec<ItemRequest>,
    /// "72h", "PT72H", seconds, or "until_booking_end".
    #[serde(default)]
    pub requested_duration: Option<String>,
    #[serde(default)]
    pub context: Context,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Approve,
    AskOwner,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CounterOffer {
    pub data_class: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Recommendation {
    pub action: Action,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_s: Option<i64>,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Decision {
    pub action: Action,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_s: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<DateTime<Utc>>,
    /// Deterministic reason from the rules. This is what decided.
    pub reason: String,
    /// Optional friendlier wording (LLM). Never changes the decision.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explanation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub counter_offer: Option<CounterOffer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recommendation: Option<Recommendation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rule_id: Option<String>,
    /// "guardian" or "owner".
    pub decided_by: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ItemStatus {
    AwaitingOwner,
    Granted,
    Denied,
    Revoked,
    Expired,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    pub id: String,
    pub data_class: String,
    pub label: String,
    pub resource: String,
    pub status: ItemStatus,
    pub decision: Decision,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grant_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsentRequest {
    pub id: String,
    pub requester: Requester,
    pub subject: String,
    pub purpose: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested_duration: Option<String>,
    pub context: Context,
    pub created: DateTime<Utc>,
    /// "awaiting_owner" while any item waits for the owner, otherwise "decided".
    pub status: String,
    pub items: Vec<Item>,
}

impl ConsentRequest {
    pub fn recompute_status(&mut self) {
        self.status = if self.items.iter().any(|i| i.status == ItemStatus::AwaitingOwner) {
            "awaiting_owner".into()
        } else {
            "decided".into()
        };
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GrantStatus {
    Active,
    Revoked,
    Expired,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Grant {
    pub id: String,
    pub request_id: String,
    pub item_id: String,
    pub subject: String,
    pub grantee: String,
    pub grantee_name: String,
    pub data_class: String,
    pub resource: String,
    pub modes: Vec<String>,
    pub starts: DateTime<Utc>,
    pub ends: DateTime<Utc>,
    pub status: GrantStatus,
    pub approved_by: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revoked_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revoke_reason: Option<String>,
    /// IRI of the audit entry that recorded the grant, in the subject's pod mirror.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audit_ref: Option<String>,
}
