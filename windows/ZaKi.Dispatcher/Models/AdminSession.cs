namespace ZaKi.Dispatcher.Models;

public sealed record AdminSession(string AdminId, string DisplayName, string Role, string Login = "");
