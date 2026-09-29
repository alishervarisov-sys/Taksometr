using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;

namespace ZaKi.Dispatcher.Services;

public static class EmbeddedWebAdmin
{
    private const string ResourceName = "ZaKi.WebAdmin.zip";
    private static readonly object ExtractionLock = new();
    private static string? _cachedPath;
    private static Task<string>? _extractionTask;

    public static Task<string> EnsureExtractedAsync()
    {
        if (HasValidIndex(_cachedPath)) return Task.FromResult(_cachedPath!);

        lock (ExtractionLock)
        {
            if (HasValidIndex(_cachedPath)) return Task.FromResult(_cachedPath!);
            if (_extractionTask is null || _extractionTask.IsFaulted || _extractionTask.IsCanceled)
                _extractionTask = Task.Run(ExtractWebAdmin);

            return _extractionTask;
        }
    }

    private static string ExtractWebAdmin()
    {
        using var resource = Assembly.GetExecutingAssembly()
            .GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException("Встроенная веб-панель отсутствует в приложении.");

        using var sha256 = SHA256.Create();
        var hash = Convert.ToHexString(sha256.ComputeHash(resource))
            .ToLowerInvariant()[..16];
        resource.Position = 0;

        var targetFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ZaKi", "Dispatcher", "WebAdmin", hash);

        if (!HasValidIndex(targetFolder))
        {
            Directory.CreateDirectory(targetFolder);
            ZipFile.ExtractToDirectory(resource, targetFolder, overwriteFiles: true);
        }

        if (!HasValidIndex(targetFolder))
            throw new InvalidDataException("Не удалось подготовить встроенную веб-панель.");

        _cachedPath = targetFolder;
        return targetFolder;
    }

    private static bool HasValidIndex(string? folder) =>
        !string.IsNullOrWhiteSpace(folder) && File.Exists(Path.Combine(folder, "index.html"));
}
