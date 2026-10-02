using System.IO;
using System.IO.Pipes;
using System.Security.Principal;

namespace ZaKi.Dispatcher.Services;

public sealed class SingleInstance : IDisposable
{
    private readonly string _name = "ZaKi.Admin.Windows." + WindowsIdentity.GetCurrent().User!.Value;
    private readonly Mutex _mutex;
    private readonly CancellationTokenSource _lifetime = new();
    public bool IsOwner { get; }

    public SingleInstance()
    {
        _mutex = new Mutex(false, "Local\\" + _name);
        try { IsOwner = _mutex.WaitOne(0); }
        catch (AbandonedMutexException) { IsOwner = true; }
    }

    public async Task ShowExistingAsync()
    {
        using var pipe = new NamedPipeClientStream(".", _name, PipeDirection.Out, PipeOptions.Asynchronous);
        await pipe.ConnectAsync(3000);
        using var writer = new StreamWriter(pipe) { AutoFlush = true };
        await writer.WriteLineAsync("show");
    }

    public void Listen(Action show) => _ = Task.Run(() => ListenAsync(show, _lifetime.Token));
    private async Task ListenAsync(Action show, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                using var pipe = new NamedPipeServerStream(_name, PipeDirection.In, 1,
                    PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(cancellationToken);
                using var reader = new StreamReader(pipe);
                if (await reader.ReadLineAsync(cancellationToken) == "show") show();
            }
            catch (OperationCanceledException) { break; }
            catch (IOException) { }
        }
    }

    public void Dispose()
    {
        _lifetime.Cancel();
        if (IsOwner) _mutex.ReleaseMutex();
        _mutex.Dispose();
    }
}
