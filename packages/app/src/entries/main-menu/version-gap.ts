import { formatMessage, type Messages, messages } from '../../i18n/index.js';
import { downloadPage, type RunningGame, type VersionGap } from '../../update/outdated.js';
import { reloadDocument } from '../../view/platform/navigation-guard.js';
import { node } from './dom.js';

/** Whose release differs from the game's: the game server's or the map catalogue's. */
export type VersionGapSource = 'relay' | 'catalogue';

/** A notice naming both releases and the one step that closes the gap, when the game is the older one:
 *  a reload on the web, the site's download page on the desktop. Its host is the live region. */
export function versionGapCard(
  gap: VersionGap,
  source: VersionGapSource,
  game: RunningGame,
  copy: Messages = messages(),
): HTMLElement {
  const text = copy.versionGap;
  const card = node('section', 'version-gap');
  const outdated = gap.kind === 'outdated';
  const other = outdated ? gap.required : gap.server;

  const versions = node('dl', 'version-gap__versions');
  versions.append(
    versionEntry(text.yours, game.version),
    versionEntry(outdated ? text.required : text.server, other ?? (outdated ? text.newer : text.older)),
  );
  const summary = node('div', 'version-gap__summary');
  summary.append(
    node('h3', 'version-gap__title', outdated ? text.outdatedTitle : aheadTitle(source, copy)),
    versions,
    node('p', 'version-gap__body', body(gap, source, copy)),
  );
  card.append(summary);
  // The catalogue's release may trail the newest one the download page offers.
  if (outdated) card.append(updateStep(source === 'relay' ? gap.required : null, game, copy));
  return card;
}

function versionEntry(label: string, version: string): HTMLElement {
  const entry = node('div', 'version-gap__version');
  entry.append(node('dt', '', label), node('dd', '', version));
  return entry;
}

function aheadTitle(source: VersionGapSource, copy: Messages): string {
  return source === 'relay' ? copy.versionGap.relayAheadTitle : copy.versionGap.catalogueAheadTitle;
}

function body(gap: VersionGap, source: VersionGapSource, copy: Messages): string {
  const text = copy.versionGap;
  if (gap.kind === 'ahead') return source === 'relay' ? text.relayAhead : text.catalogueAhead;
  return source === 'relay' ? text.relayOutdated : text.catalogueOutdated;
}

/** A reload button on the web; on the desktop a link the shell opens in the system browser, with the
 *  address beside it so the player knows where it leads. */
function updateStep(required: string | null, game: RunningGame, copy: Messages): HTMLElement {
  const text = copy.versionGap;
  const actions = node('div', 'version-gap__actions');
  if (game.web) {
    const reload = node('button', 'main-menu__primary', text.reload);
    reload.type = 'button';
    reload.addEventListener('click', reloadDocument);
    actions.append(reload);
    return actions;
  }
  const page = downloadPage();
  const label =
    required === null ? text.downloadUnnamed : formatMessage(text.download, { version: required });
  const link = node('a', 'main-menu__primary version-gap__download', label);
  link.href = page;
  link.target = '_blank';
  link.rel = 'noopener';
  actions.append(
    link,
    node('span', 'version-gap__where', page.replace(/^https:\/\//, '').replace(/\/$/, '')),
  );
  return actions;
}
