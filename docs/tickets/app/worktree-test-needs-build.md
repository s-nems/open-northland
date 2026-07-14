# Make `npm test` work in a fresh checkout/worktree without a prior build

**Area:** repo tooling (vitest resolution) · **Origin:** /ticket-scout tooling sweep, 2026-07-14
(the file-separately item named in [biome-ignores-worktrees](biome-ignores-worktrees.md)) · **Priority:** P2

In any fresh checkout or worktree, `npm test` fails on unresolved workspace packages until
`npm run build` has run — 60 test files import `@open-northland/*` by bare specifier, and every
workspace `package.json` resolves dist-only (`"exports": { ".": "./dist/index.js" }`). There is no
root vitest config and no `resolve.alias` to `src/`, so vitest resolves straight to missing `dist/`.
Nothing closes the gap: `.claude/commands/worktree.md` provisions `npm install` + the `content/`
copy but not `npm run build`, the harness `EnterWorktree` tool provisions nothing, and `AGENTS.md`
Commands never states the ordering dependency. (CI is unaffected only because its `typecheck` step
is `tsc --build`, which emits `dist/` before `npm test` runs.) Stale `dist/` is the subtler variant:
tests silently exercise the last build, not the working tree.

## Scope

Pick one (present the tradeoff in the PR):

- **Robust:** a root `vitest.config.ts` with `resolve.alias` mapping `@open-northland/*` →
  `packages/*/src/index.ts`, so tests run against source and never depend on a prior build. Confirm
  the sim determinism-hygiene scan still sees the right files and nothing dist-specific breaks.
- **Minimal:** document `npm install && npm run build` as the fresh-checkout prerequisite in
  `AGENTS.md` Commands and add `npm run build` to the `/worktree` provisioning list in
  `.claude/commands/worktree.md`.

## Verify

From a fresh `git worktree add` with no `node_modules`/`dist`: `npm test` passes after only the
chosen path (alias — no build; or the documented provisioning). `npm run check`, `npm run build`
stay green in the main checkout.

## Source basis

Repo tooling only; no game behavior claim.
