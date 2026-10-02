import { type KeyBindings, type KeybindingAction, keyDisplayLabel } from '../hud/keybindings.js';
import { currentLocale, formatMessage, type Locale, messages } from '../i18n/index.js';

export type LoadingTipId = keyof ReturnType<typeof messages>['loadingTips']['tips'];

interface LoadingTip {
  readonly id: LoadingTipId;
  /** The action whose binding fills `{key}`; a tip whose action is unbound is not shown. */
  readonly key?: KeybindingAction;
}

const LOADING_TIPS: readonly LoadingTip[] = [
  { id: 'queueOrders' },
  { id: 'attackMove', key: 'attackMove' },
  { id: 'postGraduates', key: 'assistant' },
  { id: 'moveFlags', key: 'assistant' },
  { id: 'lobbyNation' },
  { id: 'roads', key: 'roadTool' },
  { id: 'upgrade', key: 'upgradeBuilding' },
  { id: 'buildRun' },
  { id: 'nextCivilian', key: 'nextCivilian' },
  { id: 'nextSingleWoman', key: 'nextSingleWoman' },
  { id: 'signposts' },
  { id: 'porterFlag' },
  { id: 'nationSwitch', key: 'construction' },
];

/** The queue modifier is fixed rather than a binding, so it is named here once. */
const QUEUE_MODIFIER = 'Shift';

/** The tips the player's bindings can show. */
export function availableTips(bindings: KeyBindings): LoadingTipId[] {
  return LOADING_TIPS.filter((tip) => tip.key === undefined || bindings[tip.key] !== null).map(
    (tip) => tip.id,
  );
}

/** A tip's text as runs of plain text and keycap labels, in order. */
export type TipSegment = { readonly text: string } | { readonly keycap: string };

export function tipSegments(
  id: LoadingTipId,
  bindings: KeyBindings,
  locale: Locale = currentLocale(),
): TipSegment[] {
  const text = messages(locale);
  const template = formatMessage(text.loadingTips.tips[id], {
    graduatesOption: text.hud.extras.postGraduates,
    flagsOption: text.hud.extras.moveFlags,
    area: text.hud.settlerPanel.workArea,
  });
  const action = LOADING_TIPS.find((tip) => tip.id === id)?.key;
  const binding = action === undefined ? null : bindings[action];
  return template
    .split(/(\{key\}|\{shift\})/)
    .filter((part) => part.length > 0)
    .map((part) => {
      if (part === '{shift}') return { keycap: QUEUE_MODIFIER };
      if (part === '{key}' && binding !== null) return { keycap: keyDisplayLabel(binding) };
      return { text: part };
    });
}

/**
 * The next tip off a shuffled deck: every available tip shows once before any repeats, and a fresh
 * deck never opens with the tip shown last. `deck` is the stored remainder; ids no longer available
 * drop out of it.
 */
export function drawTip(
  deck: readonly LoadingTipId[],
  available: readonly LoadingTipId[],
  last: LoadingTipId | null,
  random: () => number,
): { readonly tip: LoadingTipId | null; readonly rest: LoadingTipId[] } {
  let remaining = deck.filter((id) => available.includes(id));
  if (remaining.length === 0) remaining = shuffledAvoidingFirst(available, last, random);
  const [tip = null, ...rest] = remaining;
  return { tip, rest };
}

function shuffledAvoidingFirst(
  ids: readonly LoadingTipId[],
  avoid: LoadingTipId | null,
  random: () => number,
): LoadingTipId[] {
  const deck = [...ids];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j] as LoadingTipId, deck[i] as LoadingTipId];
  }
  if (deck.length > 1 && deck[0] === avoid) {
    const swap = 1 + Math.floor(random() * (deck.length - 1));
    [deck[0], deck[swap]] = [deck[swap] as LoadingTipId, deck[0]];
  }
  return deck;
}

/** The deck outlives the page, so each loading screen across visits draws the next card. */
const DECK_KEY = 'open-northland.loadingTips.deck';
const LAST_KEY = 'open-northland.loadingTips.last';

function isTipId(value: unknown): value is LoadingTipId {
  return LOADING_TIPS.some((tip) => tip.id === value);
}

function storedDeck(raw: string | null): LoadingTipId[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isTipId) : [];
  } catch {
    return [];
  }
}

/** Draw this loading screen's tip and advance the stored deck. Storage denied still draws at random. */
export function nextLoadingTip(
  bindings: KeyBindings,
  random: () => number = cryptoRandom,
): LoadingTipId | null {
  let deck: LoadingTipId[] = [];
  let last: LoadingTipId | null = null;
  try {
    deck = storedDeck(window.localStorage.getItem(DECK_KEY));
    const stored = window.localStorage.getItem(LAST_KEY);
    last = isTipId(stored) ? stored : null;
  } catch {
    // Storage denied (private mode): a fresh deck every load.
  }
  const { tip, rest } = drawTip(deck, availableTips(bindings), last, random);
  try {
    window.localStorage.setItem(DECK_KEY, JSON.stringify(rest));
    if (tip !== null) window.localStorage.setItem(LAST_KEY, tip);
  } catch {
    // Storage denied: the next load starts its own deck.
  }
  return tip;
}

/** A uniform draw in [0, 1) from the platform's cryptographic source. */
function cryptoRandom(): number {
  return (crypto.getRandomValues(new Uint32Array(1))[0] as number) / 2 ** 32;
}

/** The tip panel for the boot card, or null when no tip is available. */
export function loadingTipPanel(bindings: KeyBindings): HTMLElement | null {
  const tip = nextLoadingTip(bindings);
  if (tip === null) return null;
  const heading = document.createElement('div');
  heading.className = 'boot-tip__heading';
  heading.textContent = messages().loadingTips.heading;
  const body = document.createElement('p');
  body.className = 'boot-tip__text';
  for (const segment of tipSegments(tip, bindings)) {
    if ('keycap' in segment) {
      const kbd = document.createElement('kbd');
      kbd.className = 'boot-tip__key';
      kbd.textContent = segment.keycap;
      body.append(kbd);
    } else {
      body.append(segment.text);
    }
  }
  const panel = document.createElement('aside');
  panel.className = 'boot-tip';
  panel.append(heading, body);
  return panel;
}
