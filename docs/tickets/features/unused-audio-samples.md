# Decide the sounds that still play nowhere

**Area:** audio, app · **Priority:** P3

The object ambience plays the landscape-group one-shots (birds, branch cracks, stones, sirens, ice
cracks) and a felled tree sounds `Woodcutter TreeFalling`. The sounds below have no trigger.

## Scope

### Samples with no sound-bank group

Each needs an ear decision: audition it, then choose a trigger or record why it stays unused. Paths are
relative to the exported sound root.

| Samples | Candidate use |
| --- | --- |
| `ambient/beach1`, `desert1`, `desert2`, `forest1`, `water1`, `water4` | Extra terrain beds. The data binds no pattern group to them, so the bed choice is authored |
| `ambient/ice_cracking4`-`6` | Further wavs for the `Ice cracks` object ambience |
| `ambient/owl_01`, `owl_02`, `mysticcircle` | No obvious trigger: there is no time of day, and no mystic circle object |
| `humantalk/talk_f10`, `talk_m10` | Further SocialTalk lines |
| `misc/teleporter` | No teleport in the game |
| `static/fisthit04`, `hammer03` | Further wavs for `Weapon Fist Hit` and `Hammer Wood` |

### Bank groups without an event

Bind only once the named input exists; do not change the sim just to play a sample.

| Group (`LogicSoundType`) | What a trigger needs |
| --- | --- |
| Kiss (47) | `settlersMarried` already rings the marriage jingle, and a binding holds one sound per event kind |
| Laugh Woman (49), Laugh Child (50) | An event: the woman's enjoy clip authors no cue, and the sim has no play or festivity event |
| Stereo Fire Loop (41) | The sim has no fire event; a home's holy fire is building state, so it needs a positioned loop layer |
| Ship Water, Creak, Sails Bell, Seagulls (51-54) | A ship moving or moored on screen; only the one-off `vehicleDocked` exists |
| Weresnake Get Hit (99), Wolve Get Hit (106) | `combatHit` names the target, but no table maps an animal tribe to its get-hit group |
| Sword and fist hits on wood and houses (83, 84, 87, 88, 94; 94 holds the only copy of `hit m 03`) | `combatHit` marks a blow on a building, but the weapon tables name none of these groups |
| Generic Snake (55), Generic WereWolf (63) | A call row: `animals/sounds.ini` lists none for these creatures |

## Verify

Test each new binding or bank join. Audition accepted samples in a scene that triggers them, and check
that an unrelated scene stays quiet.
