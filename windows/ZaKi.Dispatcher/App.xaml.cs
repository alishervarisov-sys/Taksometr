using System.IO;
using System.Windows;
using Microsoft.Toolkit.Uwp.Notifications;
using ZaKi.Dispatcher.Data;
using ZaKi.Dispatcher.Services;

namespace ZaKi.Dispatcher;

public partial class App : Application
{
    private SyncService? _sync;
    private WindowsBalanceNotifications? _notifications;
    private SingleInstance? _instance;
    private System.Windows.Forms.NotifyIcon? _tray;
    private FullAdminWindow? _panel;
    private string? _webAdminId;
    private string? _pendingRequest;
    private string? _pendingAdmin;
    private bool _showRequested;
    public bool IsExiting { get; private set; }

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        try
        {
            if (e.Args.Any(argument =>
                    argument.Equals("--verify-package", StringComparison.OrdinalIgnoreCase)))
            {
                var webRoot = await EmbeddedWebAdmin.EnsureExtractedAsync();
                if (!File.Exists(Path.Combine(webRoot, "index.html")))
                    throw new FileNotFoundException("Встроенная веб-панель не распакована.");

                var verificationDatabase = new LocalDatabase();
                await verificationDatabase.InitializeAsync();
                Shutdown(0);
                return;
            }
            if (e.Args.Contains("--verify-notifications", StringComparer.OrdinalIgnoreCase))
            {
                var outputArgument = e.Args.First(argument => argument.StartsWith("--output=", StringComparison.Ordinal));
                var notifier = new WindowsBalanceNotifications(new FirebaseRestClient(), "__package-verification__", Dispatcher);
                try
                {
                    var shown = notifier.ShowTest();
                    var verificationGroup = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
                        System.Text.Encoding.UTF8.GetBytes("__package-verification__")))[..16];
                    var toast = ToastNotificationManagerCompat.History.GetHistory().FirstOrDefault(toast => toast.Tag == "test" && toast.Group == verificationGroup);
                    var stored = toast is not null;
                    var xml = toast?.Content.GetXml();
                    var action = xml is null ? null : System.Xml.Linq.XDocument.Parse(xml).Descendants("action").FirstOrDefault();
                    var arguments = action is null ? null : ToastArguments.Parse((string?)action.Attribute("arguments") ?? "");
                    var buttonWorks = arguments?.Contains("adminId") == true
                        && arguments["adminId"] == "__package-verification__"
                        && arguments.Contains("requestId") && arguments.Contains("action") && arguments["action"] == "review";
                    File.WriteAllText(outputArgument[9..], System.Text.Json.JsonSerializer.Serialize(new { shown, stored, buttonWorks, error = notifier.LastError }));
                    Shutdown(shown && stored && buttonWorks ? 0 : 2);
                }
                finally { notifier.ClearHistory(); }
                return;
            }

            _instance = new SingleInstance();
            var background = e.Args.Contains("--background", StringComparer.OrdinalIgnoreCase);
            if (!_instance.IsOwner)
            {
                if (!background) await _instance.ShowExistingAsync();
                Shutdown();
                return;
            }
            _instance.Listen(() => Dispatcher.BeginInvoke(() => ShowPanel()));
            SessionEnding += (_, _) => IsExiting = true;
            ToastNotificationManagerCompat.OnActivated += args => Dispatcher.BeginInvoke(() =>
            {
                var values = ToastArguments.Parse(args.Argument);
                if (!values.Contains("adminId") || IsExiting) return;
                if (_panel is not null && values["adminId"] != _webAdminId) return;
                _pendingAdmin = values["adminId"];
                _pendingRequest = values.Contains("requestId") ? values["requestId"] : "";
                if (_panel is not null) OpenRequests(_pendingRequest);
            });

            var database = new LocalDatabase();
            await database.InitializeAsync();

            // Extract the bundled panel while the user signs in, so opening the
            // full admin window does not block on disk I/O.
            _ = EmbeddedWebAdmin.EnsureExtractedAsync();

            var firebase = new FirebaseRestClient();
            var sessionStore = new SessionStore();
            var session = sessionStore.Load();
            if (session is null)
            {
                if (background) { Shutdown(); return; }
                var login = new LoginWindow(firebase);
                if (login.ShowDialog() != true || login.Session is null)
                {
                    Shutdown();
                    return;
                }

                session = login.Session;
                sessionStore.Save(session);
            }

            _sync = new SyncService(database, firebase, session.AdminId);
            _sync.Start();
            var main = new FullAdminWindow(database, _sync, session, sessionStore);
            _panel = main;
            _webAdminId = session.Role == "SUPER_ADMIN" ? "SUPER_ADMIN" : session.AdminId;
            _notifications = new WindowsBalanceNotifications(firebase, _webAdminId, Dispatcher);
            _notifications.Start();
            InitializeTray();
            MainWindow = main;
            if (_pendingRequest is not null && _pendingAdmin == _webAdminId) OpenRequests(_pendingRequest);
            else if (!background || _showRequested) main.Show();
        }
        catch (Exception exception)
        {
            if (e.Args.Any(argument => argument.StartsWith("--verify-", StringComparison.Ordinal)))
            {
                var output = e.Args.FirstOrDefault(argument => argument.StartsWith("--output=", StringComparison.Ordinal));
                if (output is not null) File.WriteAllText(output[9..], System.Text.Json.JsonSerializer.Serialize(new { error = exception.Message }));
                Shutdown(1);
                return;
            }
            MessageBox.Show(
                $"Не удалось запустить ZaKi Dispatcher.\n\n{exception.Message}",
                "Ошибка запуска",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    private void InitializeTray()
    {
        using var stream = GetResourceStream(new Uri("pack://application:,,,/Assets/zaki.ico"))!.Stream;
        using var sourceIcon = new System.Drawing.Icon(stream);
        var menu = new System.Windows.Forms.ContextMenuStrip();
        menu.Items.Add("Открыть ZaKi Admin", null, (_, _) => ShowPanel());
        menu.Items.Add("Заявки на пополнение", null, (_, _) => OpenRequests(""));
        menu.Items.Add("Проверить уведомления", null, (_, _) => TestNotifications());
        menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
        menu.Items.Add("Выход", null, (_, _) => ExitApplication());
        _tray = new System.Windows.Forms.NotifyIcon
        {
            Icon = (System.Drawing.Icon)sourceIcon.Clone(),
            Text = "ZaKi Admin 1.3.0 — уведомления о пополнении",
            Visible = true,
            ContextMenuStrip = menu
        };
        _tray.DoubleClick += (_, _) => ShowPanel();
    }

    private void ShowPanel()
    {
        if (_panel is null) { _showRequested = true; return; }
        _panel.Show();
        if (_panel.WindowState == WindowState.Minimized) _panel.WindowState = WindowState.Normal;
        _panel.Activate();
    }

    private void OpenRequests(string requestId)
    {
        if (_panel is null) return;
        ShowPanel();
        _panel.OpenTopUpRequest(requestId);
    }

    public void TestNotifications()
    {
        try
        {
            if (_notifications?.ShowTest() == true) return;
            MessageBox.Show(_notifications?.LastError ?? "Уведомления ещё не готовы.", "Уведомления ZaKi");
        }
        catch (Exception exception) { MessageBox.Show(exception.Message, "Уведомления ZaKi"); }
    }

    public void SignOut()
    {
        _webAdminId = null;
        // Stop polling before clearing the session so no queued notification can
        // reveal another administrator's request after logout.
        _notifications?.DisposeAsync().AsTask().GetAwaiter().GetResult();
        _notifications?.ClearHistory();
        _notifications = null;
        new SessionStore().Clear();
        ExitApplication();
    }

    private void ExitApplication() { IsExiting = true; Shutdown(); }

    protected override void OnExit(ExitEventArgs e)
    {
        IsExiting = true;
        _tray?.Dispose();
        if (_notifications is not null)
        {
            try { _notifications.DisposeAsync().AsTask().GetAwaiter().GetResult(); }
            catch { /* Windows is closing. */ }
        }
        if (_sync is not null)
        {
            try { _sync.DisposeAsync().AsTask().GetAwaiter().GetResult(); }
            catch { /* Application is already closing. */ }
        }
        _instance?.Dispose();
        base.OnExit(e);
    }
}
