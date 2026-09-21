using System.Net.Http;
using ZaKi.Dispatcher.Data;

namespace ZaKi.Dispatcher.Services;

public sealed class SyncService : IAsyncDisposable
{
    private readonly LocalDatabase _database;
    private readonly FirebaseRestClient _firebase;
    private readonly string _adminId;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly CancellationTokenSource _lifetime = new();
    private Task? _loop;

    public SyncService(LocalDatabase database, FirebaseRestClient firebase, string adminId)
    {
        _database = database;
        _firebase = firebase;
        _adminId = adminId;
    }

    public string AdminId => _adminId;
    public bool IsOnline { get; private set; }
    public DateTimeOffset? LastSuccessfulSync { get; private set; }
    public string? LastError { get; private set; }

    public event EventHandler? StateChanged;
    public event EventHandler? DataChanged;

    public void Start()
    {
        _loop ??= RunLoopAsync(_lifetime.Token);
    }

    public async Task SyncNowAsync(bool full = false, CancellationToken cancellationToken = default)
    {
        if (!await _gate.WaitAsync(0, cancellationToken)) return;
        try
        {
            LastError = null;
            IsOnline = await _firebase.CheckConnectionAsync(cancellationToken);
            StateChanged?.Invoke(this, EventArgs.Empty);
            if (!IsOnline) return;

            foreach (var operation in await _database.GetPendingOperationsAsync())
            {
                try
                {
                    await _firebase.CallFunctionAsync(operation.FunctionName, operation.PayloadJson, cancellationToken);
                    await _database.CompleteOperationAsync(operation);
                }
                catch (HttpRequestException exception)
                {
                    await _database.FailOperationAsync(operation, exception.Message);
                    IsOnline = false;
                    LastError = "Связь с Firebase прервана";
                    StateChanged?.Invoke(this, EventArgs.Empty);
                    return;
                }
                catch (Exception exception)
                {
                    await _database.FailOperationAsync(operation, exception.Message);
                    LastError = exception.Message;
                }
            }

            var deliveries = await _firebase.GetLatestDeliveriesAsync(full ? 5000 : 300, cancellationToken);
            await _database.UpsertDeliveriesAsync(deliveries);
            LastSuccessfulSync = DateTimeOffset.Now;
            IsOnline = true;
            DataChanged?.Invoke(this, EventArgs.Empty);
            StateChanged?.Invoke(this, EventArgs.Empty);
        }
        catch (OperationCanceledException) when (_lifetime.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            IsOnline = false;
            LastError = exception.Message;
            StateChanged?.Invoke(this, EventArgs.Empty);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task QueueStatusChangeAsync(Models.Delivery delivery, string status)
    {
        await _database.QueueStatusChangeAsync(_adminId, delivery, status);
        DataChanged?.Invoke(this, EventArgs.Empty);
        await SyncNowAsync();
    }

    private async Task RunLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            await SyncNowAsync(cancellationToken: cancellationToken);
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(15), cancellationToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        await _lifetime.CancelAsync();
        if (_loop is not null)
        {
            try { await _loop; } catch (OperationCanceledException) { }
        }
        _lifetime.Dispose();
        _gate.Dispose();
    }
}
