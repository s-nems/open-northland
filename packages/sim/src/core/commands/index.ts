import type { DebugCommand, RulesCommand } from './administration.js';
import type { AiPlayerCommand } from './ai-player.js';
import type { AssistantCommand } from './assistant.js';
import type { DiplomacyCommand } from './diplomacy.js';
import type { PlacementCommand } from './placement.js';
import type { SpawnCommand } from './spawn.js';
import type { TradeAgreementCommand, TradeCommand } from './trade.js';
import type { TributeCommand } from './tribute.js';
import type { UnitOrderCommand } from './unit-orders.js';

export {
  adminCommand,
  aiCommand,
  COMMAND_ENVELOPE_VERSION,
  COMMAND_ISSUER,
  type CommandEnvelope,
  ownedEnvelope,
  type PlayerCommand,
  playerCommand,
  type SeatEnvelope,
  setupCommand,
} from './envelope.js';
export type { PlaceBuildingCommand } from './placement.js';
export type { CreateVehicleCommand, SettlerEquipment, SettlerEquipmentSlot } from './spawn.js';
export { type GroupMember, type GroupWorker, orderedSettler } from './unit-orders.js';

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
  | TributeCommand
  | DiplomacyCommand
  | TradeCommand
  | TradeAgreementCommand
  | DebugCommand;
