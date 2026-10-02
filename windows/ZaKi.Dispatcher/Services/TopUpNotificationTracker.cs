using System.IO;
using System.Text.Json;
using ZaKi.Dispatcher.Models;

namespace ZaKi.Dispatcher.Services;

/// <summary>Persists only request IDs, separately for each administrator.</summary>
public sealed class TopUpNotificationTracker
{
    private readonly string _path;
    private readonly HashSet<string> _seen;

    public TopUpNotificationTracker(string path)
    {
        _path = path;
        try { _seen = File.Exists(path) ? JsonSerializer.Deserialize<HashSet<string>>(File.ReadAllText(path)) ?? [] : []; }
        catch (JsonException) { _seen = []; }
    }

    public async Task ProcessAsync(IReadOnlyList<BalanceTopUpRequest> requests,
        Func<BalanceTopUpRequest, Task<bool>> show, Action<string> remove, CancellationToken cancellationToken)
    {
        var pending = requests.Select(request => request.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var id in _seen.Where(id => !pending.Contains(id)).ToArray())
        {
            cancellationToken.ThrowIfCancellationRequested();
            remove(id);
            _seen.Remove(id);
        }
        Save();
        foreach (var request in requests)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (_seen.Contains(request.Id) || string.IsNullOrWhiteSpace(request.Id)) continue;
            if (!await show(request)) continue;
            _seen.Add(request.Id);
            Save();
        }
    }

    private void Save()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        File.WriteAllText(_path + ".tmp", JsonSerializer.Serialize(_seen));
        File.Move(_path + ".tmp", _path, overwrite: true);
    }
}
