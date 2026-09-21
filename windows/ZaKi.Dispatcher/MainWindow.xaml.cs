using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using ZaKi.Dispatcher.Data;
using ZaKi.Dispatcher.Models;
using ZaKi.Dispatcher.Services;

namespace ZaKi.Dispatcher;

public partial class MainWindow : Window
{
    private readonly LocalDatabase _database;
    private readonly SyncService _sync;
    private readonly ObservableCollection<Delivery> _deliveries = [];
    private readonly ICollectionView _view;

    public MainWindow(LocalDatabase database, SyncService sync, AdminSession session)
    {
        InitializeComponent();
        _database = database;
        _sync = sync;
        AdminNameText.Text = session.DisplayName;

        DeliveriesGrid.ItemsSource = _deliveries;
        _view = CollectionViewSource.GetDefaultView(_deliveries);
        _view.Filter = FilterDelivery;

        _sync.StateChanged += Sync_StateChanged;
        _sync.DataChanged += Sync_DataChanged;
        Loaded += MainWindow_Loaded;
        Closing += MainWindow_Closing;
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        await ReloadLocalAsync();
        _sync.Start();
    }

    private void MainWindow_Closing(object? sender, CancelEventArgs e)
    {
        _sync.StateChanged -= Sync_StateChanged;
        _sync.DataChanged -= Sync_DataChanged;
    }

    private async void SyncButton_Click(object sender, RoutedEventArgs e)
    {
        SyncButton.IsEnabled = false;
        SyncButton.Content = "Синхронизация…";
        await _sync.SyncNowAsync(full: true);
        await ReloadLocalAsync();
        SyncButton.Content = "⟳  Синхронизировать";
        SyncButton.IsEnabled = true;
    }

    private void SearchBox_TextChanged(object sender, TextChangedEventArgs e) => _view.Refresh();
    private void StatusFilter_SelectionChanged(object sender, SelectionChangedEventArgs e) => _view?.Refresh();

    private bool FilterDelivery(object item)
    {
        if (item is not Delivery delivery) return false;
        var search = SearchBox.Text.Trim();
        if (!string.IsNullOrWhiteSpace(search) &&
            !delivery.Id.Contains(search, StringComparison.OrdinalIgnoreCase) &&
            !delivery.ClientPhone.Contains(search, StringComparison.OrdinalIgnoreCase) &&
            !delivery.CourierName.Contains(search, StringComparison.OrdinalIgnoreCase)) return false;

        var status = (StatusFilter.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "ALL";
        return status == "ALL" || delivery.Status == status;
    }

    private async void CompleteButton_Click(object sender, RoutedEventArgs e) =>
        await ChangeSelectedStatusAsync("COMPLETED", "Завершить выбранный заказ?");

    private async void CancelButton_Click(object sender, RoutedEventArgs e) =>
        await ChangeSelectedStatusAsync("CANCELLED", "Отменить выбранный заказ?");

    private async Task ChangeSelectedStatusAsync(string status, string question)
    {
        if (DeliveriesGrid.SelectedItem is not Delivery delivery)
        {
            MessageBox.Show("Сначала выберите заказ", "ZaKi Dispatcher");
            return;
        }
        if (MessageBox.Show(
                $"{question}\n\nКлиент: {delivery.ClientPhone}\nКурьер: {delivery.CourierName}",
                "Подтверждение",
                MessageBoxButton.YesNo,
                MessageBoxImage.Question) != MessageBoxResult.Yes) return;

        await _sync.QueueStatusChangeAsync(delivery, status);
        await ReloadLocalAsync();
    }

    private void DeliveriesGrid_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (DeliveriesGrid.SelectedItem is not Delivery delivery) return;
        var details = $"""
            Заказ: {delivery.Id}
            Статус: {delivery.StatusLabel}
            Клиент: {delivery.ClientPhone}
            Курьер: {delivery.CourierName} {delivery.CourierPhone}

            Откуда: {ValueOrDash(delivery.PickupAddress)}
            Куда: {ValueOrDash(delivery.DestinationAddress)}
            Комментарий: {ValueOrDash(delivery.Comment)}

            Расстояние: {delivery.DistanceLabel}
            Стоимость: {delivery.CostLabel}
            Комиссия: {delivery.Commission:N2} сомони
            Ожидание: {delivery.WaitingMinutes:N0} мин
            """;
        MessageBox.Show(details, "Детали заказа", MessageBoxButton.OK, MessageBoxImage.Information);
    }

    private async void Sync_DataChanged(object? sender, EventArgs e) =>
        await Dispatcher.InvokeAsync(ReloadLocalAsync);

    private void Sync_StateChanged(object? sender, EventArgs e) =>
        Dispatcher.Invoke(UpdateSyncState);

    private async Task ReloadLocalAsync()
    {
        var selectedId = (DeliveriesGrid.SelectedItem as Delivery)?.Id;
        var items = await _database.GetDeliveriesAsync();
        _deliveries.Clear();
        foreach (var item in items) _deliveries.Add(item);
        DeliveriesGrid.SelectedItem = selectedId is null ? null : _deliveries.FirstOrDefault(x => x.Id == selectedId);

        TotalCountText.Text = _deliveries.Count.ToString("N0");
        PendingCountText.Text = _deliveries.Count(x => x.Status == "PENDING").ToString("N0");
        ActiveCountText.Text = _deliveries.Count(x => x.Status == "IN_PROGRESS").ToString("N0");
        QueueCountText.Text = (await _database.GetPendingCountAsync()).ToString("N0");
        _view.Refresh();
        UpdateSyncState();
    }

    private void UpdateSyncState()
    {
        if (_sync.IsOnline)
        {
            ConnectionText.Text = "● Онлайн";
            ConnectionText.Foreground = new SolidColorBrush(Color.FromRgb(25, 97, 39));
            ConnectionBadge.Background = new SolidColorBrush(Color.FromRgb(231, 244, 234));
        }
        else
        {
            ConnectionText.Text = "● Офлайн";
            ConnectionText.Foreground = new SolidColorBrush(Color.FromRgb(166, 50, 43));
            ConnectionBadge.Background = new SolidColorBrush(Color.FromRgb(252, 227, 225));
        }

        FooterText.Text = _sync.LastSuccessfulSync is null
            ? $"Локальная база: {_database.DatabasePath}"
            : $"Последняя синхронизация: {_sync.LastSuccessfulSync:dd.MM.yyyy HH:mm:ss}";
        if (!string.IsNullOrWhiteSpace(_sync.LastError)) FooterText.Text += $"  •  {_sync.LastError}";
    }

    private static string ValueOrDash(string value) => string.IsNullOrWhiteSpace(value) ? "—" : value;
}
