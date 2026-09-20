# Implement all six wearable amulet effects

**Area:** sim, data, app · **Priority:** P2

## Problem

All six amulets can be equipped, but their effects are not consumed: food, stamina,
strength, defense, critical hit and speed. The equipment effect reader currently handles
production tools, restoration and death-save consumables, not wearable amulet benefits.

## Scope

Verify each effect and its combination rules against the owned engine. Encode classification
and magnitudes in content, and consume equipped amulets in needs, combat and movement.
Check removal, duplicate amulets and interaction with other modifiers. Do not infer magnitudes
from display names. the original `an original routine` (0x100116476) confirms
speed subtracts two from step cost before age, equipment weight and script flags; the other
five effects still require investigation of `an original routine*` callers.

This is separate from potion drinking and equipment-consumable extraction tickets.

## Verify

Cover all six effects with synthetic unit/integration tests, real-content joins,
equip/remove and duplicate cases, deterministic save/replay, and a registered equipment
acceptance scene with inspected browser output.
