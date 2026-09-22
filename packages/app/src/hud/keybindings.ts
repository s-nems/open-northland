export const CONTROL_GROUP_ACTIONS = [
  'controlGroup1',
  'controlGroup2',
  'controlGroup3',
  'controlGroup4',
  'controlGroup5',
  'controlGroup6',
  'controlGroup7',
  'controlGroup8',
  'controlGroup9',
  'controlGroup0',
] as const;

export type ControlGroupAction = (typeof CONTROL_GROUP_ACTIONS)[number];
export type ControlGroupMode = 'recall' | 'replace' | 'add';

const CONTROL_GROUP_REPLACE_ACTIONS = CONTROL_GROUP_ACTIONS.map((group) => `${group}Replace` as const);
const CONTROL_GROUP_ADD_ACTIONS = CONTROL_GROUP_ACTIONS.map((group) => `${group}Add` as const);

export const CONTROL_GROUP_BINDING_ACTIONS = [
  ...CONTROL_GROUP_ACTIONS,
  ...CONTROL_GROUP_REPLACE_ACTIONS,
  ...CONTROL_GROUP_ADD_ACTIONS,
] as const;

export type ControlGroupBindingAction = (typeof CONTROL_GROUP_BINDING_ACTIONS)[number];

/** Display order of the bindings table; also the priority order when stored bindings collide. */
export const KEYBINDING_ACTIONS = [
  'panUp',
  'panDown',
  'panLeft',
  'panRight',
  'pauseToggle',
  'gameMenu',
  'construction',
  'residents',
  'assistant',
  'statistics',
  'mission',
  'diplomacy',
  'knowledge',
  'hudToggle',
  'actionRing',
  'professionPicker',
  'attackMove',
  'workFlagOrder',
  ...CONTROL_GROUP_BINDING_ACTIONS,
] as const;

/** Rebindable player actions. A binding is a normalized input chord; `null` is unbound. */
export type KeybindingAction = (typeof KEYBINDING_ACTIONS)[number];
export type KeyBindings = Readonly<Record<KeybindingAction, string | null>>;

const controlGroupDefaults = Object.fromEntries(
  CONTROL_GROUP_ACTIONS.flatMap((action, index) => {
    const digit = index === 9 ? 0 : index + 1;
    return [
      [action, `Digit${digit}`],
      [`${action}Replace`, `Ctrl+Digit${digit}`],
      [`${action}Add`, `Shift+Digit${digit}`],
    ];
  }),
) as Pick<KeyBindings, ControlGroupBindingAction>;

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  panLeft: 'ArrowLeft',
  panRight: 'ArrowRight',
  panUp: 'ArrowUp',
  panDown: 'ArrowDown',
  pauseToggle: 'KeyP',
  gameMenu: 'Escape',
  // Construction keeps the original's B. The other beam windows take F2-F7 in beam order, then the HUD
  // toggle; the original puts diplomacy, statistics, subjects and the technology tree on F5-F8.
  construction: 'KeyB',
  residents: 'F2',
  assistant: 'F3',
  statistics: 'F4',
  mission: 'F5',
  diplomacy: 'F6',
  knowledge: 'F7',
  hudToggle: 'F8',
  actionRing: 'Space',
  professionPicker: 'KeyC',
  attackMove: 'KeyA',
  workFlagOrder: 'Primary+Mouse2',
  ...controlGroupDefaults,
};

export function controlGroupBinding(action: ControlGroupBindingAction): {
  readonly group: ControlGroupAction;
  readonly mode: ControlGroupMode;
} {
  const group = CONTROL_GROUP_ACTIONS.find((candidate) => action.startsWith(candidate));
  if (group === undefined) throw new Error(`Unknown control-group binding: ${action}`);
  return {
    group,
    mode: action.endsWith('Replace') ? 'replace' : action.endsWith('Add') ? 'add' : 'recall',
  };
}

/** The game's F-row. F11 and F12 stay the browser's (fullscreen, developer tools); the running game
 *  takes the rest from it, F5's reload included (`tool-panel/input.ts`). */
const FUNCTION_KEY_CODE = /^F([1-9]|10)$/;

export function isFunctionKeyCode(code: string): boolean {
  return FUNCTION_KEY_CODE.test(code);
}

/** Codes a binding may take. Escape stays the fixed cancel key and may hold only the game menu, which
 *  opens once there is nothing left to cancel (`bindingAllowedFor`); Tab and Enter stay out. */
const BINDABLE_KEY_CODE =
  /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(Left|Right|Up|Down)|Space|Escape|Comma|Period|Slash|Semicolon|Quote|BracketLeft|BracketRight|Minus|Equal|Backquote|Home|End|PageUp|PageDown|Insert|Delete)$/;
const ESCAPE_ACTION: KeybindingAction = 'gameMenu';
const BINDABLE_POINTER_CODE = /^Mouse[012]$/;
const MODIFIER_ORDER = ['Primary', 'Ctrl', 'Shift', 'Alt', 'Meta'] as const;

export function isBindableCode(code: string): boolean {
  return BINDABLE_KEY_CODE.test(code) || isFunctionKeyCode(code);
}

export function isBindableBinding(binding: string): boolean {
  const parts = binding.split('+');
  const code = parts.pop();
  if (code === undefined || (!isBindableCode(code) && !BINDABLE_POINTER_CODE.test(code))) return false;
  if (code === 'Escape' && parts.length > 0) return false;
  const modifiers = new Set(parts);
  if (
    modifiers.size !== parts.length ||
    parts.some((part) => !MODIFIER_ORDER.some((item) => item === part)) ||
    (modifiers.has('Primary') && (modifiers.has('Ctrl') || modifiers.has('Meta')))
  ) {
    return false;
  }
  const normalized = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
  return normalized.every((modifier, index) => parts[index] === modifier);
}

function eventBinding(
  code: string,
  event: Pick<KeyboardEvent | MouseEvent, 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>,
): string {
  const modifiers = [
    ...(event.ctrlKey ? ['Ctrl'] : []),
    ...(event.shiftKey ? ['Shift'] : []),
    ...(event.altKey ? ['Alt'] : []),
    ...(event.metaKey ? ['Meta'] : []),
  ];
  return [...modifiers, code].join('+');
}

export function bindingFromKeyboardEvent(event: KeyboardEvent): string | null {
  return isBindableCode(event.code) ? eventBinding(event.code, event) : null;
}

export function bindingFromMouseEvent(event: MouseEvent): string | null {
  const code = `Mouse${event.button}`;
  return BINDABLE_POINTER_CODE.test(code) ? eventBinding(code, event) : null;
}

export function matchesKeyboardBinding(event: KeyboardEvent, binding: string | null): boolean {
  const actual = bindingFromKeyboardEvent(event);
  return binding !== null && actual !== null && matchesEventBinding(actual, binding);
}

export function matchesMouseBinding(event: MouseEvent, binding: string | null): boolean {
  const actual = bindingFromMouseEvent(event);
  return binding !== null && actual !== null && matchesEventBinding(actual, binding);
}

function matchesEventBinding(actual: string, expected: string): boolean {
  if (!expected.startsWith('Primary+')) return actual === expected;
  const rest = expected.slice('Primary+'.length);
  return actual === `Ctrl+${rest}` || actual === `Meta+${rest}`;
}

export function bindingAllowedFor(action: KeybindingAction, binding: string): boolean {
  const parts = binding.split('+');
  const code = parts.at(-1) ?? '';
  const mouse = code.startsWith('Mouse');
  if (code === 'Escape') return action === ESCAPE_ACTION && parts.length === 1;
  if (action === 'workFlagOrder') {
    return mouse && code !== 'Mouse1' && parts.length > 1 && binding !== 'Shift+Mouse0';
  }
  return !mouse && !parts.includes('Primary');
}

/** The bindings a player moved off their defaults, which is all that settings keep. */
export function changedKeyBindings(bindings: KeyBindings): Partial<Record<KeybindingAction, string | null>> {
  return Object.fromEntries(
    KEYBINDING_ACTIONS.filter((action) => bindings[action] !== DEFAULT_KEY_BINDINGS[action]).map((action) => [
      action,
      bindings[action],
    ]),
  );
}

/**
 * Parse stored bindings, filling missing or malformed actions from the current defaults. A stored chord
 * claims its key before any default does, so a new default never takes a key the player picked; within
 * each pass the earlier action wins a doubly-claimed chord and the later one is left unbound.
 */
export function parseKeyBindings(value: unknown): KeyBindings {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const taken = new Set<string>();
  const claim = (binding: string | null): string | null => {
    if (binding === null || taken.has(binding)) return null;
    taken.add(binding);
    return binding;
  };
  const own = new Map<KeybindingAction, string | null>();
  for (const action of KEYBINDING_ACTIONS) {
    const stored = record[action];
    if (stored === null) own.set(action, null);
    else if (typeof stored === 'string' && isBindableBinding(stored) && bindingAllowedFor(action, stored)) {
      own.set(action, claim(stored));
    }
  }
  const result = {} as Record<KeybindingAction, string | null>;
  for (const action of KEYBINDING_ACTIONS) {
    const binding = own.get(action);
    result[action] = binding !== undefined ? binding : claim(DEFAULT_KEY_BINDINGS[action]);
  }
  return result;
}

/** Give `binding` to `action`; an action previously holding the same chord becomes unbound. */
export function assignBinding(bindings: KeyBindings, action: KeybindingAction, binding: string): KeyBindings {
  const next: Record<KeybindingAction, string | null> = { ...bindings, [action]: binding };
  for (const other of KEYBINDING_ACTIONS) {
    if (other !== action && bindings[other] === binding) next[other] = null;
  }
  return next;
}

const CODE_LABELS: Readonly<Record<string, string>> = {
  Escape: 'Esc',
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

export interface BindingDisplayNames {
  readonly space: string;
  readonly mouseLeft?: string;
  readonly mouseMiddle?: string;
  readonly mouseRight?: string;
}

/** Player-facing label for a normalized binding chord. */
export function keyDisplayLabel(binding: string, names: BindingDisplayNames): string {
  const parts = binding.split('+');
  const code = parts.pop() ?? binding;
  let codeLabel = CODE_LABELS[code] ?? code;
  if (code === 'Space') codeLabel = names.space;
  else if (code === 'Mouse0') codeLabel = names.mouseLeft ?? 'Mouse 1';
  else if (code === 'Mouse1') codeLabel = names.mouseMiddle ?? 'Mouse 3';
  else if (code === 'Mouse2') codeLabel = names.mouseRight ?? 'Mouse 2';
  else codeLabel = /^Key([A-Z])$/.exec(code)?.[1] ?? codeLabel;
  const digit = /^Digit([0-9])$/.exec(code)?.[1];
  if (digit !== undefined) codeLabel = digit;
  const numpad = /^Numpad([0-9])$/.exec(code)?.[1];
  if (numpad !== undefined) codeLabel = `Num ${numpad}`;
  return [...parts.map((part) => (part === 'Primary' ? 'Ctrl/Cmd' : part)), codeLabel].join(' + ');
}
