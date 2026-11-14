import type { ArticleGroup } from '../../../hud/knowledge/articles.js';
import { ECONOMY } from './economy.js';
import { EXPERIENCE } from './experience.js';
import { MILITARY } from './military.js';
import { PROBLEMS } from './problems.js';
import { SETTLERS } from './settlers.js';
import { WORLD } from './world.js';

export const ARTICLES: readonly ArticleGroup[] = [SETTLERS, EXPERIENCE, ECONOMY, MILITARY, WORLD, PROBLEMS];
