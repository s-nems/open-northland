# Make the .cif string-table codepage a per-language parameter

**Area:** pipeline · **Origin:** source-basis review of the byte-preserving-latin1 fix, 2026-07-16 ·
**Priority:** P3

`tools/asset-pipeline/src/decoders/ini/string-tables.ts` — `latin1ToCp1250` hardcodes
`new TextDecoder('windows-1250')` for every `.cif` display string it re-decodes. That is correct for
the current deliverable only because every display-text consumer is gated to `pol` (CP1250) and `eng`
(pure ASCII, so the CP1250 re-decode is a no-op):

- `stages/gui/strings.ts` `STRING_LANGS = ['eng', 'pol']`
- `stages/maps/meta.ts` (map-folder `strings.cif`) — `pol`/`eng`
- `stages/goods/names.ts` (localized good names) — `pol`/`eng`

It is a latent hazard, not one introduced by this diff: the fonts stage already ships a Cyrillic
`rus/` variant (`stages/fonts.ts` `FONT_VARIANTS`), and adding `rus` (or `ger`, which is CP1252) to
any of those three language lists would silently mojibake the text — the bytes would be preserved
correctly by `decodeLatin1` but then forced through the wrong `windows-1250` re-decode. `rus` is
CP1251 (Cyrillic); `ger` is CP1252.

## Scope

- Thread the target codepage through the display-string seam: give `latin1ToCp1250` (and
  `decodeCifStringTable`) a codepage/label argument instead of the hardcoded `windows-1250`, defaulting
  to `windows-1250` so current callers are unchanged.
- Map each language to its codepage at the stage layer (`pol`→`windows-1250`, `eng`→ASCII/no-op or
  `windows-1250` which decodes ASCII 1:1, `rus`→`windows-1251`, `ger`→`windows-1252`) rather than
  assuming one global codepage. A small `lang → codepage` table beside the language lists is the
  natural home.
- The readable-`.ini` seam (`decodeIni`, `grammar.ts`) has the same `windows-1250` assumption — decide
  whether it needs the same parameter or stays CP1250-only (the readable `.ini` files that ship are the
  Central-European set), and say which in the change.

Do this before wiring any non-Central-European language into a display-string list.

## Verify

`npm test` (add a table-driven test that a `windows-1251` byte decodes to the right Cyrillic letter
through the seam), `npm run check`, `npm run build`. If a real non-`pol` language is enabled,
regenerate `content/` and spot-check that language's `strings/<lang>.json` against the original.

## Source basis

CP1250 (Central European), CP1251 (Cyrillic), CP1252 (Western European) are the Windows codepages the
original's per-language text files are authored in; the codepage belongs to the consuming language, not
the byte-preserving decoder (the `.fnt` fonts are already byte-indexed per this principle — see
`stages/fonts.ts` header). Confirm each language's actual codepage against its `Data/text/<lang>/`
files before enabling it.
