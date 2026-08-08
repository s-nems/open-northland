import type { DebugCommand, RulesCommand } from './administration.js';
import type { AiPlayerCommand } from './ai-player.js';
import type { AssistantCommand } from './assistant.js';
import type { PlacementCommand } from './placement.js';
import type { SpawnCommand } from './spawn.js';
import type { UnitOrderCommand } from './unit-orders.js';

export {
  adminCommand,
  aiCommand,
  COMMAND_ENVELOPE_VERSION,
  COMMAND_ISSUER,
  type CommandEnvelope,
  type PlayerCommand,
  playerCommand,
  setupCommand,
} from './envelope.js';
export type { PlaceBuildingCommand } from './placement.js';
export type { SettlerEquipment, SettlerEquipmentSlot } from './spawn.js';

/**
 * The serializable external inputs CommandSystem applies; a caller submits one inside a
 * {@link CommandEnvelope}, which names the authority it acts under.
 *
 * Every `(x, y)` payload is a half-cell node address on the `2W×2H` navigation lattice
 * (`nav/halfcell.ts`), the original's logic grid and the space `map.cif` placements use.
 */
export type Command =
  | PlacementCommand
  | SpawnCommand
  | UnitOrderCommand
  | RulesCommand
  | AiPlayerCommand
  | AssistantCommand
  | DebugCommand;
