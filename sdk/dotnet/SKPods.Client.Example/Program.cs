// STUB / example. Logs in as the dw-agent test user, writes to its own pod, reads
// it back, then tries dw-alice's private storage and expects 403.
//
//   export SKPODS_BASE=https://pods-dev.skstack01.douno.it
//   export SKPODS_USER=dw-agent
//   export SKPODS_CLIENT_ID=...       # delivered privately by the SKPods admin
//   export SKPODS_CLIENT_SECRET=...   # never commit
//   dotnet run --project SKPods.Client.Example
using SKPods.Client;

var opt = PodStoreOptions.FromEnvironment();
using var http = new HttpClient();
using var dpop = new DpopProofFactory();
var auth = new SolidOidcClientCredentials(http, opt, dpop);
IPodStore store = new SolidHttpPodStore(http, auth);

// 1. write to own pod
var mine = new Uri(opt.PodRoot, $"skpods-example-{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}.ttl");
await store.PutAsync(mine, "<#it> <http://schema.org/name> \"skpods example\" .\n");
Console.WriteLine($"PUT  {mine} ok");

// 2. read it back
var back = await store.GetAsync(mine);
Console.WriteLine($"GET  {mine} -> {(back is null ? "missing" : back.Body.Trim())}");

// 3. clean up
await store.DeleteAsync(mine);

// 4. other user's private storage must be denied
var alice = new Uri(opt.PodRootOf("dw-alice"), "private/");
try
{
    await store.GetAsync(alice);
    Console.WriteLine($"UNEXPECTED: read {alice}");
    return 1;
}
catch (PodAccessException e) when (e.Status == 403)
{
    Console.WriteLine($"GET  {alice} -> 403 as expected");
}
return 0;
