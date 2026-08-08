import type { ContentSet } from '@open-northland/data';
import {
  Age,
  addPerson,
  Female,
  Health,
  Owner,
  Position,
  Residence,
  Settler,
} from '../../components/index.js';
import { fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { BABY_FEMALE, BABY_MALE } from '../lifecycle/ageclass.js';
import { stampDefaultStance } from '../orders/index.js';
import { DEFAULT_SETTLER_HITPOINTS } from './settlers.js';

/**
 * Assemble a newborn of the ordered `sex` at its mother's door. Deliberately not a `createSettler` call: it
 * rolls no RNG (a birth must not perturb the seeded stream), takes its sex and life stage from the parents'
 * order rather than a job slug, and starts on the childhood {@link DEFAULT_SETTLER_HITPOINTS} pool, growing
 * into its tribe's adult pool when it grows up (GrowthSystem). It emits nothing, and the stamp order is
 * hash-significant.
 */
export function spawnNewborn(
  world: World,
  content: ContentSet,
  mother: Entity,
  home: Entity,
  sex: 'female' | 'male',
): Entity {
  const p = world.get(mother, Position); // she stands at the door she entered by, so the baby appears there
  const baby = world.create();
  world.add(baby, Position, { x: p.x, y: p.y });
  addPerson(world, baby, {
    tribe: world.get(mother, Settler).tribe,
    jobType: sex === 'male' ? BABY_MALE : BABY_FEMALE,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  if (sex === 'female') world.add(baby, Female, { female: true });
  world.add(baby, Age, { ticks: 0 });
  world.add(baby, Health, { hitpoints: DEFAULT_SETTLER_HITPOINTS, max: DEFAULT_SETTLER_HITPOINTS });
  const owner = world.tryGet(mother, Owner)?.player;
  if (owner !== undefined) {
    world.add(baby, Owner, { player: owner });
    stampDefaultStance(world, content, baby, world.get(baby, Settler).jobType);
  }
  world.add(baby, Residence, { home });
  return baby;
}
