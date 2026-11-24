// STUB-level but functional for dev. Headless agents (for example dw-agent).
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace SKPods.Client;

/// <summary>
/// client_credentials grant with a DPoP-bound token, as used by headless agents.
/// Flow (verified against the dev server): GET /.well-known/openid-configuration,
/// then POST to token_endpoint with HTTP Basic (client id/secret), form body
/// grant_type=client_credentials&amp;scope=webid, and a DPoP header. The response
/// access_token is bound to the DPoP key. Use "Authorization: DPoP &lt;token&gt;".
/// </summary>
public sealed class SolidOidcClientCredentials : ISolidAuthenticator
{
    private readonly HttpClient _http;
    private readonly PodStoreOptions _opt;
    private readonly DpopProofFactory _dpop;
    private string? _token;
    private DateTimeOffset _expires;
    private string? _tokenEndpoint;

    public SolidOidcClientCredentials(HttpClient http, PodStoreOptions options, DpopProofFactory? dpop = null)
    {
        _http = http;
        _opt = options;
        _dpop = dpop ?? new DpopProofFactory();
        if (options.ClientId is null || options.ClientSecret is null)
            throw new InvalidOperationException("SKPODS_CLIENT_ID and SKPODS_CLIENT_SECRET are required (delivered privately by the SKPods admin).");
    }

    public async Task AuthorizeAsync(HttpRequestMessage request, string? nonce = null, CancellationToken ct = default)
    {
        var token = await GetTokenAsync(ct);
        request.Headers.Authorization = new AuthenticationHeaderValue("DPoP", token);
        request.Headers.Remove("DPoP");
        request.Headers.Add("DPoP", _dpop.CreateProof(request.Method.Method, request.RequestUri!, token, nonce));
    }

    private async Task<string> GetTokenAsync(CancellationToken ct)
    {
        if (_token is not null && DateTimeOffset.UtcNow < _expires - TimeSpan.FromSeconds(30)) return _token;

        _tokenEndpoint ??= await DiscoverTokenEndpointAsync(ct);
        string? nonce = null;
        for (var attempt = 0; attempt < 2; attempt++)
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, _tokenEndpoint)
            {
                Content = new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["grant_type"] = "client_credentials",
                    ["scope"] = "webid",
                }),
            };
            var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{_opt.ClientId}:{_opt.ClientSecret}"));
            req.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);
            req.Headers.Add("DPoP", _dpop.CreateProof("POST", new Uri(_tokenEndpoint), null, nonce));

            using var resp = await _http.SendAsync(req, ct);
            // Nonce retry: servers may answer 400/401 with a DPoP-Nonce header. Retry once with it.
            if (attempt == 0 && resp.Headers.TryGetValues("DPoP-Nonce", out var n) && !resp.IsSuccessStatusCode)
            {
                nonce = n.First();
                continue;
            }
            resp.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
            _token = doc.RootElement.GetProperty("access_token").GetString()!;
            var expiresIn = doc.RootElement.TryGetProperty("expires_in", out var e) ? e.GetInt32() : 600;
            _expires = DateTimeOffset.UtcNow.AddSeconds(expiresIn);
            return _token;
        }
        throw new HttpRequestException("Token request failed after DPoP nonce retry.");
    }

    private async Task<string> DiscoverTokenEndpointAsync(CancellationToken ct)
    {
        var url = _opt.BaseUrl.TrimEnd('/') + "/.well-known/openid-configuration";
        using var doc = JsonDocument.Parse(await _http.GetStringAsync(url, ct));
        return doc.RootElement.GetProperty("token_endpoint").GetString()!;
    }
}
