# P3 — Move the mod download/extract off the Electron main process

`installCnMod` (`packages/desktop/src/mod-install.ts`) runs on the main process: the 594 MB
download is async streaming (fine), but the zip extraction inflates/writes ~43k members in a loop
(`extractModZip`), and deflated members run `zlib.inflateRaw` on the main loop. The shipped CnMod
1.3.1 zip is method-store throughout, so today the loop is I/O-bound and the UI stays responsive —
a future deflated archive would stutter the window.

The pipeline already has the pattern to copy: `pipeline-host.ts` forks the bundled
`pipeline-child.cjs` as a `utilityProcess` and streams `PipelineEvent`s (per
`packages/desktop/AGENTS.md`, CPU-bound work never rides the main-process event loop).

Scope: fork a `mod-install-child` the same way (bundle it in `scripts/bundle.mjs`), stream the
existing `ModInstallEvent`s over the port, and keep `AbortController` cancellation working across
the process boundary (kill the child like `PipelineHost.stop`). The IPC surface toward the setup
renderer (`downloadMod`/`cancelModDownload`/`modEvent` in `src/ipc.ts`) stays unchanged.

Verify: `packages/desktop/test/mod-install.test.ts` still passes (module logic is process-agnostic);
a manual wizard run downloads + unpacks with a live progress bar and a working Cancel.
