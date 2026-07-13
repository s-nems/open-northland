/** Compatibility barrel; entity creation is grouped under `conflict/spawn/`. */
export { spawnAnimalHerd } from './spawn/animals.js';
export {
  createSettler,
  DEFAULT_SETTLER_HITPOINTS,
  type SettlerSpec,
  spawnSettler,
} from './spawn/settlers.js';
