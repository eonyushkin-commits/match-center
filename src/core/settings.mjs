// Настройки = встроенные значения + отличия пользователя (settings.json).
// У пользователя хранятся только отличия, поэтому каналы и алиасы из новых версий доходят
// до всех сами. Правятся настройки из приложения; сломанный файл не мешает запуску.
//
// Файл версии 2: общие настройки (частота опроса, уведомления, трей, автозапуск, ui) лежат
// в корне, а каналы, турниры, написания и избранное — отдельно у каждого вида спорта:
//   { version: 2, tray, ui: { … }, sports: { <вид>: { channels, leagues, favorites, … } } }
// Номера игроков, команд и матчей у разных источников пересекаются, поэтому общего
// избранного нет. Файл версии 1 (без version, всё в корне) переносится при открытии.
// Остальному приложению настройки отдаются «плоскими» — общие вместе с разделом одного вида.
import { EventEmitter } from 'node:events';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultSport, sportById } from '../sports/index.mjs';

const COMMON = JSON.parse(await readFile(new URL('./defaults.json', import.meta.url), 'utf8'));
// встроенные настройки вида спорта: его каналы, турниры и написания + общие значения
export const defaultsOf = (sport) => ({ ...sport.defaults, ...COMMON });
export const defaults = defaultsOf(defaultSport);

export const VERSION = 2;
const SPORT_KEYS = ['channels', 'leagues', 'teamAliases', 'favorites', 'favoriteMatches'];
const COMMON_KEYS = ['refreshSeconds', 'notifications', 'tray', 'autostart', 'ui'];
const V1_BACKUP = 'settings.v1.json';

const SCREEN_NAME = /^[\w.-]{2,64}$/;
const THEMES = ['system', 'light', 'dark'];
const FILTERS = ['streams', 'live', 'favorites'];

function clamp(n, lo, hi, fallback) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
}

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const knownLeagues = (sport) => new Set(sport.defaults.knownLeagues.map((l) => l.id)); // турниры (разряды) вида спорта
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Раздел вида спорта: каналы, турниры, написания, избранное
function resolveSport(user, sport) {
  const d = sport.defaults;
  const channels = new Map(d.channels.map((c) =>
    [c.screenName, { screenName: c.screenName, label: c.label, enabled: true, builtIn: true }]));
  for (const c of Array.isArray(user.channels) ? user.channels : []) {
    if (!SCREEN_NAME.test(c?.screenName || '')) continue;
    const base = channels.get(c.screenName);
    channels.set(c.screenName, {
      screenName: c.screenName,
      label: c.label || base?.label || c.screenName,
      enabled: !c.disabled,
      builtIn: !!base,
    });
  }

  const userAliases = isAliasMap(user.teamAliases) ? user.teamAliases : {};
  const teamAliases = {};
  for (const src of [d.teamAliases, userAliases])
    for (const [team, names] of Object.entries(src))
      teamAliases[team] = [...new Set([...(teamAliases[team] || []), ...names])];

  const known = knownLeagues(sport);
  return {
    channels: [...channels.values()],
    leagues: Array.isArray(user.leagues) && user.leagues.some((id) => known.has(id)) ? user.leagues.filter((id) => known.has(id)) : d.leagues,
    teamAliases,
    userAliases,
    favorites: Array.isArray(user.favorites) ? user.favorites : [],
    favoriteMatches: freshMatches(user.favoriteMatches), // отдельные матчи с напоминанием
  };
}

// Общие настройки: одни на все виды спорта
function resolveCommon(user) {
  const ui = isObject(user.ui) ? user.ui : {};
  return {
    refreshSeconds: clamp(user.refreshSeconds, 30, 600, COMMON.refreshSeconds),
    notifications: typeof user.notifications === 'boolean' ? user.notifications : COMMON.notifications,
    tray: typeof user.tray === 'boolean' ? user.tray : COMMON.tray, // закрытие окна сворачивает в трей
    autostart: typeof user.autostart === 'boolean' ? user.autostart : COMMON.autostart, // запуск вместе с Windows
    ui: {
      theme: THEMES.includes(ui.theme) ? ui.theme : 'system',
      sport: sportById(ui.sport) ? ui.sport : defaultSport.id, // вид спорта, открытый в окне
      filters: Object.fromEntries(FILTERS.map((f) => [f, !!ui.filters?.[f]])),
      hideScores: !!ui.hideScores, // режим без спойлеров
      leaguesByTime: !!ui.leaguesByTime, // турниры по времени первого матча, а не в порядке списка
      trayHintShown: !!ui.trayHintShown,
      window: isObject(ui.window) ? ui.window : null,
    },
  };
}

// Итоговые настройки одного вида спорта, с которыми работает приложение.
// user — отличия пользователя «плоско»: общие вместе с разделом этого вида.
export function resolve(user = {}, sport = defaultSport) {
  return { ...resolveSport(user, sport), ...resolveCommon(user) };
}

// Отмеченные матчи нужны только до начала: через сутки после него запись больше не нужна
function freshMatches(list, now = Date.now()) {
  return (Array.isArray(list) ? list : [])
    .filter((m) => Number.isInteger(m?.id) && !(Date.parse(m.utcTime) < now - 24 * 3600e3))
    .map((m) => ({ id: m.id, name: String(m.name || '').slice(0, 120), utcTime: String(m.utcTime || '') }));
}

function isAliasMap(v) {
  return isObject(v) && Object.values(v).every((names) => Array.isArray(names) && names.every((n) => typeof n === 'string'));
}

// Изменения из приложения (в виде итоговых настроек вида спорта) → новые отличия пользователя,
// тоже «плоские»
export function applyPatch(user, patch, sport = defaultSport) {
  if (!patch || typeof patch !== 'object') throw invalid('Ожидался объект настроек');
  const d = sport.defaults;
  const next = { ...user };

  if (patch.channels !== undefined) {
    if (!Array.isArray(patch.channels)) throw invalid('channels: ожидался список');
    const builtIn = new Map(d.channels.map((c) => [c.screenName, c]));
    const seen = new Set();
    const list = [];
    for (const c of patch.channels) {
      const screenName = String(c?.screenName || '').trim();
      if (!SCREEN_NAME.test(screenName)) throw invalid(`Неверное имя канала: «${screenName}»`);
      if (seen.has(screenName)) continue;
      seen.add(screenName);
      const label = String(c.label || '').trim().slice(0, 60);
      const base = builtIn.get(screenName);
      const entry = { screenName };
      if (!base) entry.label = label || screenName;
      else if (label && label !== base.label) entry.label = label;
      if (c.enabled === false) entry.disabled = true;
      if (!base || entry.label || entry.disabled) list.push(entry);
    }
    // встроенный канал, которого нет в списке, пользователь убрал — запоминаем как выключенный
    for (const screenName of builtIn.keys())
      if (!seen.has(screenName)) list.push({ screenName, disabled: true });
    next.channels = list.length ? list : undefined;
  }

  if (patch.leagues !== undefined) {
    if (!Array.isArray(patch.leagues)) throw invalid('leagues: ожидался список');
    const known = knownLeagues(sport);
    const ids = [...new Set(patch.leagues.map(Number))].filter((n) => known.has(n));
    if (!ids.length) throw invalid(sport.texts.pickLeague);
    next.leagues = sameList(ids, d.leagues) ? undefined : ids;
  }

  if (patch.userAliases !== undefined) {
    if (!isAliasMap(patch.userAliases)) throw invalid(`${sport.texts.aliases}: ожидались списки строк`);
    const clean = Object.fromEntries(Object.entries(patch.userAliases)
      .map(([team, names]) => [team.trim(), names.map((n) => n.trim()).filter(Boolean)])
      .filter(([team, names]) => team && names.length));
    next.teamAliases = Object.keys(clean).length ? clean : undefined;
  }

  if (patch.favorites !== undefined) {
    if (!Array.isArray(patch.favorites)) throw invalid('favorites: ожидался список');
    next.favorites = patch.favorites
      .filter((f) => Number.isInteger(f?.id))
      .map((f) => ({ id: f.id, name: String(f.name || '').slice(0, 80) }));
  }

  if (patch.favoriteMatches !== undefined) {
    if (!Array.isArray(patch.favoriteMatches)) throw invalid('favoriteMatches: ожидался список');
    const list = freshMatches(patch.favoriteMatches);
    next.favoriteMatches = list.length ? list : undefined;
  }

  if (patch.refreshSeconds !== undefined) {
    const v = clamp(patch.refreshSeconds, 30, 600, COMMON.refreshSeconds);
    next.refreshSeconds = v === COMMON.refreshSeconds ? undefined : v;
  }

  for (const key of ['notifications', 'tray', 'autostart'])
    if (patch[key] !== undefined) next[key] = !!patch[key];

  if (patch.ui !== undefined) {
    const ui = { ...(user.ui || {}) };
    if (THEMES.includes(patch.ui.theme)) ui.theme = patch.ui.theme;
    if (patch.ui.sport !== undefined) {
      if (!sportById(patch.ui.sport)) throw invalid(`Неизвестный вид спорта: «${patch.ui.sport}»`);
      ui.sport = patch.ui.sport;
    }
    if (patch.ui.filters) ui.filters = Object.fromEntries(FILTERS.map((f) => [f, !!patch.ui.filters[f]]));
    for (const key of ['hideScores', 'leaguesByTime', 'trayHintShown'])
      if (patch.ui[key] !== undefined) ui[key] = !!patch.ui[key];
    if (patch.ui.window && typeof patch.ui.window === 'object') {
      const { x, y, width, height, maximized } = patch.ui.window;
      ui.window = { x, y, width, height, maximized: !!maximized };
    }
    next.ui = ui;
  }

  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  return next;
}

// Содержимое settings.json → файл версии 2. Файл версии 1 целиком относился к одному виду
// спорта (v1Sport): его каналы, турниры, написания и избранное уходят в раздел этого вида.
// Разделы видов, которых это приложение не знает, сохраняются как есть.
export function migrate(file, v1Sport = defaultSport.id) {
  if (file.version >= VERSION) return { ...file, sports: isObject(file.sports) ? file.sports : {} };
  const section = pick(file, SPORT_KEYS);
  return {
    version: VERSION,
    ...pick(file, COMMON_KEYS),
    sports: Object.keys(section).length ? { [v1Sport]: section } : {},
  };
}

// v1Sport — к какому виду спорта относится найденный файл версии 1
export async function openSettings(dir, { v1Sport = defaultSport.id } = {}) {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'settings.json');
  const warnings = [];
  let data; // файл версии 2
  let queue = Promise.resolve();

  async function write(next) {
    const tmp = `${file}.tmp`;
    await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
    await rename(tmp, file); // целиком или никак — файл не останется наполовину записанным
  }

  try {
    const read = JSON.parse(await readFile(file, 'utf8'));
    if (!isObject(read)) throw new Error('ожидался объект');
    data = migrate(read, v1Sport);
    if (!(read.version >= VERSION)) {
      // прежний файл остаётся рядом: по нему можно вернуться на старую версию приложения.
      // COPYFILE_EXCL — копию, сделанную раньше, не затираем
      if (Object.keys(read).length) await copyFile(file, path.join(dir, V1_BACKUP), 1).catch(() => {});
      await write(data);
    }
  } catch (e) {
    data = { version: VERSION, sports: {} };
    if (e.code === 'ENOENT') {
      await write(data);
    } else {
      const backup = file.replace(/\.json$/, `.broken-${Date.now()}.json`);
      await copyFile(file, backup).catch(() => {});
      warnings.push(`Файл настроек повреждён (${e.message}), используются настройки по умолчанию. Копия: ${backup}`);
    }
  }

  const sportOf = (id) => {
    const sport = sportById(id);
    if (!sport) throw invalid(`Неизвестный вид спорта: «${id}»`);
    return sport;
  };
  // отличия пользователя «плоско»: общие + раздел вида
  const flat = (d, id) => ({ ...(isObject(d.sports[id]) ? d.sports[id] : {}), ...pick(d, COMMON_KEYS) });
  const active = () => resolveCommon(data).ui.sport;
  let cache = new Map(); // вид → итоговые настройки; сбрасывается при каждой правке
  function get(id = active()) {
    if (!cache.has(id)) cache.set(id, resolve(flat(data, id), sportOf(id)));
    return cache.get(id);
  }

  const events = new EventEmitter();
  return Object.assign(events, {
    warnings,
    // итоговые настройки вида спорта id; без id — того, что открыт в окне (ui.sport)
    get,
    // Правка настроек вида id (без id — открытого в окне): общие поля меняются для всех видов.
    // Сначала файл, потом память: не записалось — приложение целиком остаётся на прежних настройках.
    // Правки идут по очереди, каждая — поверх предыдущей.
    update(patch, id) {
      return (queue = queue.catch(() => {}).then(async () => {
        const sport = sportOf(id ?? active());
        const user = applyPatch(flat(data, sport.id), patch, sport);
        const section = pick(user, SPORT_KEYS);
        const sportsNext = { ...data.sports, [sport.id]: section };
        if (!Object.keys(section).length) delete sportsNext[sport.id];
        const next = { version: VERSION, ...pick(user, COMMON_KEYS), sports: sportsNext };
        await write(next);
        const prev = get();
        data = next;
        cache = new Map();
        warnings.length = 0; // файл перезаписан целым — предупреждение о поломке больше не актуально
        // слушателям — настройки вида, открытого в окне; за своим видом каждый обращается сам: get(id)
        events.emit('change', get(), prev);
        return get(sport.id);
      }));
    },
  });
}
