# Installer package contract

`packages/installer` is the first-run setup shared by the desktop and web shells: the setup page
(markup, styles, panels), the EN/PL catalog, content freshness, pipeline progress shaping, and the
CulturesNation mod install. The mod is the conversion's only input, and `requireModRoot` is the one
place that admits a conversion. The root [`AGENTS.md`](../../AGENTS.md) applies.

- Everything here must run in a plain browser page: no `node:` imports, no Electron, no shell
  globals. File access goes through `@open-northland/vfs`; archive bytes through `ZipSource`.
- Shells talk to the setup page only through `ShellApi` (`src/shell-api.ts`), an intersection of role
  interfaces a panel can take one of. Widen the interface rather than branching on a shell name.
- The transport for fetching the mod archive belongs to each shell (`ModZipDownload`); this package
  owns validation, extraction, and discovery. An install unpacks straight to its final path and
  marks the directory incomplete until it is done: staging elsewhere would cost the browser a full
  copy of the tree, so a failed reinstall costs the previous one instead.
- User-facing strings live in the i18n catalog in both languages; `*Html` entries are trusted
  markup, never interpolated input. Every failure a visitor can act on gets a string, including the
  ones that stop the page before the first phase renders.
