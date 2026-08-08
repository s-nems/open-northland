# Bind the marriage jingle

**Area:** audio · **Priority:** P3

`settlersMarried` is emitted with the kiss node (`packages/sim/src/core/events.ts`), and the decoded
bank carries the marriage jingle (`SoundFXJingle` `MusicType` 22, `jingles_marriage.wav`), but no
binding exists - a wedding is silent today.

## Scope

- Add a `settlersMarried` entry to `defaultBindings` (`packages/audio/src/data/bindings.ts`) with
  `musicType` 22 and `screenGated: true`.
- The event carries `a`/`b` spouses rather than an `entity` field, so a `localPlayerOnly` owner
  fallback cannot locate an owner; gate by the `at` node only, or extend the event with the couple's
  `player` first.

## Verify

- Director test: an on-screen wedding rings the jingle, an off-screen one stays silent.
- Listening pass in game on a map where a couple marries.
