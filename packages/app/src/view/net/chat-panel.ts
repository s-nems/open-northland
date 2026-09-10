import { MAX_CHAT_LENGTH } from '@open-northland/net-protocol';
import { messages } from '../../i18n/index.js';
import { el } from '../overlay.js';

/** Lines kept on screen; older ones scroll off. */
const MAX_LINES = 8;
/** Over the canvas and the perf readout; the system menu and every dialog sit above. */
const CHAT_Z_INDEX = '60';
const LOG_STYLE = [
  'position:fixed',
  'bottom:12px',
  'width:380px',
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

export interface ChatLine {
  /** The sender's nick, or null for a line about the session itself. */
  readonly from: string | null;
  readonly text: string;
}

export interface ChatPanel {
  append(line: ChatLine): void;
  dispose(): void;
}

export interface ChatPanelDeps {
  /** Left edge in px, clear of the tool-panel strip. */
  readonly leftPx: number;
  readonly onSend: (text: string) => void;
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
  log.style.left = `${deps.leftPx}px`;
  log.setAttribute('role', 'log');
  const lines = el('div', 'display:flex;flex-direction:column;gap:2px');
  const input = el('input', INPUT_STYLE);
  input.type = 'text';
  input.maxLength = MAX_CHAT_LENGTH;
  input.placeholder = copy.chatPlaceholder;
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

  return {
    append(line): void {
      const row = el('div', line.from === null ? 'opacity:0.75;font-style:italic' : '');
      if (line.from !== null) row.append(el('span', 'font-weight:700', `${line.from}: `));
      row.append(document.createTextNode(line.text));
      lines.append(row);
      while (lines.childElementCount > MAX_LINES) lines.firstElementChild?.remove();
    },
    dispose(): void {
      document.removeEventListener('keydown', onPageKey);
      log.remove();
    },
  };
}
