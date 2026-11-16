// Общие куски разметки для строк матча разных видов спорта.
import { esc } from '../format.mjs';

// ★ — участник в избранном. hint — подсказка, пока он не в избранном
export const starHtml = (t, fav, hint) => `<button type="button" class="star${fav ? ' on' : ''}" data-fav="${esc(t.id)}" data-name="${esc(t.name)}" aria-pressed="${fav}"
        title="${fav ? 'Убрать из избранного' : hint}">★</button>`;
