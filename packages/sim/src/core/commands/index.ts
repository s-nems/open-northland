import type { DebugCommand, RulesCommand } from './administration.js';
import type { AiPlayerCommand } from './ai-player.js';
import type { PlacementCommand } from './placement.js';
import type { SpawnCommand } from './spawn.js';
import type { UnitOrderCommand } from './unit-orders.js';

export type { SettlerEquipment, SettlerEquipmentSlot } from './spawn.js';

/**
 * Commands are the serializable external inputs applied by CommandSystem. Systems perform the internal
 * world updates. Commands remain serializable for replay diagnostics and possible future lockstep input.
 *
 * Every `(x, y)` payload is a HALF-CELL node address on the `2W×2H` navigation lattice
 * (`nav/halfcell.ts`) — the original's logic grid, the same space `map.cif` placements and footprint
 * offsets use. The handlers mint fractional tile Positions from it via `positionOfNode`.
 *
 * This is a discriminated union, not a bag of methods or numeric opcodes — adding a variant forces
 * every handler's `switch` to acknowledge it (via assertNever), which is the modern guard against
 * the original's "magic number opcode" fragility.
 */
export type Command =
  | PlacementCommand
  | SpawnCommand
  | UnitOrderCommand
  | RulesCommand
  | AiPlayerCommand
  | DebugCommand;
