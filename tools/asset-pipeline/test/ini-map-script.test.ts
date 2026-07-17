import { describe, expect, it } from 'vitest';
import type { CifLine } from '../src/decoders/cif.js';
import { cifLinesToSections, extractMapScript, parseIniSections } from '../src/decoders/ini.js';

const SRC = { file: 'some_map/player.inc+mission.inc' } as const;

describe('extractMapScript', () => {
  // Mirrors the real plaintext grammar (CnModMaps player.inc/mission.inc): macro tokens in mixed
  // case, tab separators, junk decoration lines, and one MissionData section per trigger.
  const plaintext = `
[playerdata]
player 0 #PLAYER_TYPE_HUMAN #TRIBE_TYPE_HUMAN_VIKING #PLAYER_COLOR_ID_ORANGE
player 1 #PLAYER_TYPE_human\t#TRIBE_TYPE_HUMAN_frank #PLAYER_COLOR_ID_green
player 2 #PLAYER_TYPE_AI #TRIBE_TYPE_HUMAN_SARACEN #PLAYER_COLOR_ID_BLACK
diplomacy 0 1 #DIPLOMACY_STATE_FRIEND
diplomacy 0 2 #DIPLOMACY_STATE_ENEMY
diplomacy 1 2 #DIPLOMACY_STATE_NEUTRAL
noseenfirstmessage 0 5

[playermisc]
nametribe 0 50
nametribeshort 0 60
playerneverdies 2
relationnotchangeable 0 2

[MissionData]
debuginfo "StartText"
description 300
active 1
visible 0
goal "True"
result "PlayCutscene" 500 1
result "ExploreArea" 8 0 0 0

[MissionData]
debuginfo "Victory"
description -1
active 0
successfullif 2
goal "HumansDied" 100
goal "PlayerSeen" 0 2
result "MissionWon" 0
esult "AddTributeGoods" 15 "coin" 40
`;

  it('types the roster, diplomacy and mission headers; keeps opcodes lossless', () => {
    const script = extractMapScript(parseIniSections(plaintext), SRC);
    expect(script).toBeDefined();
    expect(script?.players).toEqual([
      { player: 0, type: 'human', tribeId: 1, colorId: 7 },
      { player: 1, type: 'human', tribeId: 2, colorId: 4 },
      { player: 2, type: 'ai', tribeId: 4, colorId: 9 },
    ]);
    expect(script?.diplomacy).toEqual([
      { from: 0, to: 1, state: 'friend' },
      { from: 0, to: 2, state: 'enemy' },
      { from: 1, to: 2, state: 'neutral' },
    ]);
    // playermisc + unrecognized playerdata lines land lossless in misc, file order preserved.
    expect(script?.misc).toEqual([
      { key: 'noseenfirstmessage', values: ['0', '5'] },
      { key: 'nametribe', values: ['0', '50'] },
      { key: 'nametribeshort', values: ['0', '60'] },
      { key: 'playerneverdies', values: ['2'] },
      { key: 'relationnotchangeable', values: ['0', '2'] },
    ]);
    expect(script?.missions).toHaveLength(2);
    expect(script?.missions[0]).toMatchObject({
      debugName: 'StartText',
      descriptionStringId: 300,
      active: true,
      visible: false,
      goals: [{ key: 'goal', values: ['True'] }],
      results: [
        { key: 'result', values: ['PlayCutscene', '500', '1'] },
        { key: 'result', values: ['ExploreArea', '8', '0', '0', '0'] },
      ],
    });
    // The second trigger: successfullif typed, and the corpus's real `esult` typo kept lossless.
    expect(script?.missions[1]).toMatchObject({
      descriptionStringId: -1,
      active: false,
      successfullIf: 2,
      other: [{ key: 'esult', values: ['AddTributeGoods', '15', 'coin', '40'] }],
    });
  });

  it('decodes the packed map.cif skin (macros already resolved to logicdefines codes)', () => {
    // Mirrors a real packed map.cif (multiplayer_104_militar): numeric codes, level-tagged sections.
    const lines: CifLine[] = [
      { level: 1, text: 'playerdata' },
      { level: 2, text: 'player 0 1 1 0' },
      { level: 2, text: 'player 1 2 1 7' },
      { level: 2, text: 'diplomacy 0 1 3' },
    ];
    const script = extractMapScript(cifLinesToSections(lines), { file: 'x/map.cif' });
    expect(script?.players).toEqual([
      { player: 0, type: 'human', tribeId: 1, colorId: 0 },
      { player: 1, type: 'ai', tribeId: 1, colorId: 7 },
    ]);
    expect(script?.diplomacy).toEqual([{ from: 0, to: 1, state: 'enemy' }]);
  });

  it('drops a malformed roster row to misc and keeps the first duplicate slot', () => {
    const text = `
[playerdata]
player 0 #PLAYER_TYPE_HUMAN #TRIBE_TYPE_HUMAN_VIKING #PLAYER_COLOR_ID_BLUE
player 0 #PLAYER_TYPE_AI #TRIBE_TYPE_HUMAN_FRANK #PLAYER_COLOR_ID_RED
player X #PLAYER_TYPE_AI #TRIBE_TYPE_HUMAN_FRANK #PLAYER_COLOR_ID_RED
player 3 #PLAYER_TYPE_NONE #TRIBE_TYPE_HUMAN_FRANK #PLAYER_COLOR_ID_RED
player 4 #PLAYER_TYPE_AI 0 #PLAYER_COLOR_ID_RED
player 5 #PLAYER_TYPE_AI #TRIBE_TYPE_HUMAN_FRANK 99
......................................................................
`;
    const script = extractMapScript(parseIniSections(text), SRC);
    expect(script?.players).toEqual([{ player: 0, type: 'human', tribeId: 1, colorId: 0 }]);
    // The duplicate, the unparsable row, the PLAYER_TYPE_NONE row, the out-of-range tribe/colour
    // rows (which would otherwise fail the whole map at the final schema parse) and the decoration
    // line all stay lossless in misc instead of vanishing.
    expect(script?.misc.map((l) => l.key)).toEqual([
      'player',
      'player',
      'player',
      'player',
      'player',
      '......................................................................',
    ]);
  });

  it('returns undefined when no script section yields anything', () => {
    expect(extractMapScript(parseIniSections('[logiccontrol]\nmapsize 10 10\n'), SRC)).toBeUndefined();
  });

  it('types the [multiplayer] lobby table in the plaintext macro skin', () => {
    // Mirrors Magiczny_Las player.inc: per-slot options, a hidden scripted slot, and the corpus's
    // hand-wrapped continuation quirk (a bare #PLAYER_TYPE_NONE line) staying lossless in other.
    const text = `
[playerdata]
player 0 #PLAYER_TYPE_HUMAN #TRIBE_TYPE_HUMAN_VIKING #PLAYER_COLOR_ID_BLUE

[multiplayer]
playeroption 0 #PLAYER_TYPE_HUMAN #PLAYER_TYPE_AI #PLAYER_TYPE_NONE
playeroption 1 #PLAYER_TYPE_HUMAN #PLAYER_TYPE_AI
#PLAYER_TYPE_NONE
playeroption 2 #PLAYER_TYPE_AI
playerhideinmenu 2
playerfixcolors 1
`;
    const script = extractMapScript(parseIniSections(text), SRC);
    expect(script?.multiplayer).toEqual({
      slotOptions: [
        { player: 0, allowed: ['human', 'ai', 'none'] },
        { player: 1, allowed: ['human', 'ai'] },
        { player: 2, allowed: ['ai'] },
      ],
      hiddenSlots: [2],
      fixedColors: true,
      other: [{ key: '#PLAYER_TYPE_NONE', values: [] }],
    });
  });

  it('types the [multiplayer] table in the packed numeric skin (a lobby-openable ai slot)', () => {
    // Mirrors the packed SPECJALNA- MOSTY NA RZECE map.cif: playerdata authors one human slot, but
    // playeroption offers human (1) on an ai slot too — the lobby's seat-eligibility table.
    const lines: CifLine[] = [
      { level: 1, text: 'playerdata' },
      { level: 2, text: 'player 0 1 1 0' },
      { level: 2, text: 'player 1 2 1 1' },
      { level: 1, text: 'multiplayer' },
      { level: 2, text: 'playeroption 0 1 2 0' },
      { level: 2, text: 'playeroption 1 1 2 0' },
    ];
    const script = extractMapScript(cifLinesToSections(lines), { file: 'x/map.cif' });
    expect(script?.multiplayer?.slotOptions).toEqual([
      { player: 0, allowed: ['human', 'ai', 'none'] },
      { player: 1, allowed: ['human', 'ai', 'none'] },
    ]);
    expect(script?.multiplayer?.hiddenSlots).toEqual([]);
    expect(script?.multiplayer?.fixedColors).toBeUndefined();
  });
});
