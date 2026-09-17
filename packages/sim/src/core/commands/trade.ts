import type { Entity } from '../../ecs/world.js';

/**
 * The orders a player gives one of its traders (the original's human commands 0x24, 0x25, 0x31, 0x32
 * and 0x33). Every one names the trader as `entity`; an entity that is no trader of the seat's is
 * skipped. The trade agreements themselves are content, registered at world assembly.
 */
export type TradeCommand =
  | {
      /** Put `house` on the trader's route: its second stop, or its first. A house of another player
       *  is the stop the trader exchanges goods at. */
      readonly kind: 'attachTradeHouse';
      readonly entity: Entity;
      readonly house: Entity;
    }
  | {
      readonly kind: 'detachTradeHouse';
      readonly entity: Entity;
      readonly house: Entity;
    }
  | {
      /** Mark `good` for import into `house` (a stop of the route), or clear the mark. A stop with no
       *  marks takes every good the house stores. */
      readonly kind: 'setTradeImport';
      readonly entity: Entity;
      readonly house: Entity;
      readonly good: number;
      readonly on: boolean;
    }
  | {
      /** Clear every import mark on the trader's route. */
      readonly kind: 'clearTradeImports';
      readonly entity: Entity;
    }
  | {
      /** Trade on the map's agreement `agreement` (an index into the table) at the route's foreign
       *  stop. -1 drops the choice. */
      readonly kind: 'setTradeAgreement';
      readonly entity: Entity;
      readonly agreement: number;
    };

/** Register one of the map's `tradeagreement` rows (trusted setup). The houses it applies to are the
 *  ones stamped with `missionId`, resolved live, so a house placed later still qualifies. */
export type TradeAgreementCommand = {
  readonly kind: 'addTradeAgreement';
  readonly missionId: number;
  readonly giveGood: number;
  readonly giveAmount: number;
  readonly takeGood: number;
  readonly takeAmount: number;
};
