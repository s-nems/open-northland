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

[specialItems]

add 0 #SPECIAL_ITEM_TYPE_LETTER_TO_SET_ANY_HOUSE
add 0 #SPECIAL_ITEM_TYPE_LETTER_TO_SET_ANY_HOUSE
add 1 #SPECIAL_ITEM_TYPE_LETTER_TO_SET_GIVEN_HOUSE #HOUSE_TYPE_FIGHT_TOWER_01
add 2 #SPECIAL_ITEM_TYPE_NONE
add X #SPECIAL_ITEM_TYPE_LETTER_TO_SET_ANY_HOUSE
remove 0 #SPECIAL_ITEM_TYPE_LETTER_TO_SET_ANY_HOUSE

[misc_humannames]
setname	100	100
setname 101 101 
setname x 7

[misc_tradeagreement]

tradeagreement          769          #GOOD_TYPE_MEAD          1          #GOOD_TYPE_ARMOR_LEATHER          4
tradeagreement 900 #GOOD_TYPE_WHEAT 4 #GOOD_TYPE_AMULET_CRITICAL_HIT 1
tradeagreement 901 #GOOD_TYPE_NOTAGOOD 4 #GOOD_TYPE_GOLD 1

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
    // Starting papers: the kind and house codes as logicdefines.inc resolves them, no house as 0.
    expect(script?.specialItems).toEqual([
      { player: 0, kind: 2, param: 0 },
      { player: 0, kind: 2, param: 0 },
      { player: 1, kind: 3, param: 41 },
    ]);
    // playermisc + unrecognized playerdata/specialItems lines land lossless in misc, file order preserved.
    expect(script?.misc).toEqual([
      { key: 'noseenfirstmessage', values: ['0', '5'] },
      { key: 'nametribe', values: ['0', '50'] },
      { key: 'nametribeshort', values: ['0', '60'] },
      { key: 'playerneverdies', values: ['2'] },
      { key: 'relationnotchangeable', values: ['0', '2'] },
      { key: 'add', values: ['2', '#SPECIAL_ITEM_TYPE_NONE'] },
      { key: 'add', values: ['X', '#SPECIAL_ITEM_TYPE_LETTER_TO_SET_ANY_HOUSE'] },
      { key: 'remove', values: ['0', '#SPECIAL_ITEM_TYPE_LETTER_TO_SET_ANY_HOUSE'] },
    ]);
    // The human-name rows are typed; a malformed one is dropped rather than failing the map.
    expect(script?.humanNames).toEqual([
      { humanId: 100, stringId: 100 },
      { humanId: 101, stringId: 101 },
    ]);
    // Trade agreements resolve their goods through the GOOD_TYPE_* codes; an unknown macro drops the row.
    expect(script?.tradeAgreements).toEqual([
      { missionId: 769, giveGood: 43, giveAmount: 1, takeGood: 34, takeAmount: 4 },
      { missionId: 900, giveGood: 4, giveAmount: 4, takeGood: 54, takeAmount: 1 },
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
      { level: 1, text: 'specialitems' },
      { level: 2, text: 'add 1 3 1' },
    ];
    const script = extractMapScript(cifLinesToSections(lines), { file: 'x/map.cif' });
    expect(script?.players).toEqual([
      { player: 0, type: 'human', tribeId: 1, colorId: 0 },
      { player: 1, type: 'ai', tribeId: 1, colorId: 7 },
    ]);
    expect(script?.diplomacy).toEqual([{ from: 0, to: 1, state: 'enemy' }]);
    expect(script?.specialItems).toEqual([{ player: 1, kind: 3, param: 1 }]);
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

  it('types the [AIData] seat toggles and leaves the task program alone', () => {
    // Mirrors SPECJALNA- FORTECA's packed section: a blanket HAI_Disable per fortress seat beside the
    // authored tasks; the plaintext skin spells the header [aidata].
    const lines: CifLine[] = [
      { level: 1, text: 'playerdata' },
      { level: 2, text: 'player 0 1 1 0' },
      { level: 1, text: 'AIData' },
      { level: 2, text: 'HAI_Disable 6' },
      { level: 2, text: 'HAI_Disable 6' },
      { level: 2, text: 'AI_Disable 2' },
      { level: 2, text: 'HAI_DisableMilitary 3' },
      { level: 2, text: 'hai_disableroadbuild 3' },
      { level: 2, text: 'HAI_DisableHouseBuild 3 2' },
      { level: 2, text: 'HAI_Disable x' },
      { level: 2, text: 'AI_MainTask_Defend 6 10 100000 215 270 40 5 10' },
    ];
    const script = extractMapScript(cifLinesToSections(lines), { file: 'x/map.cif' });
    expect(script?.ai).toEqual([
      {
        player: 6,
        disabled: false,
        strategicOff: [
          'collectResources',
          'guideBuild',
          'homeExpansion',
          'houseBuild',
          'houseUpgrade',
          'military',
          'roadBuild',
        ],
        conditions: [],
        tasks: [
          { kind: 'defend', priority: 10, condition: 100000, x: 215, y: 270, range: 40, min: 5, max: 10 },
        ],
      },
      { player: 2, disabled: true, strategicOff: [], conditions: [], tasks: [] },
      { player: 3, disabled: false, strategicOff: ['military', 'roadBuild'], conditions: [], tasks: [] },
    ]);
    expect(script?.misc).toEqual([]);
  });

  it('types the scripted handler’s program the way the loader reads each line', () => {
    const lines: CifLine[] = [
      { level: 1, text: 'AIData' },
      { level: 2, text: 'AI_UnitLimit 6 10' },
      { level: 2, text: 'AI_MaxUnitLimit 6 0' },
      { level: 2, text: 'AI_SoldiersDefaultPosition 6 245 247 70' },
      { level: 2, text: 'AI_SetCondition_True 6 0' },
      { level: 2, text: 'AI_SetCondition_OnTime 6 1 2' },
      { level: 2, text: 'AI_SetCondition_OnConditions 6 4 0 1 0 2 3' },
      { level: 2, text: 'AI_SetCondition_OnConditionChangeDelayed 6 5 1 4 1 30' },
      { level: 2, text: 'AI_SetCondition_OnDiplomacyChange 6 6 0 0 6 3' },
      { level: 2, text: 'AI_SetCondition_OnCreatureInRange 7 0 0 245 247 70 20 1 1' },
      { level: 2, text: 'AI_SetCondition_OnHouseInRange 6 7 0 250 243 10 6 0 39 1' },
      { level: 2, text: 'AI_SetCondition_OnPlayerSeen 6 8 1 6 0' },
      { level: 2, text: 'AI_SetCondition_OnPlayerDead 6 9 0' },
      { level: 2, text: 'AI_SetCondition_OnNumberOfSoldiers 6 10 0 140 6' },
      { level: 2, text: 'AI_SetCondition_OnExternal 6 2 1' },
      { level: 2, text: 'AI_SetCondition_OnTimer 6 11 100 50 25' },
      { level: 2, text: 'AI_MainTask_Attack 7 100 3 407 263 120 0 0 289 254 1' },
      { level: 2, text: 'AI_MainTask_CreateCreatures 6 100 4 2 35 250 243 0 1 0' },
      // The loose maps sometimes drop the trailing `once`; the loader reads a missing int as 0.
      { level: 2, text: 'AI_MainTask_CreateCreatures 1 100 30 2 41 65 169 0 1' },
      { level: 2, text: 'AI_MainTask_ChangeDiplomacy 6 5 100000 0 3' },
      { level: 2, text: 'AI_MainTask_SelfDestroyPlayer 6 12' },
      // A slot past the table, and a negative range: both dropped, as the loader refuses the first
      // and the schema the second.
      { level: 2, text: 'AI_SetCondition_OnExternal 6 100 1' },
      { level: 2, text: 'AI_MainTask_Defend 6 10 100000 1 1 -5 0 0' },
    ];
    const script = extractMapScript(cifLinesToSections(lines), { file: 'x/map.cif' });
    expect(script?.ai).toEqual([
      {
        player: 6,
        disabled: false,
        strategicOff: [],
        unitLimit: 10,
        maxUnitLimit: 0,
        defaultPosition: { x: 245, y: 247, range: 70 },
        conditions: [
          { kind: 'true', slot: 0 },
          { kind: 'onTime', slot: 1, ticks: 1440 },
          { kind: 'onConditions', slot: 4, sticky: false, mode: 1, slots: [0, 2, 3] },
          {
            kind: 'onConditionChangeDelayed',
            slot: 5,
            sticky: true,
            source: 4,
            onActivation: true,
            delayTicks: 360,
          },
          { kind: 'onDiplomacyChange', slot: 6, sticky: false, from: 0, to: 6, state: 3 },
          {
            kind: 'onHouseInRange',
            slot: 7,
            sticky: false,
            x: 250,
            y: 243,
            range: 10,
            player: 6,
            enemiesOnly: false,
            houseType: 39,
            finishedOnly: true,
          },
          { kind: 'onPlayerSeen', slot: 8, sticky: true, seer: 6, seen: 0 },
          { kind: 'onPlayerDead', slot: 9, player: 0 },
          { kind: 'onNumberOfSoldiers', slot: 10, sticky: false, count: 140, player: 6 },
          { kind: 'onExternal', slot: 2, raised: true },
          { kind: 'onTimer', slot: 11, delayTicks: 100, activeTicks: 50, inactiveTicks: 25 },
        ],
        tasks: [
          {
            kind: 'createCreatures',
            priority: 100,
            condition: 4,
            tribe: 2,
            job: 35,
            x: 250,
            y: 243,
            missionId: 0,
            count: 1,
            once: false,
          },
          { kind: 'changeDiplomacy', priority: 5, condition: 100000, player: 0, state: 3 },
          { kind: 'selfDestroyPlayer', condition: 12 },
        ],
      },
      {
        player: 7,
        disabled: false,
        strategicOff: [],
        conditions: [
          {
            kind: 'onCreatureInRange',
            slot: 0,
            sticky: false,
            x: 245,
            y: 247,
            range: 70,
            player: 20,
            enemiesOnly: true,
            soldiersOnly: true,
          },
        ],
        tasks: [
          {
            kind: 'attack',
            priority: 100,
            condition: 3,
            x: 407,
            y: 263,
            range: 120,
            min: 0,
            max: 0,
            rallyX: 289,
            rallyY: 254,
            stance: 1,
          },
        ],
      },
      {
        player: 1,
        disabled: false,
        strategicOff: [],
        conditions: [],
        tasks: [
          {
            kind: 'createCreatures',
            priority: 100,
            condition: 30,
            tribe: 2,
            job: 41,
            x: 65,
            y: 169,
            missionId: 0,
            count: 1,
            once: false,
          },
        ],
      },
    ]);
  });

  it('types the [multiplayer] table in the packed numeric skin (a lobby-openable ai slot)', () => {
    // Mirrors the packed SPECJALNA- MOSTY NA RZECE map.cif: playerdata authors one human slot, but
    // playeroption offers human (1) on an ai slot too - the lobby's seat-eligibility table.
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

it('extracts numeric map permissions and keeps unknown permission macros visible', () => {
  const script = extractMapScript(
    parseIniSections(`[allowedthings]
forbidgood 2 1 7
allowhouse 2 1 4
forbidjob 2 1 #UNKNOWN_JOB
`),
    SRC,
  );
  expect(script?.permissions).toEqual([
    { player: 2, tribe: 1, kind: 'good', typeId: 7, allowed: false },
    { player: 2, tribe: 1, kind: 'house', typeId: 4, allowed: true },
  ]);
  expect(script?.misc).toEqual([{ key: 'forbidjob', values: ['2', '1', '#UNKNOWN_JOB'] }]);
});
