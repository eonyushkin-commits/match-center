// Футбол на странице: строка команды с логотипом и счётом, шапка турнира, тексты.
// Общий каркас (view.mjs, settings-ui.mjs) о виде спорта знает только это описание.
import { esc } from '../format.mjs';
import { starHtml } from './parts.mjs';

const LOGOS = 'https://images.fotmob.com/image_resources/logo';

export default {
  id: 'football',
  sourceName: 'FotMob',
  searchPlaceholder: 'Команда или турнир',
  emptyHint: 'Турниры выбираются в настройках.',

  // шапка раздела: логотип, название, тур/стадия тем же стилем, что уровень тенниса, страна
  leagueHeadHtml: (lg) => `<img loading="lazy" src="${LOGOS}/leaguelogo/${encodeURIComponent(lg.id)}.png" alt=""> ${esc(lg.name)}${(lg.stages || []).map((stage) => ` <span class="level">${esc(stage)}</span>`).join('')} <small>${esc(lg.country)}</small>`,
  // подпись турнира у матча в блоке «Сейчас в эфире»
  leagueTag: (lg) => lg.name,
  // Уточняем стадию у матча при смешанных турах и вне обычного раздела турнира.
  metaOf: (m, lg, showLeague) => m.round && (showLeague || (lg.stages || []).length > 1) ? [m.round] : [],
  // левая колонка: статус — как его отдаёт FotMob (FT, HT, AET, Pen…) — или время начала
  whenText: (m, live, time) => (m.cancelled ? (m.reason || 'Canc.') : live ? (m.liveTime || 'LIVE') : m.finished ? (m.reason || 'FT') : time),

  // Сторона матча — команда. o: { fav, hidden, showScore, mask }; mask — кнопка «?» вместо счёта
  teamHtml(t, other, m, o) {
    const score = o.hidden ? o.mask : `<span class="score">${esc(t.score)}</span>`;
    return `<div class="team${!o.hidden && m.finished && t.score > other.score ? ' win' : ''}">
      <img loading="lazy" src="${LOGOS}/teamlogo/${encodeURIComponent(t.id)}_small.png" alt="">
      <span class="name">${esc(t.name)}</span>
      ${starHtml(t, o.fav, 'В избранное — уведомлю о начале каждого матча команды')}
      ${o.showScore ? score : ''}</div>`;
  },

  // тексты диалога настроек
  settings: {
    channelExample: 'vkvideo.ru/@pl_forever',
    leaguesTitle: 'Турниры',
    leaguesHint: '',
    // турнир можно добавить по номеру из адреса на сайте источника; названия — из /api/leagues
    leagueAdd: { placeholder: 'Другой турнир: число из ссылки fotmob.com/leagues/…' },
    notifyLabel: 'Уведомлять о матчах избранных команд',
    notifyHint: 'Когда матч фактически начался — для избранных команд (★) и отмеченных матчей (🔔).',
    favoritesWord: 'Команды',
    aliasesTitle: 'Написание команд',
    aliasesPlaceholder: 'Манчестер Юнайтед = МЮ, Ман Юнайтед',
    aliasesHint: 'Если канал пишет команду не так, как FotMob: по строке на команду, слева — название из расписания.',
    aliasWord: 'Команда',
  },
};
