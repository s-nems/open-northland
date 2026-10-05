import { MAX_CHAT_LENGTH } from '@open-northland/net-protocol';
import { quietTextField } from '../../hud/dom/parts/text-field.js';
import type { Rect } from '../../hud/geometry.js';
import type { ChatLine } from '../../hud/network/model.js';
import { messages } from '../../i18n/index.js';
import { el } from '../overlay.js';

/** Lines kept on screen; older ones scroll off. */
const MAX_LINES = 8;
/** The log's width in client px when nothing crowds it. */
const LOG_WIDTH_PX = 380;
/** The narrowest log that still reads beside the navigation beam; a narrower gap lifts it above. */
const MIN_BESIDE_BEAM_WIDTH_PX = 240;
/** Px kept clear between the log and the window's right edge or the beam. */
const CLEARANCE_PX = 12;
/** Over the canvas and the perf readout; the system menu and every dialog sit above. */
const CHAT_Z_INDEX = '60';
const LOG_STYLE = [
  'position:fixed',
  'display:flex',
  'flex-direction:column',
  'gap:2px',
  'color:#e8dcc0',
  'font:13px/1.35 ui-serif,Georgia,serif',
  'text-shadow:0 1px 2px rgba(0,0,0,0.9)',
  'pointer-events:none',
  `z-index:${CHAT_Z_INDEX}`,
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
  /** Show the newest of the room's lines; the same `version` twice costs nothing. */
  show(chat: readonly ChatLine[], version: number): void;
  /** Follow the left inset, which moves with the minimap. */
  updateLayout(): void;
  /** Hide the log while the network window shows the whole chat over it. */
  setHidden(hidden: boolean): void;
  /** The log's left and top edge in client px; the top rises as lines arrive. */
  anchor(): { readonly left: number; readonly top: number };
  dispose(): void;
}

export interface ChatPanelDeps {
  /** Left edge in client px, clear of the minimap. */
  readonly leftPx: () => number;
  /** The navigation beam's box in client px. */
  readonly beam: () => Rect;
  readonly onSend: (text: string) => void;
}

/** Where the log stands, in client px from the viewport's left and bottom edges. */
export interface ChatLogPlacement {
  readonly left: number;
  readonly bottom: number;
  readonly width: number;
}

/** Beside the beam, narrowed to end before it, while that leaves a readable column; else above the
 *  beam at full width. Never past the viewport's right edge. */
export function chatLogPlacement(
  left: number,
  viewport: { readonly width: number; readonly height: number },
  beam: Rect,
): ChatLogPlacement {
  const fits = Math.max(0, Math.min(LOG_WIDTH_PX, viewport.width - left - CLEARANCE_PX));
  if (left + fits + CLEARANCE_PX <= beam.x) return { left, bottom: CLEARANCE_PX, width: fits };
  const beside = beam.x - left - CLEARANCE_PX;
  if (beside >= MIN_BESIDE_BEAM_WIDTH_PX) return { left, bottom: CLEARANCE_PX, width: beside };
  return { left, bottom: viewport.height - beam.y + CLEARANCE_PX, width: fits };
}

/** True for a keydown the page itself owns: not typed into a field or answered on a button. */
function fromThePage(event: KeyboardEvent): boolean {
  const target = event.target;
  return !(target instanceof HTMLElement) || target === document.body || target instanceof HTMLCanvasElement;
}

/** The chat log above the bottom edge and the line Enter opens to type into. */
export function mountChatPanel(deps: ChatPanelDeps): ChatPanel {
  const copy = messages().net;
  const log = el('div', LOG_STYLE);
  let left = Number.NaN;
  let placed = '';
  const position = (): void => {
    const next = chatLogPlacement(
      deps.leftPx(),
      { width: window.innerWidth, height: window.innerHeight },
      deps.beam(),
    );
    const key = `${next.left},${next.bottom},${next.width}`;
    if (key === placed) return;
    placed = key;
    left = next.left;
    log.style.left = `${next.left}px`;
    log.style.bottom = `${next.bottom}px`;
    log.style.width = `${next.width}px`;
  };
  position();
  window.addEventListener('resize', position);
  log.setAttribute('role', 'log');
  const lines = el('div', 'display:flex;flex-direction:column;gap:2px');
  const input = el('input', INPUT_STYLE);
  input.type = 'text';
  quietTextField(input);
  input.maxLength = MAX_CHAT_LENGTH;
  input.placeholder = copy.chatPlaceholder;
  input.setAttribute('aria-label', copy.chatPlaceholder);
  input.hidden = true;
  log.append(lines, input);
  document.body.append(log);

  const closeInput = (): void => {
    input.hidden = true;
    input.value = '';
    input.blur();
  };
  const onPageKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' || !input.hidden || !fromThePage(event)) return;
    event.preventDefault();
    input.hidden = false;
    input.focus();
  };
  input.addEventListener('keydown', (event) => {
    // Neither key may reach the page: Escape would open the system menu, Enter reopen the line.
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeInput();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const text = input.value.trim();
      if (text.length > 0) deps.onSend(text);
      closeInput();
    }
  });
  document.addEventListener('keydown', onPageKey);

  let shownVersion = -1;
  return {
    updateLayout: position,
    show(chat, version): void {
      if (version === shownVersion) return;
      shownVersion = version;
      lines.replaceChildren(...chat.slice(-MAX_LINES).map(lineRow));
    },
    setHidden(hidden): void {
      const display = hidden ? 'none' : 'flex';
      if (log.style.display !== display) log.style.display = display;
    },
    anchor(): { left: number; top: number } {
      return { left, top: log.getBoundingClientRect().top };
    },
    dispose(): void {
      window.removeEventListener('resize', position);
      document.removeEventListener('keydown', onPageKey);
      log.remove();
    },
  };
}

function lineRow(line: ChatLine): HTMLDivElement {
  const row = el(
    'div',
    `overflow-wrap:anywhere;${line.from === null ? 'opacity:0.75;font-style:italic' : ''}`,
  );
  if (line.from !== null) row.append(el('span', 'font-weight:700', `${line.from}: `));
  row.append(document.createTextNode(line.text));
  return row;
}
