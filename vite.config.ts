import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { contentSchema, publishedContent, publicationIssues } from "./app/content-validation";

function getContent() {
  return contentSchema.parse(JSON.parse(readFileSync(new URL("./content/trainer.json", import.meta.url), "utf8")));
}

export default defineConfig({
  base: "./",
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  build: { outDir: "docs", emptyOutDir: true },
  plugins: [
    react(),
    {
      name: "trainer-content",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.split("?")[0] !== "/content/trainer.json") return next();
          try {
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.end(JSON.stringify(publishedContent(getContent())));
          } catch { res.statusCode = 500; res.end("Obsah se nepodařilo načíst."); }
        });
      },
      generateBundle() {
        const content = getContent();
        for (const issue of publicationIssues(content)) this.warn(`${issue.questionId || issue.levelId || "Obsah"}: ${issue.message}`);
        this.emitFile({ type: "asset", fileName: "content/trainer.json", source: JSON.stringify(publishedContent(content), null, 2) });
        this.emitFile({ type: "asset", fileName: ".nojekyll", source: "" });
      },
    },
  ],
});
