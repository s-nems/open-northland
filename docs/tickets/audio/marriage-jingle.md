# Bind the marriage jingle

Priority: P3. Area: audio.

`settlersMarried` is emitted with the kiss node (`packages/sim/src/core/events.ts`), and the decoded
bank carries the marriage jingle (`SoundFXJingle` `MusicType` 22, `jingles_marriage.wav`), but no
binding exists - a wedding is silent today.

Scope: add a `settlersMarried` entry to `defaultBindings` (`packages/audio/src/data/bindings.ts`)
with `musicType` 22, `screenGated: true`. Note the event carries `a`/`b` spouses rather than an
`entity` field, so a `localPlayerOnly` owner fallback cannot locate an owner; gate by the `at` node
only, or extend the event with the couple's `player` first.

Verify: director test (on-screen wedding rings, off-screen silent) plus a listening pass in game.
