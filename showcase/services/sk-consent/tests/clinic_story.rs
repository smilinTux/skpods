//! Full clinic story against a live pod server. Ignored by default.
//!
//! Run:  set -a; . <creds env with SKPODS_BASE, DW_ALICE_*, DW_PRACTITIONER_*>; set +a
//!       export SKCONSENT_CREDS_FILE=<0600 file with SKCONSENT_CLIENT_ID / SKCONSENT_CLIENT_SECRET for the agent>
//!       cargo test --test clinic_story -- --ignored --nocapture
//!
//! It starts the service in process, seeds the owner's pod, files the clinic request with a 20 second duration, lets the
//! owner approve the insurance item with a real DPoP token, reads every item as the clinic, waits for expiry, reads again.

use std::future::IntoFuture;
use sk_consent::{api, broker::Broker, config::Config, demo, store::Store};

#[tokio::test]
#[ignore = "needs a live pod server and credentials, see the file header"]
async fn clinic_story_with_auto_revoke() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    std::env::set_var("SKCONSENT_BIND", addr.to_string());
    std::env::set_var("DEMO_INSECURE_OWNER", "0");
    let mut cfg = Config::from_env().expect("config from env");
    let dir = std::env::temp_dir().join(format!("sk-consent-it-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    cfg.db_path = dir.join("it.db");
    let base = cfg.pods_base.clone();
    let b = Broker::start(cfg.clone(), Store::open(&cfg.db_path).unwrap());
    tokio::spawn(axum::serve(listener, api::router(b.clone())).into_future());
    let broker_url = format!("http://{addr}");

    let owner = demo::Actor::from_env("DW_ALICE", "dw-alice").unwrap();
    let clinic = demo::Actor::from_env("DW_PRACTITIONER", "dw-practitioner").unwrap();
    let subject = owner.webid(&base);
    let agent = b.agent_webid().await.expect("agent login");
    demo::seed_demo(&base, &owner, &clinic, &agent).await.expect("seed");

    // Unauthenticated and bogus-token callers are refused.
    let http = reqwest::Client::new();
    let r = http.post(format!("{broker_url}/requests")).json(&serde_json::json!({})).send().await.unwrap();
    assert!(r.status() == 401 || r.status() == 422, "unauthenticated POST /requests: {}", r.status());
    let r = http.post(format!("{broker_url}/grants/none/revoke")).header("Authorization", "DPoP junk").header("DPoP", "junk").send().await.unwrap();
    assert_eq!(r.status(), 401);

    let rep = demo::simulate_clinic(
        &demo::SimOpts {
            base: base.clone(),
            broker: broker_url.clone(),
            subject: subject.clone(),
            clinic: demo::Actor::from_env("DW_PRACTITIONER", "dw-practitioner").unwrap(),
            duration: Some("20s".into()),
            booking_ref: "BAY-1042".into(),
            owner: Some(demo::Actor::from_env("DW_ALICE", "dw-alice").unwrap()),
            wait_owner_s: 0,
            watch_expiry: true,
        },
        &|s| println!("{s}"),
    )
    .await
    .expect("simulation");

    let item = |c: &str| rep.items.iter().find(|i| i.data_class == c).unwrap();
    for c in ["dob", "allergies", "medications"] {
        assert_eq!(item(c).action, "approve", "{c} auto approved");
        assert_eq!(item(c).read_http, Some(200), "{c} readable while granted");
        assert_eq!(item(c).read_after_expiry, Some(403), "{c} blocked after expiry");
    }
    assert_eq!(item("insurance_member_id").status, "granted", "owner approved");
    assert_eq!(item("insurance_member_id").read_http, Some(200));
    assert_eq!(item("ssn").action, "deny");
    assert_eq!(item("ssn").read_http, Some(403));
    assert!(item("ssn").counter_offer.is_some());

    // Owner revokes the insurance grant now, with a real token, and the clinic loses access at once.
    let gid = item("insurance_member_id").grant_id.clone().unwrap();
    let (oc, oe) = sk_consent::solid::SolidClient::ephemeral(&base, &owner.user, &owner.password).await.unwrap();
    let url = format!("{broker_url}/grants/{gid}/revoke");
    let mut rb = http.post(&url).json(&serde_json::json!({}));
    for (k, v) in oc.auth_headers("POST", &url).await.unwrap() {
        rb = rb.header(k, v);
    }
    let r = rb.send().await.unwrap();
    assert_eq!(r.status(), 200, "owner revoke");
    oe.cleanup().await;
    let (cc, ce) = sk_consent::solid::SolidClient::ephemeral(&base, &clinic.user, &clinic.password).await.unwrap();
    let res = b.store.get_grant(&gid).unwrap().unwrap().resource;
    assert_eq!(cc.get(&res).await.unwrap().status.as_u16(), 403, "clinic read after owner revoke");
    ce.cleanup().await;

    // The audit chain verifies, then a tampered store is caught.
    let v: serde_json::Value = http.get(format!("{broker_url}/audit/verify")).send().await.unwrap().json().await.unwrap();
    assert_eq!(v["ok"], true, "{v}");
    b.store.raw_exec("UPDATE audit SET json = replace(json, 'dob', 'xxx') WHERE seq = 2").unwrap();
    let v: serde_json::Value = http.get(format!("{broker_url}/audit/verify")).send().await.unwrap().json().await.unwrap();
    assert_eq!(v["ok"], false);
    assert_eq!(v["first_bad_index"], 2);
    std::fs::remove_dir_all(dir).ok();
}
