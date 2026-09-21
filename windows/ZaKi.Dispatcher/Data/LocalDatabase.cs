using Microsoft.Data.Sqlite;
using System.IO;
using ZaKi.Dispatcher.Models;

namespace ZaKi.Dispatcher.Data;

public sealed class LocalDatabase
{
    private readonly string _connectionString;

    public string DatabasePath { get; }

    public LocalDatabase()
    {
        var directory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "ZaKi",
            "Dispatcher");
        Directory.CreateDirectory(directory);
        DatabasePath = Path.Combine(directory, "zaki-dispatcher.db");
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = DatabasePath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared
        }.ToString();
    }

    public async Task InitializeAsync()
    {
        await using var connection = await OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = """
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 5000;

            CREATE TABLE IF NOT EXISTS deliveries (
                id TEXT PRIMARY KEY,
                courier_id TEXT NOT NULL DEFAULT '',
                courier_name TEXT NOT NULL DEFAULT '',
                courier_phone TEXT NOT NULL DEFAULT '',
                client_phone TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'PENDING',
                delivery_type TEXT NOT NULL DEFAULT 'default',
                order_kind TEXT NOT NULL DEFAULT '',
                admin_order_stage TEXT NOT NULL DEFAULT '',
                comment TEXT NOT NULL DEFAULT '',
                pickup_address TEXT NOT NULL DEFAULT '',
                destination_address TEXT NOT NULL DEFAULT '',
                distance_meters REAL NOT NULL DEFAULT 0,
                cost REAL NOT NULL DEFAULT 0,
                commission REAL NOT NULL DEFAULT 0,
                waiting_minutes REAL NOT NULL DEFAULT 0,
                start_time INTEGER NULL,
                end_time INTEGER NULL,
                created_at INTEGER NOT NULL DEFAULT 0,
                server_updated_at INTEGER NOT NULL DEFAULT 0,
                has_pending_changes INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS ix_deliveries_created_at
                ON deliveries(created_at DESC);
            CREATE INDEX IF NOT EXISTS ix_deliveries_status
                ON deliveries(status);

            CREATE TABLE IF NOT EXISTS sync_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                delivery_id TEXT NOT NULL,
                function_name TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT NULL
            );
            """;
        await command.ExecuteNonQueryAsync();
    }

    public async Task<IReadOnlyList<Delivery>> GetDeliveriesAsync(int limit = 5000)
    {
        var result = new List<Delivery>();
        await using var connection = await OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, courier_id, courier_name, courier_phone, client_phone,
                   status, delivery_type, order_kind, admin_order_stage, comment,
                   pickup_address, destination_address, distance_meters, cost,
                   commission, waiting_minutes, start_time, end_time, created_at,
                   server_updated_at, has_pending_changes
              FROM deliveries
             ORDER BY created_at DESC
             LIMIT $limit;
            """;
        command.Parameters.AddWithValue("$limit", limit);

        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            result.Add(new Delivery
            {
                Id = reader.GetString(0),
                CourierId = reader.GetString(1),
                CourierName = reader.GetString(2),
                CourierPhone = reader.GetString(3),
                ClientPhone = reader.GetString(4),
                Status = reader.GetString(5),
                DeliveryType = reader.GetString(6),
                OrderKind = reader.GetString(7),
                AdminOrderStage = reader.GetString(8),
                Comment = reader.GetString(9),
                PickupAddress = reader.GetString(10),
                DestinationAddress = reader.GetString(11),
                DistanceMeters = reader.GetDouble(12),
                Cost = reader.GetDouble(13),
                Commission = reader.GetDouble(14),
                WaitingMinutes = reader.GetDouble(15),
                StartTime = reader.IsDBNull(16) ? null : reader.GetInt64(16),
                EndTime = reader.IsDBNull(17) ? null : reader.GetInt64(17),
                CreatedAt = reader.GetInt64(18),
                ServerUpdatedAt = reader.GetInt64(19),
                HasPendingChanges = reader.GetBoolean(20)
            });
        }
        return result;
    }

    public async Task UpsertDeliveriesAsync(IEnumerable<Delivery> deliveries)
    {
        await using var connection = await OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();

        foreach (var delivery in deliveries)
        {
            var command = connection.CreateCommand();
            command.Transaction = (SqliteTransaction)transaction;
            command.CommandText = """
                INSERT INTO deliveries (
                    id, courier_id, courier_name, courier_phone, client_phone,
                    status, delivery_type, order_kind, admin_order_stage, comment,
                    pickup_address, destination_address, distance_meters, cost,
                    commission, waiting_minutes, start_time, end_time, created_at,
                    server_updated_at, has_pending_changes)
                VALUES (
                    $id, $courier_id, $courier_name, $courier_phone, $client_phone,
                    $status, $delivery_type, $order_kind, $admin_order_stage, $comment,
                    $pickup_address, $destination_address, $distance_meters, $cost,
                    $commission, $waiting_minutes, $start_time, $end_time, $created_at,
                    $server_updated_at, 0)
                ON CONFLICT(id) DO UPDATE SET
                    courier_id = excluded.courier_id,
                    courier_name = excluded.courier_name,
                    courier_phone = excluded.courier_phone,
                    client_phone = excluded.client_phone,
                    status = CASE WHEN deliveries.has_pending_changes = 1 THEN deliveries.status ELSE excluded.status END,
                    delivery_type = excluded.delivery_type,
                    order_kind = excluded.order_kind,
                    admin_order_stage = CASE WHEN deliveries.has_pending_changes = 1 THEN deliveries.admin_order_stage ELSE excluded.admin_order_stage END,
                    comment = excluded.comment,
                    pickup_address = excluded.pickup_address,
                    destination_address = excluded.destination_address,
                    distance_meters = excluded.distance_meters,
                    cost = excluded.cost,
                    commission = excluded.commission,
                    waiting_minutes = excluded.waiting_minutes,
                    start_time = excluded.start_time,
                    end_time = excluded.end_time,
                    created_at = excluded.created_at,
                    server_updated_at = excluded.server_updated_at;
                """;
            AddDeliveryParameters(command, delivery);
            await command.ExecuteNonQueryAsync();
        }

        await transaction.CommitAsync();
    }

    public async Task QueueStatusChangeAsync(string adminId, Delivery delivery, string status)
    {
        await using var connection = await OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();

        var update = connection.CreateCommand();
        update.Transaction = (SqliteTransaction)transaction;
        update.CommandText = """
            UPDATE deliveries
               SET status = $status, has_pending_changes = 1
             WHERE id = $id;
            """;
        update.Parameters.AddWithValue("$status", status);
        update.Parameters.AddWithValue("$id", delivery.Id);
        await update.ExecuteNonQueryAsync();

        var payload = System.Text.Json.JsonSerializer.Serialize(new
        {
            adminId,
            deliveryId = delivery.Id,
            status
        });
        var queue = connection.CreateCommand();
        queue.Transaction = (SqliteTransaction)transaction;
        queue.CommandText = """
            INSERT INTO sync_queue(delivery_id, function_name, payload_json, created_at)
            VALUES ($delivery_id, 'adminSetDeliveryStatus', $payload, $created_at);
            """;
        queue.Parameters.AddWithValue("$delivery_id", delivery.Id);
        queue.Parameters.AddWithValue("$payload", payload);
        queue.Parameters.AddWithValue("$created_at", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        await queue.ExecuteNonQueryAsync();

        await transaction.CommitAsync();
        delivery.Status = status;
        delivery.HasPendingChanges = true;
    }

    public async Task<IReadOnlyList<SyncOperation>> GetPendingOperationsAsync()
    {
        var result = new List<SyncOperation>();
        await using var connection = await OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, delivery_id, function_name, payload_json, attempts
              FROM sync_queue
             ORDER BY id
             LIMIT 100;
            """;
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            result.Add(new SyncOperation
            {
                Id = reader.GetInt64(0),
                DeliveryId = reader.GetString(1),
                FunctionName = reader.GetString(2),
                PayloadJson = reader.GetString(3),
                Attempts = reader.GetInt32(4)
            });
        }
        return result;
    }

    public async Task CompleteOperationAsync(SyncOperation operation)
    {
        await using var connection = await OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();

        var delete = connection.CreateCommand();
        delete.Transaction = (SqliteTransaction)transaction;
        delete.CommandText = "DELETE FROM sync_queue WHERE id = $id;";
        delete.Parameters.AddWithValue("$id", operation.Id);
        await delete.ExecuteNonQueryAsync();

        var remaining = connection.CreateCommand();
        remaining.Transaction = (SqliteTransaction)transaction;
        remaining.CommandText = "SELECT COUNT(*) FROM sync_queue WHERE delivery_id = $delivery_id;";
        remaining.Parameters.AddWithValue("$delivery_id", operation.DeliveryId);
        var count = Convert.ToInt32(await remaining.ExecuteScalarAsync());
        if (count == 0)
        {
            var clear = connection.CreateCommand();
            clear.Transaction = (SqliteTransaction)transaction;
            clear.CommandText = "UPDATE deliveries SET has_pending_changes = 0 WHERE id = $delivery_id;";
            clear.Parameters.AddWithValue("$delivery_id", operation.DeliveryId);
            await clear.ExecuteNonQueryAsync();
        }

        await transaction.CommitAsync();
    }

    public async Task FailOperationAsync(SyncOperation operation, string error)
    {
        await using var connection = await OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE sync_queue
               SET attempts = attempts + 1, last_error = $error
             WHERE id = $id;
            """;
        command.Parameters.AddWithValue("$error", error.Length > 1000 ? error[..1000] : error);
        command.Parameters.AddWithValue("$id", operation.Id);
        await command.ExecuteNonQueryAsync();
    }

    public async Task<int> GetPendingCountAsync()
    {
        await using var connection = await OpenAsync();
        var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM sync_queue;";
        return Convert.ToInt32(await command.ExecuteScalarAsync());
    }

    private async Task<SqliteConnection> OpenAsync()
    {
        var connection = new SqliteConnection(_connectionString);
        await connection.OpenAsync();
        return connection;
    }

    private static void AddDeliveryParameters(SqliteCommand command, Delivery delivery)
    {
        command.Parameters.AddWithValue("$id", delivery.Id);
        command.Parameters.AddWithValue("$courier_id", delivery.CourierId);
        command.Parameters.AddWithValue("$courier_name", delivery.CourierName);
        command.Parameters.AddWithValue("$courier_phone", delivery.CourierPhone);
        command.Parameters.AddWithValue("$client_phone", delivery.ClientPhone);
        command.Parameters.AddWithValue("$status", delivery.Status);
        command.Parameters.AddWithValue("$delivery_type", delivery.DeliveryType);
        command.Parameters.AddWithValue("$order_kind", delivery.OrderKind);
        command.Parameters.AddWithValue("$admin_order_stage", delivery.AdminOrderStage);
        command.Parameters.AddWithValue("$comment", delivery.Comment);
        command.Parameters.AddWithValue("$pickup_address", delivery.PickupAddress);
        command.Parameters.AddWithValue("$destination_address", delivery.DestinationAddress);
        command.Parameters.AddWithValue("$distance_meters", delivery.DistanceMeters);
        command.Parameters.AddWithValue("$cost", delivery.Cost);
        command.Parameters.AddWithValue("$commission", delivery.Commission);
        command.Parameters.AddWithValue("$waiting_minutes", delivery.WaitingMinutes);
        command.Parameters.AddWithValue("$start_time", (object?)delivery.StartTime ?? DBNull.Value);
        command.Parameters.AddWithValue("$end_time", (object?)delivery.EndTime ?? DBNull.Value);
        command.Parameters.AddWithValue("$created_at", delivery.CreatedAt);
        command.Parameters.AddWithValue("$server_updated_at", delivery.ServerUpdatedAt);
    }
}
