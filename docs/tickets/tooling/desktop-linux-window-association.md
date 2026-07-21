# Linux window association: set desktopName + syncDesktopName

**Area:** desktop · **Priority:** P3

electron-builder warns during the Linux AppImage build that `desktopName` is not set, so desktop
environments may not link the running window to the generated `.desktop` entry (wrong/missing
taskbar icon and grouping under some DEs).

Fix per the electron-builder docs
(https://www.electron.build/linux#window-association-desktopname--syncdesktopname):

- set `desktopName` in `packages/desktop/package.json`
- set `linux.syncDesktopName: true` in `packages/desktop/electron-builder.yml`

Verification needs a Linux desktop session (or at least confirming the packaged `.desktop` entry and
WM_CLASS match); the build-time warning disappearing is the headless signal.
