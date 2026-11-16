// Теннис как вид спорта матч-центра: расписание и счёт ATP и WTA из ESPN.
// Общее ядро (src/core) знает о виде спорта только то, что перечислено в этом описании.
import { readFile } from 'node:fs/promises';
import { buildDay, toursOf } from './day.mjs';
import { parsePair } from './match.mjs';
import { createEspn } from './source.mjs';

const defaults = JSON.parse(await readFile(new URL('./defaults.json', import.meta.url), 'utf8'));

export default {
  id: 'tennis',
  label: 'Теннис',
  sourceName: 'ESPN',
  // каналы VK, разряды («турниры» настроек) и написания игроков по умолчанию
  defaults,
  // откуда страница может брать картинки: флаги игроков
  imageHosts: ['https://a.espncdn.com'],
  // слова вида спорта: счётчики диагностического отчёта и ошибки настроек
  texts: {
    leagues: 'разрядов',
    favorites: 'избранных игроков',
    pickLeague: 'Выберите хотя бы один разряд',
    aliases: 'Написания игроков',
  },

  // Запросы Chromium со стандартным User-Agent Electron ESPN отклоняет (403), а встроенный
  // fetch Node.js принимает — поэтому nodeFetch, а не fetchImpl
  createSource: ({ nodeFetch = fetch } = {}) => createEspn(nodeFetch),
  // что спрашивать у источника на день: туры выбранных разрядов
  dayQuery: (settings) => toursOf(settings.leagues),
  // { data, date, tz, settings, snapshot, now } → { leagues, stale, fetchedAt }
  buildDay,
  // состояние источника для отчёта: [{ name, okAt, errorAt, error }]
  health: (source) => source.health().map(({ tour, ...h }) => ({ name: tour, ...h })),
  // заголовок эфира VK → { teams, doubles } или null
  parseTitle: parsePair,
};
