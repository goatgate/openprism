import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
if (process.argv.includes("--test")) {
  await build({
    entryPoints: ["test/core.test.ts", "test/host.test.ts"],
    outdir: "test-dist",
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
  });
} else {
  await mkdir("dist", { recursive: true });
  await build({
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.cjs",
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    external: ["vscode"],
    sourcemap: true,
  });
  await build({
    entryPoints: ["src/preview.ts"],
    outfile: "dist/preview.js",
    bundle: true,
    platform: "browser",
    target: "es2022",
    format: "esm",
  });
  await copyFile(
    "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
    "dist/pdf.worker.min.mjs",
  );
}
