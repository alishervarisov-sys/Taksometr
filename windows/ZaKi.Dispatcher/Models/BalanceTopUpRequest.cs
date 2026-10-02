namespace ZaKi.Dispatcher.Models;

public sealed record BalanceTopUpRequest(string Id, string CourierName, decimal Amount);
