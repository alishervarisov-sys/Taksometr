using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ZaKi.Dispatcher.Models;

namespace ZaKi.Dispatcher.Services;

public sealed class FirebaseRestClient
{
    private const string ProjectId = "auva-70253";
    private const string ApiKey = "AIzaSyC" + "PRo5_sfkPMOIDdAP1MWFCSLbCO7HqHA0";
    private const string Region = "us-central1";
    private static readonly Uri FirestoreBase = new(
        $"https://firestore.googleapis.com/v1/projects/{ProjectId}/databases/(default)/documents/");

    private readonly HttpClient _http = new()
    {
        Timeout = TimeSpan.FromSeconds(25)
    };

    public async Task<AdminSession?> LoginAsync(string login, string password, CancellationToken cancellationToken)
    {
        var passwordHash = Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(password))).ToLowerInvariant();

        var request = new
        {
            structuredQuery = new
            {
                from = new[] { new { collectionId = "users" } },
                where = new
                {
                    compositeFilter = new
                    {
                        op = "AND",
                        filters = new object[]
                        {
                            FieldEquals("login", login),
                            FieldEquals("passwordHash", passwordHash),
                            FieldEquals("role", "ADMIN")
                        }
                    }
                },
                limit = 1
            }
        };

        var endpoint = new Uri(
            $"https://firestore.googleapis.com/v1/projects/{ProjectId}/databases/(default)/documents:runQuery?key={ApiKey}");
        using var response = await _http.PostAsJsonAsync(endpoint, request, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
        using var json = await JsonDocument.ParseAsync(
            await response.Content.ReadAsStreamAsync(cancellationToken),
            cancellationToken: cancellationToken);

        foreach (var row in json.RootElement.EnumerateArray())
        {
            if (!row.TryGetProperty("document", out var document)) continue;
            var id = DocumentId(document.GetProperty("name").GetString());
            var fields = document.GetProperty("fields");
            var name = GetString(fields, "name");
            var role = login.Equals("alishervarisov@gmail.com", StringComparison.OrdinalIgnoreCase)
                ? "SUPER_ADMIN"
                : "ADMIN";
            return new AdminSession(id, string.IsNullOrWhiteSpace(name) ? login : name, role, login);
        }
        return null;
    }

    public async Task<IReadOnlyList<Delivery>> GetLatestDeliveriesAsync(
        int limit,
        CancellationToken cancellationToken)
    {
        var results = new List<Delivery>();
        string? pageToken = null;

        while (results.Count < limit)
        {
            var pageSize = Math.Min(200, limit - results.Count);
            var query = $"?pageSize={pageSize}&orderBy={Uri.EscapeDataString("createdAt desc")}&key={ApiKey}";
            if (!string.IsNullOrWhiteSpace(pageToken))
                query += $"&pageToken={Uri.EscapeDataString(pageToken)}";

            using var response = await _http.GetAsync(new Uri(FirestoreBase, "deliveries" + query), cancellationToken);
            await EnsureSuccessAsync(response, cancellationToken);
            using var json = await JsonDocument.ParseAsync(
                await response.Content.ReadAsStreamAsync(cancellationToken),
                cancellationToken: cancellationToken);

            if (json.RootElement.TryGetProperty("documents", out var documents))
            {
                foreach (var document in documents.EnumerateArray())
                    results.Add(ParseDelivery(document));
            }

            pageToken = json.RootElement.TryGetProperty("nextPageToken", out var token)
                ? token.GetString()
                : null;
            if (string.IsNullOrWhiteSpace(pageToken)) break;
        }

        return results;
    }

    public async Task CallFunctionAsync(
        string functionName,
        string payloadJson,
        CancellationToken cancellationToken)
    {
        await CallFunctionForResultAsync(functionName, payloadJson, cancellationToken);
    }

    public async Task<IReadOnlyList<BalanceTopUpRequest>> GetBalanceTopUpRequestsAsync(
        string adminId, CancellationToken cancellationToken)
    {
        var result = await CallFunctionForResultAsync("getBalanceTopUpRequests",
            JsonSerializer.Serialize(new { adminId }), cancellationToken);
        return JsonSerializer.Deserialize<List<BalanceTopUpRequest>>(
            result.GetProperty("requests"), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? [];
    }

    private async Task<JsonElement> CallFunctionForResultAsync(
        string functionName, string payloadJson, CancellationToken cancellationToken)
    {
        var endpoint = new Uri($"https://{Region}-{ProjectId}.cloudfunctions.net/{functionName}");
        using var payload = JsonDocument.Parse(payloadJson);
        using var response = await _http.PostAsJsonAsync(
            endpoint,
            new { data = payload.RootElement.Clone() },
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);

        using var json = await JsonDocument.ParseAsync(
            await response.Content.ReadAsStreamAsync(cancellationToken),
            cancellationToken: cancellationToken);
        if (json.RootElement.TryGetProperty("error", out var error))
        {
            var message = error.TryGetProperty("message", out var value)
                ? value.GetString()
                : "Cloud Function вернула ошибку";
            throw new InvalidOperationException(message);
        }
        return json.RootElement.TryGetProperty("result", out var result) ? result.Clone() : default;
    }

    public async Task<bool> CheckConnectionAsync(CancellationToken cancellationToken)
    {
        try
        {
            using var response = await _http.GetAsync(
                new Uri(FirestoreBase, $"tariffs/default?key={ApiKey}"),
                cancellationToken);
            return response.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    private static object FieldEquals(string field, string value) => new
    {
        fieldFilter = new
        {
            field = new { fieldPath = field },
            op = "EQUAL",
            value = new { stringValue = value }
        }
    };

    private static Delivery ParseDelivery(JsonElement document)
    {
        var fields = document.GetProperty("fields");
        var createdAt = GetLong(fields, "createdAt");
        return new Delivery
        {
            Id = DocumentId(document.GetProperty("name").GetString()),
            CourierId = GetString(fields, "courierId"),
            CourierName = GetString(fields, "courierName"),
            CourierPhone = GetString(fields, "courierPhone"),
            ClientPhone = GetString(fields, "clientPhone"),
            Status = GetString(fields, "status", "PENDING"),
            DeliveryType = GetString(fields, "deliveryType", "default"),
            OrderKind = GetString(fields, "orderKind"),
            AdminOrderStage = GetString(fields, "adminOrderStage"),
            Comment = GetString(fields, "comment"),
            PickupAddress = GetNestedString(fields, "pickup", "address"),
            DestinationAddress = GetNestedString(fields, "destination", "address"),
            DistanceMeters = GetDouble(fields, "distanceMeters"),
            Cost = GetDouble(fields, "cost"),
            Commission = GetDouble(fields, "commission"),
            WaitingMinutes = GetDouble(fields, "waitingMinutes"),
            StartTime = GetNullableLong(fields, "startTime"),
            EndTime = GetNullableLong(fields, "endTime"),
            CreatedAt = createdAt,
            ServerUpdatedAt = GetLong(fields, "statusChangedAt", createdAt)
        };
    }

    private static string DocumentId(string? name) =>
        string.IsNullOrWhiteSpace(name) ? "" : name[(name.LastIndexOf('/') + 1)..];

    private static string GetString(JsonElement fields, string name, string fallback = "")
    {
        if (!fields.TryGetProperty(name, out var field)) return fallback;
        return field.TryGetProperty("stringValue", out var value) ? value.GetString() ?? fallback : fallback;
    }

    private static string GetNestedString(JsonElement fields, string mapName, string fieldName)
    {
        if (!fields.TryGetProperty(mapName, out var map) ||
            !map.TryGetProperty("mapValue", out var mapValue) ||
            !mapValue.TryGetProperty("fields", out var nested)) return "";
        return GetString(nested, fieldName);
    }

    private static long GetLong(JsonElement fields, string name, long fallback = 0) =>
        GetNullableLong(fields, name) ?? fallback;

    private static long? GetNullableLong(JsonElement fields, string name)
    {
        if (!fields.TryGetProperty(name, out var field) || field.TryGetProperty("nullValue", out _)) return null;
        if (field.TryGetProperty("integerValue", out var integer) &&
            long.TryParse(integer.GetString(), out var longValue)) return longValue;
        if (field.TryGetProperty("doubleValue", out var number)) return Convert.ToInt64(number.GetDouble());
        return null;
    }

    private static double GetDouble(JsonElement fields, string name)
    {
        if (!fields.TryGetProperty(name, out var field)) return 0;
        if (field.TryGetProperty("doubleValue", out var number)) return number.GetDouble();
        if (field.TryGetProperty("integerValue", out var integer) &&
            double.TryParse(integer.GetString(), out var result)) return result;
        return 0;
    }

    private static async Task EnsureSuccessAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode) return;
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        throw new HttpRequestException(
            $"Firebase вернул {(int)response.StatusCode}: {body}",
            null,
            response.StatusCode);
    }
}
