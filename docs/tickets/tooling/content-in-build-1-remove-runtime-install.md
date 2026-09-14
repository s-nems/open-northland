# Remove the runtime content install and serve the converted content from the build

**Area:** installer, web, desktop, app, vfs · **Focus:** content delivery · **Priority:** P2

The repository is private and its builds are handed only to people who may hold the original data,
so the converted content ships inside the desktop installers and the web image instead of being
produced on the player's machine. Everything that exists to download the CulturesNation archive,
run the asset pipeline at runtime, and gate the game behind that flow is dead weight:
`packages/installer` (both setup pages, shell i18n, mod download and extraction, content-state
classification), `packages/web/src` (service worker, OPFS layout, pipeline worker, Web Locks,
pickers), and about half of `packages/desktop` (`pipeline-host.ts`, `pipeline-child.ts`,
`mod-install/`, `setup/`, `shell-state.ts`, `shell-locale.ts`, `config.ts`, the mod and pipeline
IPC in `ipc.ts`/`ipc-handlers.ts`). The app must not know which host runs it.

End state of this ticket series: the pipeline writes `content/`, the app builds `packages/app/dist`,
and every host (Vite, nginx, Electron) serves both trees statically from one origin. This ticket
removes the runtime install; the content layout, the CI content job, and the documentation
framing are the three tickets that follow.

## Scope

- Delete `packages/installer` and `packages/web` whole (Dockerfile, `nginx.conf`, bundle, serve,
  smoke and contract scripts included; the image is rebuilt from scratch in a later ticket). Drop
  their root `tsconfig.json` references, root scripts (`web:site`, `web:serve`, `web:image`), the
  `npm run web:site` step in `.github/workflows/ci.yml`, and the `image` job in
  `.github/workflows/release.yml` together with the web-image lines `publish` prints and retags.
- Delete the OPFS adapter: `packages/vfs/src/opfs.ts`, its `./opfs` export, and
  `test/support/fake-opfs.ts` with its adapter-suite entry. The package otherwise stays.
- Desktop becomes a game window plus the `app://` protocol. Delete the files listed above, the
  setup host (`SETUP_HOST`, `SETUP_URL`, the setup renderer bundle and copies in
  `scripts/bundle.mjs`), the "Reinstall game content" menu item, `gameUrlForLocale` and
  `watchGameLocale`; use Electron's default application menu. The window always loads `GAME_URL`.
  The content root is `resources/content` when `app.isPackaged`, otherwise the checkout's `content/`
  (honour `ON_CONTENT_DIR` like `packages/app/vite.config.ts` does). Add
  `extraResources: { from: ../../content, to: content }` to `electron-builder.yml`.
- Saves use the browser store on every host. Delete `save-files.ts`, `preload.ts`, `ipc.ts`,
  `ipc-handlers.ts` and the frame guard in desktop; delete `store-desktop.ts`, `file-access.ts`, the
  `window.desktop` global declarations and the desktop branch of `openSaveStore` in
  `packages/app/src/view/runtime/save-load/`. The window opens without a preload script.
- Remove `installer` and `web` from `scripts/check-docs.mjs` `ticketAreas` and from the area list in
  `docs/tickets/README.md`. Update `AGENTS.md`'s package-contract list, `docs/ARCHITECTURE.md`,
  `docs/DEVELOPMENT.md`, `docs/LEGAL.md` and `README.md` only where they name the deleted packages
  or the setup flow; rewrite `packages/desktop/AGENTS.md` to the thin host.
- Delete `docs/tickets/tooling/installer-mod-install-i18n.md`,
  `docs/tickets/tooling/web-shell-recovery-paths.md` and
  `docs/tickets/tooling/zip-source-file-handle.md`; reword the installer references in
  `docs/tickets/pipeline/skip-report-completeness.md`.
- Non-goals: the content directory layout and `packages/content-resolver` (next ticket), building
  content in CI and the web image (third ticket), the private-project rewrite of the docs (fourth).

## Verify

`npm run check`, `npm run check:docs`, `npm run typecheck`, `npm run build`, and Vitest for
`packages/desktop`, `packages/vfs` and `packages/app`. `grep -rn "window.desktop\|@open-northland/installer\|vfs/opfs" packages tools --include=*.ts` finds nothing.
On macOS with a converted `content/` in the checkout, `npm run desktop`: the menu lists maps with
minimaps, a map starts, a game saves and loads, and the save is still listed after quitting and
relaunching. `npm run desktop:dist` produces an app whose `Resources/content/ir.json` exists.
