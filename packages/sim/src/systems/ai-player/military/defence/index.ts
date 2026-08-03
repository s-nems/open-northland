// The seat defending itself. The autonomous HAI exposes only `HAI_Disable*`, so the shape and the radii
// here are approximations; the scripted `AI_MainTask_Defend` and `AI_SoldiersDefaultPosition` vocabulary
// in map `[aidata]` blocks is readable per-map authoring, and is where a calibration pass would start.

export { alarmOrders } from './alarm.js';
export { TOWER_GARRISON_ARCHERS, towerPostOrders } from './posts.js';
export { sortieOrders } from './sortie.js';
export {
  raidOnTheSettlement,
  seatRaiders,
  THREAT_STAND_DOWN_MARGIN_NODES,
  threatWatchNodes,
} from './threat.js';
