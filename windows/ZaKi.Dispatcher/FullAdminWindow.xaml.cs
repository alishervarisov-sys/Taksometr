using System.IO;
using System.ComponentModel;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using ZaKi.Dispatcher.Data;
using ZaKi.Dispatcher.Models;
using ZaKi.Dispatcher.Services;

namespace ZaKi.Dispatcher;

public partial class FullAdminWindow : Window
{
    private readonly LocalDatabase _database;
    private readonly SyncService _sync;
    private readonly AdminSession _session;
    private readonly SessionStore _sessionStore;
    private MainWindow? _nativeOrdersWindow;
    private string? _webRoot;
    private string? _routeToRestore;

    public FullAdminWindow(
        LocalDatabase database,
        SyncService sync,
        AdminSession session,
        SessionStore sessionStore)
    {
        InitializeComponent();
        _database = database;
        _sync = sync;
        _session = session;
        _sessionStore = sessionStore;
        Loaded += FullAdminWindow_Loaded;
        _sync.StateChanged += Sync_StateChanged;
        Closed += FullAdminWindow_Closed;
        Closing += (_, args) =>
        {
            if (((App)Application.Current).IsExiting) return;
            args.Cancel = true;
            Hide();
            _nativeOrdersWindow?.Hide();
        };
    }

    private async void FullAdminWindow_Loaded(object sender, RoutedEventArgs e)
    {
        try
        {
            var webRoot = await EmbeddedWebAdmin.EnsureExtractedAsync();
            _webRoot = webRoot;

            var userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "ZaKi", "Dispatcher", "WebView2");
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: userData);
            await AdminWebView.EnsureCoreWebView2Async(environment);

            AdminWebView.CoreWebView2.Settings.AreDevToolsEnabled = false;
            AdminWebView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            AdminWebView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            AdminWebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "zakitaksometr.web.app",
                webRoot,
                CoreWebView2HostResourceAccessKind.Allow);

            var webAdminId = _session.Role == "SUPER_ADMIN" ? "SUPER_ADMIN" : _session.AdminId;
            var bootstrap =
                "window.zakiDesktopNotifications = true;\n" +
                "localStorage.setItem('adminId', " + JsonSerializer.Serialize(webAdminId) + ");\n" +
                "localStorage.setItem('adminRole', " + JsonSerializer.Serialize(_session.Role) + ");\n" +
                "const zakiRestorePath = sessionStorage.getItem('zakiReloadPath');\n" +
                "if (zakiRestorePath) {\n" +
                "  sessionStorage.removeItem('zakiReloadPath');\n" +
                "  history.replaceState({}, '', zakiRestorePath);\n" +
                "}\n";
            await AdminWebView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(bootstrap);
            AdminWebView.CoreWebView2.WebMessageReceived += (_, args) =>
            {
                if (!Uri.TryCreate(args.Source, UriKind.Absolute, out var source) ||
                    source.Scheme != "https" || source.Host != "zakitaksometr.web.app") return;
                try
                {
                    using var message = JsonDocument.Parse(args.WebMessageAsJson);
                    if (message.RootElement.TryGetProperty("type", out var type) && type.GetString() == "ZAKI_LOGOUT")
                        ((App)Application.Current).SignOut();
                }
                catch (JsonException) { }
            };

            AdminWebView.NavigationStarting += AdminWebView_NavigationStarting;
            AdminWebView.NavigationCompleted += AdminWebView_NavigationCompleted;
            // Use the real Hosting origin while serving the bundled files from
            // disk. Firebase/Maps see the same origin as the web panel, but the
            // interface itself opens even when Hosting is unavailable.
            AdminWebView.Source = new Uri("https://zakitaksometr.web.app/index.html");
        }
        catch (Exception exception)
        {
            LoadingPanel.Visibility = Visibility.Collapsed;
            MessageBox.Show(
                "Не удалось запустить полную панель.\n\n" + exception.Message,
                "ZaKi Admin",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
        }
    }

    public void OpenTopUpRequest(string requestId)
    {
        _routeToRestore = string.IsNullOrWhiteSpace(requestId) ? "/commission"
            : "/commission?requestId=" + Uri.EscapeDataString(requestId);
        if (AdminWebView.CoreWebView2 is not null)
            AdminWebView.CoreWebView2.Navigate("https://zakitaksometr.web.app/index.html");
    }

    private void TestNotifications_Click(object sender, RoutedEventArgs e) => ((App)Application.Current).TestNotifications();

    private void AdminWebView_NavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (_webRoot is null || !Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri)) return;
        if (!uri.Host.Equals("zakitaksometr.web.app", StringComparison.OrdinalIgnoreCase)) return;

        var relativePath = Uri.UnescapeDataString(uri.AbsolutePath).TrimStart('/');
        if (string.IsNullOrWhiteSpace(relativePath)) relativePath = "index.html";
        var physicalPath = Path.GetFullPath(Path.Combine(
            _webRoot,
            relativePath.Replace('/', Path.DirectorySeparatorChar)));

        // A BrowserRouter route is not a physical file. Redirect it through
        // index.html and restore the route after React has loaded.
        if (physicalPath.StartsWith(_webRoot, StringComparison.OrdinalIgnoreCase) &&
            !File.Exists(physicalPath))
        {
            e.Cancel = true;
            _routeToRestore = uri.PathAndQuery + uri.Fragment;
            AdminWebView.CoreWebView2.Navigate("https://zakitaksometr.web.app/index.html");
        }
    }

    private async void AdminWebView_NavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (!e.IsSuccess)
        {
            StateText.Text = "Ошибка загрузки панели: " + e.WebErrorStatus;
            return;
        }

        if (!string.IsNullOrWhiteSpace(_routeToRestore))
        {
            var route = _routeToRestore;
            _routeToRestore = null;
            await AdminWebView.CoreWebView2.ExecuteScriptAsync(
                "history.replaceState({}, '', " + JsonSerializer.Serialize(route) + ");" +
                "window.dispatchEvent(new PopStateEvent('popstate'));"
            );
        }

        LoadingPanel.Visibility = Visibility.Collapsed;
        AdminWebView.Visibility = Visibility.Visible;
        UpdateStateText();
    }

    private async void Reload_Click(object sender, RoutedEventArgs e)
    {
        const string homeUrl = "https://zakitaksometr.web.app/index.html";
        try
        {
            if (AdminWebView.CoreWebView2 is null) return;

            // BrowserRouter stores the active screen in the URL (for example
            // /deliveries), but that path is not a physical file in the bundled
            // build. Save the route, load the real index.html, then the startup
            // script above restores the route before React starts.
            await AdminWebView.CoreWebView2.ExecuteScriptAsync("""
                (() => {
                    const path = location.pathname === '/index.html'
                        ? '/'
                        : location.pathname + location.search + location.hash;
                    sessionStorage.setItem('zakiReloadPath', path);
                    location.replace('/index.html');
                })();
                """);
        }
        catch
        {
            // Recovery path also fixes an already visible ERR_FILE_NOT_FOUND.
            AdminWebView.CoreWebView2?.Navigate(homeUrl);
        }
        // The web panel already reloads its own Firebase data. Keep the local
        // SQLite cache fresh without fetching the full 5,000-order history.
        _ = _sync.SyncNowAsync();
    }

    private void OpenNativeOrders_Click(object sender, RoutedEventArgs e)
    {
        if (_nativeOrdersWindow is { IsVisible: true })
        {
            _nativeOrdersWindow.Activate();
            return;
        }
        _nativeOrdersWindow = new MainWindow(_database, _sync, _session)
        {
            Owner = this,
            ShowInTaskbar = false
        };
        _nativeOrdersWindow.Show();
    }

    private void SwitchAccount_Click(object sender, RoutedEventArgs e)
    {
        if (MessageBox.Show(
                "При следующем запуске потребуется войти под другим пользователем.",
                "Сменить аккаунт",
                MessageBoxButton.OKCancel,
                MessageBoxImage.Question) != MessageBoxResult.OK) return;

        ((App)Application.Current).SignOut();
    }

    private void Sync_StateChanged(object? sender, EventArgs e) => Dispatcher.BeginInvoke(UpdateStateText);

    private void UpdateStateText()
    {
        StateText.Text = _sync.IsOnline
            ? $"● Онлайн • обновлено {_sync.LastSuccessfulSync:HH:mm:ss}"
            : "● Офлайн • доступны ранее загруженные данные";
    }

    private void FullAdminWindow_Closed(object? sender, EventArgs e)
    {
        _sync.StateChanged -= Sync_StateChanged;
        _nativeOrdersWindow?.Close();
    }
}
