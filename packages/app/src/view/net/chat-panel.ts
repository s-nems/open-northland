import { MAX_CHAT_LENGTH } from '@open-northland/net-protocol';
import { quietTextField } from '../../hud/dom/parts/text-field.js';
import type { Rect } from '../../hud/geometry.js';
import type { ChatLine } from '../../hud/network/model.js';
import { NOTICE_COLUMN } from '../../hud/regions.js';
import { messages } from '../../i18n/index.js';
import { el } from '../overlay.js';

/** Lines kept on screen; older ones scroll off. */
const MAX_LINES = 8;
/** The log's width in client px when nothing crowds it. */
const LOG_WIDTH_PX = 380;
/** The narrowest log that still reads beside the navigation beam; a narrower gap lifts it above. */
const MIN_BESIDE_BEAM_WIDTH_PX = 240;
/** Px kept clear between the log and the minimap, the window's right edge or the beam. */
const CLEARANCE_PX = 12;
/** Design px between the notice column's right edge and the log, so the log never covers a notice. */
const NOTICE_COLUMN_GAP = 12;
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
   *  while a line is fresh or the line is open, and follow the minimap. */
  refresh(chat: readonly ChatLine[], version: number): void;
  /** Hide the log while the network window shows the whole chat over it; hiding closes the line,
   *  since the window's own field is the chat while it is open. */
  setHidden(hidden: boolean): void;
  dispose(): void;
}

export interface ChatPanelDeps {
  /** The HUD's scale: client px per design px. */
  readonly scale: () => number;
  /** The minimap's box in client px, which the log stands on; null while it is hidden. */
  readonly minimap: () => Rect | null;
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

/** The log's left edge and the y its foot stands on, in client px: right of the notice column, on the
 *  minimap's top edge, or on the viewport's foot without a minimap. */
export function chatLogArea(
  scale: number,
  viewportHeight: number,
  minimap: Rect | null,
): { readonly left: number; readonly floor: number } {
  const clearOfNotices = (NOTICE_COLUMN.left + NOTICE_COLUMN.width + NOTICE_COLUMN_GAP) * scale;
  return {
    left: Math.max(minimap?.x ?? 0, clearOfNotices),
    floor: minimap === null ? viewportHeight : minimap.y,
  };
}

/** Standing on `floor`; a log that would reach down beside the beam narrows to end before it while
 *  that leaves a readable column, else rises above it. Never past the viewport's right edge. */
export function chatLogPlacement(
  area: { readonly left: number; readonly floor: number },
  viewport: { readonly width: number; readonly height: number },
  beam: Rect,
): ChatLogPlacement {
  const { left } = area;
  const bottom = viewport.height - area.floor + CLEARANCE_PX;
  const width = Math.max(0, Math.min(LOG_WIDTH_PX, viewport.width - left - CLEARANCE_PX));
  const clearOfBeam = viewport.height - bottom <= beam.y || left + width + CLEARANCE_PX <= beam.x;
  if (clearOfBeam) return { left, bottom, width };
  const beside = beam.x - left - CLEARANCE_PX;
  if (beside >= MIN_BESIDE_BEAM_WIDTH_PX) return { left, bottom, width: beside };
  return { left, bottom: viewport.height - beam.y + CLEARANCE_PX, width };
}

/** True for a keydown the page itself owns: not typed into a field or answered on a button. */
function fromThePage(event: KeyboardEvent): boolean {
  const target = event.target;
  return !(target instanceof HTMLElement) || target === document.body || target instanceof HTMLCanvasElement;
}

/** The chat over the minimap: the line Enter opens in a fixed slot on the minimap's top edge, and the
 *  log above it, which shows while a line is fresh or the line is open. */
export function mountChatPanel(deps: ChatPanelDeps): ChatPanel {
  const copy = messages().net;
  const now = deps.now ?? (() => performance.now());
  const log = el('div', LOG_STYLE);
  let placed = '';
  const position = (): void => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const next = chatLogPlacement(
      chatLogArea(deps.scale(), viewport.height, deps.minimap()),
      viewport,
      deps.beam(),
    );
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
    dispose(): void {
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
