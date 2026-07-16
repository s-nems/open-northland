# Play the marriage and birth jingles off the family events

**Area:** audio + app · **Origin:** marriage/children feature, 2026-07-16 · **Priority:** P3

The sim now emits `settlersMarried` (the wedding kiss completing) and `settlerBorn` fires for a
family birth, but no jingle plays for either. The app's audio layer already plays non-spatial
life-event jingles off snapshot events (`packages/app/src/content/audio.ts`).

Source basis: the original scores both as music jingles — `logicdefines.inc`
`DM_MUSIC_TYPE_JINGLE_MARRIAGE = 22` and `DM_MUSIC_TYPE_JINGLE_BIRTH = 23` (alongside death 25 and
house-built 26). Investigate first: locate the decoded jingle tracks in the extracted sound bank
(`content/` sounds) and their ids/names; if the bank does not carry them, extend the pipeline's
sound extraction before wiring.

Scope: bind `settlersMarried` → the marriage jingle and family `settlerBorn` → the birth jingle in
the app audio bindings; audition in `?sounds` and in `?scene=family`.

Verify: human ear in `?scene=family` (agents cannot self-sign audio).
