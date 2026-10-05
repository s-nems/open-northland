import { MAX_CHAT_LENGTH } from '@open-northland/net-protocol';
import { quietTextField } from '../../hud/dom/parts/text-field.js';
import type { Rect } from '../../hud/geometry.js';
import type { NetChatLine } from '../../hud/network/model.js';
import { messages } from '../../i18n/index.js';
import { el } from '../overlay.js';

/** Lines kept on screen; older ones scroll off. */
const MAX_LINES = 8;
/** The log's column width in client px. */
const LOG_WIDTH_PX = 380;
/** Client px kept clear between the log and the viewport's side edges. */
const EDGE_CLEARANCE_PX = 12;
/** Design px between the navigation beam's top edge and the log's foot. */
const BEAM_GAP = 8;
/** Wall ms the log stays up after its newest line before it fades. */
export const CHAT_LINGER_MS = 8000;
/** Wall ms the log takes to fade out. */
const FADE_MS = 600;
/** Over the canvas and the perf readout; the system menu and every dialog sit above. */
const CHAT_Z_INDEX = '60';
const LOG_STYLE = [
  'position:fixed',
  'display:flex',
  'flex-direction:column',
  'justify-content:flex-end',
  'gap:2px',
  'color:#e8dcc0',
  'font:13px/1.35 ui-serif,Georgia,serif',
  'text-shadow:0 1px 2px rgba(0,0,0,0.9)',
  'pointer-events:none',
  `z-index:${CHAT_Z_INDEX}`,
].join(';');
const LINES_STYLE = [
  'display:flex',
  'flex-direction:column',
  'gap:2px',
  `transition:opacity ${FADE_MS}ms`,
].join(';');
const INPUT_STYLE = [
  'box-sizing:border-box',
  'width:100%',
  'margin-top:6px',
  'padding:6px 8px',
  'background:rgba(20,16,12,0.92)',
  'color:#e8dcc0',
  'font:inherit',
  'border:1px solid rgba(138,116,74,0.7)',
  'border-radius:5px',
  'pointer-events:auto',
].join(';');

export interface ChatPanel {
  /** Once a frame: take the room's newest lines (the same `version` twice costs nothing), show the log
   *  while a line is fresh or the line is open, and follow the beam. */
  refresh(chat: readonly NetChatLine[], version: number): void;
  /** Hide the log while the network window shows the whole chat over it; hiding closes the line,
   *  since the window's own field is the chat while it is open. */
  setHidden(hidden: boolean): void;
  /** True while the line is open under the player's keys. */
  typing(): boolean;
  dispose(): void;
}

export interface ChatPanelDeps {
  /** The HUD's scale: client px per design px. */
  readonly scale: () => number;
  /** The navigation beam's box in client px. */
  readonly beam: () => Rect;
  readonly onSend: (text: string) => void;
  /** Wall ms; the lines linger by it. */
  readonly now?: () => number;
}

/** Where the log stands, in client px from the viewport's left and bottom edges. */
export interface ChatLogPlacement {
  readonly left: number;
  readonly bottom: number;
  readonly width: number;
}

/** A fixed-width column centred on the beam's axis, its foot a gap above the beam's top, narrowed and
 *  slid only as far as the viewport's side edges demand. */
export function chatLogPlacement(
  viewport: { readonly width: number; readonly height: number },
  beam: Rect,
  scale: number,
): ChatLogPlacement {
  const width = Math.max(0, Math.min(LOG_WIDTH_PX, viewport.width - 2 * EDGE_CLEARANCE_PX));
  const centred = Math.round(beam.x + beam.w / 2 - width / 2);
  const left = Math.max(EDGE_CLEARANCE_PX, Math.min(centred, viewport.width - EDGE_CLEARANCE_PX - width));
  return { left, bottom: Math.round(viewport.height - beam.y + BEAM_GAP * scale), width };
}

/** True for a keydown the page itself owns: not typed into a field or answered on a button. */
function fromThePage(event: KeyboardEvent): boolean {
  const target = event.target;
  return !(target instanceof HTMLElement) || target === document.body || target instanceof HTMLCanvasElement;
}

/** The chat above the navigation beam: the line Enter opens in a fixed slot at the column's foot, and
 *  the log stacking upward from it, which shows while a line is fresh or the line is open. */
export function mountChatPanel(deps: ChatPanelDeps): ChatPanel {
  const copy = messages().net;
  const now = deps.now ?? (() => performance.now());
  const log = el('div', LOG_STYLE);
  let placed = '';
  const position = (): void => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const next = chatLogPlacement(viewport, deps.beam(), deps.scale());
    const key = `${next.left},${next.bottom},${next.width}`;
    if (key === placed) return;
    placed = key;
    log.style.left = `${next.left}px`;
    log.style.bottom = `${next.bottom}px`;
    log.style.width = `${next.width}px`;
  };
  position();
  log.setAttribute('role', 'log');
  const lines = el('div', LINES_STYLE);
  const input = el('input', INPUT_STYLE);
  input.type = 'text';
  quietTextField(input);
  input.maxLength = MAX_CHAT_LENGTH;
  input.placeholder = copy.chatPlaceholder;
  input.setAttribute('aria-label', copy.chatPlaceholder);
  // The closed line keeps its slot, so opening it never moves the log.
  input.style.visibility = 'hidden';
  log.append(lines, input);
  document.body.append(log);

  let logHidden = false;
  let lineOpen = false;
  let lastLineAt = Number.NEGATIVE_INFINITY;
  let linesShown = true;
  const showLines = (): void => {
    const shown = lineOpen || now() - lastLineAt < CHAT_LINGER_MS;
    if (shown === linesShown) return;
    linesShown = shown;
    lines.style.opacity = shown ? '1' : '0';
  };
  showLines();
  const setLineOpen = (open: boolean): void => {
    lineOpen = open;
    input.style.visibility = open ? 'visible' : 'hidden';
    if (open) {
      input.focus();
    } else {
      input.value = '';
      input.blur();
    }
    showLines();
  };
  const onPageKey = (event: KeyboardEvent): void => {
    if (logHidden || event.key !== 'Enter' || lineOpen || !fromThePage(event)) return;
    event.preventDefault();
    setLineOpen(true);
  };
  input.addEventListener('keydown', (event) => {
    // Neither key may reach the page: Escape would open the system menu, Enter reopen the line.
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setLineOpen(false);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const text = input.value.trim();
      if (text.length > 0) deps.onSend(text);
      setLineOpen(false);
    }
  });
  document.addEventListener('keydown', onPageKey);

  let shownVersion = -1;
  return {
    refresh(chat, version): void {
      position();
      if (version !== shownVersion) {
        if (version > shownVersion && chat.length > 0) lastLineAt = now();
        shownVersion = version;
        lines.replaceChildren(...chat.slice(-MAX_LINES).map(lineRow));
      }
      showLines();
    },
    setHidden(hidden): void {
      if (hidden === logHidden) return;
      logHidden = hidden;
      if (hidden && lineOpen) setLineOpen(false);
      log.style.display = hidden ? 'none' : 'flex';
    },
    typing: () => lineOpen,
    dispose(): void {
      document.removeEventListener('keydown', onPageKey);
      log.remove();
    },
  };
}

function lineRow(line: NetChatLine): HTMLDivElement {
  const row = el(
    'div',
    `overflow-wrap:anywhere;${line.from === null ? 'opacity:0.75;font-style:italic' : ''}`,
  );
  if (line.from !== null) row.append(el('span', 'font-weight:700', `${line.from}: `));
  row.append(document.createTextNode(line.text));
  return row;
}
