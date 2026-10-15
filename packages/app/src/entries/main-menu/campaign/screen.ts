import type { Campaign, MapTextLanguage } from '@open-northland/data';
import { loadCampaigns } from '../../../campaign/catalog.js';
import { campaignMissionQuery, RECOMMENDED_CAMPAIGN_TRIBE } from '../../../campaign/launch.js';
import { campaignLanguage, campaignLogo, campaignMovies, localizedText } from '../../../campaign/locale.js';
import { type MusicSilencer, playCampaignMovie } from '../../../campaign/movie.js';
import {
  type CampaignProgress,
  grantCampaignMaps,
  nextCampaignStage,
  readCampaignProgress,
} from '../../../campaign/progress.js';
import { createHudPlane } from '../../../hud/dom/root.js';
import { createSystemConfirm, type SystemConfirmCopy } from '../../../hud/dom/system-confirm.js';
import { displayViewOf, uiScaleFor } from '../../../hud/ui-scale.js';
import { currentLocale, messages } from '../../../i18n/index.js';
import type { LaunchEntry } from '../../../launch.js';
import { node } from '../dom.js';
import type { MenuScreen, MountedScreen } from '../model.js';
import { screenHead } from '../screen-head.js';
import { targetSearch } from '../target-search.js';
import { campaignMap } from './map.js';
import {
  initialCampaign,
  launchTribe,
  readChosenCampaign,
  readRevealedRoutes,
  rememberChosenCampaign,
  rememberRevealedRoute,
  routeToReveal,
  unlockedStages,
} from './model.js';
import './screen.css';
import { campaignTribeChoice } from './tribe-choice.js';

/** Window storage, or none where reading the accessor itself throws. */
function viewerStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The campaign's title artwork, or its localized title where there is none or it fails to load. */
function campaignTab(campaign: Campaign, language: MapTextLanguage): HTMLButtonElement {
  const title = localizedText(campaign.title, language);
  const button = node('button', 'campaign-screen__campaign');
  button.type = 'button';
  const text = (): HTMLElement => node('span', 'campaign-screen__campaign-title', title);
  const url = campaignLogo(campaign, language);
  if (url === undefined) {
    button.append(text());
    return button;
  }
  const logo = node('img', 'campaign-screen__campaign-logo');
  logo.alt = title;
  logo.src = url;
  logo.addEventListener('error', () => logo.replaceWith(text()), { once: true });
  button.append(logo);
  return button;
}

/** A question over the whole menu in the HUD's own confirm window; Esc and the shade decline. */
async function askInHud(copy: SystemConfirmCopy, signal: AbortSignal): Promise<boolean> {
  const backdrop = node('div', 'on-system-backdrop');
  const plane = createHudPlane(uiScaleFor(displayViewOf(window.innerWidth, window.innerHeight)));
  plane.element.classList.add('on-system-plane');
  backdrop.append(plane.element);
  const confirm = createSystemConfirm(plane.element);
  const prior = document.activeElement;
  const inert = new Map<HTMLElement, boolean>();
  for (const child of document.body.children) {
    if (child instanceof HTMLElement) {
      inert.set(child, child.inert);
      child.inert = true;
    }
  }
  // Capture phase, so the menu does not also read Esc as back-navigation.
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    event.preventDefault();
    confirm.cancel();
  };
  window.addEventListener('keydown', onKey, true);
  signal.addEventListener('abort', confirm.cancel, { once: true });
  document.body.append(backdrop);
  try {
    return await confirm.open(copy);
  } finally {
    signal.removeEventListener('abort', confirm.cancel);
    window.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    for (const [element, was] of inert) element.inert = was;
    if (prior instanceof HTMLElement && prior.isConnected) prior.focus();
  }
}

export function campaignScreen(
  open: (screen: MenuScreen) => void,
  launch: LaunchEntry,
  silenceMusic: MusicSilencer,
): MountedScreen {
  const scope = new AbortController();
  const copy = messages().campaign;
  const storage = viewerStorage();
  const section = node('section', 'main-menu__screen campaign-screen');
  const tabs = node('div', 'campaign-screen__campaigns');
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', copy.campaigns);
  const body = node('div', 'campaign-screen__body');
  const status = node('p', 'campaign-screen__status');
  status.setAttribute('role', 'status');
  section.append(screenHead('campaign', open, 'newGame'), tabs, body, status);

  let campaigns: readonly Campaign[] = [];
  let current: Campaign | undefined;
  let selected: string | undefined;
  let tribe: number = RECOMMENDED_CAMPAIGN_TRIBE;
  let busy = false;
  let asking = false;

  const setBusy = (next: boolean): void => {
    busy = next;
    for (const button of section.querySelectorAll<HTMLButtonElement>('button')) button.disabled = next;
  };

  const renderTabs = (): void => {
    tabs.replaceChildren(
      ...campaigns.map((campaign) => {
        const tab = campaignTab(campaign, campaignLanguage(campaign, currentLocale()));
        tab.setAttribute('aria-pressed', String(campaign === current));
        tab.addEventListener('click', () => {
          if (campaign === current) return;
          rememberChosenCampaign(storage, campaign.id);
          selected = undefined;
          status.textContent = '';
          show(campaign);
          tabs.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
        });
        return tab;
      }),
    );
  };

  const show = (campaign: Campaign): void => {
    current = campaign;
    renderTabs();
    const language = campaignLanguage(campaign, currentLocale());
    let progress: CampaignProgress;
    try {
      progress = readCampaignProgress(campaign, localStorage);
    } catch {
      status.textContent = copy.storage;
      body.replaceChildren();
      return;
    }
    const stages = unlockedStages(campaign, progress);
    if (!stages.some(({ stage }) => stage.mapId === selected)) selected = stages.at(-1)?.stage.mapId;
    const reveal = routeToReveal(stages, readRevealedRoutes(storage, campaign));
    if (reveal !== undefined) rememberRevealedRoute(storage, campaign, reveal);

    const map = campaignMap(campaign, stages, language, reveal, body, (mapId) => choose(mapId));
    const side = node('aside', 'campaign-screen__side');
    const heading = node('h2', 'campaign-screen__side-title', copy.missions);
    heading.id = 'campaign-screen-missions';
    const list = node('ol', 'campaign-screen__missions');
    list.setAttribute('aria-labelledby', heading.id);
    const rows = stages.map(({ stage, number }) => {
      const row = node('button', 'campaign-screen__mission');
      row.type = 'button';
      row.append(
        node('span', 'campaign-screen__mission-number', String(number)),
        node('span', 'campaign-screen__mission-title', localizedText(stage.title, language)),
      );
      row.addEventListener('click', () => choose(stage.mapId));
      const item = node('li');
      item.append(row);
      list.append(item);
      return { mapId: stage.mapId, row };
    });

    const tribeChoice = campaignTribeChoice(tribe, (next) => {
      tribe = next;
    });

    const start = node('button', 'main-menu__primary campaign-screen__start', copy.start);
    start.type = 'button';
    start.addEventListener('click', () => {
      const mapId = selected;
      if (mapId === undefined || busy) return;
      setBusy(true);
      const intro = campaignMovies(campaign, language).intro;
      const run = async (): Promise<void> => {
        if (mapId === campaign.stages[0]?.mapId && intro !== undefined)
          await playCampaignMovie(
            intro,
            { play: copy.play, skip: copy.skipMovie, failed: copy.movieFailed, seek: copy.seekMovie },
            scope.signal,
            silenceMusic,
          );
        const chosen = launchTribe(tribe);
        const query = campaignMissionQuery(
          chosen === undefined ? { mapId, language } : { mapId, language, tribe: chosen },
        );
        if (!scope.signal.aborted) await launch(targetSearch(query));
      };
      void run().catch(() => {
        if (scope.signal.aborted) return;
        setBusy(false);
        status.textContent = copy.storage;
        show(campaign);
      });
    });

    side.append(heading, list, start);
    const foot = node('div', 'campaign-screen__foot');
    foot.append(tribeChoice.root);

    const next = nextCampaignStage(campaign, progress);
    const nextStage = campaign.stages.find((stage) => stage.mapId === next);
    const nextMap = campaign.maps.find((map) => map.id === next);
    if (nextStage !== undefined && nextMap !== undefined) {
      const skip = node('button', 'campaign-screen__skip', copy.skip);
      skip.type = 'button';
      skip.addEventListener('click', () => {
        if (busy || asking) return;
        asking = true;
        void askInHud(
          {
            title: copy.skip,
            message: copy.confirm,
            cancel: copy.cancel,
            confirm: copy.unlock,
          },
          scope.signal,
        ).then((accepted) => {
          asking = false;
          if (!accepted || scope.signal.aborted) return;
          try {
            grantCampaignMaps(
              campaign,
              [{ campaignId: campaign.campaignId, mapId: nextMap.missionId }],
              localStorage,
            );
          } catch {
            status.textContent = copy.storage;
            return;
          }
          status.textContent = '';
          selected = nextStage.mapId;
          show(campaign);
          body.querySelector<HTMLElement>('.campaign-screen__mission[aria-pressed="true"]')?.focus();
        });
      });
      foot.append(skip);
    }

    // Scrolls the list alone, so a long campaign keeps the chosen row in sight without moving the screen.
    const keepInView = (item: HTMLElement): void => {
      const bottom = item.offsetTop + item.offsetHeight;
      if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
    };
    const choose = (mapId: string): void => {
      selected = mapId;
      map.select(mapId);
      for (const { mapId: id, row } of rows) {
        row.setAttribute('aria-pressed', String(id === mapId));
        if (id === mapId && row.parentElement !== null) keepInView(row.parentElement);
      }
      start.disabled = busy;
    };
    const stage = node('div', 'campaign-screen__stage');
    stage.append(map.root, side);
    body.replaceChildren(stage, foot);
    if (selected !== undefined) choose(selected);
    else start.disabled = true;
  };

  void loadCampaigns()
    .then((loaded) => {
      if (scope.signal.aborted) return;
      campaigns = loaded;
      const requested = new URLSearchParams(window.location.search).get('campaign');
      const campaign = initialCampaign(campaigns, requested, readChosenCampaign(storage));
      if (campaign === undefined) {
        status.textContent = copy.empty;
        return;
      }
      show(campaign);
    })
    .catch(() => {
      if (!scope.signal.aborted) status.textContent = copy.empty;
    });
  window.addEventListener(
    'storage',
    () => {
      if (current !== undefined && !busy && !asking) show(current);
    },
    { signal: scope.signal },
  );
  return { element: section, dispose: () => scope.abort() };
}
