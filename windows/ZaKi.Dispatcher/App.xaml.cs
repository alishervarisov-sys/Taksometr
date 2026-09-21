using System.IO;
using System.Windows;
using ZaKi.Dispatcher.Data;
using ZaKi.Dispatcher.Services;

namespace ZaKi.Dispatcher;

public partial class App : Application
{
    private SyncService? _sync;

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

            var database = new LocalDatabase();
            await database.InitializeAsync();

            var firebase = new FirebaseRestClient();
            var login = new LoginWindow(firebase);
            if (login.ShowDialog() != true || login.Session is null)
            {
                Shutdown();
                return;
            }

            _sync = new SyncService(database, firebase, login.Session.AdminId);
            _sync.Start();
            var main = new FullAdminWindow(database, _sync, login.Session);
            MainWindow = main;
            main.Show();
        }
        catch (Exception exception)
        {
            MessageBox.Show(
                $"Не удалось запустить ZaKi Dispatcher.\n\n{exception.Message}",
                "Ошибка запуска",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        if (_sync is not null)
        {
            try { _sync.DisposeAsync().AsTask().GetAwaiter().GetResult(); }
            catch { /* Application is already closing. */ }
        }
        base.OnExit(e);
    }
}
