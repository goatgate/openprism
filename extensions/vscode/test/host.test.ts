// Exercise the extension's VS Code contracts without pretending to launch a GUI host.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { createServer } from "node:http";

async function harness(storage?: string) {
  const directory =
    storage ?? (await mkdtemp(path.join(tmpdir(), "prism-host-")));
  const keys = new Map<string, string>(),
    commands = new Map<string, (...args: any[]) => Promise<void>>();
  const inputs: (string | undefined)[] = [],
    prompts: unknown[] = [],
    events: any[] = [],
    edits: unknown[] = [];
  let provider: any,
    receive: (value: unknown) => Promise<void> = async () => {};
  class Uri {
    scheme = "file";
    constructor(public fsPath: string) {}
    toString() {
      return `file://${this.fsPath}`;
    }
    static file(p: string) {
      return new Uri(p);
    }
    static joinPath(uri: Uri, ...parts: string[]) {
      return new Uri(path.join(uri.fsPath, ...parts));
    }
  }
  class Range {
    constructor(
      public start: unknown,
      public end: unknown,
    ) {}
    get isEmpty() {
      return this.start === this.end;
    }
  }
  const position = { line: 0, character: 0 };
  const doc = {
    uri: Uri.file(path.join(directory, "main.tex")),
    version: 1,
    languageId: "latex",
    isDirty: false,
    isUntitled: false,
    getText: () => "\\documentclass{article}",
    save: async () => true,
  };
  const config: Record<string, unknown> = {
    apiBaseUrl: "https://integrate.api.nvidia.com/v1",
    model: "test/model",
    maxContextCharacters: 1000,
    maxOutputTokens: 128,
  };
  const noopDisposable = () => ({ dispose() {} });
  const mock = {
    Uri,
    Range,
    ConfigurationTarget: { Global: 1 },
    WorkspaceEdit: class {
      replace(...args: unknown[]) {
        edits.push(args);
      }
    },
    commands: {
      registerCommand: (name: string, fn: any) => {
        commands.set(name, fn);
        return noopDisposable();
      },
      executeCommand: async (name: string) => commands.get(name)?.(),
    },
    window: {
      activeTextEditor: {
        document: doc,
        selection: { start: position, end: position, isEmpty: true },
      },
      createOutputChannel: () => ({
        ...noopDisposable(),
        appendLine() {},
        clear() {},
        show() {},
      }),
      registerWebviewViewProvider: (_id: string, p: any) => {
        provider = p;
        return noopDisposable();
      },
      onDidChangeActiveTextEditor: noopDisposable,
      onDidChangeTextEditorSelection: noopDisposable,
      showInputBox: async (options: unknown) => {
        prompts.push(options);
        return inputs.shift();
      },
      showInformationMessage: async () => {},
      showErrorMessage: async (text: string) =>
        events.push({ type: "error", text }),
      showWarningMessage: async (
        _title: string,
        _options: unknown,
        action: string,
      ) => action,
      showTextDocument: async (document: unknown) =>
        events.push({ type: "document", document }),
    },
    workspace: {
      isTrusted: true,
      textDocuments: [doc],
      getConfiguration: () => ({
        get: (name: string) => config[name],
        update: async (name: string, value: unknown) => {
          config[name] = value;
        },
      }),
      onDidChangeConfiguration: noopDisposable,
      onDidSaveTextDocument: noopDisposable,
      openTextDocument: async (value: any) =>
        value instanceof Uri ? doc : value,
      applyEdit: async () => {
        doc.version++;
        return true;
      },
    },
  };
  const context = {
    extensionUri: Uri.file(process.cwd()),
    globalStorageUri: Uri.file(directory),
    subscriptions: [] as any[],
    secrets: {
      get: async (id: string) => keys.get(id),
      store: async (id: string, value: string) => {
        keys.set(id, value);
      },
      delete: async (id: string) => {
        keys.delete(id);
      },
    },
  };
  const module = { exports: {} as { activate: (context: unknown) => void } };
  const nativeRequire = createRequire(path.join(process.cwd(), "package.json"));
  vm.runInNewContext(await readFile("dist/extension.cjs", "utf8"), {
    module,
    exports: module.exports,
    require: (name: string) => (name === "vscode" ? mock : nativeRequire(name)),
    Buffer,
    console,
    process,
    URL,
    AbortController,
    fetch,
    setTimeout,
    clearTimeout,
  });
  module.exports.activate(context);
  provider.resolveWebviewView({
    webview: {
      cspSource: "vscode-webview:",
      html: "",
      asWebviewUri: (uri: Uri) => uri.toString(),
      postMessage: (value: unknown) => {
        events.push(value);
        return Promise.resolve(true);
      },
      onDidReceiveMessage: (fn: typeof receive) => {
        receive = fn;
        return noopDisposable();
      },
    },
    onDidDispose: noopDisposable,
  });
  return {
    directory,
    keys,
    commands,
    inputs,
    prompts,
    events,
    edits,
    config,
    doc,
    provider,
    send: (v: unknown) => receive(v),
    cleanup: () => {
      context.subscriptions.forEach((d) => d.dispose());
    },
  };
}

test("password input stores secrets per endpoint, never sends keys to the webview, and deletes only the current key", async () => {
  const host = await harness();
  try {
    host.inputs.push("nvidia-secret");
    await host.commands.get("openPrism.setApiKey")!();
    assert.equal((host.prompts[0] as { password: boolean }).password, true);
    assert.equal(
      host.keys.get("openPrism.apiKey:https://integrate.api.nvidia.com/v1"),
      "nvidia-secret",
    );
    host.config.apiBaseUrl = "https://api.openai.com/v1";
    host.inputs.push("other-secret");
    await host.commands.get("openPrism.setApiKey")!();
    await host.commands.get("openPrism.deleteApiKey")!();
    assert.equal(host.keys.size, 1);
    assert(!JSON.stringify(host.events).includes("nvidia-secret"));
    assert(!JSON.stringify(host.events).includes("other-secret"));
  } finally {
    host.cleanup();
    await rm(host.directory, { recursive: true, force: true });
  }
});

test("custom templates survive reopening and create new documents without overwriting the original", async () => {
  const host = await harness();
  let reopened: Awaited<ReturnType<typeof harness>> | undefined;
  try {
    host.inputs.push("My research paper", "Personal template");
    await host.commands.get("openPrism.saveTemplate")!();
    const stored = JSON.parse(
      await readFile(path.join(host.directory, "templates.json"), "utf8"),
    );
    assert.equal(stored.length, 1);
    assert.equal(stored[0].name, "My research paper");
    reopened = await harness(host.directory);
    await reopened.send({ type: "ready" });
    assert(
      reopened.events.some(
        (event) =>
          event.type === "state" &&
          event.templates.some((t: any) => t.id === stored[0].id),
      ),
    );
    await reopened.send({ type: "template", id: stored[0].id });
    assert(
      reopened.events.some(
        (event) =>
          event.type === "document" &&
          event.document.content === host.doc.getText(),
      ),
    );
    assert.equal(host.doc.version, 1);
    await reopened.send({ type: "deleteTemplate", id: stored[0].id });
    assert.equal(
      JSON.parse(
        await readFile(path.join(host.directory, "templates.json"), "utf8"),
      ).length,
      0,
    );
  } finally {
    host.cleanup();
    reopened?.cleanup();
    await rm(host.directory, { recursive: true, force: true });
  }
});

test("streamed suggestions require explicit apply and refuse stale document edits", async () => {
  const mock = createServer((_, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ message: { content: "```latex\n\\section{New}\n```" } }],
      }),
    );
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const address = mock.address();
  assert(address && typeof address !== "string");
  const host = await harness();
  try {
    host.config.apiBaseUrl = `http://127.0.0.1:${address.port}/v1`;
    host.inputs.push("test-key");
    await host.commands.get("openPrism.setApiKey")!();
    await host.send({ type: "send", text: "Add a section" });
    const complete = host.events.find((event) => event.type === "complete");
    assert(complete?.canApply);
    assert.equal(host.edits.length, 0);
    host.doc.version++;
    await host.send({ type: "apply", id: complete.id });
    assert.equal(host.edits.length, 0);
    assert(
      host.events.some(
        (event) =>
          event.type === "status" && event.text.includes("document changed"),
      ),
    );
    await host.send({ type: "send", text: "Try again" });
    const next = host.events
      .filter((event) => event.type === "complete")
      .at(-1);
    await host.send({ type: "apply", id: next.id });
    assert.equal(host.edits.length, 1);
  } finally {
    host.cleanup();
    await rm(host.directory, { recursive: true, force: true });
    mock.closeAllConnections();
    await new Promise<void>((resolve) => mock.close(() => resolve()));
  }
});
