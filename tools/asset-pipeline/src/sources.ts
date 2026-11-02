/**
 * The pipeline's reading of the source data pack, for tools that check text against what the pipeline
 * converts: the translations audit and import read maps, object tables, descriptions and the history book through
 * these.
 */
export { CORRECTIONS_DIR, loadSourceCorrections } from './corrections.js';
export { findPathCaseInsensitive, type SourceRoots } from './roots.js';
export { type CampaignMapTree, campaignMapId, readCampaignMapTree } from './stages/campaigns.js';
export { helpText, readObjectHelp } from './stages/gui/help.js';
export { HISTORY_BOOK, historyDir, readHistoryBlocks } from './stages/gui/history.js';
export {
  GAME_OBJECT_TABLES,
  type GameObjectNames,
  type GameObjectTable,
  isGameObjectTable,
  isObjectHelpTable,
  OBJECT_HELP_FILES,
  OBJECT_HELP_TABLES,
  type ObjectHelpTable,
  readGameObjectNames,
} from './stages/gui/strings.js';
export { readBaseMapTree } from './stages/maps/convert.js';
export { takesSourceLanguageOverlays } from './stages/maps/provenance.js';
