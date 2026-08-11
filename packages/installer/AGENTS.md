# Installer package contract

`packages/installer` is the first-run setup shared by the desktop and web shells: the setup page
(markup, styles, panels), browser folder acquisition, the EN/PL catalog, content freshness, pipeline
progress shaping, and the CulturesNation mod install. The root [`AGENTS.md`](../../AGENTS.md)
applies.

- Everything here must run in a plain browser page: no `node:` imports, no Electron, no shell
  globals. File access goes through `@open-northland/vfs`; archive bytes through `ZipSource`.
- Shells talk to the setup page only through `ShellApi` (`src/shell-api.ts`), an intersection of role
  interfaces a panel can take one of. Optional members double as capability flags (typed paths,
  install detection, adopting a picked folder); widen the interface rather than branching on a shell
  name.
- The seam carries data, never DOM events: the page owns the drop and hands a shell a
  `PickedFolder`, so a shell behind IPC can implement the same contract.
- The transport for fetching the mod archive belongs to each shell (`ModZipDownload`); this package
  owns validation, extraction, and discovery. An install unpacks straight to its final path and
  marks the directory incomplete until it is done: staging elsewhere would cost the browser a full
  copy of the tree, so a failed reinstall costs the previous one instead.
- User-facing strings live in the i18n catalog in both languages; `*Html` entries are trusted
  markup, never interpolated input. Every failure a visitor can act on gets a string, including the
  ones that stop the page before the first phase renders.
