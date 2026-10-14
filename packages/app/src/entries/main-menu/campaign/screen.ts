import type { Campaign } from '@open-northland/data';
import { loadCampaigns } from '../../../campaign/catalog.js';
import { playCampaignMovie } from '../../../campaign/movie.js';
import {
  type CampaignProgress,
  grantCampaignMaps,
  nextCampaignStage,
  readCampaignProgress,
} from '../../../campaign/progress.js';
import { currentLocale, formatMessage, messages } from '../../../i18n/index.js';
import type { LaunchEntry } from '../../../launch.js';
import { BUTTON_STYLE, DIALOG_STYLE, el } from '../../../view/overlay.js';
import type { MenuScreen, MountedScreen } from '../model.js';
import { screenHead } from '../screen-head.js';
import { targetSearch } from '../target-search.js';
import './screen.css';

export function campaignScreen(open: (screen: MenuScreen) => void, launch: LaunchEntry): MountedScreen {
  const scope = new AbortController();
  const section = document.createElement('section');
  section.className = 'main-menu__screen campaign-screen';
  section.append(screenHead('campaign', open, 'newGame'));
  const body = document.createElement('div');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  section.append(body, status);
  const copy = messages().campaign;
  let selected: string | undefined;
  let busy = false;
  let current: Campaign | undefined;
  const fail = (): void => {
    status.textContent = copy.storage;
  };

  const render = (campaign: Campaign): void => {
    current = campaign;
    let progress: CampaignProgress;
    try {
      progress = readCampaignProgress(campaign, localStorage);
    } catch {
      fail();
      return;
    }
    const unlocked = new Set(progress.unlocked);
    selected ??= campaign.stages.filter((stage) => unlocked.has(stage.mapId)).at(-1)?.mapId;
    body.replaceChildren();
    const title = document.createElement('h2');
    title.textContent = campaign.title;
    const layout = document.createElement('div');
    layout.className = 'campaign-screen__layout';
    const map = document.createElement('div');
    map.className = 'campaign-screen__map';
    const image = document.createElement('img');
    image.src = campaign.background;
    image.alt = '';
    map.append(image);
    const side = document.createElement('div');
    side.className = 'campaign-screen__side';
    const list = document.createElement('ol');
    list.className = 'campaign-screen__stages';
    for (const [index, stage] of campaign.stages.entries()) {
      const available = unlocked.has(stage.mapId);
      const label = `${index + 1}. ${stage.title} · ${available ? copy.available : copy.locked}`;
      const select = (): void => {
        selected = stage.mapId;
        render(campaign);
      };
      const point = document.createElement('button');
      point.type = 'button';
      point.className = 'campaign-screen__point';
      point.textContent = `${index + 1}`;
      point.title = label;
      point.setAttribute('aria-label', label);
      point.style.left = `${stage.x * 100}%`;
      point.style.top = `${stage.y * 100}%`;
      point.disabled = !available || busy;
      point.setAttribute('aria-pressed', String(selected === stage.mapId));
      point.addEventListener('click', select);
      map.append(point);
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = stage.title;
      button.disabled = !available || busy;
      button.title = label;
      button.setAttribute('aria-pressed', String(selected === stage.mapId));
      button.addEventListener('click', select);
      row.append(button);
      list.append(row);
    }
    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'campaign-screen__start';
    start.textContent = copy.start;
    start.disabled = busy || selected === undefined || !unlocked.has(selected);
    start.addEventListener('click', () => {
      const mapId = selected;
      if (mapId === undefined || busy) return;
      busy = true;
      render(campaign);
      const run = async (): Promise<void> => {
        if (mapId === campaign.stages[0]?.mapId && campaign.intro !== undefined)
          await playCampaignMovie(
            campaign.intro,
            { play: copy.play, skip: copy.skipMovie, failed: copy.movieFailed },
            scope.signal,
          );
        if (!scope.signal.aborted)
          await launch(
            targetSearch(`?map=${encodeURIComponent(mapId)}&missions=on&lang=${campaign.language}`),
          );
      };
      void run().catch(() => {
        if (!scope.signal.aborted) {
          busy = false;
          fail();
          render(campaign);
        }
      });
    });
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'campaign-screen__skip';
    skip.textContent = copy.skip;
    const next = nextCampaignStage(campaign, progress);
    skip.disabled = busy || next === undefined;
    if (next === undefined) skip.title = copy.all;
    skip.addEventListener('click', () => {
      const stage = campaign.stages.find((stage) => stage.mapId === next);
      const map = campaign.maps.find((map) => map.id === next);
      if (stage === undefined || map === undefined || busy) return;
      const dialog = el('dialog', `${DIALOG_STYLE};max-width:32rem`);
      dialog.append(el('p', 'line-height:1.5', formatMessage(copy.confirm, { mission: stage.title })));
      const cancel = el('button', BUTTON_STYLE, copy.cancel);
      const confirm = el('button', BUTTON_STYLE, copy.unlock);
      const error = el('p', '', '');
      error.setAttribute('role', 'status');
      const close = (): void => {
        dialog.remove();
        scope.signal.removeEventListener('abort', close);
        skip.focus();
      };
      scope.signal.addEventListener('abort', close, { once: true });
      cancel.addEventListener('click', close);
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        close();
      });
      dialog.addEventListener('keydown', (event) => event.stopPropagation());
      confirm.addEventListener('click', () => {
        try {
          grantCampaignMaps(
            campaign,
            [{ campaignId: campaign.campaignId, mapId: map.missionId }],
            localStorage,
          );
        } catch {
          error.textContent = copy.storage;
          return;
        }
        close();
        selected = stage.mapId;
        render(campaign);
      });
      dialog.append(cancel, confirm, error);
      document.body.append(dialog);
      dialog.showModal();
      cancel.focus();
    });
    side.append(list, start, skip);
    layout.append(map, side);
    body.append(title, layout);
  };
  void loadCampaigns()
    .then((campaigns) => {
      if (scope.signal.aborted) return;
      const requested = new URLSearchParams(window.location.search).get('campaign');
      const campaign =
        campaigns.find((campaign) => campaign.id === requested && campaign.language === currentLocale()) ??
        campaigns.find((campaign) => campaign.language === currentLocale()) ??
        campaigns[0];
      if (campaign === undefined) {
        status.textContent = copy.empty;
        return;
      }
      render(campaign);
    })
    .catch(() => {
      if (!scope.signal.aborted) status.textContent = copy.empty;
    });
  window.addEventListener(
    'storage',
    () => {
      if (current !== undefined && !busy) render(current);
    },
    { signal: scope.signal },
  );
  return { element: section, dispose: () => scope.abort() };
}
