/**
 * One equipped item in a {@link spawnSettler} `equipment` payload. `goodType` is the equip good's
 * `typeId`; `degreeOfUsePct` is the item's used-up fraction as a whole percent `0..100` (converted to
 * the `Equipment` component's `Fixed` `degreeOfUse` by the handler, the same raw-int→`Fixed` conversion
 * `moveSpeed` uses — the command stays serializable, no branded `Fixed` on the wire). Omit
 * `degreeOfUsePct` for a fresh item. Meaningful only for a wearing good; ignored for permanent gear.
 */
export interface SettlerEquipmentSlot {
  readonly goodType: number;
  readonly degreeOfUsePct?: number;
}

/**
 * A {@link spawnSettler} `equipment` payload — which items a spawned settler wears. Each field is one
 * slot; `misc` is the consumable list (padded/truncated to the component's fixed misc-slot count). Any
 * omitted / null slot is empty.
 */
export interface SettlerEquipment {
  readonly boots?: SettlerEquipmentSlot | null;
  readonly tool?: SettlerEquipmentSlot | null;
  readonly weapon?: SettlerEquipmentSlot | null;
  readonly armor?: SettlerEquipmentSlot | null;
  readonly misc?: ReadonlyArray<SettlerEquipmentSlot | null>;
}
