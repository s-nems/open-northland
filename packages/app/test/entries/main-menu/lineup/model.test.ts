import type { MapSeatRelation, MapsIndexPlayerSlot } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { listsOwnRelations, mapLineup } from '../../../../src/entries/main-menu/lineup/model.js';

/** A seat a person may take, unless `claimable` is false: then the map plays it. */
function seat(player: number, claimable = true, hidden = false): MapsIndexPlayerSlot {
  return {
    player,
    type: claimable ? 'human' : 'ai',
    tribeId: 1,
    colorId: player,
    claimable,
    hidden,
    aiAllowed: true,
    noneAllowed: true,
    hasComputerControl: true,
  };
}

/** Every pair of `seats` in `stance`. */
function all(seats: readonly number[], stance: MapSeatRelation['stance']): MapSeatRelation[] {
  return seats.flatMap((a, index) => seats.slice(index + 1).map((b) => ({ a, b, stance })));
}

/** Every pair across the two seat lists in `stance`. */
function across(
  left: readonly number[],
  right: readonly number[],
  stance: MapSeatRelation['stance'],
): MapSeatRelation[] {
  return left.flatMap((a) => right.map((b) => ({ a: Math.min(a, b), b: Math.max(a, b), stance })));
}

const groupsOf = (lineup: ReturnType<typeof mapLineup>) =>
  lineup?.groups.map((group) => [group.kind, group.players]);

describe('mapLineup', () => {
  it('splits two alliances at war into teams', () => {
    const lineup = mapLineup(
      [0, 1, 2, 3, 4, 5].map((player) => seat(player)),
      [...all([0, 1, 2], 'ally'), ...all([3, 4, 5], 'ally'), ...across([0, 1, 2], [3, 4, 5], 'enemy')],
    );
    expect(lineup?.format).toBe('teams');
    expect(lineup?.sides).toEqual([3, 3]);
    expect(groupsOf(lineup)).toEqual([
      ['team', [0, 1, 2]],
      ['team', [3, 4, 5]],
    ]);
  });

  it("puts a map seat in the team it stands with, counting only a person's seats per side", () => {
    // Seats 0 and 2 against 1 and 3; the map's 4 fights beside 0 and 2, its 5 beside 1 and 3.
    const lineup = mapLineup(
      [seat(0), seat(1), seat(2), seat(3), seat(4, false), seat(5, false)],
      [...all([0, 2, 4], 'ally'), ...all([1, 3, 5], 'ally'), ...across([0, 2, 4], [1, 3, 5], 'enemy')],
    );
    expect(lineup?.sides).toEqual([2, 2]);
    expect(groupsOf(lineup)).toEqual([
      ['team', [0, 2, 4]],
      ['team', [1, 3, 5]],
    ]);
  });

  it('reads all enemies as a free-for-all and sets a seat neutral to everyone aside', () => {
    const lineup = mapLineup(
      [0, 1, 2, 3].map((player) => seat(player)),
      all([0, 1, 2], 'enemy'),
    );
    expect(lineup?.format).toBe('free-for-all');
    expect(lineup?.sides).toEqual([1, 1, 1]);
    expect(groupsOf(lineup)).toEqual([
      ['sides', [0, 1, 2]],
      ['neutral', [3]],
    ]);
  });

  it('keeps a map seat out of a team whose map seat it fights', () => {
    // Map seats 4 and 5 both stand with 0 and 1 against 2 and 3, but fight each other.
    const lineup = mapLineup(
      [seat(0), seat(1), seat(2), seat(3), seat(4, false), seat(5, false)],
      [
        ...all([0, 1, 4], 'ally'),
        ...all([0, 1, 5], 'ally').filter((row) => row.a !== 0 || row.b !== 1),
        ...all([2, 3], 'ally'),
        ...across([0, 1, 4, 5], [2, 3], 'enemy'),
        { a: 4, b: 5, stance: 'enemy' },
      ],
    );
    expect(groupsOf(lineup)).toEqual([
      ['team', [0, 1, 4]],
      ['team', [2, 3]],
      ['others', [5]],
    ]);
  });

  it('groups map seats outside the alliance by their stance toward all of it', () => {
    const lineup = mapLineup(
      [seat(0), seat(1), seat(2, false), seat(3, false), seat(4, false)],
      [
        ...all([0, 1], 'ally'),
        ...across([0, 1], [2], 'enemy'),
        ...across([0, 1], [3], 'ally'),
        { a: 0, b: 4, stance: 'enemy' },
      ],
    );
    expect(lineup?.format).toBe('allied');
    // 3 allies with everyone and joins; 2 is everyone's enemy; 4 fights only seat 0.
    expect(groupsOf(lineup)).toEqual([
      ['sides', [0, 1, 3]],
      ['enemies', [2]],
      ['others', [4]],
    ]);
  });

  it('reads seats that are all neutral as one neutral side', () => {
    const lineup = mapLineup([seat(0), seat(1), seat(2), seat(3, false)], across([0, 1, 2], [3], 'ally'));
    expect(lineup?.format).toBe('neutral');
    expect(groupsOf(lineup)).toEqual([
      ['sides', [0, 1, 2]],
      ['allies', [3]],
    ]);
  });

  it('calls an alliance that is not whole mixed, and its seats list their own relations', () => {
    // 1 allies both 0 and 2, who fight each other.
    const lineup = mapLineup(
      [seat(0), seat(1), seat(2)],
      [
        { a: 0, b: 1, stance: 'ally' },
        { a: 1, b: 2, stance: 'ally' },
        { a: 0, b: 2, stance: 'enemy' },
      ],
    );
    expect(lineup?.format).toBe('mixed');
    const [sides] = lineup?.groups ?? [];
    expect(sides !== undefined && lineup !== null && listsOwnRelations(lineup, sides)).toBe(true);
  });

  it('has no lineup without two seats a person may take, and leaves hidden seats out', () => {
    expect(mapLineup([seat(0), seat(1, false)], all([0, 1], 'enemy'))).toBeNull();
    const lineup = mapLineup([seat(0), seat(1), seat(2, true, true)], all([0, 1, 2], 'enemy'));
    expect(groupsOf(lineup)).toEqual([['sides', [0, 1]]]);
  });
});
