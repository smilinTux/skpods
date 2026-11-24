// STUB, DEV ONLY. Writes WAC .acl documents directly with the caller's own
// credentials. It has NO scheduled revoke and NO tamper-evident audit log: the
// real broker (planned) adds those. Grants are tracked in memory only.
using System.Collections.Concurrent;
using System.Text;

namespace SKPods.Client;

/// <summary>
/// Dev implementation of <see cref="IConsentBroker"/>: one .acl per resource,
/// written through <see cref="IPodStore"/>. Caller must hold acl:Control.
/// </summary>
public sealed class WacDirectConsentBroker(IPodStore store) : IConsentBroker
{
    private readonly ConcurrentDictionary<string, Grant> _grants = new();

    public async Task<Grant> RequestGrantAsync(GrantRequest r, CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;
        var grant = new Grant(Guid.NewGuid().ToString("n"), r.Resource, r.Grantee, r.Modes, now, now + r.Lifetime, r.Purpose, false);
        // TODO: this REPLACES the whole .acl. A real implementation must read the
        // existing .acl and merge, so the owner's own Control authorization survives.
        await store.PutAsync(AclOf(r.Resource), BuildAcl(grant, r.Inherit), "text/turtle", null, ct);
        _grants[grant.Id] = grant;
        return grant;
    }

    public Task<Grant?> GetGrantAsync(string grantId, CancellationToken ct = default)
        => Task.FromResult(_grants.TryGetValue(grantId, out var g) ? g : null);

    public async Task RevokeAsync(string grantId, CancellationToken ct = default)
    {
        if (!_grants.TryGetValue(grantId, out var g)) return;
        // TODO: remove only this grant's authorization from the merged .acl instead of deleting the file.
        await store.DeleteAsync(AclOf(g.Resource), ct);
        _grants[grantId] = g with { Revoked = true };
    }

    public Task<IReadOnlyList<Grant>> ListGrantsAsync(Uri? resource = null, bool includeExpired = false, CancellationToken ct = default)
    {
        var now = DateTimeOffset.UtcNow;
        IReadOnlyList<Grant> list = _grants.Values
            .Where(g => resource is null || g.Resource == resource)
            .Where(g => includeExpired || (!g.Revoked && g.ExpiresAt > now))
            .ToList();
        return Task.FromResult(list);
    }

    // Convention for the Nextcloud engine: the ACL of X is X + ".acl". A general client
    // should read the Link rel="acl" header instead. TODO: do that.
    private static Uri AclOf(Uri resource) => new(resource.ToString() + ".acl");

    private static string BuildAcl(Grant g, bool inherit)
    {
        var modes = new List<string>();
        if (g.Modes.HasFlag(AccessMode.Read)) modes.Add("acl:Read");
        if (g.Modes.HasFlag(AccessMode.Append)) modes.Add("acl:Append");
        if (g.Modes.HasFlag(AccessMode.Write)) modes.Add("acl:Write");
        if (g.Modes.HasFlag(AccessMode.Control)) modes.Add("acl:Control");
        var sb = new StringBuilder();
        sb.AppendLine("@prefix acl: <http://www.w3.org/ns/auth/acl#> .");
        sb.AppendLine("<#grant> a acl:Authorization ;");
        sb.AppendLine($"  acl:agent <{g.Grantee}> ;");
        sb.AppendLine($"  acl:accessTo <{g.Resource}> ;");
        if (inherit) sb.AppendLine($"  acl:default <{g.Resource}> ;");
        sb.AppendLine($"  acl:mode {string.Join(", ", modes)} .");
        return sb.ToString();
    }
}
