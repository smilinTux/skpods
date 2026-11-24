// STUB. The real consent broker is PLANNED (Rust service, phase 3). This is the
// interface the app codes against, so swapping WacDirectConsentBroker for an HTTP
// client of the real broker does not change app code.
namespace SKPods.Client;

/// <summary>Access modes, mapped to WAC acl:Read / acl:Write / acl:Append / acl:Control.</summary>
[Flags]
public enum AccessMode { Read = 1, Append = 2, Write = 4, Control = 8 }

/// <summary>Request for a time-limited grant over one resource or container.</summary>
public sealed record GrantRequest(Uri Resource, Uri Grantee, AccessMode Modes, TimeSpan Lifetime, string Purpose, bool Inherit = false);

/// <summary>An issued grant.</summary>
public sealed record Grant(string Id, Uri Resource, Uri Grantee, AccessMode Modes, DateTimeOffset IssuedAt, DateTimeOffset ExpiresAt, string Purpose, bool Revoked);

/// <summary>Time-limited, revocable access grants with an audit trail.</summary>
public interface IConsentBroker
{
    Task<Grant> RequestGrantAsync(GrantRequest request, CancellationToken ct = default);
    Task<Grant?> GetGrantAsync(string grantId, CancellationToken ct = default);
    Task RevokeAsync(string grantId, CancellationToken ct = default);

    /// <summary>Lists grants, optionally only those on a resource. Expired grants have ExpiresAt in the past.</summary>
    Task<IReadOnlyList<Grant>> ListGrantsAsync(Uri? resource = null, bool includeExpired = false, CancellationToken ct = default);
}
