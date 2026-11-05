import { messages } from '../i18n/index.js';

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

/** A spectator's keys to watch the first nine seats of its picker, in the picker's order. */
export const SPECTATOR_SEAT_ACTIONS = [
  'watchSeat1',
  'watchSeat2',
  'watchSeat3',
  'watchSeat4',
  'watchSeat5',
  'watchSeat6',
  'watchSeat7',
  'watchSeat8',
  'watchSeat9',
] as const;

export const SPECTATOR_ACTIONS = [
  ...SPECTATOR_SEAT_ACTIONS,
  'watchPlayersSight',
  'watchRevealedMap',
] as const;

export type SpectatorAction = (typeof SPECTATOR_ACTIONS)[number];

/** Display order of the bindings table; also the priority order when stored bindings collide. */
export const KEYBINDING_ACTIONS = [
  'panUp',
  'panDown',
  'panLeft',
  'panRight',
  'pauseToggle',
  'speedCycle',
  'gameMenu',
  'loadGame',
  'saveGame',
  'mission',
  'construction',
  'residents',
  'assistant',
  'statistics',
  'diplomacy',
  'diplomacyMap',
  'knowledge',
  'network',
  'hudToggle',
  'jumpToStore',
  'actionRing',
  'professionPicker',
  'equipmentPicker',
  'assignWorkplace',
  'assignHome',
  'attackMove',
  'dockShips',
  'workFlagOrder',
  'roadTool',
  'palisadeTool',
  'upgradeGround',
  'gateTool',
  'upgradeBuilding',
  'defenceOn',
  'defenceOff',
  'buildingAlarm',
  'nextCivilian',
  'nextScout',
  'nextSingleWoman',
  'selectSoldiers',
  'addSoldiers',
  'selectHeroes',
  'keepHeroes',
  'keepSoldiers',
  ...CONTROL_GROUP_BINDING_ACTIONS,
  ...SPECTATOR_ACTIONS,
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

const spectatorSeatDefaults = Object.fromEntries(
  SPECTATOR_SEAT_ACTIONS.map((action, index) => [action, `Digit${index + 1}`]),
) as Pick<KeyBindings, (typeof SPECTATOR_SEAT_ACTIONS)[number]>;

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  panLeft: 'ArrowLeft',
  panRight: 'ArrowRight',
  panUp: 'ArrowUp',
  panDown: 'ArrowDown',
  // The defaults follow the original's keys where it has one: F3 load, F4 save, F5 diplomacy, F6
  // statistics, B, E, S, D, Shift+D, V, Shift+V, P, L, H, the selection keys . , / M F X Y, C, W and the
  // digit groups. Ours: Esc's game menu (the original's options sit on F2), F1 the mission (the
  // original's help), F2 the subjects (the original's F7), F7 the knowledge (the original's technology
  // tree on F8), F8 the HUD, N the network panel of a relayed game (a letter: Mac keyboards give F9 to
  // media keys), O the diplomacy map, Q for the original's A (Assign Work Place), so A stays
  // attack-move, R the shown building's Upgrade, Alt+V the shown building's alarm beside the original's
  // V, I the selection's equipment window (the common inventory key), Z the selected ships' dock order.
  pauseToggle: 'KeyP',
  speedCycle: 'KeyL',
  gameMenu: 'Escape',
  loadGame: 'F3',
  saveGame: 'F4',
  mission: 'F1',
  construction: 'KeyB',
  residents: 'F2',
  assistant: 'KeyE',
  statistics: 'F6',
  diplomacy: 'F5',
  diplomacyMap: 'KeyO',
  knowledge: 'F7',
  network: 'KeyN',
  hudToggle: 'F8',
  jumpToStore: 'KeyH',
  actionRing: 'Space',
  professionPicker: 'KeyC',
  equipmentPicker: 'KeyI',
  assignWorkplace: 'KeyQ',
  assignHome: 'KeyW',
  attackMove: 'KeyA',
  dockShips: 'KeyZ',
  workFlagOrder: 'Primary+Mouse2',
  roadTool: 'KeyS',
  palisadeTool: 'KeyD',
  // Beside the road and wall keys, with F left to the original's heroes key; a rare order, so it
  // toggles rather than taking a held modifier.
  upgradeGround: 'KeyG',
  gateTool: 'Shift+KeyD',
  upgradeBuilding: 'KeyR',
  defenceOn: 'KeyV',
  defenceOff: 'Shift+KeyV',
  buildingAlarm: 'Alt+KeyV',
  nextCivilian: 'Period',
  nextScout: 'Comma',
  nextSingleWoman: 'Slash',
  selectSoldiers: 'KeyM',
  addSoldiers: 'Shift+KeyM',
  selectHeroes: 'KeyF',
  keepHeroes: 'KeyX',
  keepSoldiers: 'KeyY',
  ...controlGroupDefaults,
  // A spectator's digits pick the seats, 0 the revealed map beside them, the key left of 1 the
  // players' sight.
  ...spectatorSeatDefaults,
  watchPlayersSight: 'Backquote',
  watchRevealedMap: 'Digit0',
};

const SPECTATOR_ACTION_SET: ReadonlySet<string> = new Set(SPECTATOR_ACTIONS);
const CONTROL_GROUP_BINDING_SET: ReadonlySet<string> = new Set(CONTROL_GROUP_BINDING_ACTIONS);

export function isSpectatorAction(action: KeybindingAction): action is SpectatorAction {
  return SPECTATOR_ACTION_SET.has(action);
}

/**
 * Whether two actions may not hold the same chord. A spectator's keys answer only while it watches,
 * where its control groups give way to them, so the two may share one; every other pair conflicts.
 */
export function bindingsConflict(a: KeybindingAction, b: KeybindingAction): boolean {
  const spectatorBesideGroup =
    (isSpectatorAction(a) && CONTROL_GROUP_BINDING_SET.has(b)) ||
    (isSpectatorAction(b) && CONTROL_GROUP_BINDING_SET.has(a));
  return !spectatorBesideGroup;
}

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

export type ModifierState = Pick<KeyboardEvent | MouseEvent, 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>;
/** A mouse press as a binding reads it: its button and the modifiers held. */
export type MousePress = ModifierState & Pick<MouseEvent, 'button'>;

/** The fields a key binding reads off a press. */
export type KeyPress = ModifierState & Pick<KeyboardEvent, 'code'>;

function eventBinding(code: string, event: ModifierState): string {
  const modifiers = [
    ...(event.ctrlKey ? ['Ctrl'] : []),
    ...(event.shiftKey ? ['Shift'] : []),
    ...(event.altKey ? ['Alt'] : []),
    ...(event.metaKey ? ['Meta'] : []),
  ];
  return [...modifiers, code].join('+');
}

export function bindingFromKeyboardEvent(event: KeyPress): string | null {
  return isBindableCode(event.code) ? eventBinding(event.code, event) : null;
}

export function bindingFromMouseEvent(event: MousePress): string | null {
  const code = `Mouse${event.button}`;
  return BINDABLE_POINTER_CODE.test(code) ? eventBinding(code, event) : null;
}

export function matchesKeyboardBinding(event: KeyPress, binding: string | null): boolean {
  const actual = bindingFromKeyboardEvent(event);
  return binding !== null && actual !== null && matchesEventBinding(actual, binding);
}

/**
 * {@link matchesKeyboardBinding}, also taking the press with Shift held over a binding without Shift: the
 * key of an order the player gives while queueing orders with Shift.
 */
export function matchesKeyboardBindingUnderShift(event: KeyPress, binding: string | null): boolean {
  if (matchesKeyboardBinding(event, binding)) return true;
  if (!event.shiftKey || binding === null || binding.split('+').includes('Shift')) return false;
  const { code, ctrlKey, altKey, metaKey } = event;
  return matchesKeyboardBinding({ code, ctrlKey, shiftKey: false, altKey, metaKey }, binding);
}

export function matchesMouseBinding(event: MousePress, binding: string | null): boolean {
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
    // Shift + left and right click stay the selection toggle and the queued order.
    return (
      mouse &&
      code !== 'Mouse1' &&
      parts.length > 1 &&
      binding !== 'Shift+Mouse0' &&
      binding !== 'Shift+Mouse2'
    );
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
 * each pass the earlier action wins a chord two conflicting actions claim and the later one is left
 * unbound.
 */
export function parseKeyBindings(value: unknown): KeyBindings {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const holders = new Map<string, KeybindingAction[]>();
  const claim = (action: KeybindingAction, binding: string | null): string | null => {
    if (binding === null) return null;
    const held = holders.get(binding) ?? [];
    if (held.some((other) => bindingsConflict(action, other))) return null;
    held.push(action);
    holders.set(binding, held);
    return binding;
  };
  const own = new Map<KeybindingAction, string | null>();
  for (const action of KEYBINDING_ACTIONS) {
    const stored = record[action];
    if (stored === null) own.set(action, null);
    else if (typeof stored === 'string' && isBindableBinding(stored) && bindingAllowedFor(action, stored)) {
      own.set(action, claim(action, stored));
    }
  }
  const result = {} as Record<KeybindingAction, string | null>;
  for (const action of KEYBINDING_ACTIONS) {
    const binding = own.get(action);
    result[action] = binding !== undefined ? binding : claim(action, DEFAULT_KEY_BINDINGS[action]);
  }
  return result;
}

/** Give `binding` to `action`; an action conflicting with it that held the same chord becomes unbound. */
export function assignBinding(bindings: KeyBindings, action: KeybindingAction, binding: string): KeyBindings {
  const next: Record<KeybindingAction, string | null> = { ...bindings, [action]: binding };
  for (const other of KEYBINDING_ACTIONS) {
    if (other !== action && bindings[other] === binding && bindingsConflict(action, other))
      next[other] = null;
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
  readonly mouseLeft: string;
  readonly mouseMiddle: string;
  readonly mouseRight: string;
}

function localeBindingNames(): BindingDisplayNames {
  const text = messages().mainMenu.settings;
  return {
    space: text.keySpace,
    mouseLeft: text.mouseLeft,
    mouseMiddle: text.mouseMiddle,
    mouseRight: text.mouseRight,
  };
}

/** Player-facing label for a normalized binding chord. */
export function keyDisplayLabel(binding: string, names: BindingDisplayNames = localeBindingNames()): string {
  const parts = binding.split('+');
  const code = parts.pop() ?? binding;
  let codeLabel = CODE_LABELS[code] ?? code;
  if (code === 'Space') codeLabel = names.space;
  else if (code === 'Mouse0') codeLabel = names.mouseLeft;
  else if (code === 'Mouse1') codeLabel = names.mouseMiddle;
  else if (code === 'Mouse2') codeLabel = names.mouseRight;
  else codeLabel = /^Key([A-Z])$/.exec(code)?.[1] ?? codeLabel;
  const digit = /^Digit([0-9])$/.exec(code)?.[1];
  if (digit !== undefined) codeLabel = digit;
  const numpad = /^Numpad([0-9])$/.exec(code)?.[1];
  if (numpad !== undefined) codeLabel = `Num ${numpad}`;
  return [...parts.map((part) => (part === 'Primary' ? 'Ctrl/Cmd' : part)), codeLabel].join(' + ');
}
