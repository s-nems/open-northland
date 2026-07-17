# Show the boot card before the app bundle executes

**Area:** app (entries, desktop shell) · **Origin:** feat/loading-screen, 2026-07-17 · **Priority:** P3

`view/boot-progress.ts` mounts the loading card from the two playable entries, so it can only appear
once `main.ts` runs — i.e. after the browser has fetched, parsed and executed the app bundle
(`packages/app/dist/assets/index-*.js`, ~900 kB / ~278 kB gzipped). Until then the page is the body's
bare `#1a1410`, which is the black screen the card exists to remove, just shorter. The desktop shell
loads the same bundle over `app://` (`packages/desktop/src/window.ts` only sets a `#1d1a15`
`backgroundColor`), so it shows the same gap.

The fix is static markup in `packages/app/index.html` that paints on the first frame, which
`mountBootProgress` then adopts instead of creating its own node.

**Investigate first:** the shell is shared by every entry, so static markup must not leak into the ones
that do not want it. `?shot` is the hard case — `scripts/shot.mjs` screenshots the `#game` element, and
an overlay covering it would corrupt the committed PNG. The menu (`entries/menu.ts`) sets
`canvas.hidden = true` and paints its own DOM immediately, so it must drop the card too. Decide whether
the markup is removed by the non-playable entries or opted into some other way before implementing.

## Scope

- Static card markup + styles in `index.html` (the inline `<style>` block, or the already-linked
  `entries/menu/menu.css`), visible on first paint.
- `mountBootProgress` adopts the existing node when present; every non-playable entry (`shot.ts`,
  `menu.ts`, the galleries) removes it on entry.
- Keep the card's look identical to the JS-built one (one source of truth for the styles).

## Verify

- `npm test` + `npm run check` + `npm run build`.
- `npm run shot` — the committed PNG must be unchanged (this is the regression the ticket exists to
  avoid).
- `npm run dev` → hard-reload `?map=<id>` with the network throttled: the card is up from the first
  paint. Human sign-off on the visual.
