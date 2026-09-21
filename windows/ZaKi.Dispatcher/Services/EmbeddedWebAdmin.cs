using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;

namespace ZaKi.Dispatcher.Services;

public static class EmbeddedWebAdmin
{
    private const string ResourceName = "ZaKi.WebAdmin.zip";
    private static readonly SemaphoreSlim ExtractionGate = new(1, 1);
    private static string? _cachedPath;

    public static async Task<string> EnsureExtractedAsync()
    {
        if (HasValidIndex(_cachedPath)) return _cachedPath!;

        await ExtractionGate.WaitAsync();
        try
        {
            if (HasValidIndex(_cachedPath)) return _cachedPath!;

            await using var resource = Assembly.GetExecutingAssembly()
                .GetManifestResourceStream(ResourceName)
                ?? throw new InvalidOperationException("Встроенная веб-панель отсутствует в приложении.");

            using var sha256 = SHA256.Create();
            var hash = Convert.ToHexString(await sha256.ComputeHashAsync(resource))
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
        finally
        {
            ExtractionGate.Release();
        }
    }

    private static bool HasValidIndex(string? folder) =>
        !string.IsNullOrWhiteSpace(folder) && File.Exists(Path.Combine(folder, "index.html"));
}
