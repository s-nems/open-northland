# Gate the app's `vite build` bundling step in CI

**Area:** repo tooling (CI) · **Origin:** /ticket-scout tooling sweep, 2026-07-14 · **Priority:** P3

The production bundler never runs anywhere automated: root `npm run build` is `tsc --build` (the
same command as CI's `typecheck` step), while the app's real build is `tsc --build && vite build`
(`packages/app/package.json`) — so a change that type-checks but breaks the production bundle (a
bad dynamic import, an asset URL, vite-specific resolution) ships green. CI can run it without game
assets: the committed app degrades without `content/` (`packages/app/AGENTS.md`), and CI already
has no game copy.

## Scope

- Add an app bundle step to `.github/workflows/ci.yml` (single OS is enough — it is a bundler
  check, not a determinism check): `npm run build --workspace @open-northland/app` or equivalent.
- Optional, same visit: the CI matrix pins node 22 only while `engines` allows
  `^20.19.0 || >=22.12.0` — either test node 20 too or narrow `engines`.

## Verify

CI green on a checkout without `content/`, with the new step visibly producing the bundle.

## Source basis

Repo tooling only; no game behavior claim.
