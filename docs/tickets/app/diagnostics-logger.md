# Add a channel/level diagnostics logger with an in-memory ring buffer

**Area:** app · **Origin:** diagnostics research discussion 2026-07-16 · **Priority:** P2

The app has no logging abstraction: ~16 raw `console.warn`/`console.info` calls, all
content-fallback notices (`entries/map.ts`, `slice/map-loader.ts`, `content/*.ts`, …); render/audio
have zero. Nothing captures what happened before a failure, so a tester report today is "it broke"
with no artifact. Research across OpenRA (`Log.AddChannel` → per-channel files), Spring/Recoil
(`ILog` sections+levels → one `infolog.txt`), and 0 A.D. converged on one pattern: **a single
logging backbone with named channels and severity levels**, through which ordinary logs, crash
reports, and slow-path perf reports all flow — that unification is what makes "attach your log" a
one-step bug-report ritual. The browser translation (no filesystem): an in-memory structured ring
buffer plus a console sink, downloadable on demand.

This ticket is the backbone; the crash overlay + downloadable bundle build on it
(`docs/tickets/app/crash-capture-diagnostics-bundle.md`).

Source basis: none needed — self-consistency tooling, not a mechanic.

## Scope

1. `packages/app/src/diag/` — a small logger module:
   - `log(channel, level, message, data?)` with levels `debug | info | warn | error` and
     string-named channels (start with `content`, `boot`, `crash`, `perf`; open set, no registry
     ceremony needed).
   - Two sinks: the browser console (dev-readable, level→console method) and a bounded ring buffer
     of plain JSON-serializable entries `{timeMs, channel, level, message, data?}` (capacity a few
     thousand; oldest dropped). The ring is the artifact the future bundle serializes.
   - A minimum-level / per-channel filter knob (default: everything to the ring, `info`+ to the
     console) so a chatty channel can't drown the console.
2. **Environment header**, written once at boot into the ring (channel `boot`) — the part of every
   studied engine's log that makes reports actionable: app version/commit if available, URL +
   params, UA, WebGL renderer string, screen size, whether decoded `content/` is present, and (once
   a game starts) seed, map/scene id, content version.
3. Migrate the existing `console.*` call sites in `packages/app/src` to the logger (channel
   `content` for the fallback notices). `tools/asset-pipeline` CLI output is out of scope.
4. Stays app-local. `packages/sim` stays log-free (purity — sim facts enter the log at the app
   boundary); promote to a shared package only when render/audio become a real second caller
   (dedupe-at-second-caller rule).

## Verify

- Unit tests: ring bound + drop-oldest, entry serializability (`JSON.stringify` round-trip),
  level/channel filtering.
- `npm test`, `npm run check`, `npm run build`.
- Manual: boot `?map=` without `content/` — fallback notices appear in the console via the logger
  and in the ring; the boot header is the first entries.
