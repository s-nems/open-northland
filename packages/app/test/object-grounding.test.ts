import { describe, expect, it } from 'vitest';
import { isGroundedWall } from '../src/content/object-grounding.js';

describe('isGroundedWall', () => {
  it('sets the stonework walls into the ground and leaves their doors, pillars and stones standing', () => {
    const dungeon = (editName: string) => ({ editName, editGroups: ['misc_dungeon'] });
    expect(isGroundedWall(dungeon('basic_wall_h_01'))).toBe(true);
    expect(isGroundedWall({ editName: 'asgard walls front', editGroups: ['xMissionCD_Dungeon'] })).toBe(true);
    expect(isGroundedWall(dungeon('door_wood_closed'))).toBe(false);
    expect(isGroundedWall(dungeon('pillar 01'))).toBe(false);
    expect(isGroundedWall(dungeon('stone 01'))).toBe(false);
  });

  it('sets a whole wall run into the ground, corners included, but not the bridge filed with it', () => {
    const iceRun = (editName: string) => ({
      editName,
      editGroups: ['xMissionCD_Dungeon', 'xMissionCD_ice wall'],
    });
    expect(isGroundedWall(iceRun('iceDungeon_wall_01'))).toBe(true);
    expect(isGroundedWall(iceRun('iceDungeon_outer_01'))).toBe(true);
    expect(isGroundedWall(iceRun('iceDungeon_inv_04'))).toBe(true);
    expect(isGroundedWall(iceRun('ice bridge'))).toBe(false);
  });

  it('leaves a wall outside the stonework groups to its own path', () => {
    // The palisade's wall posts are live entities, set into the ground by the sprite pool.
    expect(isGroundedWall({ editName: 'wall_01', editGroups: ['misc_walls'] })).toBe(false);
    expect(isGroundedWall({ editName: 'basic_wall_h_01' })).toBe(false);
  });
});
