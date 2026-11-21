const $ = id => document.getElementById(id);
const nativePermission = { permissions: ["nativeMessaging"] };
let prompts = [];
let slots = [];
let editingId = null;
let hostError = "";
let pasteError = "";

function feedback(message = "", error = false) {
  $("feedback").textContent = message;
  $("feedback").hidden = !message;
  $("feedback").classList.toggle("error", error);
}

function actionButton(label, handler) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.className = "text-button";
  element.addEventListener("click", handler);
  return element;
}

function shortcut(slot) {
  return slots.find(command => command.name === `paste-${slot}`)?.shortcut || "";
}

function renderList() {
  const search = $("search").value.trim().toLowerCase();
  const visible = prompts.filter(prompt =>
    `${prompt.title}\n${prompt.text}`.toLowerCase().includes(search)
  );
  const cards = visible.map(prompt => {
    const card = document.createElement("article");
    card.className = "prompt";
    const heading = document.createElement("div");
    heading.className = "prompt-heading";
    const title = document.createElement("h2");
    title.textContent = prompt.title;
    heading.append(title);
    if (prompt.slot) {
      const keys = document.createElement("kbd");
      keys.textContent = shortcut(prompt.slot) || "Unbound";
      heading.append(keys);
    }
    const preview = document.createElement("p");
    preview.className = "preview";
    preview.textContent = prompt.text;

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(
      actionButton("Copy", async () => {
        try {
          await navigator.clipboard.writeText(prompt.text);
          feedback("Copied to clipboard.");
        } catch {
          feedback("Couldn't copy the prompt.", true);
        }
      }),
      actionButton("Edit", () => showEditor(prompt)),
      actionButton("Delete", async () => {
        if (!window.confirm(`Delete “${prompt.title}”?`)) return;
        try {
          const result = await chrome.runtime.sendMessage({ type: "remove", id: prompt.id });
          feedback(result.ok ? "Prompt deleted." : result.message, !result.ok);
        } catch {
          feedback("Couldn't delete the prompt.", true);
        }
      })
    );
    card.append(heading, preview, actions);
    return card;
  });
  $("list").replaceChildren(...cards);
  $("empty").hidden = visible.length > 0;
  $("empty").textContent = prompts.length ? "No matching prompts." : "No prompts yet.";
}

function renderSlots(selected) {
  const options = [new Option("None", 0)];
  for (let slot = 1; slot <= 4; slot++) {
    const assigned = prompts.find(prompt => prompt.slot === slot && prompt.id !== editingId);
    const keys = shortcut(slot);
    const label = `${keys || `Shortcut ${slot} (unbound)`}${assigned ? ` · ${assigned.title}` : ""}`;
    options.push(new Option(label, slot));
  }
  $("slot").replaceChildren(...options);
  $("slot").value = selected;
  updateSlotNote();
}

function updateSlotNote() {
  const slot = Number($("slot").value);
  const assigned = slot && prompts.find(prompt => prompt.slot === slot && prompt.id !== editingId);
  const note = assigned
    ? `This will reassign the shortcut from “${assigned.title}”.`
    : slot && !shortcut(slot) ? "Set the keys under Manage shortcuts." : "";
  $("slot-note").textContent = note;
  $("slot-note").hidden = !note;
}

function showEditor(prompt) {
  editingId = prompt?.id ?? null;
  $("title").value = prompt?.title ?? "";
  $("text").value = prompt?.text ?? "";
  const defaultSlot = !$("shortcut-fields").hidden && prompts.length === 0 ? 1 : 0;
  renderSlots(prompt?.slot ?? defaultSlot);
  $("editor").hidden = false;
  $("library").hidden = true;
  $("add").hidden = true;
  $("heading").textContent = prompt ? "Edit prompt" : "New prompt";
  feedback();
  $("title").focus();
}

function showLibrary() {
  $("editor").hidden = true;
  $("library").hidden = false;
  $("add").hidden = false;
  $("heading").textContent = "Prompts";
  feedback();
  $("search").focus();
}

function renderPasteStatus() {
  const message = hostError || pasteError;
  $("paste-status").textContent = message;
  $("paste-status").hidden = !message;
}

async function refreshPasteSetup() {
  try {
    const { os } = await chrome.runtime.getPlatformInfo();
    $("shortcuts").hidden = os !== "win";
    $("shortcut-fields").hidden = os !== "win";
    const enabled = os === "win" && await chrome.permissions.contains(nativePermission);
    $("paste-setup").hidden = os !== "win" || enabled;
    if (enabled) {
      const status = await chrome.runtime.sendMessage({ type: "status" });
      hostError = status.ok ? "" : status.message;
    }
  } catch {
    hostError = "Couldn't check the Windows helper.";
  }
  renderPasteStatus();
}

$("enable-paste").addEventListener("click", async () => {
  try {
    if (await chrome.permissions.request(nativePermission)) {
      pasteError = "";
      await refreshPasteSetup();
    }
  } catch {
    feedback("Couldn't enable keyboard paste.", true);
  }
});

$("search").addEventListener("input", renderList);
$("slot").addEventListener("change", updateSlotNote);
$("add").addEventListener("click", () => showEditor());
$("cancel").addEventListener("click", showLibrary);
$("shortcuts").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
$("editor").addEventListener("submit", async event => {
  event.preventDefault();
  $("save").disabled = true;
  const prompt = { id: editingId, title: $("title").value, text: $("text").value, slot: Number($("slot").value) };
  try {
    const result = await chrome.runtime.sendMessage({ type: "save", prompt });
    if (result.ok) {
      $("search").value = "";
      renderList();
      showLibrary();
      feedback("Prompt saved.");
    } else {
      feedback(result.message, true);
    }
  } catch {
    feedback("Couldn't save the prompt.", true);
  } finally {
    $("save").disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.prompts) {
    prompts = changes.prompts.newValue ?? [];
    renderList();
    if (!$("editor").hidden) renderSlots($("slot").value);
  }
  if (area === "session" && changes.pasteError) {
    pasteError = changes.pasteError.newValue ?? "";
    renderPasteStatus();
  }
});

try {
  const [stored, commands, session] = await Promise.all([
    chrome.storage.local.get("prompts"),
    chrome.commands.getAll(),
    chrome.storage.session.get("pasteError")
  ]);
  prompts = stored.prompts ?? [];
  slots = commands;
  pasteError = session.pasteError ?? "";
  renderPasteStatus();
  renderList();
} catch {
  feedback("Couldn't load the prompt library.", true);
}

await refreshPasteSetup();
