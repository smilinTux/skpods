// STUB. Part of the SKPods.Client SDK skeleton. See ../../README.md.
namespace SKPods.Client;

/// <summary>
/// Connection settings for one pod server and one identity. Values come from
/// environment variables. Nothing here is ever hardcoded and secrets are never
/// logged or committed.
/// </summary>
public sealed class PodStoreOptions
{
    /// <summary>Server origin, e.g. the dev server base URL. No trailing slash.</summary>
    public required string BaseUrl { get; init; }

    /// <summary>Solid user name (the part after "~" in the pod URL), e.g. "dw-agent".</summary>
    public string? User { get; init; }

    /// <summary>WebID of the acting identity (optional, informational for client credentials).</summary>
    public string? WebId { get; init; }

    /// <summary>Client credentials id for headless agents. Delivered privately by the SKPods admin.</summary>
    public string? ClientId { get; init; }

    /// <summary>Client credentials secret. Delivered privately by the SKPods admin. Never commit.</summary>
    public string? ClientSecret { get; init; }

    /// <summary>Pod root, e.g. {BaseUrl}/apps/solid/~{User}/storage/ (shape verified against pods-dev tooling).</summary>
    public Uri PodRoot => new($"{BaseUrl.TrimEnd('/')}/apps/solid/~{User}/storage/");

    /// <summary>Pod root for another user (used to test access denial).</summary>
    public Uri PodRootOf(string user) => new($"{BaseUrl.TrimEnd('/')}/apps/solid/~{user}/storage/");

    /// <summary>
    /// Reads SKPODS_BASE (required), SKPODS_USER, SKPODS_WEBID, SKPODS_CLIENT_ID,
    /// SKPODS_CLIENT_SECRET from the environment.
    /// </summary>
    public static PodStoreOptions FromEnvironment()
    {
        static string? Env(string n) => Environment.GetEnvironmentVariable(n) is { Length: > 0 } v ? v : null;
        return new PodStoreOptions
        {
            BaseUrl = Env("SKPODS_BASE") ?? throw new InvalidOperationException("SKPODS_BASE is not set"),
            User = Env("SKPODS_USER"),
            WebId = Env("SKPODS_WEBID"),
            ClientId = Env("SKPODS_CLIENT_ID"),
            ClientSecret = Env("SKPODS_CLIENT_SECRET"),
        };
    }
}
