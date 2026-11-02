/* All provider text, templates, and document names are rendered as text, never HTML. */
const vscode = acquireVsCodeApi();
const byId = (id) => document.getElementById(id);
const replies = new Map();
const post = (type, extra = {}) => vscode.postMessage({ type, ...extra });
for (const button of document.querySelectorAll("[data-command]"))
  button.addEventListener("click", () =>
    post("command", { command: button.dataset.command }),
  );
function selectTab(templates) {
  byId("templates-section").hidden = !templates;
  byId("chat-section").hidden = templates;
  for (const [id, selected] of [
    ["templates-tab", templates],
    ["chat-tab", !templates],
  ]) {
    byId(id).classList.toggle("selected", selected);
    byId(id).setAttribute("aria-pressed", String(selected));
  }
}
byId("chat-tab").onclick = () => selectTab(false);
byId("templates-tab").onclick = () => selectTab(true);
byId("clear").onclick = () => post("clear");
byId("cancel").onclick = () => post("cancel");
byId("chat-form").onsubmit = (event) => {
  event.preventDefault();
  const text = byId("prompt").value.trim();
  if (text) post("send", { text });
};
byId("prompt").addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter")
    byId("chat-form").requestSubmit();
});
function bubble(title, text) {
  const article = document.createElement("article");
  article.className = "message";
  const label = document.createElement("h3");
  label.textContent = title;
  const content = document.createElement("pre");
  content.textContent = text;
  article.append(label, content);
  byId("messages").append(article);
  return { article, content };
}
function idle() {
  byId("send").disabled = false;
  byId("cancel").disabled = true;
}
window.addEventListener("message", (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "state": {
      byId("provider").textContent = `${msg.model} · ${msg.endpoint}`;
      byId("key-status").textContent = msg.hasKey
        ? "Key stored securely for this endpoint"
        : "No key stored for this endpoint";
      byId("context").textContent = msg.context;
      byId("templates").replaceChildren();
      for (const template of msg.templates) {
        const card = document.createElement("article");
        card.className = "template";
        const name = document.createElement("h3");
        name.textContent = template.name;
        const desc = document.createElement("p");
        desc.textContent = template.description;
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = template.builtin ? "Included" : "Your template";
        const actions = document.createElement("div");
        actions.className = "actions";
        const use = document.createElement("button");
        use.textContent = "New document";
        use.onclick = () => post("template", { id: template.id });
        actions.append(use);
        if (!template.builtin) {
          const remove = document.createElement("button");
          remove.textContent = "Delete";
          remove.onclick = () => post("deleteTemplate", { id: template.id });
          actions.append(remove);
        }
        card.append(tag, name, desc, actions);
        byId("templates").append(card);
      }
      break;
    }
    case "begin": {
      byId("status").textContent = "Thinking…";
      byId("prompt").value = "";
      byId("send").disabled = true;
      byId("cancel").disabled = false;
      bubble("You", msg.prompt);
      replies.set(msg.id, bubble("Open Prism", ""));
      break;
    }
    case "token": {
      const reply = replies.get(msg.id);
      if (reply) reply.content.textContent += msg.text;
      break;
    }
    case "complete": {
      const reply = replies.get(msg.id);
      if (reply && msg.canApply) {
        const apply = document.createElement("button");
        apply.textContent = "Review & apply LaTeX";
        apply.onclick = () => post("apply", { id: msg.id });
        reply.article.append(apply);
      }
      byId("status").textContent = "Response complete.";
      break;
    }
    case "idle":
      idle();
      break;
    case "clear":
      byId("messages").replaceChildren();
      replies.clear();
      byId("status").textContent = "Chat cleared.";
      break;
    case "status":
      byId("status").textContent = msg.text;
      break;
  }
});
post("ready");
