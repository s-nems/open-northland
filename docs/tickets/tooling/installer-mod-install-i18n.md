# Localize the installer's mod-install / pipeline diagnostic strings

**Area:** desktop · **Priority:** P3

The first-run installer's UI, native menu, dialogs, and IPC-handler errors are now localized
(EN/PL) through `packages/desktop/src/i18n/`. Deliberately left in English as a named boundary: the
**deep diagnostic strings** thrown/emitted from the mod installer and streamed from the pipeline,
which the setup page surfaces verbatim. The most user-visible is the CnMod hash-mismatch warning,
shown in the mod panel's note line.

Still English:

- `packages/desktop/src/mod-install/install.ts` — the sha256 mismatch `mod-warning`
  ("downloaded archive differs from the verified CnMod 1.3.1 …") and "the downloaded archive
  contained no files".
- `packages/desktop/src/mod-install/extract.ts` — "skipped unsafe zip member …" warning.
- `packages/desktop/src/mod-install/download.ts` — "empty response body", "Google Drive kept
  answering with a page instead of the file".
- Pipeline `log`/`error` lines shown in the run phase's log tail and the failure log (raw
  conversion output — likely stays English as build diagnostics).

## Scope

- Route the mod-install messages through the installer catalog. They are generated in the main
  process below the IPC layer, so either thread a translator/`messages()` call down into
  `mod-install/*`, or have those layers emit a small discriminated `code` + params and translate at
  the `forwardModEvent` / handler boundary (preferred — keeps `mod-install/` string-free and pure).
- Decide explicitly whether raw pipeline log/error lines are worth translating; if not, say so in
  the code comment so the boundary is intentional, not forgotten.
- Add the new keys to both `en.ts` and `pl.ts` (Polish authored, matching the installer's existing
  EN/PL pair).

## Verify

`npm test`, `npm run check`, `npm run build`. Manual: trigger a mod-panel warning path (e.g. point
"I already have it…" at a folder without `DataCnmd/`) and confirm the message follows the language.
