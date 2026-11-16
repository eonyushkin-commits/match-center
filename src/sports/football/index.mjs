// Футбол как вид спорта матч-центра: расписание и счёт из FotMob.
// Общее ядро (src/core) знает о виде спорта только то, что перечислено в этом описании.
import { readFile } from 'node:fs/promises';
import { buildDay } from './day.mjs';
import { parseTeams } from './match.mjs';
import { createFotmob } from './source.mjs';

const defaults = JSON.parse(await readFile(new URL('./defaults.json', import.meta.url), 'utf8'));

export default {
  id: 'football',
  label: 'Футбол',
  sourceName: 'FotMob',
  // каналы VK, турниры и написания команд по умолчанию
  defaults,
  // в настройках можно выбрать любой турнир FotMob по номеру, а не только из knownLeagues
  openLeagues: true,
  // откуда страница может брать картинки: логотипы команд и турниров
  imageHosts: ['https://images.fotmob.com'],
  // слова вида спорта: счётчики диагностического отчёта и ошибки настроек
  texts: {
    leagues: 'турниров',
    favorites: 'избранных команд',
    pickLeague: 'Выберите хотя бы один турнир',
    aliases: 'Написания команд',
  },

  // FotMob принимает запросы сетевого стека приложения (fetchImpl)
  createSource({ fetchImpl = fetch } = {}) {
    const fotmob = createFotmob(fetchImpl);
    return {
      fotmob,
      // день — расписание вместе с русскими названиями: { fm, ru }
      async day(date, tz) {
        const [fm, ru] = await Promise.all([fotmob.day(date, tz), fotmob.names()]);
        return { fm, ru };
      },
      refresh: () => fotmob.refresh(),
    };
  },
  // что спрашивать у источника на день: FotMob делит матчи на дни по часовому поясу
  dayQuery: (settings, tz) => tz,
  // { data, settings, snapshot } → { leagues, stale, fetchedAt }
  buildDay: ({ data, settings, snapshot }) => buildDay({ fm: data.fm, ru: data.ru, settings, snapshot }),
  // состояние источника для отчёта: [{ name, okAt, errorAt, error }]
  health: (source) => source.fotmob.health().map(({ what, ...h }) => ({ name: what, ...h })),
  // заголовок эфира VK → { teams } или null
  parseTitle(title) {
    const teams = parseTeams(title);
    return teams ? { teams } : null;
  },
  // Русские названия всех турниров FotMob для выбора в настройках: { номер: «Россия · ФНЛ» },
  // у международных — без страны
  async leagueCatalog(source) {
    const j = await source.fotmob.leagues();
    const names = {};
    for (const g of [...(j.international || []), ...(j.countries || [])]) {
      for (const l of g.leagues || []) {
        const name = l.localizedName || l.name;
        names[l.id] = g.ccode === 'INT' ? name : `${g.localizedName || g.name} · ${name}`;
      }
    }
    return names;
  },
};
