/** Display order of the bindings table; also the priority order when stored codes collide. */
export const KEYBINDING_ACTIONS = [
  'panUp',
  'panDown',
  'panLeft',
  'panRight',
  'pauseToggle',
  'actionRing',
  'professionPicker',
  'attackMove',
] as const;

/** Rebindable player actions. A binding is a `KeyboardEvent.code`; `null` is unbound. */
export type KeybindingAction = (typeof KEYBINDING_ACTIONS)[number];

export type KeyBindings = Readonly<Record<KeybindingAction, string | null>>;

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  panLeft: 'ArrowLeft',
  panRight: 'ArrowRight',
  panUp: 'ArrowUp',
  panDown: 'ArrowDown',
  pauseToggle: 'KeyP',
  actionRing: 'Space',
  professionPicker: 'KeyC',
  attackMove: 'KeyA',
};

/** Codes a binding may take: plain game keys only. Modifiers, Escape (the fixed cancel key), and
 *  browser-owned keys (Tab, Enter, the F-row) stay out. */
const BINDABLE_CODE =
  /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(Left|Right|Up|Down)|Space|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Minus|Equal|Backquote|Home|End|PageUp|PageDown|Insert|Delete)$/;

export function isBindableCode(code: string): boolean {
  return BINDABLE_CODE.test(code);
}

/**
 * Parse a stored bindings blob. Per action: an explicit `null` stays unbound, a valid code is kept,
 * anything else falls back to the default. A code claimed twice stays with the earlier action and
 * unbinds the later one, so a code never fires two actions.
 */
export function parseKeyBindings(value: unknown): KeyBindings {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const taken = new Set<string>();
  const result = {} as Record<KeybindingAction, string | null>;
  for (const action of KEYBINDING_ACTIONS) {
    const stored = record[action];
    let code: string | null;
    if (stored === null) code = null;
    else if (typeof stored === 'string' && isBindableCode(stored)) code = stored;
    else code = DEFAULT_KEY_BINDINGS[action];
    if (code !== null && taken.has(code)) code = null;
    if (code !== null) taken.add(code);
    result[action] = code;
  }
  return result;
}

/** Give `code` to `action`; an action previously holding that code becomes unbound. */
export function assignBinding(bindings: KeyBindings, action: KeybindingAction, code: string): KeyBindings {
  const next: Record<KeybindingAction, string | null> = { ...bindings, [action]: code };
  for (const other of KEYBINDING_ACTIONS) {
    if (other !== action && bindings[other] === code) next[other] = null;
  }
  return next;
}

const CODE_LABELS: Readonly<Record<string, string>> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
};

/** Key-cap label for a binding code; `names` carries the locale's word for the space bar. */
export function keyDisplayLabel(code: string, names: { readonly space: string }): string {
  if (code === 'Space') return names.space;
  const symbol = CODE_LABELS[code];
  if (symbol !== undefined) return symbol;
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  if (letter !== undefined) return letter;
  const digit = /^Digit([0-9])$/.exec(code)?.[1];
  if (digit !== undefined) return digit;
  const numpad = /^Numpad([0-9])$/.exec(code)?.[1];
  if (numpad !== undefined) return `Num ${numpad}`;
  return code; // Home, End, PageUp… read fine as raw codes
}
