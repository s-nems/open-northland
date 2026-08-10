import { messages } from '../i18n/index.js';
import { el } from './dom.js';
import { showPhase } from './phases.js';

/**
 * The setup page's last-resort surface: every label on the card is filled by script, so a failure
 * before or during boot would otherwise leave an empty card with dead buttons. It fills only the
 * shell-neutral copy, because the shell whose state would word the rest is what just failed.
 */
export function showSetupBlocked(message: string): void {
  const t = messages().setup;
  document.title = t.title;
  el('intro').innerHTML = t.introHtml;
  showPhase('blocked');
  el('blocked-message').textContent = message;
}
