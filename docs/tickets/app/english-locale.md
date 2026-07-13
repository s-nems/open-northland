# Add an English clean-room catalog and a locale switch seam

**Area:** app (i18n) · **Origin:** gap-analysis audit 2026-07-13 · **Priority:** P3

The app's clean-room UI strings are Polish-only: `packages/app/src/i18n/index.ts` declares
`type Locale = 'pol'` with a single-entry table, and `pl.ts` (59 lines: `profession` / `category` /
`ui` message groups) is the only catalog — its own doc comment says "every other locale is a sibling
file with the same shape". Meanwhile the **decoded original** GUI string tables already ship both
languages (`content/gui/strings/<lang>.json`, "eng + pol extracted" — docs/SOURCES.md ~line 513) and
are selected separately via `?lang=` / `DEFAULT_UI_LANG = 'pol'` in
`packages/app/src/content/gui-gfx.ts`. So an English-speaking player gets English decoded windows
but Polish clean-room labels — the two locale knobs are disconnected.

Source basis: clean-room translations are authored, not extracted; the decoded `eng` string tables
are available as a terminology reference for original UI vocabulary. Small ticket.

## Scope

1. Add `packages/app/src/i18n/en.ts` with the identical key set (the shared shape makes a missing
   key a compile error — keep it that way; consider deriving `Messages` from a shared shape so both
   catalogs are checked against each other).
2. Widen `Locale` to `'pol' | 'eng'` (match the decoded tables' language codes so one value drives
   both layers) and register the table.
3. One locale switch seam: the existing `?lang=` param (`view/game-view.ts`) should select BOTH the
   decoded string tables and the clean-room catalog — thread the value into the i18n default instead
   of the two layers defaulting independently. Keep `pol` the default (matches `DEFAULT_UI_LANG`).
4. Out of scope: a settings-UI language picker (belongs to an options window —
   docs/tickets/app/hud-missing-windows.md covers that surface).

## Verify

- Type-level: removing a key from either catalog fails `npm run check` (compile-time parity).
- Browser: `?lang=eng` shows English profession/category/ui labels AND English decoded window
  strings; no `?lang` still shows Polish everywhere — **user's eyes**, quick pass.
- `npm test`, `npm run check`, `npm run build`.
