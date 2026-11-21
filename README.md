# Prompts

A local prompt library for Chrome. Save, search and copy reusable prompts. The optional Windows helper lets you use keyboard shortcuts to paste into supported Claude and ChatGPT editors in Chrome.

## Load from source

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the [extensie](extensie/) folder. If the extension is already loaded, click **Reload** on its card.
3. Pin **Prompts** from Chrome’s **Extensions** menu for easy access.

## Enable keyboard paste on Windows

On 64-bit Windows with PowerShell 7 and .NET Framework, build the helper and register it for your Windows account.

```powershell
pwsh -File .\Build-Windows.ps1
.\Install.cmd
```

Open **Prompts** and click **Enable keyboard paste** if shown. The helper runs when Chrome calls it from the extension.

## Use

1. Open **Prompts**, click **New prompt**, and enter a title and the prompt text.
2. Click **Save**. **Copy** puts a saved prompt on the system clipboard.
3. On Windows with the helper enabled, assign a shortcut to a prompt. Focus the message field in Claude or ChatGPT and press the shortcut. You decide when to send the message.

The default Windows shortcuts are listed below. Change them under **Manage shortcuts** or at `chrome://extensions/shortcuts`.

| Slot | Default shortcut |
| --- | --- |
| 1 | `Ctrl+Shift+Y` |
| 2 | `Ctrl+Shift+U` |
| 3 | `Ctrl+Shift+K` |
| 4 | `Ctrl+Shift+L` |

If a shortcut does nothing, check that Chrome assigned the keys, the Windows helper is enabled, and the message field has focus. You can still use **Copy** and paste manually.

## Storage and removal

Prompts stay in the current Chrome profile and use Chrome’s local storage. Copying or pasting replaces the system clipboard contents. Keyboard paste requires the optional native messaging permission. See the [privacy policy](PRIVACY.md).

To remove the Windows helper, run [Uninstall.cmd](Uninstall.cmd). To remove the extension and its saved prompts, use **Remove** at `chrome://extensions`.

## Build for the Chrome Web Store

Create the extension ZIP with PowerShell 7. On 64-bit Windows, build the native helper using the item ID assigned by the Chrome Web Store.

```powershell
pwsh -File .\Build-Store.ps1
pwsh -File .\Build-Windows.ps1 -StoreExtensionId omhmjlbfpbfbkgflmajpaejfnbgdkphj
```

The ZIP and store helper are written to `dist/`. For release, sign the Windows executable and publish it as a [GitHub Release](https://github.com/CiubotaruBogdan/Prompter/releases) asset with its SHA-256 checksum. The store helper uses `--install` and `--uninstall` to manage its own registration.
