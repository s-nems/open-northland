// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

const installNameOverlay = vi.hoisted(() => vi.fn());
const MENU_NAMES = vi.hoisted(() => ({ tribes: {} }));

vi.mock('../../../src/i18n/index.js', async (actual) => ({
  ...(await actual<typeof import('../../../src/i18n/index.js')>()),
  installNameOverlay,
}));
vi.mock('../../../src/content/real-content.js', () => ({ loadRealContent: async () => ({}) }));
vi.mock('../../../src/content/ir/load.js', () => ({ loadIr: async () => null }));
vi.mock('../../../src/content/gui/gfx.js', () => ({
  loadObjectHelp: async () => null,
  loadGuiStrings: async () => ({}),
}));
vi.mock('../../../src/content/gui/original-names.js', () => ({
  originalTribeNameOverlay: async () => MENU_NAMES,
  installOriginalNames: vi.fn(),
}));
vi.mock('../../../src/hud/knowledge/base.js', () => ({ createKnowledgeBase: () => ({}) }));
vi.mock('../../../src/hud/dom/knowledge/art.js', () => ({ createKnowledgeArt: () => ({}) }));
vi.mock('../../../src/hud/dom/good-art.js', () => ({ createGoodIconPainter: () => () => undefined }));
vi.mock('../../../src/hud/dom/knowledge/view.js', () => ({
  createKnowledgeView: () => {
    throw new Error('view failed');
  },
}));

import { knowledgeScreen } from '../../../src/entries/main-menu/knowledge.js';

describe('the Knowledge menu screen', () => {
  it("puts the menu's names back when the view fails to build", async () => {
    const failure = new Promise<unknown>((done) => process.once('unhandledRejection', done));
    knowledgeScreen(() => undefined);
    await expect(failure).resolves.toMatchObject({ message: 'view failed' });
    expect(installNameOverlay).toHaveBeenCalledWith(expect.any(String), MENU_NAMES);
  });
});
