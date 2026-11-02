# Open Prism for VS Code

An integrated LaTeX workspace for VS Code, based on [assistant-ui/open-prism](https://github.com/assistant-ui/open-prism).

- Native LaTeX editing with side-by-side PDF preview.
- Streaming AI assistant supporting NVIDIA Build and other OpenAI-compatible APIs.
- API keys stored in VS Code SecretStorage, separately for each endpoint.
- Included templates plus save, import, reuse, and delete commands.
- Explicit review before applying AI-generated LaTeX edits.

## Build and install

Requires Node.js 22+ for building, VS Code 1.95+, and TeX Live or MiKTeX for PDF compilation.

```sh
cd extensions/vscode
npm ci
npm run package
```

In VS Code, select **Extensions → … → Install from VSIX** and choose the generated `.vsix` file. Open **Open Prism**, select **Provider**, and use **Set key** to securely store your NVIDIA Build or other provider API key.

See the [extension documentation](extensions/vscode/README.md) for setup, configuration, templates, and testing.

## Validation

```sh
cd extensions/vscode
npm run check
npm test
# Optional browser checks (requires Chromium and pdflatex):
npx playwright install chromium
npm run test:webview
```

The extension code is MIT licensed; upstream attribution is preserved in the extension license. PDF.js is Apache-2.0 licensed; its license is included alongside the extension.
