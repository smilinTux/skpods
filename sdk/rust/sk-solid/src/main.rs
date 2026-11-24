//! sk-solid CLI. STUB: parses arguments, then hits `todo!()`.

use clap::{Parser, Subcommand};
use sk_solid::{acl::Mode, Config};

#[derive(Parser)]
#[command(name = "sk-solid", version, about = "SKPods Solid client and dev tooling (stub)")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Fetch a token with client credentials and print its expiry (never the token).
    Login,
    /// GET a resource.
    Get { url: String },
    /// PUT a file to a resource.
    Put { url: String, file: String, #[arg(long, default_value = "text/turtle")] content_type: String },
    /// PATCH a resource (N3 Patch or SPARQL Update).
    Patch { url: String, file: String, #[arg(long)] sparql: bool },
    /// DELETE a resource.
    Delete { url: String },
    /// Grant a WebID access to a resource.
    Grant { resource: String, grantee: String, #[arg(long, value_delimiter = ',', default_value = "read")] modes: Vec<String> },
    /// Revoke a WebID's access to a resource.
    Revoke { resource: String, grantee: String },
    /// Load fixtures into the test users' pods.
    Seed { #[arg(long)] reset: bool },
}

#[allow(dead_code)]
fn parse_mode(s: &str) -> Option<Mode> {
    match s {
        "read" => Some(Mode::Read),
        "append" => Some(Mode::Append),
        "write" => Some(Mode::Write),
        "control" => Some(Mode::Control),
        _ => None,
    }
}

fn main() -> sk_solid::Result<()> {
    let cli = Cli::parse();
    let cfg = Config::from_env()?;
    match cli.cmd {
        Cmd::Seed { reset } => sk_solid::seed::seed(&cfg, reset),
        _ => todo!("wire the remaining subcommands to auth, pod and acl"),
    }
}
