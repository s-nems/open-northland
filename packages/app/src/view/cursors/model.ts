export const CURSOR_THEMES = ['iron', 'bone', 'amber', 'steel', 'system'] as const;
export type CursorTheme = (typeof CURSOR_THEMES)[number];
export type ArtCursorTheme = Exclude<CursorTheme, 'system'>;
export const CURSOR_SIZES = [24, 28, 32] as const;
export type CursorSize = (typeof CURSOR_SIZES)[number];
export const DEFAULT_CURSOR_THEME: CursorTheme = 'steel';
export const DEFAULT_CURSOR_SIZE: CursorSize = 28;

export const CURSOR_STATES = [
  'normal',
  'select',
  'pressed',
  'command',
  'pointer',
  'grab',
  'grabbing',
  'not-allowed',
  'move',
  'attack',
  'build',
  'work',
  'crosshair',
  'text',
  'help',
  'progress',
] as const;
export type CursorState = (typeof CURSOR_STATES)[number];

const FALLBACKS: Readonly<Record<CursorState, string>> = {
  normal: 'default',
  select: 'default',
  pressed: 'default',
  command: 'default',
  pointer: 'pointer',
  grab: 'grab',
  grabbing: 'grabbing',
  'not-allowed': 'not-allowed',
  move: 'crosshair',
  attack: 'crosshair',
  build: 'crosshair',
  work: 'crosshair',
  crosshair: 'crosshair',
  text: 'text',
  help: 'help',
  progress: 'progress',
};

export function parseCursorTheme(value: unknown): CursorTheme {
  return CURSOR_THEMES.find((theme) => theme === value) ?? DEFAULT_CURSOR_THEME;
}

export function parseCursorSize(value: unknown): CursorSize {
  return CURSOR_SIZES.find((size) => size === value) ?? DEFAULT_CURSOR_SIZE;
}

export function cursorFallback(state: CursorState): string {
  return FALLBACKS[state];
}

export function cursorVariable(state: CursorState): string {
  const name = state === 'normal' ? 'default' : state;
  return `var(--cursor-${name}, ${FALLBACKS[state]})`;
}
