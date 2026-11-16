// Расписание FotMob. Одинаковые запросы, пришедшие одновременно, объединяются; при сбое сети
// отдаются последние полученные данные с пометкой stale: { message, format }, а не ошибка
// (см. core/cache.mjs). Форма каждого ответа проверяется на входе: см. core/shape.mjs.
import { createCache } from '../../core/cache.mjs';
import { expect, isObject } from '../../core/shape.mjs';

const need = (ok, what) => expect(ok, 'FotMob', what);

export function createFotmob(fetchImpl = fetch) {
  const cache = createCache();
  // для диагностики: что спрашивали → { okAt, errorAt, error } — время настоящих ответов FotMob, а не чтений кэша
  const health = new Map();
  const note = (what, patch) => health.set(what, { okAt: null, errorAt: null, error: null, ...health.get(what), ...patch });

  // check(j) проверяет форму ответа и может вернуть исправленный ответ
  async function getJson(what, url, check) {
    try {
      const r = await fetchImpl(url, { signal: AbortSignal.timeout(15e3) });
      if (!r.ok) throw new Error(`FotMob ответил ${r.status}`);
      const j = await r.json();
      const checked = check(j) ?? j;
      note(what, { okAt: Date.now() });
      return checked;
    } catch (e) {
      note(what, { errorAt: Date.now(), error: e.message });
      throw e;
    }
  }

  return {
    health: () => [...health].map(([what, h]) => ({ what, ...h })),
    // русские названия команд, турниров и стран
    names: () => cache.get('ru', 24 * 3600e3, () => getJson('названия', 'https://www.fotmob.com/api/translationmapping?locale=ru',
      (j) => need(isObject(j?.Participants), 'в названиях нет словаря Participants'))),
    // все матчи дня date (ГГГГММДД) в часовом поясе tz: { leagues: [{ id, matches }], stale, fetchedAt }
    day: (date, tz) => cache.get(`day:${date}:${tz}`, 45e3, () =>
      getJson('расписание', `https://www.fotmob.com/api/data/matches?date=${date}&timezone=${encodeURIComponent(tz)}`, (j) => {
        if (j === null) return { leagues: [] }; // так FotMob отвечает на день за пределами своего расписания
        return need(Array.isArray(j?.leagues), 'в расписании нет списка leagues');
      })),
    // все турниры с русскими названиями — для турниров, добавленных в настройках по номеру
    leagues: () => cache.get('leagues', 24 * 3600e3, () => getJson('турниры', 'https://www.fotmob.com/api/data/allLeagues?locale=ru',
      (j) => need(Array.isArray(j?.countries) && Array.isArray(j?.international), 'в справочнике турниров нет списков countries и international'))),
    // «Обновить» по кнопке: расписание спросим заново, не дожидаясь срока. Полученное раньше
    // остаётся — его покажем, если FotMob не ответит.
    refresh() {
      cache.expire((key) => key.startsWith('day:'));
    },
  };
}
