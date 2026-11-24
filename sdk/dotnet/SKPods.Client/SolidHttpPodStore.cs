// STUB-level: GET/PUT/PATCH/DELETE work; Turtle parsing and Type Index are TODO.
using System.Net;
using System.Text;
using System.Text.RegularExpressions;

namespace SKPods.Client;

/// <summary>HttpClient-based <see cref="IPodStore"/> that signs every request with DPoP.</summary>
public sealed class SolidHttpPodStore(HttpClient http, ISolidAuthenticator auth) : IPodStore
{
    public async Task<PodResource?> GetAsync(Uri resource, string accept = "text/turtle", CancellationToken ct = default)
    {
        using var resp = await SendAsync(() =>
        {
            var r = new HttpRequestMessage(HttpMethod.Get, resource);
            r.Headers.TryAddWithoutValidation("Accept", accept);
            return r;
        }, ct);
        if (resp.StatusCode == HttpStatusCode.NotFound) return null;
        resp.EnsureSuccessStatusCode();
        return new PodResource(resource, resp.Content.Headers.ContentType?.MediaType ?? "", await resp.Content.ReadAsStringAsync(ct), resp.Headers.ETag?.Tag);
    }

    public async Task PutAsync(Uri resource, string body, string contentType = "text/turtle", string? ifMatch = null, CancellationToken ct = default)
    {
        using var resp = await SendAsync(() =>
        {
            var r = new HttpRequestMessage(HttpMethod.Put, resource) { Content = new StringContent(body, Encoding.UTF8, contentType) };
            if (ifMatch is not null) r.Headers.TryAddWithoutValidation("If-Match", ifMatch);
            return r;
        }, ct);
        resp.EnsureSuccessStatusCode();
    }

    public async Task PatchAsync(Uri resource, string patchBody, PatchKind kind, CancellationToken ct = default)
    {
        var ct2 = kind == PatchKind.N3Patch ? "text/n3" : "application/sparql-update";
        using var resp = await SendAsync(() => new HttpRequestMessage(HttpMethod.Patch, resource) { Content = new StringContent(patchBody, Encoding.UTF8, ct2) }, ct);
        resp.EnsureSuccessStatusCode();
    }

    public async Task DeleteAsync(Uri resource, CancellationToken ct = default)
    {
        using var resp = await SendAsync(() => new HttpRequestMessage(HttpMethod.Delete, resource), ct);
        if (resp.StatusCode != HttpStatusCode.NotFound) resp.EnsureSuccessStatusCode();
    }

    public async Task<IReadOnlyList<Uri>> ListContainerAsync(Uri container, CancellationToken ct = default)
    {
        var res = await GetAsync(container, "text/turtle", ct) ?? throw new FileNotFoundException(container.ToString());
        // TODO: replace this crude scan with a real Turtle parser (for example dotNetRDF)
        // and read ldp:contains triples properly. This regex only handles the common
        // "ldp:contains <a>, <b> ." serialization.
        var m = Regex.Match(res.Body, @"ldp:contains\s+([^.;]+)");
        if (!m.Success) return [];
        return Regex.Matches(m.Groups[1].Value, @"<([^>]+)>")
            .Select(x => new Uri(container, x.Groups[1].Value)).ToList();
    }

    public Task<IReadOnlyList<TypeRegistration>> FindByTypeAsync(Uri webId, Uri rdfClass, CancellationToken ct = default)
        => throw new NotImplementedException(
            "TODO: GET the WebID profile, read solid:publicTypeIndex and solid:privateTypeIndex, " +
            "GET each index, return solid:TypeRegistration entries whose solid:forClass == rdfClass " +
            "(solid:instance or solid:instanceContainer). Needs a Turtle parser.");

    /// <summary>
    /// Sends a signed request. On 401 with a DPoP-Nonce header, retries once with that nonce.
    /// 401/403 final answers raise <see cref="PodAccessException"/>.
    /// </summary>
    private async Task<HttpResponseMessage> SendAsync(Func<HttpRequestMessage> make, CancellationToken ct)
    {
        string? nonce = null;
        for (var attempt = 0; ; attempt++)
        {
            var req = make();
            await auth.AuthorizeAsync(req, nonce, ct);
            var resp = await http.SendAsync(req, ct);
            if (resp.StatusCode == HttpStatusCode.Unauthorized && attempt == 0 && resp.Headers.TryGetValues("DPoP-Nonce", out var n))
            {
                nonce = n.First();
                resp.Dispose();
                continue;
            }
            if (resp.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            {
                var status = (int)resp.StatusCode;
                resp.Dispose();
                throw new PodAccessException(req.RequestUri!, status);
            }
            return resp;
        }
    }
}
