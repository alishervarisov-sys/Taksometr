using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace ZaKi.Dispatcher.Models;

public sealed class Delivery : INotifyPropertyChanged
{
    private string _status = "PENDING";

    public string Id { get; init; } = "";
    public string CourierId { get; set; } = "";
    public string CourierName { get; set; } = "";
    public string CourierPhone { get; set; } = "";
    public string ClientPhone { get; set; } = "";
    public string Status
    {
        get => _status;
        set
        {
            if (_status == value) return;
            _status = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(StatusLabel));
        }
    }
    public string DeliveryType { get; set; } = "default";
    public string OrderKind { get; set; } = "";
    public string AdminOrderStage { get; set; } = "";
    public string Comment { get; set; } = "";
    public string PickupAddress { get; set; } = "";
    public string DestinationAddress { get; set; } = "";
    public double DistanceMeters { get; set; }
    public double Cost { get; set; }
    public double Commission { get; set; }
    public double WaitingMinutes { get; set; }
    public long? StartTime { get; set; }
    public long? EndTime { get; set; }
    public long CreatedAt { get; set; }
    public long ServerUpdatedAt { get; set; }
    public bool HasPendingChanges { get; set; }

    public string StatusLabel => Status switch
    {
        "PENDING" => "Ожидает курьера",
        "IN_PROGRESS" => "В процессе",
        "COMPLETED" => "Завершён",
        "CANCELLED" => "Отменён",
        _ => Status
    };

    public string CreatedAtLabel => CreatedAt <= 0
        ? "—"
        : DateTimeOffset.FromUnixTimeMilliseconds(CreatedAt).LocalDateTime.ToString("dd.MM.yyyy HH:mm");

    public string CostLabel => $"{Cost:N2} сомони";
    public string DistanceLabel => DistanceMeters < 1000
        ? $"{DistanceMeters:N0} м"
        : $"{DistanceMeters / 1000:N1} км";

    public event PropertyChangedEventHandler? PropertyChanged;
    private void OnPropertyChanged([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
