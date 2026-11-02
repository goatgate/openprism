// Browser validation of the actual webview markup and bundles, without a VS Code GUI.
const { chromium } = require("playwright");
const { createServer } = require("node:http");
const { readFile, mkdtemp, writeFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

(async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "prism-browser-"));
  const source = await readFile("src/extension.ts", "utf8");
  const markup = [
    ...source.matchAll(/(?:view\.)?webview\.html = (`[\s\S]*?`);/g),
  ].map((match) => match[1]);
  assert.equal(markup.length, 2, "Both actual webview templates must be found");
  let origin;
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/" || req.url === "/preview") {
        const preview = req.url === "/preview";
        const html = vm.runInNewContext(markup[preview ? 1 : 0], {
          n: "browser-test-nonce",
          view: { webview: { cspSource: origin } },
          webview: { cspSource: origin },
          script: `${origin}/${preview ? "dist/preview.js" : "media/sidebar.js"}`,
          style: `${origin}/media/sidebar.css`,
          worker: `${origin}/dist/pdf.worker.min.mjs`,
        });
        res.setHeader("content-type", "text/html");
        res.end(html);
        return;
      }
      const file = req.url.replace(/^\//, "");
      if (
        !/^(?:media\/(?:sidebar\.css|sidebar\.js)|dist\/(?:preview\.js|pdf\.worker\.min\.mjs))$/.test(
          file,
        )
      ) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.setHeader(
        "content-type",
        file.endsWith(".css") ? "text/css" : "text/javascript",
      );
      res.end(await readFile(file));
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 420, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (entry) => {
      if (["error", "warning"].includes(entry.type()))
        console.log(`Browser ${entry.type()}: ${entry.text()}`);
    });
    await page.addInitScript(() => {
      window.sent = [];
      window.acquireVsCodeApi = () => ({
        postMessage: (msg) => window.sent.push(msg),
      });
    });
    await page.goto(origin);
    await page.waitForFunction(() =>
      window.sent.some((msg) => msg.type === "ready"),
    );
    await page.evaluate(() =>
      window.postMessage(
        {
          type: "state",
          endpoint: "https://integrate.api.nvidia.com/v1",
          model: "meta/llama-3.3-70b-instruct",
          hasKey: true,
          context: "main.tex · document context",
          templates: [
            {
              id: "one",
              name: "<img src=x onerror=alert(1)>",
              description: "My custom template",
              builtin: false,
            },
          ],
        },
        "*",
      ),
    );
    await page.getByRole("button", { name: "Templates", exact: true }).click();
    await page
      .getByRole("button", { name: "New document", exact: true })
      .click();
    assert(
      await page.evaluate(() =>
        window.sent.some((msg) => msg.type === "template" && msg.id === "one"),
      ),
    );
    assert.equal(
      await page.locator("#templates img").count(),
      0,
      "Template names must be inert text",
    );
    await page.getByRole("button", { name: "Assistant", exact: true }).click();
    await page.getByLabel("Ask your assistant").fill("Improve this equation");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    assert(
      await page.evaluate(() =>
        window.sent.some(
          (msg) => msg.type === "send" && msg.text === "Improve this equation",
        ),
      ),
    );
    await page.evaluate(() => {
      window.postMessage(
        { type: "begin", id: "reply", prompt: "Improve this equation" },
        "*",
      );
      window.postMessage(
        {
          type: "token",
          id: "reply",
          text: "<script>bad()</script>\n```latex\nE=mc^2\n```",
        },
        "*",
      );
      window.postMessage(
        { type: "complete", id: "reply", canApply: true },
        "*",
      );
      window.postMessage({ type: "idle" }, "*");
    });
    await page.getByRole("button", { name: "Review & apply LaTeX" }).click();
    assert(
      await page.evaluate(() =>
        window.sent.some((msg) => msg.type === "apply" && msg.id === "reply"),
      ),
    );
    assert.equal(
      await page.locator("#messages script").count(),
      0,
      "Model responses must be inert text",
    );
    await page.screenshot({
      path: path.join(directory, "sidebar.png"),
      fullPage: true,
    });

    // A real TeX-produced PDF must render through the bundled PDF.js worker under CSP.
    await writeFile(
      path.join(directory, "main.tex"),
      String.raw`\documentclass{article}\begin{document}\Huge Open Prism browser preview.\end{document}`,
    );
    execFileSync(
      "pdflatex",
      [
        "-no-shell-escape",
        "-interaction=nonstopmode",
        "-halt-on-error",
        "main.tex",
      ],
      { cwd: directory, stdio: "pipe" },
    );
    const pdf = (await readFile(path.join(directory, "main.pdf"))).toString(
      "base64",
    );
    await page.goto(`${origin}/preview`);
    await page.waitForFunction(() =>
      window.sent.some((msg) => msg.type === "ready"),
    );
    await page.evaluate(
      (data) => window.postMessage({ type: "pdf", data }, "*"),
      pdf,
    );
    await page.waitForFunction(
      () => document.querySelector("#status").textContent === "1 page",
    );
    await page
      .waitForFunction(() => {
        const canvas = document.querySelector("canvas");
        if (!canvas) return false;
        const data = canvas
          .getContext("2d")
          .getImageData(0, 0, canvas.width, canvas.height).data;
        let dark = 0;
        for (let i = 0; i < data.length; i += 4)
          if (data[i] < 100 && data[i + 3] > 0) dark++;
        return dark > 100;
      })
      .catch(async (error) => {
        console.log(
          await page.evaluate(() => ({
            status: document.getElementById("status").textContent,
            canvas: [...document.querySelectorAll("canvas")].map((c) => {
              const d = c
                .getContext("2d")
                .getImageData(0, 0, c.width, c.height).data;
              let dark = 0,
                opaque = 0;
              for (let i = 0; i < d.length; i += 4) {
                if (d[i] < 100 && d[i + 3]) dark++;
                if (d[i + 3]) opaque++;
              }
              return { width: c.width, height: c.height, dark, opaque };
            }),
          })),
        );
        throw error;
      });
    const before = await page
      .locator("canvas")
      .evaluate((canvas) => canvas.getBoundingClientRect().width);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.waitForFunction(
      (width) =>
        document.querySelector("canvas")?.getBoundingClientRect().width > width,
      before,
    );
    await page.getByRole("button", { name: "Save PDF…" }).click();
    assert(
      await page.evaluate(() => window.sent.some((msg) => msg.type === "save")),
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: sidebar navigation, template reuse, prompt delivery, safe text rendering, explicit apply, real PDF rendering under CSP, zoom, and export request.",
    );
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
