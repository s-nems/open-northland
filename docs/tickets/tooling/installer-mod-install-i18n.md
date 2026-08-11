# Localize the installer's mod-install / pipeline diagnostic strings

**Area:** installer, desktop, web · **Priority:** P3

The first-run installer's UI, native menu, dialogs, and shell-side errors are localized (EN/PL)
through `packages/installer/src/i18n/`. Deliberately left in English as a named boundary: the **deep
diagnostic strings** thrown or emitted below the shell seam and streamed from the pipeline, which the
setup page surfaces verbatim. The most user-visible is the CnMod hash-mismatch warning, shown in the
mod panel's note line.

Still English:

- `packages/installer/src/mod-install/install.ts` - the sha256 mismatch `mod-warning` ("downloaded
  archive differs from the verified CnMod 1.3.1 …"), "the downloaded archive contained no files", and
  "no DataCnmd/ found inside the downloaded archive", which is what a rezipped or wrong archive
  produces on both shells.
- `packages/installer/src/mod-install/extract.ts` - "skipped unsafe zip member …" warning.
- `packages/desktop/src/mod-install/download.ts` - "empty response body", "Google Drive kept
  answering with a page instead of the file".
- `packages/web/src/mod-transport.ts` - "mod download: empty response body" and "mod download:
  unusable path …". The 404 case is already localized (`errors.modArchiveUnavailable`).
- Pipeline `log`/`error` lines shown in the run phase's log tail and the failure log (raw
  conversion output - likely stays English as build diagnostics).

## Scope

- Route the mod-install messages through the installer catalog. `mod-install/*` is shared and runs
  below the IPC layer on desktop, so have those layers emit a small discriminated `code` + params and
  translate at the `forwardModEvent` / handler boundary, keeping `mod-install/` string-free and pure.
- Decide explicitly whether raw pipeline log/error lines are worth translating; if not, say so in
  the code comment so the boundary is intentional, not forgotten.
- Add the new keys to both `en.ts` and `pl.ts` (Polish authored, matching the installer's existing
  EN/PL pair).

## Verify

`npm test`, `npm run check`, `npm run build`. Manual, per shell: on desktop point "I already have
it…" at a folder without `DataCnmd/`; on the web point it at a zip that carries no `DataCnmd/`.
Confirm the message follows the selected language in both.
