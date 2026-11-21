const host = "ro.prompturi.chrome";
const nativePermission = { permissions: ["nativeMessaging"] };
const messages = {
  permission: "Enable keyboard paste in Prompts to use this shortcut.",
  disconnected: "Install the Prompts Windows helper to use keyboard paste.",
  outdated: "Update the Prompts Windows helper to use keyboard paste.",
  focus: "Click an editable message field in Claude or ChatGPT and try again.",
  busy: "Release the shortcut keys and try again.",
  clipboard: "The Windows clipboard is busy. Try again.",
  input: "Couldn't paste the prompt. Use Copy to paste it manually.",
  invalid: "Couldn't read the prompt."
};

async function library() {
  const { prompts = [] } = await chrome.storage.local.get("prompts");
  return prompts;
}

let lastEdit = Promise.resolve();

function editLibrary(request) {
  const edit = lastEdit.then(async () => {
    const prompts = await library();
    if (request.type === "remove") {
      await chrome.storage.local.set({ prompts: prompts.filter(prompt => prompt.id !== request.id) });
      return { ok: true };
    }

    const { id, title, text, slot } = request.prompt;
    if (typeof title !== "string" || !title.trim() || title.length > 90 ||
        typeof text !== "string" || !text.trim() || text.length > 30000 || text.includes("\0") ||
        !Number.isInteger(slot) || slot < 0 || slot > 4) {
      return { ok: false, message: "Enter a title and prompt text." };
    }
    const current = prompts.find(prompt => prompt.id === id);
    if (id && !current) return { ok: false, message: "This prompt was deleted." };
    const updated = { id: current?.id ?? crypto.randomUUID(), title: title.trim(), text, slot };
    const otherPrompts = prompts.filter(prompt => prompt.id !== updated.id).map(prompt =>
      slot > 0 && prompt.slot === slot ? { ...prompt, slot: 0 } : prompt
    );
    await chrome.storage.local.set({ prompts: [updated, ...otherPrompts] });
    return { ok: true };
  });
  lastEdit = edit.catch(() => {});
  return edit;
}

async function askHost(request) {
  try {
    if (!(await chrome.permissions.contains(nativePermission))) {
      return { ok: false, message: messages.permission };
    }
    const result = await chrome.runtime.sendNativeMessage(host, request);
    if (result?.protocol !== 2) return { ok: false, message: messages.outdated };
    return result?.ok ? { ok: true } : { ok: false, message: messages[result?.code] ?? messages.invalid };
  } catch {
    return { ok: false, message: messages.disconnected };
  }
}

async function setResult(message = "") {
  await chrome.storage.session.set({ pasteError: message });
  await chrome.action.setBadgeText({ text: message ? "!" : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#000000" });
  await chrome.action.setTitle({ title: message ? `Prompts — ${message}` : "Prompts" });
}

let pasting = false;
chrome.commands.onCommand.addListener(async command => {
  const slot = Number(command.slice("paste-".length));
  if (pasting || !/^paste-[1-4]$/.test(command)) return;
  pasting = true;
  try {
    const { os } = await chrome.runtime.getPlatformInfo();
    if (os !== "win") return;
    const prompt = (await library()).find(item => item.slot === slot);
    if (!prompt) {
      await setResult(`No prompt is assigned to shortcut ${slot}.`);
      return;
    }
    const result = await askHost({ action: "paste-v2", text: prompt.text });
    await setResult(result.ok ? "" : result.message);
  } catch {
    await setResult(messages.input);
  } finally {
    pasting = false;
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html") ||
      typeof request?.type !== "string") return false;
  if (request.type === "status") {
    askHost({ action: "ping" }).then(sendResponse);
    return true;
  }
  if (request.type === "save" || request.type === "remove") {
    editLibrary(request).then(sendResponse, () => {
      sendResponse({ ok: false, message: "Couldn't update the prompt library." });
    });
    return true;
  }
  return false;
});
