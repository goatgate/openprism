# Open Prism for VS Code

A VS Code adaptation of [assistant-ui/open-prism](https://github.com/assistant-ui/open-prism): native LaTeX editing, a side-by-side PDF preview, an AI writing assistant, and reusable templates. It runs without the Next.js app, Redis, or a separate LaTeX API.

## Install and start

Requires VS Code 1.95+ and TeX Live or MiKTeX on the **extension host's PATH**. For Remote SSH, WSL, or containers, install TeX there. `pdflatex` is the default; `xelatex` and `lualatex` are also supported.

1. Install the `.vsix` using **Extensions → … → Install from VSIX**.
2. Open a trusted workspace folder and click the Open Prism activity bar icon (or run **Open Prism: Open Workspace**).
3. In **Templates**, choose **New document** or open an existing `.tex` file. Save new documents before compiling.
4. Click **Compile & preview**. The PDF opens beside your native editor. Use **Save PDF…** in the preview to export it.

The compiler runs twice for cross-references, with shell escape disabled. Assets and `\input` files resolve relative to the main document. Temporary compiler output is cleaned up. Use `openPrism.rootFile` for multi-file projects and optionally enable `openPrism.compileOnSave`. Compilation errors appear in **Output → Open Prism LaTeX**. Dirty TeX documents are saved before compilation. Bibliography workflows requiring BibTeX/Biber or external tools are not yet automated.

## NVIDIA Build and other OpenAI-compatible APIs

1. Run **Open Prism: Configure Provider** or click **Provider** in the sidebar.
2. Select **NVIDIA Build**. The default base URL is `https://integrate.api.nvidia.com/v1` and the default model is `meta/llama-3.3-70b-instruct`. Use a model ID currently available in your [NVIDIA API catalog](https://build.nvidia.com/).
3. Click **Set key**, then paste your NVIDIA Build API key into the password input.
4. Open a LaTeX document, optionally select text, and send a prompt from the Assistant tab. The displayed provider receives that selection or the document, bounded by the context limit.

For OpenAI choose the OpenAI preset, or choose **Custom OpenAI-compatible** and supply a base URL and model. The extension calls `{base URL}/chat/completions` with a Bearer token, `model`, `messages`, `stream`, and `max_tokens`. It supports streaming SSE and nonstreaming JSON responses. HTTPS is required except for localhost providers. Custom providers still require a stored key; a local server that does not authenticate can use an arbitrary local placeholder key. Some providers may require different request fields and are not supported by the standard chat-completions adapter.

Keys are stored in **VS Code SecretStorage**, separately for each endpoint. They never enter the webview, workspace files, settings, output logs, or templates. Changing providers does not send the old provider's key to the new endpoint. **Remove key** deletes the current endpoint's saved key. Settings contain only the endpoint and model; do not put keys in settings or URLs.

Chat is kept in memory, bounded to six conversation turns, and cleared when provider settings change or the view is disposed. Requests have a two-minute timeout and a **Stop** button. No request is sent until you press Send. Context is limited by `openPrism.maxContextCharacters` (30,000 characters by default). A response's first fenced `latex`/`tex` block can be inserted at the original cursor or replace the original selection through **Review & apply LaTeX**. The extension asks for confirmation and refuses stale suggestions if the document changed. Edits use VS Code's normal undo history.

## Templates

Article, Report, and Letter templates are included. **Save current** saves the active LaTeX document as a named template; **Import .tex** imports another file. Every template creates a new unsaved document, leaving the template and existing files untouched. Custom templates can be deleted with confirmation and are retained across workspaces in the extension's global storage (`templates.json`). Treat templates as ordinary local files, not a place to store secrets. Template assets and multi-file project folders are not copied.

## Settings

| Setting | Purpose |
| --- | --- |
| `openPrism.apiBaseUrl` | OpenAI-compatible endpoint, including `/v1` where required |
| `openPrism.model` | Provider-specific model ID |
| `openPrism.compiler` | `pdflatex`, `xelatex`, or `lualatex` |
| `openPrism.rootFile` | Main `.tex` path relative to the workspace folder |
| `openPrism.compileOnSave` | Refresh PDF after saving TeX; off by default |
| `openPrism.maxContextCharacters` | Limit document context sent to the model |
| `openPrism.maxOutputTokens` | Requested response length |

## Develop and package

This is a standalone npm package under `extensions/vscode`; it does not modify the upstream pnpm workspace or lockfile. Requires Node.js 22+ for the build tooling.

```sh
cd extensions/vscode
npm ci
npm run check
npm test                 # uses a local mock API and a real pdflatex installation
npx playwright install chromium
npm run test:webview     # browser checks for sidebar, CSP, PDF rendering, and zoom
npm run build
npm run package          # creates open-prism-vscode-0.1.0.vsix
```

To debug, open this extension directory as the VS Code folder, build it, and press **F5**. The Extension Development Host starts with the extension installed. No live API call is made by the automated tests. Test NVIDIA/OpenAI authentication with your own securely stored key. The local publisher ID is for development packaging; replace it with your Marketplace publisher before publishing.

For browser checks with an existing Chromium installation, set `CHROMIUM_EXECUTABLE` to its path instead of downloading a browser. These checks use the actual webview markup and bundles in Chromium; extension-contract tests mock the VS Code API. They do not replace an interactive Extension Development Host check of OS-backed secret storage and VS Code layout.

Based on Open-Prism, Copyright (c) 2026 assistant-ui, under the MIT license.
