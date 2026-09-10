import type { InfoLineView } from '@open-northland/sim';

/** The `%d` a map's info string prints its tally into; a second one prints the line's `extra`. */
const COUNT_PLACEHOLDER = '%d';

/**
 * One info line's text: the map's string with its first `%d` replaced by the live count and the
 * second by the line's `extra` (reading: the original prints through its `printf` with those two
 * arguments, a plain string getting zeros). A string the map's table lacks prints its id.
 */
export function formatInfoLine(text: string | undefined, line: InfoLineView): string {
  let out = text ?? `#${line.stringId}`;
  for (const value of [line.count, line.extra]) {
    const at = out.indexOf(COUNT_PLACEHOLDER);
    if (at < 0) break;
    out = `${out.slice(0, at)}${value}${out.slice(at + COUNT_PLACEHOLDER.length)}`;
  }
  return out;
}

/** The player's info lines as the display prints them, top to bottom. */
export function infoLineTexts(
  lines: readonly InfoLineView[],
  textOf: (stringId: number) => string | undefined,
): string[] {
  return lines.map((line) => formatInfoLine(textOf(line.stringId), line));
}
