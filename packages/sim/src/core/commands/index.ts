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
 * Commands are the serializable external inputs applied by CommandSystem. Systems perform the internal
 * world updates. Commands remain serializable for replay diagnostics and possible future lockstep input.
 * A caller submits one inside a {@link CommandEnvelope}, which names the authority it acts under.
 *
 * Every `(x, y)` payload is a half-cell node address on the `2W×2H` navigation lattice
 * (`nav/halfcell.ts`), the original's logic grid and the same space `map.cif` placements and footprint
 * offsets use. The handlers mint fractional tile Positions from it via `positionOfNode`.
 */
export type Command =
  | PlacementCommand
  | SpawnCommand
  | UnitOrderCommand
  | RulesCommand
  | AiPlayerCommand
  | AssistantCommand
  | DebugCommand;
