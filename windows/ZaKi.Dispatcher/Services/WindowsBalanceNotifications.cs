using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Threading;
using Microsoft.Toolkit.Uwp.Notifications;
using Windows.UI.Notifications;
using ZaKi.Dispatcher.Models;

namespace ZaKi.Dispatcher.Services;

public sealed class WindowsBalanceNotifications : IAsyncDisposable
{
    private readonly FirebaseRestClient _firebase;
    private readonly string _adminId;
    private readonly System.Windows.Threading.Dispatcher _dispatcher;
    private readonly TopUpNotificationTracker _tracker;
    private readonly string _group;
    private readonly CancellationTokenSource _lifetime = new();
    private Task? _loop;

    public WindowsBalanceNotifications(FirebaseRestClient firebase, string adminId, System.Windows.Threading.Dispatcher dispatcher)
    {
        _firebase = firebase; _adminId = adminId; _dispatcher = dispatcher;
        _group = Tag(adminId);
        var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ZaKi", "Dispatcher", "Notifications");
        _tracker = new TopUpNotificationTracker(Path.Combine(folder, _group + ".json"));
    }

    public string? LastError { get; private set; }
    public void Start() => _loop ??= Task.Run(() => RunAsync(_lifetime.Token));

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(15));
        try
        {
            do
            {
                try
                {
                    var requests = await _firebase.GetBalanceTopUpRequestsAsync(_adminId, cancellationToken);
                    await _tracker.ProcessAsync(requests,
                        request => _dispatcher.InvokeAsync(() => Show(request), DispatcherPriority.Background, cancellationToken).Task,
                        id => ToastNotificationManagerCompat.History.Remove(Tag(id), _group), cancellationToken);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
                catch (Exception exception) { LastError = exception.Message; }
            } while (await timer.WaitForNextTickAsync(cancellationToken));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
    }

    private bool Show(BalanceTopUpRequest request)
    {
        if (_lifetime.IsCancellationRequested) return false;
        return ShowToast("Заявка на пополнение баланса",
            $"{request.CourierName} просит пополнить баланс на {request.Amount.ToString("0.##", CultureInfo.GetCultureInfo("ru-RU"))} сомони",
            request.Id);
    }

    public bool ShowTest() => ShowToast("Уведомления ZaKi",
        "Уведомления Windows работают. Новые заявки будут появляться и при закрытом окне панели.", "");

    private bool ShowToast(string title, string body, string requestId)
    {
        var notifier = ToastNotificationManagerCompat.CreateToastNotifier();
        if (notifier.Setting != NotificationSetting.Enabled)
        {
            LastError = "Уведомления ZaKi отключены в настройках Windows.";
            return false;
        }
        new ToastContentBuilder()
            .AddArgument("adminId", _adminId)
            .AddArgument("requestId", requestId)
            .AddText(title)
            .AddText(body)
            .AddButton(new ToastButton().SetContent("Открыть заявку").AddArgument("action", "review"))
            .Show(toast => { toast.Tag = string.IsNullOrEmpty(requestId) ? "test" : Tag(requestId); toast.Group = _group; });
        LastError = null;
        return true;
    }

    public void ClearHistory() => ToastNotificationManagerCompat.History.RemoveGroup(_group);
    private static string Tag(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)))[..16];

    public async ValueTask DisposeAsync()
    {
        _lifetime.Cancel();
        if (_loop is not null) await _loop.ConfigureAwait(false);
        _lifetime.Dispose();
    }
}
