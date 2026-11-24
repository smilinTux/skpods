// STUB. The only pod interface an app should code against.
namespace SKPods.Client;

/// <summary>A fetched pod resource.</summary>
public sealed record PodResource(Uri Url, string ContentType, string Body, string? ETag);

/// <summary>How a PATCH body is interpreted.</summary>
public enum PatchKind
{
    /// <summary>Solid N3 Patch (text/n3), solid:inserts / solid:deletes / solid:where.</summary>
    N3Patch,
    /// <summary>SPARQL Update (application/sparql-update).</summary>
    SparqlUpdate,
}

/// <summary>One entry from a Type Index lookup.</summary>
public sealed record TypeRegistration(Uri ForClass, Uri? Instance, Uri? InstanceContainer);

/// <summary>
/// Storage abstraction over plain Solid HTTP + DPoP. Nothing engine-specific:
/// the same code runs against the Nextcloud engine today and the Rust engine later.
/// </summary>
public interface IPodStore
{
    /// <summary>GET a resource. Returns null on 404. Throws <see cref="PodAccessException"/> on 401/403.</summary>
    Task<PodResource?> GetAsync(Uri resource, string accept = "text/turtle", CancellationToken ct = default);

    /// <summary>PUT (create or replace). Intermediate containers are created by the server. Optional If-Match.</summary>
    Task PutAsync(Uri resource, string body, string contentType = "text/turtle", string? ifMatch = null, CancellationToken ct = default);

    /// <summary>PATCH with N3 Patch or SPARQL Update.</summary>
    Task PatchAsync(Uri resource, string patchBody, PatchKind kind, CancellationToken ct = default);

    /// <summary>DELETE a resource (or an empty container).</summary>
    Task DeleteAsync(Uri resource, CancellationToken ct = default);

    /// <summary>Lists ldp:contains members of a container.</summary>
    Task<IReadOnlyList<Uri>> ListContainerAsync(Uri container, CancellationToken ct = default);

    /// <summary>
    /// Finds where a class is stored, via the Type Index linked from the WebID profile
    /// (solid:publicTypeIndex and solid:privateTypeIndex).
    /// </summary>
    Task<IReadOnlyList<TypeRegistration>> FindByTypeAsync(Uri webId, Uri rdfClass, CancellationToken ct = default);
}

/// <summary>Thrown on 401 or 403 from the pod server.</summary>
public sealed class PodAccessException(Uri url, int status)
    : Exception($"Access denied ({status}) for {url}")
{
    public Uri Url { get; } = url;
    public int Status { get; } = status;
}
