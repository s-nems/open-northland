# Give the desktop app an original icon

**Area:** desktop/tooling · **Origin:** desktop-packaging branch 2026-07-16 · **Priority:** P3
**Needs user:** approving (or supplying) the design.

electron-builder currently falls back to the default Electron icon in the installers built by
`.github/workflows/desktop-build.yml`, the taskbar/dock, and the window title bar.

## Scope

- An original OpenNorthland design — legal: no original game art, names, or logos (docs/LEGAL.md).
- One 512×512 PNG in `packages/desktop/build/icon.png`; electron-builder generates the platform
  formats (ico/icns) from it, no per-platform files needed.

## Verify

A dispatched desktop build's artifacts show the icon: Windows setup/portable exe, macOS dmg + app
bundle, Linux AppImage; the running window uses it too.
