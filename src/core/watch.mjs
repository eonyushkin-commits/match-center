// Уведомления о матчах избранных игроков и отмеченных колокольчиком матчах — только одно,
// kickoff, когда матч фактически начался (заранее не напоминаем). В теннисе время условное
// («после предыдущего матча»), поэтому начало ловим по самому матчу: пока он ждёт начала,
// проверяем раз в минуту. Проверка назначается на время начала по расписанию, но не реже
// раза в idleMs: расписание могут поменять.
import { ymdIn } from './dates.mjs';

const LATE = 10 * 60e3;
const WAIT = 60e3; // матч должен был начаться, но ещё не идёт
const OVERDUE = 6 * 3600e3; // дольше не ждём: матч перенесли

export function watchFavorites({ poller, settings, sport, source, onEvent, now = () => Date.now(), idleMs = 10 * 60e3, log = console }) {
  const seen = new Set();
  const waiting = new Set(); // матчи, которые при нас ещё не начались: их начало — новость
  let checking = null;
  let timer = null;
  let stopped = false;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // возвращает время ближайшего момента, к которому нужна следующая проверка
  async function check() {
    const s = settings.get();
    let next = Infinity;
    if (!s.notifications || (!s.favorites.length && !s.favoriteMatches.length)) return next;
    const t = now();
    // матч после полуночи лежит в расписании завтрашнего дня; смотрим вперёд до следующей проверки
    const dates = new Set([ymdIn(t, tz), ymdIn(t + idleMs, tz)]);
    const snapshot = poller.snapshot();
    for (const date of dates) {
      const day = sport.buildDay({ data: await source.day(date, sport.dayQuery(s, tz)), date, tz, settings: s, snapshot, now: t });
      for (const lg of day.leagues) {
        for (const m of lg.matches) {
          if (!m.favorite || m.cancelled) continue;
          const emit = (kind) => {
            if (seen.has(`${kind}:${m.id}`)) return;
            seen.add(`${kind}:${m.id}`);
            onEvent({ kind, date, match: m });
          };
          const kickoff = Date.parse(m.utcTime);
          if (!m.started) {
            if (!m.timeKnown) continue; // время ещё не назначено — напоминать не о чем
            waiting.add(m.id);
            if (kickoff > t) next = Math.min(next, kickoff);
            if (kickoff <= t && t - kickoff < OVERDUE) next = Math.min(next, t + WAIT);
          } else if (!m.finished && (waiting.has(m.id) || (t >= kickoff && t - kickoff <= LATE))) {
            emit('kickoff');
          }
        }
      }
    }
    return next;
  }

  function schedule(next) {
    clearTimeout(timer);
    if (stopped) return;
    timer = setTimeout(run, Math.min(Math.max(next - now(), 1000), idleMs));
    timer.unref?.();
  }

  // одновременно — одна проверка; после неё назначается следующая
  const run = () => {
    checking ??= check()
      .catch((e) => { log.warn?.(`Уведомления: ${e.message}`); return now() + 60e3; }) // сбой — через минуту ещё раз
      .then((next) => { schedule(next); return next; })
      .finally(() => { checking = null; });
    return checking;
  };

  // первая проверка — когда прочитаны каналы (для «смотреть: канал»), но не позже чем через полминуты
  poller.once('update', run);
  schedule(now() + 30e3);
  // отметили матч или игрока — проверяем сразу: матч может уже идти или вот-вот начаться
  const wanted = (s) => JSON.stringify([s.notifications, s.favorites, s.favoriteMatches]);
  settings.on('change', (s, prev) => {
    if (wanted(s) !== wanted(prev)) (checking || Promise.resolve()).then(run);
  });

  return {
    check: run,
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
