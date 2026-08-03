import { messages } from '../../i18n/index.js';
import { type MenuScreen, VERSION_LINE } from './model.js';
import { screenHead } from './screen-head.js';

/** Outbound targets of the credits screen (design frame 5a wires them to the project pages). */
const REPO_URL = 'https://github.com/s-nems/open-northland';
const ISSUES_URL = `${REPO_URL}/issues`;
const CULTURES_NATION_URL = 'https://culturesnation.pl';

function externalLink(label: string, href: string, className: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = className;
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = label;
  return link;
}

function creditsCard(title: string): HTMLDivElement {
  const box = document.createElement('div');
  box.className = 'main-menu__credits-card';
  const heading = document.createElement('div');
  heading.className = 'main-menu__credits-card-title';
  heading.textContent = title;
  box.append(heading);
  return box;
}

function thanksEntry(name: string, detail: string, href?: string): HTMLParagraphElement {
  const entry = document.createElement('p');
  entry.className = 'main-menu__credits-thanks';
  if (href === undefined) {
    entry.textContent = `${name} - ${detail}`;
  } else {
    entry.append(externalLink(name, href, 'main-menu__credits-link'), ` - ${detail}`);
  }
  return entry;
}

/** Credits / about: one centered column - intro, repo links, the team and thanks cards, legal. */
export function creditsScreen(open: (screen: MenuScreen) => void): HTMLElement {
  const copy = messages().mainMenu;
  const section = document.createElement('section');
  section.className = 'main-menu__screen';

  const head = screenHead('credits', open);

  const intro = document.createElement('p');
  intro.className = 'main-menu__credits-intro';
  intro.textContent = copy.credits.intro;
  const links = document.createElement('div');
  links.className = 'main-menu__credits-links';
  links.append(
    externalLink(copy.credits.sourceLink, REPO_URL, 'main-menu__ghost is-accent'),
    externalLink(copy.credits.reportLink, ISSUES_URL, 'main-menu__ghost'),
  );

  const team = creditsCard(copy.credits.teamTitle);
  const person = document.createElement('div');
  person.className = 'main-menu__credits-person';
  const personName = document.createElement('span');
  personName.textContent = copy.credits.teamName;
  const personRole = document.createElement('span');
  personRole.className = 'main-menu__credits-role';
  personRole.textContent = copy.credits.teamRole;
  person.append(personName, personRole);
  team.append(person);

  const thanks = creditsCard(copy.credits.thanksTitle);
  thanks.append(
    thanksEntry(copy.credits.thanksFunaticsName, copy.credits.thanksFunaticsDetail),
    thanksEntry(copy.credits.thanksCommunityName, copy.credits.thanksCommunityDetail, CULTURES_NATION_URL),
  );

  const cards = document.createElement('div');
  cards.className = 'main-menu__credits-cards';
  cards.append(team, thanks);

  const legal = document.createElement('div');
  legal.className = 'main-menu__credits-legal';
  legal.textContent = `${VERSION_LINE} · ${copy.credits.legal}`;

  const body = document.createElement('div');
  body.className = 'main-menu__credits';
  body.append(intro, links, cards, legal);
  section.append(head, body);
  return section;
}
