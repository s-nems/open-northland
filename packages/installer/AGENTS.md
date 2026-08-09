# Installer package contract

`packages/installer` is the first-run setup shared by the desktop and web shells: the setup page
(markup, styles, panels), the EN/PL catalog, content freshness, pipeline progress shaping, and the
CulturesNation mod install. The root [`AGENTS.md`](../../AGENTS.md) applies.

- Everything here must run in a plain browser page: no `node:` imports, no Electron, no shell
  globals. File access goes through `@open-northland/vfs`; archive bytes through `ZipSource`.
- Shells talk to the setup page only through `ShellApi` (`src/shell-api.ts`). Optional members
  double as capability flags (typed paths, install detection, folder drops); widen the interface
  rather than branching on a shell name.
- The transport for fetching the mod archive belongs to each shell (`ModZipDownload`); this package
  owns validation, extraction, staging, and discovery.
- User-facing strings live in the i18n catalog in both languages; `*Html` entries are trusted
  markup, never interpolated input.
