# Derive spatial-event location from the event's own `at`, not a hand-maintained kind list

**Area:** audio · **Origin:** /refactor-cleanup audio branch (refactor/audio-cleanup), 2026-07-12

`packages/audio/src/data/director/events.ts` decides whether a sim event is located by an explicit
half-cell `at` node or by its emitter entity via `isAtLocatedEvent`, which **enumerates the eight
event kinds by hand**:

```ts
function isAtLocatedEvent(ev): ev is Extract<SimEvent, { at: { x: number; y: number } }> {
  return ev.kind === 'buildingPlaced' || ev.kind === 'boatPlaced' || ev.kind === 'resourceFelled' ||
    ev.kind === 'resourceDepleted' || ev.kind === 'projectileLaunched' || ev.kind === 'projectileHit' ||
    ev.kind === 'combatHit' || ev.kind === 'combatSwing';
}
```

This is a fragile invariant: `SimEvent` (`packages/sim/src/core/events.ts`) already carries `at` on
every positioned kind, and NEW positioned kinds (`resourceMined`, `berryForaged`) that have an `at`
but no default binding today would locate by `ev.entity` (→ `undefined` → silent) the moment someone
binds them a sound. The list and the union can drift silently.

The obvious fix — test `'at' in ev` at runtime instead of listing kinds — is **not behavior-preserving**,
which is why it was deferred out of the cleanup refactor:

- `settlerDied` carries an OPTIONAL `at` (`at?`). It is a non-spatial jingle, so it never reaches the
  spatial branch — but `eventKey(ev)` also calls `isAtLocatedEvent`, so switching to `'at' in ev`
  would flip a `settlerDied` WITH `at` from an entity-keyed debounce key (`settlerDied:<entity>`) to
  a node-keyed one (`settlerDied:<x>,<y>`). That changes the one-shot cooldown/debounce identity.

## Scope

- In `events.ts`, replace the enumerated `isAtLocatedEvent` with a check on the event's own shape
  (`'at' in ev && ev.at !== undefined`), keeping the `ev is Extract<SimEvent, { at: … }>` guard.
- Decide the `settlerDied` debounce-key semantics deliberately (it is a jingle; node-keying is
  arguably more correct for dedup, but confirm it against `WebAudioEngine`'s `ONE_SHOT_COOLDOWN_S`
  debounce and the jingle path). Document the chosen key basis in a comment.
- Confirm no other event kind's `eventKey`/`eventEntity` result changes; `resourceMined`/`berryForaged`
  gaining `at`-location is the intended robustness win.

## Verify

- `npm test` (audio) — extend `packages/audio/test/director.test.ts` with a case that a positioned
  kind NOT in the old list (e.g. a bound `resourceMined`) now spatialises, and that `settlerDied`'s
  jingle key is whatever the decision above fixes.
- `npm run check`, `npm run build`.
- Source basis: `SimEvent` union in `packages/sim/src/core/events.ts` (which kinds carry `at`, and
  that `settlerDied.at` is optional).
