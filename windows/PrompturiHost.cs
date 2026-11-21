using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class PrompturiHost
{
#if STORE_BUILD
    private const string HostName = "ro.prompturi.chrome.store";
    private const string ExtensionOrigin = "chrome-extension://" + StoreIdentity.ExtensionId + "/";
    private const string InstallFolder = "PromptsChromeStore";
#else
    private const string HostName = "ro.prompturi.chrome";
    private const string ExtensionOrigin = "chrome-extension://lldgdnnpbammankobbmmknpmbcbhbkof/";
    private const string InstallFolder = "PrompturiChrome";
#endif
    private const string RegistryPath = @"Software\Google\Chrome\NativeMessagingHosts\" + HostName;
    private const int MaxMessage = 200000;
    private const int MaxText = 30000;
    private static readonly Encoding Utf8 = new UTF8Encoding(false, true);
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer
    {
        MaxJsonLength = MaxMessage,
        RecursionLimit = 8
    };

    private static string InstallDirectory
    {
        get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), InstallFolder); }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 1 && (args[0] == "--install" || args[0] == "--uninstall"))
        {
            try
            {
                if (args[0] == "--install") Install();
                else Uninstall();
                return 0;
            }
            catch
            {
                return 1;
            }
        }
        if (args.Length == 0 || args[0] != ExtensionOrigin) return 2;

        using (var input = new BinaryReader(Console.OpenStandardInput(), Utf8))
        using (var output = new BinaryWriter(Console.OpenStandardOutput(), Utf8))
        {
            string code;
            try
            {
                var length = input.ReadInt32();
                if (length <= 0 || length > MaxMessage) return 2;
                var data = input.ReadBytes(length);
                if (data.Length != length) return 2;
                var request = Json.DeserializeObject(Utf8.GetString(data)) as Dictionary<string, object>;
                code = HandleRequest(request);
            }
            catch
            {
                code = "invalid";
            }
            var reply = Utf8.GetBytes(Json.Serialize(new { ok = code == null, code, protocol = 2 }));
            output.Write(reply.Length);
            output.Write(reply);
            output.Flush();
        }
        return 0;
    }

    private static string HandleRequest(Dictionary<string, object> request)
    {
        object action;
        if (request == null || !request.TryGetValue("action", out action)) return "invalid";
        if (Equals(action, "ping")) return null;
        object value;
        if (!Equals(action, "paste-v2") || !request.TryGetValue("text", out value)) return "invalid";
        var text = value as string;
        if (string.IsNullOrWhiteSpace(text) || text.Length > MaxText || text.IndexOf('\0') >= 0) return "invalid";
        return Paste(text);
    }

    private static void Install()
    {
        Directory.CreateDirectory(InstallDirectory);
        var source = typeof(PrompturiHost).Assembly.Location;
        var executable = Path.Combine(InstallDirectory, "PrompturiHost.exe");
        if (!string.Equals(source, executable, StringComparison.OrdinalIgnoreCase))
        {
            File.Copy(source, executable, true);
        }
        var manifest = Path.Combine(InstallDirectory, HostName + ".json");
        File.WriteAllText(manifest, Json.Serialize(new
        {
            name = HostName,
            description = "Windows paste helper for Prompts",
            path = executable,
            type = "stdio",
            allowed_origins = new[] { ExtensionOrigin }
        }), Utf8);
        using (var key = Registry.CurrentUser.CreateSubKey(RegistryPath))
        {
            key.SetValue("", manifest, RegistryValueKind.String);
        }
    }

    private static void Uninstall()
    {
        Registry.CurrentUser.DeleteSubKey(RegistryPath, false);
        File.Delete(Path.Combine(InstallDirectory, HostName + ".json"));
        File.Delete(Path.Combine(InstallDirectory, "PrompturiHost.exe"));
    }

    private static string Paste(string text)
    {
        var window = GetForegroundWindow();
        if (!IsChrome(window)) return "focus";

        // Let the Chrome shortcut release its modifiers before synthesizing Ctrl+V.
        var timeout = Stopwatch.StartNew();
        while (ModifierPressed())
        {
            if (timeout.ElapsedMilliseconds > 1200) return "busy";
            Thread.Sleep(15);
        }
        if (GetForegroundWindow() != window) return "focus";
        var editor = FocusedEditor();
        if (editor == null || GetForegroundWindow() != window) return "focus";

        uint clipboardSequence;
        try
        {
            var normalized = text.Replace("\r\n", "\n").Replace("\r", "\n").Replace("\n", "\r\n");
            var data = new DataObject(DataFormats.UnicodeText, normalized);
            using (var excludeFromHistory = new MemoryStream(new byte[] { 0 }))
            {
                data.SetData("ExcludeClipboardContentFromMonitorProcessing", false, excludeFromHistory);
                Clipboard.SetDataObject(data, true, 4, 25);
            }
            clipboardSequence = GetClipboardSequenceNumber();
        }
        catch (ExternalException)
        {
            return "clipboard";
        }

        var current = FocusedEditor();
        if (current == null || !editor.SequenceEqual(current) || GetForegroundWindow() != window) return "focus";
        if (ModifierPressed()) return "busy";
        if (GetClipboardSequenceNumber() != clipboardSequence) return "clipboard";
        var keys = new[] { Key(0xA2, false), Key(0x56, false), Key(0x56, true), Key(0xA2, true) };
        return SendInput((uint)keys.Length, keys, Marshal.SizeOf(typeof(Input))) == keys.Length ? null : "input";
    }

    private static bool IsChrome(IntPtr window)
    {
        if (window == IntPtr.Zero) return false;
        uint processId;
        GetWindowThreadProcessId(window, out processId);
        try
        {
            using (var process = Process.GetProcessById((int)processId))
            {
                return string.Equals(process.ProcessName, "chrome", StringComparison.OrdinalIgnoreCase);
            }
        }
        catch (ArgumentException)
        {
            return false;
        }
    }

    private static int[] FocusedEditor()
    {
        try
        {
            var element = AutomationElement.FocusedElement;
            if (element == null) return null;
            var properties = element.Current;
            if (properties.ControlType != ControlType.Edit || properties.IsPassword ||
                !properties.IsEnabled || !properties.HasKeyboardFocus) return null;
            object value;
            if (element.TryGetCurrentPattern(ValuePattern.Pattern, out value) &&
                ((ValuePattern)value).Current.IsReadOnly) return null;

            // Check every document ancestor, including any outer web document around a frame.
            var walker = TreeWalker.ControlViewWalker;
            var foundDocument = false;
            for (var parent = walker.GetParent(element); parent != null; parent = walker.GetParent(parent))
            {
                if (parent.Current.ControlType != ControlType.Document) continue;
                var address = parent.GetCurrentPropertyValue(ValuePatternIdentifiers.ValueProperty, true) as string;
                if (!IsAllowedDocument(address)) return null;
                foundDocument = true;
            }
            return foundDocument ? element.GetRuntimeId() : null;
        }
        catch (ElementNotAvailableException)
        {
        }
        catch (COMException)
        {
        }
        return null;
    }

    private static bool IsAllowedDocument(string address)
    {
        Uri uri;
        if (!Uri.TryCreate(address, UriKind.Absolute, out uri) || !uri.IsDefaultPort ||
            !string.IsNullOrEmpty(uri.UserInfo)) return false;
        if (uri.Scheme == Uri.UriSchemeHttps)
        {
            return uri.Host == "claude.ai" || uri.Host == "chatgpt.com";
        }
        if (uri.Scheme != "chrome-extension") return false;
        return (uri.Host == "fcoeoabgfenejglbffodgkkbkcdhcgfn" && uri.AbsolutePath == "/sidepanel.html") ||
               (uri.Host == "hehggadaopoacecdllhhajmbjkdcmajg" && uri.AbsolutePath == "/codex-work-sidepanel.html");
    }

    private static bool ModifierPressed()
    {
        return (GetAsyncKeyState(0x10) & 0x8000) != 0 ||
               (GetAsyncKeyState(0x11) & 0x8000) != 0 ||
               (GetAsyncKeyState(0x12) & 0x8000) != 0 ||
               (GetAsyncKeyState(0x5B) & 0x8000) != 0 ||
               (GetAsyncKeyState(0x5C) & 0x8000) != 0;
    }

    private static Input Key(ushort virtualKey, bool release)
    {
        return new Input { Type = 1, Data = new InputData
        {
            Keyboard = new KeyboardInput { VirtualKey = virtualKey, Flags = release ? 2u : 0u }
        } };
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Input
    {
        public uint Type;
        public InputData Data;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputData
    {
        [FieldOffset(0)] public KeyboardInput Keyboard;
        [FieldOffset(0)] public MouseInput Mouse;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput
    {
        public ushort VirtualKey, ScanCode;
        public uint Flags, Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput
    {
        public int X, Y;
        public uint MouseData, Flags, Time;
        public UIntPtr ExtraInfo;
    }

    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, Input[] inputs, int inputSize);
}
