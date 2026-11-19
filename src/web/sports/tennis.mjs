// Теннис на странице: строка игрока со счётом по сетам, шапка турнира, тексты.
// Общий каркас (view.mjs, settings-ui.mjs) о виде спорта знает только это описание.
import { esc } from '../format.mjs';
import { starHtml } from './parts.mjs';

// счёт по сетам: геймы и, если был тай-брейк, очки в нём мелко сверху; выигранный сет выделен
const setsHtml = (t) => `<span class="sets">${t.sets.map((s) =>
  `<span class="set${s.won ? ' won' : ''}">${esc(s.games)}${s.tiebreak != null ? `<sup>${esc(s.tiebreak)}</sup>` : ''}</span>`).join('')}</span>`;

export default {
  id: 'tennis',
  sourceName: 'ESPN',
  searchPlaceholder: 'Игрок или турнир',
  emptyHint: 'Мужские и женские разряды выбираются в настройках.',

  // шапка раздела: турнир, его уровень и разряд
  leagueHeadHtml: (lg) => `${esc(lg.name)}${lg.level ? ` <span class="level">${esc(lg.level)}</span>` : ''} <small>${esc(lg.country)}</small>`,
  // подпись турнира у матча в блоке «Сейчас в эфире»
  leagueTag: (lg) => `${lg.name} · ${lg.level ? `${lg.level} · ` : ''}${lg.country}`,
  // строка под турниром: раунд и корт
  metaOf: (m) => [m.round, m.court].filter(Boolean),
  // левая колонка: статус или время начала (time — «ЧЧ:ММ»)
  whenText: (m, live, time) => (m.cancelled ? (m.reason || 'Отмена') : live ? (m.liveTime || 'LIVE') : m.finished ? (m.reason || 'Оконч.') : m.timeKnown ? time : '—'),

  // Сторона матча — игрок или пара. o: { fav, hidden, showScore, mask }; mask — кнопка «?» вместо счёта
  teamHtml(t, other, m, o) {
    // номер посева — перед именем; место под него есть у обоих игроков, чтобы имена стояли ровно
    const seeded = !!(m.home.seed || m.away.seed);
    const flags = t.players.filter((p) => p.flag).map((p) => `<img loading="lazy" src="${esc(p.flag)}" alt="">`).join('');
    // ★ — у игрока одиночного разряда: пара в избранном, если в нём хотя бы один из двоих
    const star = t.id != null ? starHtml(t, o.fav, 'В избранное — уведомлю о начале каждого матча игрока') : '';
    return `<div class="team${!o.hidden && m.finished && t.winner ? ' win' : ''}">
      <span class="flags">${flags}</span>
      ${seeded ? `<small class="seed"${t.seed ? ' title="Номер посева"' : ''}>${esc(t.seed)}</small>` : ''}<span class="name">${esc(t.name)}</span>${!o.hidden && t.serving ? '<span class="serve" title="Подаёт" role="img" aria-label="Подаёт"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M10.6 2.1C10.1 7.2 6.3 9.6 2.3 9.5M21.6 9.2C18.6 16.6 9 9.4 6.8 15.3C5.1 19.6 9 22 12 22"/></svg></span>' : ''}
      ${star}
      ${o.showScore ? (o.hidden ? o.mask : setsHtml(t)) : ''}</div>`;
  },

  // тексты диалога настроек
  settings: {
    channelExample: 'vkvideo.ru/@tennis_bolshe',
    leaguesTitle: 'Разряды',
    leaguesHint: 'Показываются все доступные турниры выбранных разрядов, включая Большой шлем.',
    leagueAdd: null, // разряды заданы списком, добавлять нечего
    notifyLabel: 'Уведомлять о матчах избранных игроков',
    notifyHint: 'Когда матч фактически начался — для избранных игроков (★) и отмеченных матчей (🔔).',
    favoritesWord: 'Игроки',
    aliasesTitle: 'Написание игроков',
    aliasesPlaceholder: 'Соболенко = Сабаленка&#10;Sinner = Синер',
    aliasesHint: 'Если эфир не привязался к матчу, потому что канал пишет игрока по-своему: по строке на игрока, слева — фамилия или имя, как в расписании (или уже известное русское написание), справа — варианты канала.',
    aliasWord: 'Игрок',
  },
};
