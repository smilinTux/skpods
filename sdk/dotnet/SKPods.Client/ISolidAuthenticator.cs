// STUB. Common shape for the two login flows.
namespace SKPods.Client;

/// <summary>
/// Adds Solid-OIDC credentials (Authorization: DPoP, plus a DPoP proof) to a request.
/// </summary>
public interface ISolidAuthenticator
{
    /// <summary>Signs the request in place. Fetches or refreshes the access token as needed.</summary>
    /// <param name="nonce">Server-supplied DPoP nonce from a previous 401 response, if any.</param>
    Task AuthorizeAsync(HttpRequestMessage request, string? nonce = null, CancellationToken ct = default);
}
