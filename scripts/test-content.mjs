#!/usr/bin/env node
// Guard + runner for the manual real-content suite (docs/TESTING.md "Real-content test modes"):
// hard-fails when the IR under test is absent — the suite itself runIf-SKIPS under plain `npm test`,
// so this explicit mode is the one that refuses to pass vacuously — then runs vitest over
// packages/app/test/content. `ON_CONTENT_DIR` (absolute or repo-relative) overrides the default
// `content/`; `npm run test:pipeline` uses it to point the same suite at a fresh pipeline output.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '../..');
// Resolution rules mirror packages/app/test/content/helpers.ts `contentDir()` — keep them in step.
const override = process.env.ON_CONTENT_DIR;
const contentDir =
  override === undefined || override === ''
    ? resolve(repoRoot, 'content')
    : isAbsolute(override)
      ? override
      : resolve(repoRoot, override);
// A full pipeline run emits all three; guarding each keeps the explicit mode from passing
// vacuously when a lane vanishes (the map suite and the roster's on-disk checks would skip).
const REQUIRED = ['ir.json', 'maps', 'Data/engine2d/bin/bobs'];
const missing = REQUIRED.filter((rel) => !existsSync(resolve(contentDir, rel)));
if (missing.length > 0) {
  console.error(`test:content needs generated content — missing under ${contentDir}: ${missing.join(', ')}`);
  console.error(
    'Generate it with: npm run pipeline -- --game "../Cultures 8th Wonder" --mod DataCnmd --out content',
  );
  process.exit(1);
}

const result = spawnSync('npx', ['vitest', 'run', 'packages/app/test/content'], {
  stdio: 'inherit',
  cwd: repoRoot,
  env: process.env,
});
process.exit(result.status ?? 1);
