import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * The custom art fork may differ from the public repository only by adding these paths. Everything
 * else lands upstream first and arrives here through `git merge upstream/main`.
 */
export const forkPaths = [
  '.github/workflows/art.yml',
  'docs/art/',
  'docs/tickets/app/custom-prop-atlas-page.md',
  'packages/app/src/assets/custom/',
  'packages/app/src/custom/',
  'packages/app/test/custom/',
  'packages/app/vite/custom/',
  'packages/art-contracts/src/custom/',
  'packages/art-contracts/test/custom/',
  'scripts/custom-art-policy.mjs',
  'scripts/custom-art-sources.json',
  'scripts/custom-fork-guard.mjs',
  'scripts/test/custom-art-policy.test.mjs',
  'scripts/test/custom-fork-guard.test.mjs',
  'tools/art-pipeline/',
];

/** Upstream files the fork edits: the art scripts, the art pipeline's project reference, the lockfile. */
export const forkEdits = ['package.json', 'tsconfig.json', 'package-lock.json'];

/** The public game's copy of the shared HUD chrome, which art publication refreshes here. */
const sharedUi = 'packages/app/src/assets/ui/';

/** Why a path differing from upstream breaks the fork contract, or null when it may differ. */
export function forkViolation(path) {
  if (forkEdits.includes(path) || forkPaths.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p)))
    return null;
  if (path.startsWith(sharedUi)) return 'shared HUD chrome: commit the published mirror upstream first';
  return 'upstream file: change it in the public repository and merge upstream/main';
}

/** Every path the working tree changes against its merge base with `upstream`, both sides of a move. */
export function forkChanges(upstream, cwd = process.cwd()) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const base = git('merge-base', 'HEAD', upstream);
  return git('diff', '--name-only', '--no-renames', base).split('\n').filter(Boolean);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const upstream = process.argv[2] ?? 'upstream/main';
  const changed = forkChanges(upstream);
  const violations = changed.flatMap((path) => {
    const reason = forkViolation(path);
    return reason === null ? [] : [`- ${path}: ${reason}`];
  });
  if (violations.length > 0) {
    console.error(`Fork differs from ${upstream} outside its own paths:\n${violations.join('\n')}`);
    process.exit(1);
  }
  console.log(`Fork guard passed (${changed.length} paths differ from ${upstream}).`);
}
