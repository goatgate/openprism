import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscode = acquireVsCodeApi();
GlobalWorkerOptions.workerSrc = document.body.dataset.worker!;
const pages = document.getElementById("pages")!;
const status = document.getElementById("status")!;
let pdf: PDFDocumentProxy | undefined;
let scale = 1;
let revision = 0;
let tasks: RenderTask[] = [];
let loadRevision = 0;
function cancelRendering() {
  tasks.forEach((task) => task.cancel());
  tasks = [];
  revision++;
}
async function render() {
  cancelRendering();
  const version = revision,
    current = pdf;
  if (!current) return;
  pages.replaceChildren();
  document.getElementById("zoom")!.textContent = `${Math.round(scale * 100)}%`;
  status.textContent = `${current.numPages} page${current.numPages === 1 ? "" : "s"}`;
  try {
    for (let number = 1; number <= current.numPages; number++) {
      const page = await current.getPage(number);
      if (version !== revision) return;
      const viewport = page.getViewport({ scale });
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        2,
        Math.sqrt(8_000_000 / (viewport.width * viewport.height)),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      canvas.setAttribute("aria-label", `PDF page ${number}`);
      canvas.setAttribute("role", "img");
      pages.append(canvas);
      const task = page.render({
        canvasContext: canvas.getContext("2d")!,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      tasks.push(task);
      await task.promise;
      tasks = tasks.filter((t) => t !== task);
    }
  } catch (error) {
    if (version === revision)
      status.textContent = `Preview failed: ${error instanceof Error ? error.message : "unknown error"}`;
  }
}
document.getElementById("minus")!.onclick = () => {
  scale = Math.max(0.25, scale - 0.25);
  void render();
};
document.getElementById("plus")!.onclick = () => {
  scale = Math.min(3, scale + 0.25);
  void render();
};
document.getElementById("save")!.onclick = () =>
  vscode.postMessage({ type: "save" });
window.addEventListener("message", async (event) => {
  if (event.data?.type !== "pdf" || typeof event.data.data !== "string") return;
  const version = ++loadRevision;
  cancelRendering();
  status.textContent = "Loading PDF…";
  const previous = pdf;
  pdf = undefined;
  try {
    await previous?.destroy();
    const bytes = Uint8Array.from(atob(event.data.data), (c) =>
      c.charCodeAt(0),
    );
    const next = await getDocument({
      data: bytes,
      isEvalSupported: false,
    }).promise;
    if (version !== loadRevision) {
      await next.destroy();
      return;
    }
    pdf = next;
    await render();
  } catch {
    if (version === loadRevision)
      status.textContent =
        "Could not render this PDF. Check compilation output.";
  }
});
vscode.postMessage({ type: "ready" });
