import { IR_VERSION, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  animalBabyHitpoints,
  animalCannotBeAttacked,
  animalHitpoints,
  herdParams,
  ignoresHousesAnimal,
  isAggressiveAnimal,
  isAnimalTribe,
  isCatchableAnimal,
  isPlayableTribe,
  isWarrantableAnimal,
  locomotionOf,
} from '../../../src/systems/index.js';
import { tribeContent } from './support.js';

describe('isAnimalTribe', () => {
  it('is true for a recorded animal tribe (no tech graph) and false for a civilization', () => {
    const content = tribeContent();
    expect(isAnimalTribe(content, 9)).toBe(true); // wolves — recorded, no jobEnables
    expect(isAnimalTribe(content, 8)).toBe(true); // bears — recorded, no jobEnables
    expect(isAnimalTribe(content, 1)).toBe(false); // viking — a civilization
    expect(isAnimalTribe(content, 2)).toBe(false); // frank — a civilization
  });

  it('is false for an UNKNOWN tribe id — an absent record is not silently reclassified as an animal', () => {
    // The boundary `isAnimalTribe` exists to draw: `!isPlayableTribe(99)` is true, but tribe 99 is NOT
    // an animal (we have no record for it), so the combat drive must not treat it as wildlife.
    expect(isPlayableTribe(tribeContent(), 99)).toBe(false);
    expect(isAnimalTribe(tribeContent(), 99)).toBe(false);
  });

  it('partitions every RECORDED tribe with isPlayableTribe (exactly one of the two holds)', () => {
    const content = tribeContent();
    for (const tribe of content.tribes) {
      // For a recorded tribe, animal and playable are exact complements (XOR).
      expect(isAnimalTribe(content, tribe.typeId)).toBe(!isPlayableTribe(content, tribe.typeId));
    }
  });
});

describe('isAggressiveAnimal / animalCannotBeAttacked / animalHitpoints (animaltypes read views)', () => {
  it('isAggressiveAnimal reads the `aggressive` flag off the animaltypes record', () => {
    const content = tribeContent();
    expect(isAggressiveAnimal(content, 8)).toBe(true); // bears — aggressive record
    expect(isAggressiveAnimal(content, 9)).toBe(false); // wolves — animal tribe but NO animaltypes record
    expect(isAggressiveAnimal(content, 1)).toBe(false); // viking — a civilization, not an animal
    expect(isAggressiveAnimal(content, 99)).toBe(false); // unknown tribe — no record
  });

  it('animalHitpoints returns the adult HP pool, or null for a tribe with no animal record', () => {
    const content = tribeContent();
    expect(animalHitpoints(content, 8)).toBe(15000); // bears — hitpointsAdult
    expect(animalHitpoints(content, 9)).toBeNull(); // wolves — no animaltypes record
    expect(animalHitpoints(content, 1)).toBeNull(); // viking — a civilization
  });

  it('animalBabyHitpoints returns the juvenile HP pool, distinct from the adult, or null with no record', () => {
    const content = tribeContent();
    expect(animalBabyHitpoints(content, 8)).toBe(8000); // bears — hitpointsBaby, NOT the 15000 adult pool
    expect(animalBabyHitpoints(content, 10)).toBe(0); // cows — record with no hitpointsBaby → extractor default 0
    expect(animalBabyHitpoints(content, 9)).toBeNull(); // wolves — no animaltypes record
    expect(animalBabyHitpoints(content, 1)).toBeNull(); // viking — a civilization
  });

  it('animalCannotBeAttacked exempts a decorative-fauna animal (cannotbeattacked)', () => {
    const content = parseContentSet({
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
      tribes: [
        { typeId: 5, id: 'bees', atomicBindings: [{ jobType: 0, atomicId: 1, animation: 'b' }] },
        { typeId: 6, id: 'wasps', atomicBindings: [{ jobType: 0, atomicId: 1, animation: 'w' }] },
      ],
      animals: [
        { id: 'bee', tribeType: 5, aggressive: true, cannotBeAttacked: true, hitpointsAdult: 200 },
        { id: 'wasp', tribeType: 6, aggressive: true, hitpointsAdult: 200 },
      ],
    });
    expect(animalCannotBeAttacked(content, 5)).toBe(true); // bee — decorative, exempt
    expect(animalCannotBeAttacked(content, 6)).toBe(false); // wasp — attackable
    expect(animalCannotBeAttacked(content, 1)).toBe(false); // unknown — not exempt
  });
});

// The last two unconsumed animaltypes fields — `warrantable` (livestock-ownership) and `ignorehouses`
// (pathing-through-buildings) — now each have a read view, closing the animal-record consumer coverage
// (every extracted animaltypes.ini field is now surfaced to the sim). Both are the same boolean-flag
// pattern as isCatchableAnimal/animalCannotBeAttacked, read straight off the record (false when absent).

describe('isWarrantableAnimal / ignoresHousesAnimal (the last animaltypes flag read views)', () => {
  it('isWarrantableAnimal reads the `warrantable` flag (owned livestock) off the record', () => {
    const content = tribeContent();
    expect(isWarrantableAnimal(content, 10)).toBe(true); // cow — warrantable (penned livestock)
    expect(isWarrantableAnimal(content, 8)).toBe(false); // bear — a record, but wild (not warrantable)
    expect(isWarrantableAnimal(content, 9)).toBe(false); // wolves — animal tribe but NO animaltypes record
    expect(isWarrantableAnimal(content, 1)).toBe(false); // viking — a civilization
    expect(isWarrantableAnimal(content, 99)).toBe(false); // unknown tribe — no record
  });

  it('ignoresHousesAnimal reads the `ignorehouses` pathing flag off the record', () => {
    const content = tribeContent();
    expect(ignoresHousesAnimal(content, 8)).toBe(true); // bear — barges through buildings
    expect(ignoresHousesAnimal(content, 10)).toBe(false); // cow — a record, but paths around houses
    expect(ignoresHousesAnimal(content, 9)).toBe(false); // wolves — animal tribe but NO animaltypes record
    expect(ignoresHousesAnimal(content, 1)).toBe(false); // viking — a civilization
    expect(ignoresHousesAnimal(content, 99)).toBe(false); // unknown tribe — no record
  });

  it('the two flags are independent (a warrantable animal need not ignore houses, and vice versa)', () => {
    const content = tribeContent();
    // cow: warrantable but NOT ignoreHouses; bear: ignoreHouses but NOT warrantable — orthogonal flags.
    expect(isWarrantableAnimal(content, 10) && !ignoresHousesAnimal(content, 10)).toBe(true);
    expect(ignoresHousesAnimal(content, 8) && !isWarrantableAnimal(content, 8)).toBe(true);
  });
});

describe('herdParams (the animal herd/spawn read view)', () => {
  it('surfaces the herd/spawn params off the animaltypes record as one struct', () => {
    const params = herdParams(tribeContent(), 8); // bears
    expect(params).toEqual({
      maxGroupSize: 4, // maximumGroupSize
      searchForLeader: true, // searchForLeader
      leaderDistance: 5, // maximumLeaderDistance
      birthPointRange: 12, // maximumDistanceToBirthPoint
      stayPointRange: 7, // maximumDistanceToStayPoint
    });
  });

  it('returns null for a tribe with no animal record (an animal tribe lacking the record, or a civ)', () => {
    const content = tribeContent();
    expect(herdParams(content, 9)).toBeNull(); // wolves — animal tribe but NO animaltypes record
    expect(herdParams(content, 1)).toBeNull(); // viking — a civilization
    expect(herdParams(content, 99)).toBeNull(); // unknown tribe — no record
  });

  it('defaults a source-omitted herd field to 0/false rather than guessing (a solitary animal)', () => {
    // A minimal animal record (only the required id+tribeType): the schema fills the herd params with
    // their source-omitted defaults, and the read view passes them through verbatim — no inference.
    const content = parseContentSet({
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: 0, id: 'idle' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
      tribes: [{ typeId: 7, id: 'eagle', atomicBindings: [{ jobType: 0, atomicId: 1, animation: 'e' }] }],
      animals: [{ id: 'eagle', tribeType: 7 }],
    });
    expect(herdParams(content, 7)).toEqual({
      maxGroupSize: 0,
      searchForLeader: false,
      leaderDistance: 0,
      birthPointRange: 0,
      stayPointRange: 0,
    });
  });
});

describe('locomotionOf (the animal walk/run-speed read view)', () => {
  it('surfaces the movespeed/runspeed off the animaltypes record as one struct', () => {
    const params = locomotionOf(tribeContent(), 8); // bears: movespeed 8, runspeed 5
    expect(params).toEqual({
      walkSpeed: 8, // moveSpeed
      runSpeed: 5, // runSpeed
    });
  });

  it('returns null for a tribe with no animal record (an animal tribe lacking the record, or a civ)', () => {
    const content = tribeContent();
    expect(locomotionOf(content, 9)).toBeNull(); // wolves — animal tribe but NO animaltypes record
    expect(locomotionOf(content, 1)).toBeNull(); // viking — a civilization
    expect(locomotionOf(content, 99)).toBeNull(); // unknown tribe — no record
  });

  it('defaults a source-omitted speed to 0 rather than guessing (the engine default applies)', () => {
    // The cow record (tribe 10) sets neither movespeed nor runspeed; the read view passes the
    // schema's source-omitted 0 through verbatim — no inference of a default pace.
    expect(locomotionOf(tribeContent(), 10)).toEqual({
      walkSpeed: 0,
      runSpeed: 0,
    });
  });
});

describe('isCatchableAnimal (the catchable prey read view)', () => {
  it('is true for a catchable animal, false for non-catchable / civ / unknown', () => {
    const content = tribeContent();
    expect(isCatchableAnimal(content, 10)).toBe(true); // cow — catchable
    expect(isCatchableAnimal(content, 8)).toBe(false); // bear — aggressive, not catchable
    expect(isCatchableAnimal(content, 9)).toBe(false); // wolves — no animaltypes record
    expect(isCatchableAnimal(content, 1)).toBe(false); // viking — a civilization
    expect(isCatchableAnimal(content, 99)).toBe(false); // unknown tribe
  });
});
