# Rewrite the repository framing for a private project whose builds carry the content

**Area:** tooling · **Focus:** docs · **Priority:** P3

`README.md`, `docs/LEGAL.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md` and the "Repository
and legal boundary" section of `AGENTS.md` describe a public project whose players convert their
own game data. After the preceding tickets the repository is private, the original content is a
temporary stand-in while the project's own assets are made, and every build artifact contains the
decoded content. A new reader following those documents would look for an installer that no longer
exists and would believe the artifacts may be published.

## Scope

- Rewrite the affected sections to the current contract: private repository; original and decoded
  content are never committed (`npm run check:assets` keeps enforcing that); the archive at
  `game.opennorthland.org/cnmod.zip` is a build input; installers and the web image contain decoded
  content and are distributed only through the private repository's releases and its private GHCR
  package; the goal is replacing the original assets with the project's own.
- Remove player-facing install and first-run instructions and every mention of the setup pages,
  OPFS, the service worker, `/play/` and `?setup`. `docs/SOURCES.md` stays as the evidence policy
  for format and behavior research.
- Leave `LICENSE` and the `license` fields untouched; changing the license is not this ticket's
  decision.

## Verify

`npm run check:docs`. `grep -rn -i "installer\|setup page\|OPFS\|service worker\|/play/\|?setup" README.md docs/*.md AGENTS.md packages/*/AGENTS.md tools/*/AGENTS.md` finds nothing. A human reads
`README.md`, `docs/LEGAL.md` and the boundary section of `AGENTS.md` once, start to finish.
