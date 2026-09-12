import { describe, expect, it } from 'vitest';
import { extractMapTypes, parseIniSections } from '../src/decoders/ini.js';

describe('extractMapTypes', () => {
  it('resolves #CLEAN_MAP_TYPE macros case-insensitively and the resolved-int skin', () => {
    expect(
      extractMapTypes(parseIniSections('[misc_maptype]\nmaptype #CLEAN_MAP_TYPE_MULTI_PLAYER_FREE\n')),
    ).toEqual({ types: [4], multiplayerOnly: false });
    expect(
      extractMapTypes(parseIniSections('[misc_maptype]\nmaptype #clean_map_type_single_player_campaign\n')),
    ).toEqual({ types: [1], multiplayerOnly: false });
    expect(extractMapTypes(parseIniSections('[misc_maptype]\nmaptype 2\n'))).toEqual({
      types: [2],
      multiplayerOnly: false,
    });
  });

  it('folds every maptype line, skipping repeats and codes outside 1..6, like the original', () => {
    const header = extractMapTypes(
      parseIniSections(
        '[misc_maptype]\nmaptype 4\nmaptype 6\nmaptype 4\nmaptype 0\nmaptype 7\nmaptype #NOPE\n',
      ),
    );
    expect(header).toEqual({ types: [4, 6], multiplayerOnly: false });
  });

  it('reads mapmultiplayeronly and reports a section without a valid line as untyped', () => {
    expect(extractMapTypes(parseIniSections('[misc_maptype]\nmaptype 4\nmapmultiplayeronly\n'))).toEqual({
      types: [4],
      multiplayerOnly: true,
    });
    expect(extractMapTypes(parseIniSections('[misc_maptype]\nmaptype 9\n'))).toEqual({
      types: [],
      multiplayerOnly: false,
    });
    expect(extractMapTypes(parseIniSections('[misc_mapname]\nmapnamestringid 0\n'))).toBeUndefined();
  });

  it('reads the mapcampaignid pair and drops a malformed one', () => {
    expect(extractMapTypes(parseIniSections('[misc_maptype]\nmapcampaignid 0 5\n'))).toEqual({
      types: [],
      multiplayerOnly: false,
      campaign: { campaignId: 0, missionId: 5 },
    });
    expect(extractMapTypes(parseIniSections('[misc_maptype]\nmaptype 1\nmapcampaignid 0\n'))).toEqual({
      types: [1],
      multiplayerOnly: false,
    });
  });
});
