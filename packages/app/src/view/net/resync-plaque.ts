import { messages } from '../../i18n/index.js';

export interface ResyncPlaque {
  /** Replace the line: the wait for the snapshot, then the rebuild from it. */
  update(text: string): void;
  dispose(): void;
}

/** The plaque that says why this client's game froze and then reloads: it is out of sync and rebuilds
 *  from another member's snapshot. Mounted on the desync notice, kept over the loading card, removed
 *  once the rebuilt world shows. */
export function mountResyncPlaque(text: string): ResyncPlaque {
  const root = document.createElement('div');
  root.className = 'boot-roster boot-resync';
  root.setAttribute('role', 'alert');
  const heading = document.createElement('div');
  heading.className = 'boot-roster__heading';
  heading.textContent = messages().net.resyncTitle;
  const line = document.createElement('p');
  line.className = 'boot-resync__text';
  line.textContent = text;
  root.append(heading, line);
  document.body.append(root);
  return {
    update(next): void {
      line.textContent = next;
    },
    dispose: () => root.remove(),
  };
}
