using System.Windows;
using System.Windows.Input;
using ZaKi.Dispatcher.Models;
using ZaKi.Dispatcher.Services;

namespace ZaKi.Dispatcher;

public partial class LoginWindow : Window
{
    private readonly FirebaseRestClient _firebase;
    public AdminSession? Session { get; private set; }

    public LoginWindow(FirebaseRestClient firebase)
    {
        InitializeComponent();
        _firebase = firebase;
        Loaded += (_, _) => LoginBox.Focus();
    }

    private async void LoginButton_Click(object sender, RoutedEventArgs e) => await LoginAsync();

    private async void PasswordBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) await LoginAsync();
    }

    private async Task LoginAsync()
    {
        var login = LoginBox.Text.Trim();
        var password = PasswordBox.Password;
        if (string.IsNullOrWhiteSpace(login) || string.IsNullOrWhiteSpace(password))
        {
            ShowError("Введите логин и пароль");
            return;
        }

        LoginButton.IsEnabled = false;
        LoginButton.Content = "Проверка…";
        ErrorText.Visibility = Visibility.Collapsed;
        try
        {
            Session = await _firebase.LoginAsync(login, password, CancellationToken.None);
            if (Session is null)
            {
                ShowError("Неверный логин или пароль, либо нет прав администратора");
                return;
            }
            DialogResult = true;
        }
        catch (Exception exception)
        {
            ShowError("Не удалось связаться с Firebase. Проверьте интернет.\n" + exception.Message);
        }
        finally
        {
            LoginButton.IsEnabled = true;
            LoginButton.Content = "Войти";
        }
    }

    private void ShowError(string message)
    {
        ErrorText.Text = message;
        ErrorText.Visibility = Visibility.Visible;
    }
}
