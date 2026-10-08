import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { contentSchema, publicationIssues, publishedContent } from "../app/content-validation.ts";

const target = process.argv[2];
if (!["--local", "--remote"].includes(target)) throw new Error("Specify --local or --remote explicitly.");
const content = contentSchema.parse(JSON.parse(readFileSync(new URL("../content/trainer.json", import.meta.url), "utf8")));
if (publicationIssues(content).length) throw new Error("Source content has publication errors.");
// D1 limits each SQL statement to 100 kB. Seed via short chunks, not one huge INSERT.
const raw = JSON.stringify(content);
const published = JSON.stringify(publishedContent(content));
const quote = (text: string) => "'" + text.replaceAll("'", "''") + "'";
const statements = ["CREATE TABLE IF NOT EXISTS _habra_seed_chunks(kind TEXT,position INTEGER,data TEXT);", "DELETE FROM _habra_seed_chunks;"];
for (const [kind, text] of [["draft", raw], ["published", published]]) {
  for (let i = 0; i < text.length; i += 4000) statements.push(`INSERT INTO _habra_seed_chunks VALUES(${quote(kind)},${i},${quote(text.slice(i, i + 4000))});`);
}
statements.push(`INSERT INTO content_versions(version,draft_json,published_json,action,author_id,created_at)
SELECT 0,
(SELECT group_concat(data,'') FROM (SELECT data FROM _habra_seed_chunks WHERE kind='draft' ORDER BY position)),
(SELECT group_concat(data,'') FROM (SELECT data FROM _habra_seed_chunks WHERE kind='published' ORDER BY position)),
'seed',NULL,unixepoch() WHERE NOT EXISTS(SELECT 1 FROM content_versions);`, "DROP TABLE _habra_seed_chunks;");
const dir = mkdtempSync(join(tmpdir(), "habra-seed-"));
try {
  const path = join(dir, "seed.sql"); writeFileSync(path, statements.join("\n"));
  const extra = [...(process.env.HABRA_WRANGLER_CONFIG ? ["--config", process.env.HABRA_WRANGLER_CONFIG] : []), ...(target === "--local" && process.env.HABRA_D1_PERSIST_TO ? ["--persist-to", process.env.HABRA_D1_PERSIST_TO] : [])];
  const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", target, "--file", path, "--yes", ...extra], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { rmSync(dir, { recursive: true, force: true }); }
