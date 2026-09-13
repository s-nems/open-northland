import { MAX_SAVE_ORDERS_BYTES } from '../limits.js';
import type { ServerMessage } from '../messages.js';
import { asArray, asCount, asRecord } from '../untrusted.js';
import { parseWireCommands } from './wire.js';

/** Three bytes per UTF-16 unit conservatively bounds UTF-8 without platform APIs. */
export function saveOrdersText(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined || text.length > Math.floor(MAX_SAVE_ORDERS_BYTES / 3))
    throw new Error(`saveOrders exceeds ${MAX_SAVE_ORDERS_BYTES} byte budget`);
  return text;
}

export function parseSaveOrders(value: unknown): Extract<ServerMessage, { kind: 'saveOrders' }> {
  saveOrdersText(value);
  const raw = asRecord(value, 'saveOrders');
  const tick = asCount(raw.tick, 'saveOrders.tick');
  let previous = tick;
  const frames = asArray(raw.frames, 'saveOrders.frames').map((value, i) => {
    const frame = asRecord(value, `saveOrders.frames[${i}]`);
    const next = asCount(frame.tick, `saveOrders.frames[${i}].tick`);
    if (next <= previous) throw new Error('saveOrders frames must strictly increase after the snapshot tick');
    previous = next;
    const commands = parseWireCommands(frame.commands, `saveOrders.frames[${i}].commands`);
    if (commands.length === 0) throw new Error('saveOrders frames must contain commands');
    return { tick: next, commands };
  });
  return { kind: 'saveOrders', id: asCount(raw.id, 'saveOrders.id'), tick, frames };
}
