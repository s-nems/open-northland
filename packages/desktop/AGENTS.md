# Desktop package contract

`packages/desktop` serves the browser build through Electron and guides the user through local
content generation. The setup page, i18n catalog, and mod install live in
[`packages/installer`](../installer/AGENTS.md); this package supplies their `ShellApi` over IPC
plus everything Electron-specific. The root [`AGENTS.md`](../../AGENTS.md) applies.

## Boundaries

- The web app stays shell-agnostic and never imports desktop code.
- Serve `packages/app/dist` and generated content through `app://` using
  `@open-northland/content-resolver`, the same route table as Vite.
- Run the CPU-heavy asset pipeline in a `utilityProcess`, not on the Electron main event loop.
- Keep the renderer IPC surface narrow, typed, and validated. Do not expose raw file-system access.
- Store generated content and configuration in the selected data root, never the install directory.

Data-root precedence is defined in `src/paths.ts`: explicit `OPEN_NORTHLAND_DATA_DIR`, portable mode,
development root, then Electron `userData`. Do not duplicate this choice elsewhere.

The CulturesNation mod is the pipeline's only input. It may come from a downloaded copy in the data
root or a user-selected folder, a game folder that carries it in place included. Never modify the
user's folders.

Content freshness comes from `pipeline-manifest.json` and the bundled current manifest. A schema
mismatch blocks play; an older content revision asks for regeneration.

## Build and verification

Root commands are documented in [`docs/DEVELOPMENT.md`](../../docs/DEVELOPMENT.md). Unit-test path,
configuration, protocol, and download logic without Electron where possible; setup, archive, and
content-state logic is tested in `packages/installer`.

Packaging and the full first-run flow need platform checks. Verify the setup window, cancellation,
pipeline progress, generated-content boot, and native menu on the affected operating system. Final
window and installer appearance need human review.
