import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};
export type Template = {
  id: string;
  name: string;
  description: string;
  content: string;
  builtin?: boolean;
};

export function normalizeEndpoint(input: string): string {
  const url = new URL(input.trim());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
    throw new Error("Use HTTPS, or HTTP on localhost for a local provider.");
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      "The endpoint must not contain credentials, query parameters, or a fragment.",
    );
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (url.pathname.endsWith("/chat/completions"))
    url.pathname = url.pathname.slice(0, -17);
  return url.toString().replace(/\/+$/, "");
}

export function keyId(endpoint: string): string {
  return `openPrism.apiKey:${normalizeEndpoint(endpoint)}`;
}

// A document or a model response is content, never webview HTML or an automatic edit.
export function extractLatex(text: string): string | undefined {
  return /```(?:latex|tex)\s*\n([\s\S]*?)```/i.exec(text)?.[1].trim();
}

export function validateTemplate(value: unknown): Template {
  if (!value || typeof value !== "object") throw new Error("Invalid template.");
  const t = value as Record<string, unknown>;
  if (
    typeof t.id !== "string" ||
    typeof t.name !== "string" ||
    typeof t.content !== "string" ||
    !t.name.trim() ||
    !t.content.trim() ||
    t.name.length > 100 ||
    t.content.length > 1_000_000
  )
    throw new Error("Template needs a name and LaTeX content (maximum 1 MB).");
  return {
    id: t.id,
    name: t.name.trim(),
    description:
      typeof t.description === "string" ? t.description.slice(0, 300) : "",
    content: t.content,
  };
}

export async function streamCompletion(options: {
  endpoint: string;
  key: string;
  model: string;
  messages: Message[];
  maxTokens: number;
  signal: AbortSignal;
  onText: (text: string) => void;
}): Promise<string> {
  const response = await fetch(
    `${normalizeEndpoint(options.endpoint)}/chat/completions`,
    {
      method: "POST",
      redirect: "error",
      signal: options.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.key}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        stream: true,
        max_tokens: options.maxTokens,
      }),
    },
  );
  if (!response.ok) {
    // Provider errors can echo credentials or prompts. Keep them out of the UI and logs.
    await response.body?.cancel();
    throw new Error(
      `Provider returned HTTP ${response.status}. Check the endpoint, model, API key, and account quota.`,
    );
  }
  let result = "";
  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    if (result.length + value.length > 1_000_000)
      throw new Error("Response exceeded the 1 MB limit.");
    result += value;
    options.onText(value);
  };
  if (response.headers.get("content-type")?.includes("application/json")) {
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: unknown;
    };
    if (data.error)
      throw new Error(
        "Provider reported an error. Check your provider configuration.",
      );
    add(data.choices?.[0]?.message?.content);
  } else {
    if (!response.body) throw new Error("Provider returned no response body.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "",
      dataLines: string[] = [],
      done = false;
    const dispatch = () => {
      if (!dataLines.length) return;
      const payload = dataLines.join("\n");
      dataLines = [];
      if (payload.trim() === "[DONE]") {
        done = true;
        return;
      }
      let data: {
        choices?: {
          delta?: { content?: string };
          message?: { content?: string };
        }[];
        error?: unknown;
      };
      try {
        data = JSON.parse(payload);
      } catch {
        throw new Error("Provider returned malformed streaming data.");
      }
      if (data.error) throw new Error("Provider reported a streaming error.");
      add(
        data.choices?.[0]?.delta?.content ??
          data.choices?.[0]?.message?.content,
      );
    };
    const line = (value: string) => {
      if (!value) dispatch();
      else if (value.startsWith("data:"))
        dataLines.push(value.slice(5).trimStart());
    };
    try {
      while (!done) {
        const chunk = await reader.read();
        buffer += chunk.done
          ? decoder.decode()
          : decoder.decode(chunk.value, { stream: true });
        if (buffer.length > 2_000_000)
          throw new Error("Provider streaming event exceeded the size limit.");
        let index: number;
        while (!done && (index = buffer.indexOf("\n")) >= 0) {
          line(buffer.slice(0, index).replace(/\r$/, ""));
          buffer = buffer.slice(index + 1);
        }
        if (chunk.done) {
          if (buffer) line(buffer.replace(/\r$/, ""));
          dispatch();
          break;
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  if (!result.trim())
    throw new Error(
      "The model returned no text. Check that the selected model supports chat completions.",
    );
  return result;
}

const exec = promisify(execFile);
export async function compileDocument(
  file: string,
  compiler: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (!["pdflatex", "xelatex", "lualatex"].includes(compiler))
    throw new Error("Unsupported LaTeX compiler.");
  const directory = await mkdtemp(path.join(tmpdir(), "open-prism-"));
  try {
    for (let pass = 0; pass < 2; pass++) {
      await exec(
        compiler,
        [
          "-no-shell-escape",
          "-interaction=nonstopmode",
          "-halt-on-error",
          `-output-directory=${directory}`,
          `./${path.basename(file)}`,
        ],
        {
          cwd: path.dirname(file),
          timeout: 60_000,
          maxBuffer: 8 * 1024 * 1024,
          signal,
        },
      );
    }
    const pdf = await readFile(
      path.join(directory, `${path.basename(file, path.extname(file))}.pdf`),
    );
    if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-")))
      throw new Error("Compiler did not produce a PDF.");
    return pdf;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
