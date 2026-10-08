import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
if (!/^[a-f0-9-]{36}$/.test(config.d1_databases?.[0]?.database_id || '')) throw new Error('Set the actual D1 database_id in wrangler.jsonc before deployment.');
const app = new URL(config.vars.APP_URL);
if (app.protocol !== 'https:' || app.hostname === 'localhost' || app.pathname !== '/' || app.search || app.hash) throw new Error('Set APP_URL to the HTTPS origin of the production Worker.');
for (const args of [['node_modules/typescript/bin/tsc', '--noEmit'], ['node_modules/typescript/bin/tsc', '-p', 'worker/tsconfig.json'], ['node_modules/vite/bin/vite.js', 'build'], ['node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'DB', '--remote'], ['node_modules/wrangler/bin/wrangler.js', 'deploy']]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}
