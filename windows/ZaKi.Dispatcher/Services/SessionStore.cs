using System.Security.Cryptography;
using System.IO;
using System.Text.Json;
using ZaKi.Dispatcher.Models;

namespace ZaKi.Dispatcher.Services;

/// <summary>
/// Keeps the selected administrator on this Windows account without saving a password.
/// The session file is encrypted by Windows DPAPI and cannot be read by another account.
/// </summary>
public sealed class SessionStore
{
    private const string FileName = "session.dat";
    private readonly string _sessionPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "ZaKi", "Dispatcher", FileName);

    public AdminSession? Load()
    {
        try
        {
            if (!File.Exists(_sessionPath)) return null;

            var protectedBytes = File.ReadAllBytes(_sessionPath);
            var json = ProtectedData.Unprotect(protectedBytes, optionalEntropy: null, DataProtectionScope.CurrentUser);
            var session = JsonSerializer.Deserialize<AdminSession>(json);
            return IsValid(session) ? session : null;
        }
        catch (CryptographicException)
        {
            Clear();
            return null;
        }
        catch (JsonException)
        {
            Clear();
            return null;
        }
    }

    public void Save(AdminSession session)
    {
        if (!IsValid(session)) throw new ArgumentException("Невозможно сохранить неполную сессию.", nameof(session));

        Directory.CreateDirectory(Path.GetDirectoryName(_sessionPath)!);
        var json = JsonSerializer.SerializeToUtf8Bytes(session);
        var protectedBytes = ProtectedData.Protect(json, optionalEntropy: null, DataProtectionScope.CurrentUser);
        File.WriteAllBytes(_sessionPath, protectedBytes);
    }

    public void Clear()
    {
        if (File.Exists(_sessionPath)) File.Delete(_sessionPath);
    }

    private static bool IsValid(AdminSession? session) =>
        session is not null &&
        !string.IsNullOrWhiteSpace(session.AdminId) &&
        !string.IsNullOrWhiteSpace(session.Role);
}
