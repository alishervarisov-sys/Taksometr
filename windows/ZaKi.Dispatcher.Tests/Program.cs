using ZaKi.Dispatcher.Models;
using ZaKi.Dispatcher.Services;

static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
var folder = Path.Combine(Path.GetTempPath(), "zaki-notifications-test-" + Guid.NewGuid());
Directory.CreateDirectory(folder);
var path = Path.Combine(folder, "admin-one.json");
var request = new BalanceTopUpRequest("one", "Курьер", 30);
var shown = new List<string>();
var removed = new List<string>();
Task<bool> Show(BalanceTopUpRequest row) { shown.Add(row.Id); return Task.FromResult(true); }
try
{
    var tracker = new TopUpNotificationTracker(path);
    await tracker.ProcessAsync([request], Show, removed.Add, CancellationToken.None);
    await tracker.ProcessAsync([request], Show, removed.Add, CancellationToken.None);
    Check(shown.Count == 1, "Repeated polls must not duplicate a notification");
    tracker = new TopUpNotificationTracker(path);
    await tracker.ProcessAsync([request], Show, removed.Add, CancellationToken.None);
    Check(shown.Count == 1, "Restart must preserve the pending request's notification state");
    await tracker.ProcessAsync([request, new("two", "Курьер 2", 50)], Show, removed.Add, CancellationToken.None);
    Check(shown.Count == 2, "A new request after reconnect must display");
    await tracker.ProcessAsync([new("two", "Курьер 2", 50)], Show, removed.Add, CancellationToken.None);
    Check(removed.SequenceEqual(["one"]), "Reviewed requests must leave the notification center");
    await tracker.ProcessAsync([new("three", "Курьер 3", 70)], _ => Task.FromResult(false), removed.Add, CancellationToken.None);
    tracker = new TopUpNotificationTracker(path);
    await tracker.ProcessAsync([new("three", "Курьер 3", 70)], Show, removed.Add, CancellationToken.None);
    Check(shown.Last() == "three", "A disabled/failed toast must retry after recovery");
    var otherAdmin = new TopUpNotificationTracker(Path.Combine(folder, "admin-two.json"));
    await otherAdmin.ProcessAsync([request], Show, removed.Add, CancellationToken.None);
    Check(shown.Count(id => id == "one") == 2, "Notification state must be independent between administrators");
    using var cancellation = new CancellationTokenSource();
    cancellation.Cancel();
    try
    {
        await tracker.ProcessAsync([new("logout", "Курьер", 30)], Show, removed.Add, cancellation.Token);
        throw new Exception("Stopped monitoring must reject pending notifications");
    }
    catch (OperationCanceledException) { }
    Check(!shown.Contains("logout"), "Logout/exit must prevent a queued notification");
    File.WriteAllText(path, "corrupt file");
    await new TopUpNotificationTracker(path).ProcessAsync([request], Show, removed.Add, CancellationToken.None);
    Console.WriteLine("Windows notification checks passed: deduplication, restart, reconnect, resolved requests, failed display retry, account isolation, cancellation and corrupted state recovery.");
}
finally
{
    foreach (var file in Directory.GetFiles(folder)) File.Delete(file);
    Directory.Delete(folder);
}
