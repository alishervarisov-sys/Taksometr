namespace ZaKi.Dispatcher.Models;

public sealed class SyncOperation
{
    public long Id { get; init; }
    public string DeliveryId { get; init; } = "";
    public string FunctionName { get; init; } = "";
    public string PayloadJson { get; init; } = "{}";
    public int Attempts { get; init; }
}
