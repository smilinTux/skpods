// STUB. Interactive users (dw-alice in a browser or desktop app). Not implemented.
using System.Security.Cryptography;
using System.Text;

namespace SKPods.Client;

/// <summary>
/// Authorization Code + PKCE + DPoP for interactive users. STUB: only the PKCE
/// helpers are implemented. The rest needs dynamic client registration (or a
/// client ID document), a redirect listener or app redirect, and a code exchange
/// with a DPoP proof. See ../../../docs/LOGIN-AND-AUTH.md.
/// </summary>
public sealed class SolidOidcAuthCode : ISolidAuthenticator
{
    public SolidOidcAuthCode(HttpClient http, PodStoreOptions options, Uri redirectUri) { }

    /// <summary>Creates a PKCE verifier and its S256 challenge.</summary>
    public static (string Verifier, string Challenge) CreatePkce()
    {
        var verifier = DpopProofFactory.B64(RandomNumberGenerator.GetBytes(32));
        var challenge = DpopProofFactory.B64(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        return (verifier, challenge);
    }

    /// <summary>Builds the authorization URL the user opens in a browser.</summary>
    public Uri BuildAuthorizationUrl(string state, string challenge)
        => throw new NotImplementedException("TODO: discover authorization_endpoint, register client, build URL with code_challenge_method=S256, scope=openid webid offline_access.");

    /// <summary>Exchanges the code for a DPoP-bound token (with nonce retry).</summary>
    public Task ExchangeCodeAsync(string code, string verifier, CancellationToken ct = default)
        => throw new NotImplementedException("TODO: POST token endpoint with DPoP header, store access and refresh tokens.");

    public Task AuthorizeAsync(HttpRequestMessage request, string? nonce = null, CancellationToken ct = default)
        => throw new NotImplementedException("TODO: sign request like SolidOidcClientCredentials once a token exists; refresh when expired.");
}
