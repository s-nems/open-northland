import { type MissionPass, setMissionActive } from './pass.js';
import type { MissionResultOp } from './script.js';

/** Execute one result of mission `index`. An opcode with no executor is reported and does nothing;
 *  nothing here throws, because a corpus script must never halt a running world. */
export function executeResult(pass: MissionPass, index: number, result: MissionResultOp): void {
  switch (result.opcode) {
    case 'None':
      return;
    case 'ActivateMission':
      setMissionActive(pass, result.missionIndex, true);
      return;
    case 'DeactivateMission':
      setMissionActive(pass, result.missionIndex, false);
      return;
    case 'DisableAll':
      for (const record of pass.records) record.active = false;
      return;
    case 'SetVisible': {
      const target = pass.records[result.missionIndex];
      if (target !== undefined) target.visible = result.flag;
      return;
    }
    case 'Exit':
      pass.events.emit({ kind: 'missionExit', mission: index });
      return;
    default:
      pass.report(index, result.opcode);
  }
}
