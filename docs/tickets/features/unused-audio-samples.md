# Review and use the remaining audio samples

**Area:** audio, app · **Priority:** P3

The supplied content includes 17 distinct WAV samples that are exported but have no sound-bank
entry or explicit app/audio call site. Review them for useful additions to the game; filenames alone
do not establish their intended trigger or whether they suit the current presentation.

| Group | Samples |
| --- | --- |
| Ambient | `beach1`, `desert1`, `desert2`, `forest1`, `ice_cracking4`, `ice_cracking5`, `ice_cracking6`, `mysticcircle`, `owl_01`, `owl_02`, `water1`, `water4` |
| Human talk | `talk_f10`, `talk_m10` |
| Miscellaneous | `teleporter` |
| Impacts and work | `fisthit04`, `hammer03` |

Paths are relative to the exported sound root: `ambient/`, `humantalk/`, `misc/` and `static/`
respectively, with the `.wav` extension.

## Scope

- Audition each sample and record a concrete use or a reason to leave it unused.
- For accepted samples, choose appropriate biome, event or action triggers and route them through
  the existing audio bank, volume categories, spatial attenuation and concurrency limits.
- Tune repetition and cooldowns; avoid constant ambience, overlapping voice spam or duplicate hits.
- Label newly chosen triggers and timing as authored choices where the supplied data gives no rule.

## Verify

Test trigger selection, playback limits and mute/volume behavior. Audition accepted samples in an
appropriate gameplay scene; ensure unrelated scenes stay quiet. Do not change simulation behavior
merely to make an audio sample play.
