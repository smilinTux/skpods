use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use sk_consent::{api, broker::Broker, config::Config, demo, solid::SolidClient, store::Store};

#[derive(Parser)]
#[command(name = "sk-consent", version, about = "Consent broker and guardian agent for SKPods")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Run the HTTP service.
    Serve,
    /// Write fake PII, providers, a booking, the guardian policy and ACLs into the owner's pod (default dw-alice).
    SeedDemo {
        /// Env prefix of the owner account (reads <PREFIX>_USER and <PREFIX>_PASSWORD).
        #[arg(long, default_value = "DW_ALICE")]
        owner: String,
        /// Env prefix of the clinic account.
        #[arg(long, default_value = "DW_PRACTITIONER")]
        clinic: String,
    },
    /// Act as the clinic: send the request, wait, read each item and print what came back.
    SimulateClinic {
        #[arg(long, default_value = "DW_ALICE")]
        owner: String,
        #[arg(long, default_value = "DW_PRACTITIONER")]
        clinic: String,
        #[arg(long, env = "SKCONSENT_URL", default_value = "http://127.0.0.1:8787")]
        broker: String,
        /// Requested duration, e.g. 72h, 20s, until_booking_end.
        #[arg(long, default_value = "72h")]
        duration: String,
        /// Also act as the owner and approve the items that need a tap (24h).
        #[arg(long)]
        owner_approves: bool,
        /// Seconds to wait for a human owner when --owner-approves is not given.
        #[arg(long, default_value_t = 60)]
        wait_owner: u64,
        /// Wait for the first grant to expire and read again (expect 403).
        #[arg(long)]
        watch_expiry: bool,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())).init();
    let cli = Cli::parse();
    let cfg = Config::from_env()?;
    match cli.cmd {
        Cmd::Serve => {
            let store = Store::open(&cfg.db_path).context("open database")?;
            let bind = cfg.bind.clone();
            if cfg.insecure_owner {
                tracing::warn!("DEMO_INSECURE_OWNER=1: owner and requester identity are NOT verified. Development only.");
            }
            let b = Broker::start(cfg, store);
            match b.agent_webid().await {
                Ok(w) => tracing::info!("guardian agent logged in as {w}"),
                Err(e) => tracing::error!("agent login failed (the service will keep retrying per request): {e:#}"),
            }
            let app = api::router(b);
            let l = tokio::net::TcpListener::bind(&bind).await?;
            tracing::info!("sk-consent listening on http://{bind}");
            axum::serve(l, app).await?;
        }
        Cmd::SeedDemo { owner, clinic } => {
            let agent = SolidClient::new(&cfg.pods_base, sk_consent::solid::Creds { client_id: cfg.client_id.clone(), client_secret: cfg.client_secret.clone() });
            let agent_webid = agent.webid().await?;
            let r = demo::seed_demo(&cfg.pods_base, &demo::Actor::from_env(&owner, "dw-alice")?, &demo::Actor::from_env(&clinic, "dw-practitioner")?, &agent_webid).await?;
            println!("Seeded {} resources for {}", r.written.len(), r.subject);
            for w in r.written {
                println!("  {w}");
            }
            println!("Provider: {} (booking {})\nGuardian: {}", r.clinic, r.booking_ref, r.agent);
        }
        Cmd::SimulateClinic { owner, clinic, broker, duration, owner_approves, wait_owner, watch_expiry } => {
            let owner_actor = demo::Actor::from_env(&owner, "dw-alice")?;
            let opts = demo::SimOpts {
                base: cfg.pods_base.clone(),
                broker,
                subject: owner_actor.webid(&cfg.pods_base),
                clinic: demo::Actor::from_env(&clinic, "dw-practitioner")?,
                duration: Some(duration),
                booking_ref: "BAY-1042".into(),
                owner: owner_approves.then_some(owner_actor),
                wait_owner_s: wait_owner,
                watch_expiry,
            };
            let r = demo::simulate_clinic(&opts, &|s| println!("{s}")).await?;
            println!("\nSummary for request {}", r.request_id);
            for i in r.items {
                println!("{:<20} {:<9} {:<15} read={:?}{}", i.data_class, i.action, i.status, i.read_http.unwrap_or(0),
                    i.read_after_expiry.map(|c| format!(" after_expiry={c}")).unwrap_or_default());
                if let Some(c) = i.counter_offer {
                    println!("    counter offer: {c}");
                }
            }
        }
    }
    Ok(())
}
