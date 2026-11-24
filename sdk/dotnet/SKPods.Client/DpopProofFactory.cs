// STUB-level but functional: creates DPoP proofs (RFC 9449) with an ES256 key.
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace SKPods.Client;

/// <summary>
/// Holds one ES256 (P-256) key pair and signs DPoP proof JWTs with it. The same
/// key must be used for the token request and every resource request made with
/// the resulting access token, because the token is bound to this key (cnf.jkt).
/// </summary>
public sealed class DpopProofFactory : IDisposable
{
    private readonly ECDsa _key = ECDsa.Create(ECCurve.NamedCurves.nistP256);

    /// <summary>Public JWK (kty, crv, x, y) placed in the proof header.</summary>
    public IReadOnlyDictionary<string, string> PublicJwk { get; }

    public DpopProofFactory()
    {
        var p = _key.ExportParameters(false);
        PublicJwk = new Dictionary<string, string>
        {
            ["kty"] = "EC",
            ["crv"] = "P-256",
            ["x"] = B64(p.Q.X!),
            ["y"] = B64(p.Q.Y!),
        };
    }

    /// <summary>
    /// Builds a proof. <paramref name="url"/> is reduced to htu (no query, no fragment).
    /// Pass <paramref name="accessToken"/> for resource requests to add the ath claim,
    /// and <paramref name="nonce"/> when the server demanded one (DPoP-Nonce header).
    /// </summary>
    public string CreateProof(string method, Uri url, string? accessToken = null, string? nonce = null)
    {
        var htu = new UriBuilder(url) { Query = "", Fragment = "" }.Uri.GetLeftPart(UriPartial.Path);
        var header = new Dictionary<string, object>
        {
            ["typ"] = "dpop+jwt",
            ["alg"] = "ES256",
            ["jwk"] = PublicJwk,
        };
        var claims = new Dictionary<string, object>
        {
            ["htm"] = method.ToUpperInvariant(),
            ["htu"] = htu,
            ["iat"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            ["jti"] = Guid.NewGuid().ToString(),
        };
        if (accessToken is not null)
            claims["ath"] = B64(SHA256.HashData(Encoding.ASCII.GetBytes(accessToken)));
        if (nonce is not null)
            claims["nonce"] = nonce;
        return Sign(header, claims);
    }

    private string Sign(object header, object claims)
    {
        var signingInput = B64(JsonSerializer.SerializeToUtf8Bytes(header)) + "." + B64(JsonSerializer.SerializeToUtf8Bytes(claims));
        // ECDsa.SignData returns IEEE P1363 (r||s), which is what JWS ES256 requires.
        var sig = _key.SignData(Encoding.ASCII.GetBytes(signingInput), HashAlgorithmName.SHA256);
        return signingInput + "." + B64(sig);
    }

    internal static string B64(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public void Dispose() => _key.Dispose();
}
