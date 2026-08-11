# Let the zip reader hold one handle instead of reopening per read

**Area:** installer, vfs · **Priority:** P3

`ZipSource.read` in `packages/installer/src/mod-install/zip.ts` calls `Vfs.readFileSlice` once per
read, and `nodeVfs.readFileSlice` opens and closes the archive around each one. Unpacking CnMod is
about 46k members with two reads each, so a desktop install pays roughly 92k opens of a 600 MB file.
Measured on macOS with a warm cache, 20k 64-byte slice reads take 1595 ms reopening against 268 ms on
a shared handle, which puts the overhead at about 6 s per install before any antivirus filter driver,
and Windows is where that driver hooks every open.

The browser path is unaffected: `fileMapVfs` and `opfsVfs` resolve a handle per read anyway.

## Scope

- Give `ZipSource` an optional lifetime (open/close, or a `vfsZipSource` that holds a handle) so one
  extraction opens the archive once. The interface is already the seam between the installer and the
  file system, so this need not touch `Vfs`.
- If instead `Vfs` grows an open-file concept, it must have two real platform implementations and a
  caller, per `packages/vfs/AGENTS.md`.

## Verify

`npm test`, `npm run check`. Time a real desktop mod install before and after against the owned
archive, and report both numbers; the extraction must produce an identical tree.
