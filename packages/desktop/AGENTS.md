# Desktop package contract

`packages/desktop` serves the browser build through Electron and guides the user through local
content generation. The root [`AGENTS.md`](../../AGENTS.md) applies.

## Boundaries

- The web app stays shell-agnostic and never imports desktop code.
- Serve `packages/app/dist` and generated content through `app://` using
  `@open-northland/content-resolver`, the same route table as Vite.
- Run the CPU-heavy asset pipeline in a `utilityProcess`, not on the Electron main event loop.
- Keep the renderer IPC surface narrow, typed, and validated. Do not expose raw file-system access.
- Store generated content and configuration in the selected data root, never the install directory.

Data-root precedence is defined in `src/paths.ts`: explicit `OPEN_NORTHLAND_DATA_DIR`, portable mode,
development root, then Electron `userData`. Do not duplicate this choice elsewhere.

The CulturesNation mod is required pipeline input. It may come from the game folder, a downloaded
copy in the data root, or a user-selected folder. Never modify the owned game installation.

Content freshness comes from `pipeline-manifest.json` and the bundled current manifest. A schema
mismatch blocks play; an older content revision asks for regeneration.

## Build and verification

Root commands are documented in [`docs/DEVELOPMENT.md`](../../docs/DEVELOPMENT.md). Unit-test path,
configuration, protocol, setup, download, archive, and content-state logic without Electron where
possible.

Packaging and the full first-run flow need platform checks. Verify the setup window, cancellation,
pipeline progress, generated-content boot, and native menu on the affected operating system. Final
window and installer appearance need human review.
