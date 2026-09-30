import { MAX_SAVE_ORDERS_BYTES } from '../limits.js';
import type { ServerMessage } from '../messages.js';
import { asArray, asCount, asRecord } from '../untrusted.js';
import { parseWireCommands } from './wire.js';

/** The budget covers serialized UTF-8, including JSON escaping and frame metadata. */
export function saveOrdersText(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined || text.length > MAX_SAVE_ORDERS_BYTES)
    throw new Error(`saveOrders exceeds ${MAX_SAVE_ORDERS_BYTES} byte budget`);
  if (text.length <= Math.floor(MAX_SAVE_ORDERS_BYTES / 3)) return text;
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0x7f) bytes++;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // JSON.stringify escapes lone surrogates, so this starts a complete pair.
      bytes += 4;
      i++;
    } else bytes += 3;
    if (bytes > MAX_SAVE_ORDERS_BYTES)
      throw new Error(`saveOrders exceeds ${MAX_SAVE_ORDERS_BYTES} byte budget`);
  }
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
