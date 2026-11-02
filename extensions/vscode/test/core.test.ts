import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  compileDocument,
  extractLatex,
  keyId,
  normalizeEndpoint,
  streamCompletion,
  validateTemplate,
} from "../src/core";
import { builtins } from "../src/templates";

async function server(fn: (req: IncomingMessage, res: ServerResponse) => void) {
  const instance = createServer(fn);
  await new Promise<void>((resolve) =>
    instance.listen(0, "127.0.0.1", resolve),
  );
  const address = instance.address();
  assert(address && typeof address !== "string");
  return {
    endpoint: `http://127.0.0.1:${address.port}/v1`,
    close: () => {
      instance.closeAllConnections();
      return new Promise<void>((resolve) => instance.close(() => resolve()));
    },
  };
}
function completion(endpoint: string, onText = (_text: string) => {}) {
  return {
    endpoint,
    key: "unit-test-secret",
    model: "test/model",
    messages: [{ role: "user" as const, content: "Hello" }],
    maxTokens: 256,
    signal: new AbortController().signal,
    onText,
  };
}

test("normalizes NVIDIA/OpenAI endpoints and isolates secrets per endpoint", () => {
  assert.equal(
    normalizeEndpoint("https://integrate.api.nvidia.com/v1/"),
    "https://integrate.api.nvidia.com/v1",
  );
  assert.equal(
    normalizeEndpoint("https://api.openai.com/v1/chat/completions"),
    "https://api.openai.com/v1",
  );
  assert.notEqual(
    keyId("https://integrate.api.nvidia.com/v1"),
    keyId("https://api.openai.com/v1"),
  );
  for (const value of [
    "http://example.org/v1",
    "https://key@example.org/v1",
    "https://example.org/v1?key=secret",
    "file:///tmp/key",
    "https://example.org/#secret",
  ])
    assert.throws(() => normalizeEndpoint(value));
  assert.equal(
    normalizeEndpoint("http://localhost:11434/v1"),
    "http://localhost:11434/v1",
  );
});

test("sends OpenAI-compatible payload and parses split SSE, CRLF, comments, usage and UTF-8", async () => {
  let received: unknown, auth: string | undefined, route: string | undefined;
  const mock = await server(async (req, res) => {
    auth = req.headers.authorization;
    route = req.url;
    let body = "";
    for await (const chunk of req) body += chunk;
    received = JSON.parse(body);
    res.writeHead(200, { "content-type": "text/event-stream" });
    const bytes = Buffer.from(
      ': keepalive\r\ndata: {"choices":[{"delta":{"role":"assistant"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"Hello π"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"!"}}]}\n\ndata: {"choices":[],"usage":{"completion_tokens":3}}\n\ndata: [DONE]\n\n',
    );
    // Writes split JSON tokens and the multibyte pi character across byte boundaries.
    for (let i = 0; i < bytes.length; i += 3)
      res.write(bytes.subarray(i, i + 3));
    res.end();
  });
  try {
    let text = "";
    assert.equal(
      await streamCompletion(
        completion(mock.endpoint, (token) => (text += token)),
      ),
      "Hello π!",
    );
    assert.equal(text, "Hello π!");
    assert.equal(auth, "Bearer unit-test-secret");
    assert.equal(route, "/v1/chat/completions");
    assert.deepEqual(received, {
      model: "test/model",
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
      max_tokens: 256,
    });
  } finally {
    await mock.close();
  }
});

test("accepts JSON responses from compatible providers", async () => {
  const mock = await server((_, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ choices: [{ message: { content: "A response" } }] }),
    );
  });
  try {
    assert.equal(
      await streamCompletion(completion(mock.endpoint)),
      "A response",
    );
  } finally {
    await mock.close();
  }
});

test("redacts provider errors and rejects malformed or empty streams", async () => {
  for (const [status, body, expected] of [
    [429, "unit-test-secret and private context", /HTTP 429/],
    [200, "data: not-json\n\n", /malformed/],
    [200, "data: [DONE]\n\n", /no text/],
  ] as const) {
    const mock = await server((_, res) => {
      res.writeHead(status, { "content-type": "text/event-stream" });
      res.end(body);
    });
    try {
      await assert.rejects(
        streamCompletion(completion(mock.endpoint)),
        (error) => {
          assert(error instanceof Error);
          assert.match(error.message, expected);
          assert(!error.message.includes("unit-test-secret"));
          return true;
        },
      );
    } finally {
      await mock.close();
    }
  }
});

test("never forwards API keys across redirects", async () => {
  let redirected = false;
  const destination = await server((_, res) => {
    redirected = true;
    res.end();
  });
  const source = await server((_, res) => {
    res.writeHead(302, {
      location: `${destination.endpoint}/chat/completions`,
    });
    res.end();
  });
  try {
    await assert.rejects(streamCompletion(completion(source.endpoint)));
    assert.equal(redirected, false);
  } finally {
    await source.close();
    await destination.close();
  }
});

test("cancels an in-flight provider response", async () => {
  const mock = await server((_, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(": waiting\n\n");
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40);
  try {
    await assert.rejects(
      streamCompletion({
        ...completion(mock.endpoint),
        signal: controller.signal,
      }),
      { name: "AbortError" },
    );
  } finally {
    clearTimeout(timer);
    await mock.close();
  }
});

test("extracts explicit LaTeX suggestions and validates user templates", () => {
  assert.equal(
    extractLatex("Explanation\n```latex\n\\section{Hello}\n```"),
    "\\section{Hello}",
  );
  assert.equal(extractLatex("No code to apply"), undefined);
  assert.equal(
    validateTemplate({
      id: "abc",
      name: " My paper ",
      content: "\\documentclass{article}",
    }).name,
    "My paper",
  );
  assert.throws(() =>
    validateTemplate({ id: "abc", name: "", content: "latex" }),
  );
  assert.throws(() =>
    validateTemplate({
      id: "abc",
      name: "Huge",
      content: "x".repeat(1_000_001),
    }),
  );
});

test("compiles all bundled templates into real PDFs and resolves included files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "prism-test-"));
  try {
    for (const template of builtins) {
      const filename = path.join(directory, `${template.id}.tex`);
      await writeFile(filename, template.content);
      const pdf = await compileDocument(filename, "pdflatex");
      assert.equal(Buffer.from(pdf.subarray(0, 5)).toString(), "%PDF-");
      assert(pdf.byteLength > 1000);
    }
    await writeFile(path.join(directory, "part.tex"), "Included content.");
    const filename = path.join(directory, "with spaces.tex");
    await writeFile(
      filename,
      String.raw`\documentclass{article}\begin{document}\input{part}\end{document}`,
    );
    assert((await compileDocument(filename, "pdflatex")).byteLength > 1000);
    await assert.rejects(compileDocument(filename, "sh"), /Unsupported/);
    await writeFile(filename, "\\notacommand");
    await assert.rejects(compileDocument(filename, "pdflatex"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
