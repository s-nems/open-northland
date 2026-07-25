# Extract the animal ambient-sound binding and play it

**Area:** pipeline + audio · **Priority:** P3

`Data/engine2d/inis/animals/sounds.ini` (plaintext under a CIF header line, like `animaltypes.ini`)
is not referenced anywhere in `tools/asset-pipeline/src/`. It maps each animal tribe to its ambient
sound group and cadence: `logictribetype`, `enginesoundgroup` (e.g. tribe 8 → "Bear Sounds",
20 → "Wolf Sounds"), `mincount`, `probability`. The group WAVs themselves are already decoded into
the IR `sounds.staticGroups`, so only the tribe → group join (and its cadence params) is lost.

## Scope

- Extract the `sounds.ini` records into an IR lane (tribe id, group name, mincount, probability).
- Audio side: play a species' ambient group near visible animals of that tribe, honoring
  `mincount`/`probability` semantics (verify their meaning against the running original first;
  screen-bounded per the audio contract).

## Verify

- `npm run test:pipeline` for the extraction; an audio unit test for the join.
- In `?map=specjalna_mosty_na_rzece` (or `?scene=wildlife`), animals near the camera grunt/howl:
  **user's ears**.
