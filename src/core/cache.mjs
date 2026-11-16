// Кэш ответов источника расписания. Одинаковые запросы, пришедшие одновременно, объединяются;
// при сбое отдаётся последнее полученное значение с пометкой stale: { message, format },
// а не ошибка. Время самого ответа лежит в значении (fetchedAt): чтение кэша и сбой его не меняют.
import { FormatError } from './shape.mjs';

export function createCache({ maxEntries = 40 } = {}) {
  // key → { t, v } | { pending }. t — срок годности (expire его сбрасывает)
  const cache = new Map();

  return {
    // load() → объект; до срока ttlMs отдаётся прежнее значение
    get(key, ttlMs, load) {
      const hit = cache.get(key);
      if (hit?.pending) return hit.pending;
      if (hit && Date.now() - hit.t < ttlMs) return Promise.resolve(hit.v);
      const pending = load().then(
        (data) => {
          const t = Date.now();
          const v = { ...data, fetchedAt: t };
          cache.delete(key); // переставляем в конец — самые старые записи удаляются первыми
          cache.set(key, { t, v });
          while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
          return v;
        },
        (e) => {
          if (hit) {
            cache.set(key, hit);
            return { ...hit.v, stale: { message: e.message, format: e instanceof FormatError } };
          }
          cache.delete(key);
          throw e;
        },
      );
      cache.set(key, { ...hit, pending });
      return pending;
    },
    // Следующий запрос пойдёт в сеть, не дожидаясь срока. Полученное раньше остаётся —
    // его отдадим, если источник не ответит.
    expire(match = () => true) {
      for (const [key, hit] of cache) if (match(key)) hit.t = -Infinity;
    },
  };
}
