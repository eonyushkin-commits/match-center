// Виды спорта на странице: вид → его разметка и тексты. Список видов и порядок вкладок
// приходят с сервера (settings.sports); здесь — только то, как каждый вид выглядит.
import football from './football.mjs';
import tennis from './tennis.mjs';

export const sportViews = { tennis, football };
