# Stable mirror or hash registry for the CulturesNation mod download

**Area:** desktop · **Priority:** P3

The desktop setup wizard downloads the CnMod archive via
`packages/desktop/src/mod-install/download.ts`: culturesnation.pl's `serwerdownload.php` link
302-redirects to a Google Drive file page, and the module then plays Drive's large-file confirm-form
dance (verified live 2026-07-16; `CnMod 1.3.1.zip`, 594 MB, sha256 pinned in `CNMOD_KNOWN_SHA256`,
`src/mod-install/install.ts`).

Two fragilities are accepted for now (user decision, 2026-07-16: ship the Drive flow, revisit when
it breaks):

- Google Drive can answer "quota exceeded" for a popular file, or change the confirm-form markup.
  The wizard then degrades to the manual "I already have it…" picker, which always works.
- A new mod release changes the archive hash; the wizard only warns ("unverified version") because
  a newer release must not brick the installer, but the pinned hash then guards nothing until a
  code change.

Scope when picked up (the CulturesNation team collaborates with the project, so coordination is
available):

1. Ask the CN team for a stable direct-download URL (no Drive interstitial), or permission to
   mirror the archive (GitHub Releases fits: 594 MB < the 2 GB asset limit).
2. Point `CNMOD_DOWNLOAD_URL` at the stable source; keep the Drive hop chain as fallback (the
   downloader already short-circuits when any hop answers with the file directly).
3. Replace the single pinned hash with a small known-versions table (version → sha256) so a mod
   update means adding a row, not editing a constant buried in the downloader.

Verify: unit tests in `packages/desktop/test/mod-install/` keep passing; one live download
against the new source yields a hash from the table.
