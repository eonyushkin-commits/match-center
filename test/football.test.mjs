// Футбол в ядре: источник FotMob, день, лента, уведомления, сервер и два вида спорта вместе.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createMatchCenter } from '../src/core/app.mjs';
import { buildReport, coreDiagnostics } from '../src/core/diagnostics.mjs';
import { createFeed } from '../src/core/feed.mjs';
import { createHandler, startServer } from '../src/core/server.mjs';
import { applyPatch, openSettings, resolve } from '../src/core/settings.mjs';
import { FormatError } from '../src/core/shape.mjs';
import { createStreamPoller } from '../src/core/streams.mjs';
import { toItems } from '../src/core/vk-items.mjs';
import { watchFavorites } from '../src/core/watch.mjs';
import { buildDay } from '../src/sports/football/day.mjs';
import football from '../src/sports/football/index.mjs';
import { createFotmob } from '../src/sports/football/source.mjs';
import tennis from '../src/sports/tennis/index.mjs';

const pause = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const tmp = () => mkdtemp(path.join(os.tmpdir(), 'mc-football-'));
const answers = (body) => async () => new Response(JSON.stringify(body));
const changed = /изменил формат ответа \(.+\) — нужна новая версия приложения/;
const settingsOf = (user = {}) => resolve(user, football);

// ---------- источник: перенесено из футбольного приложения (test/shape.test.mjs) ----------

test('FotMob: расписание без списка leagues, названия без Participants — ошибка формата', async () => {
  const f = createFotmob(answers({ matches: [] }));
  await assert.rejects(f.day('20260920', 'Europe/Moscow'), (e) => e instanceof FormatError && /FotMob.*нет списка leagues/.test(e.message));
  await assert.rejects(f.names(), changed);
  await assert.rejects(f.leagues(), changed);
});

test('FotMob: день за пределами расписания (null) — просто без матчей', async () => {
  const day = await createFotmob(answers(null)).day('20270715', 'Europe/Moscow');
  assert.deepEqual(day.leagues, []);
  assert.equal(typeof day.fetchedAt, 'number', 'время ответа — как у любого источника');
});

test('FotMob сменил формат после удачного ответа — отдаётся прежнее расписание с пометкой', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  let body = { leagues: [{ id: 47, matches: [] }] };
  const f = createFotmob(async () => new Response(JSON.stringify(body)));
  const first = await f.day('20260920', 'UTC');
  body = { data: [] };
  t.mock.timers.tick(60e3);
  const day = await f.day('20260920', 'UTC');
  assert.equal(day.leagues.length, 1);
  assert.equal(day.stale.format, true);
  assert.match(day.stale.message, changed);
  const built = buildDay({ fm: day, ru: {}, settings: settingsOf(), snapshot: { streams: [] } });
  assert.equal(built.stale.format, true);
  assert.equal(built.fetchedAt, first.fetchedAt, 'время последнего настоящего ответа сбой не меняет');
});

test('FotMob: refresh — расписание спрашивается заново, не дожидаясь срока кэша; названия — нет', async () => {
  const calls = { day: 0, names: 0 };
  const f = createFotmob(async (url) => {
    const names = url.includes('translationmapping');
    calls[names ? 'names' : 'day']++;
    return new Response(JSON.stringify(names ? { Participants: {} } : { leagues: [] }));
  });
  await f.day('20260920', 'UTC');
  await f.day('20260920', 'UTC');
  await f.names();
  assert.deepEqual(calls, { day: 1, names: 1 }, 'второй раз — из кэша');
  f.refresh();
  await f.day('20260920', 'UTC');
  await f.names();
  assert.deepEqual(calls, { day: 2, names: 1 });
});

test('FotMob: состояние для отчёта — по видам запросов, с временем настоящих ответов', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  let down = false;
  const source = football.createSource({
    fetchImpl: async (url) => {
      if (down) throw new Error('нет сети');
      return new Response(JSON.stringify(url.includes('translationmapping') ? { Participants: {} } : { leagues: [] }));
    },
    nodeFetch: async () => { throw new Error('футболу встроенный fetch Node.js не нужен'); },
  });
  const data = await source.day('20260920', football.dayQuery({}, 'Europe/Moscow'));
  assert.deepEqual([data.fm.leagues, typeof data.ru.Participants], [[], 'object']);
  down = true;
  source.refresh();
  t.mock.timers.tick(10e3);
  assert.ok((await source.day('20260920', 'Europe/Moscow')).fm.stale);
  assert.deepEqual(football.health(source), [
    { name: 'расписание', okAt: 1_000_000, errorAt: 1_010_000, error: 'нет сети' },
    { name: 'названия', okAt: 1_000_000, errorAt: null, error: null },
  ]);
});

// ---------- день ----------

const ru = { Participants: { 1: 'Фулхэм', 2: 'Манчестер Юнайтед', 3: 'Арсенал' }, TournamentTemplates: { 47: 'Премьер-Лига', 77: 'Чемпионат мира' }, CountryCodes: { ENG: 'Англия' } };
const fmMatch = (id, home, away, utcTime, status = {}) => ({
  id, home: { id: home, name: `team ${home}`, score: status.started ? 1 : undefined }, away: { id: away, name: `team ${away}`, score: status.started ? 0 : undefined },
  status: { utcTime, started: false, finished: false, ...status },
});
const stream = (title, extra = {}) => ({ ...toItems([{ owner_id: -1, id: 1, title, live_status: 'started' }], { label: 'X' }, football.parseTitle)[0], time: null, ...extra });

test('buildDay: матч выбранного турнира без команд — ошибка формата; чужие турниры не проверяются', () => {
  const ok = { id: 1, home: { id: 1, name: 'A' }, away: { id: 2, name: 'B' }, status: { utcTime: '2026-09-20T15:00:00Z' } };
  const build = (leagues) => buildDay({ fm: { leagues }, ru: {}, settings: settingsOf(), snapshot: { streams: [] } });
  assert.throws(() => build([{ id: 47, matches: [ok, { id: 2, homeTeam: {}, status: {} }] }]), /FotMob изменил формат ответа \(у матча 2 нет команд или времени начала\)/);
  assert.equal(build([{ id: 47, matches: [ok] }, { id: 999999, matches: [{ id: 3 }] }]).leagues.length, 1);
});

test('buildDay: турниры в порядке настроек, русские названия, счёт, статусы FotMob, эфир и избранное', () => {
  const fm = {
    fetchedAt: 123,
    leagues: [
      { id: 48, name: 'Championship', ccode: 'ENG', matches: [fmMatch(20, 4, 5, '2026-09-20T14:00:00Z')] },
      { id: 47, name: 'Premier League', ccode: 'ENG', matches: [
        fmMatch(10, 1, 2, '2026-09-20T15:30:00Z', { started: true, liveTime: { short: '67’' } }),
        fmMatch(11, 3, 9, '2026-09-20T12:00:00Z', { started: true, finished: true, reason: { short: 'FT' } }),
      ] },
      { id: 55, name: 'Serie A', ccode: 'ITA', matches: [fmMatch(30, 7, 8, '2026-09-20T18:00:00Z')] },
    ],
  };
  const settings = settingsOf({ favorites: [{ id: 2, name: 'Манчестер Юнайтед' }], favoriteMatches: [{ id: 20, name: 'x', utcTime: new Date(Date.now() + 3600e3).toISOString() }] });
  const day = buildDay({ fm, ru, settings, snapshot: { streams: [stream('Фулхэм — МЮ | АПЛ 5 тур', { url: 'u' })] } });

  assert.deepEqual(day.leagues.map((l) => [l.id, l.name, l.country]), [[47, 'Премьер-Лига', 'Англия'], [48, 'Championship', 'Англия']], 'Серии A в настройках нет');
  assert.deepEqual([day.stale, day.fetchedAt], [null, 123]);
  const [live, done] = day.leagues[0].matches;
  assert.deepEqual(live.home, { id: 1, ids: [1], name: 'Фулхэм', score: 1 });
  assert.deepEqual(live.away, { id: 2, ids: [2], name: 'Манчестер Юнайтед', score: 0 });
  assert.deepEqual([live.started, live.finished, live.cancelled, live.liveTime, live.reason, live.timeKnown], [true, false, false, '67’', null, true]);
  assert.deepEqual([live.favorite, live.remind], [true, false], 'команда в избранном');
  assert.deepEqual(live.streams.map((s) => s.url), ['u'], 'эфир привязан по алиасу «МЮ»');
  assert.deepEqual(Object.keys(live.streams[0]).filter((k) => ['teams', 'doubles', 'score'].includes(k)), [], 'служебные поля не уходят на страницу');
  assert.deepEqual([done.reason, done.home.name, done.away.name, done.favorite], ['FT', 'Арсенал', 'team 9', false]);
  const [bell] = day.leagues[1].matches;
  assert.deepEqual([bell.favorite, bell.remind, bell.home.score], [true, true, null], 'матч отмечен колокольчиком; счёта до начала нет');
});

test('buildDay: группы одного турнира собираются в один раздел по времени начала', () => {
  const fm = { leagues: [
    { id: 900001, primaryId: 77, name: 'World Cup Grp. A', ccode: 'INT', matches: [fmMatch(1, 1, 2, '2026-06-20T18:00:00Z')] },
    { id: 900002, primaryId: 77, name: 'World Cup Grp. B', ccode: 'INT', matches: [fmMatch(2, 3, 4, '2026-06-20T15:00:00Z')] },
  ] };
  const day = buildDay({ fm, ru, settings: settingsOf({ leagues: [77] }), snapshot: { streams: [] } });
  assert.deepEqual(day.leagues.map((l) => [l.id, l.name, l.country, l.matches.map((m) => m.id)]), [[77, 'Чемпионат мира', 'INT', [2, 1]]]);
});

// ---------- настройки ----------

test('настройки футбола: турнир — любой номер FotMob; свои тексты ошибок; номера тенниса не подходят теннису наоборот', () => {
  assert.deepEqual(settingsOf().leagues, [47, 48, 132, 133, 247, 338]);
  assert.deepEqual(settingsOf({ leagues: [42, 47] }).leagues, [42, 47], 'турнир, добавленный по номеру');
  assert.deepEqual(applyPatch({}, { leagues: [42, '47', 42, -1, 'x'] }, football).leagues, [42, 47]);
  assert.equal(applyPatch({}, { leagues: [47, 48, 132, 133, 247, 338] }, football).leagues, undefined, 'встроенный список не хранится');
  assert.throws(() => applyPatch({}, { leagues: [] }, football), { status: 400, message: /хотя бы один турнир/ });
  assert.throws(() => applyPatch({}, { userAliases: { a: 'b' } }, football), { status: 400, message: /Написания команд/ });
  assert.deepEqual(settingsOf().channels.map((c) => c.screenName), ['englishaccent', 'pl_forever', 'sportcast.online', 'vishli_football', 'liga_pari']);
  assert.deepEqual(settingsOf({ teamAliases: { 'Арсенал': ['Канониры'] } }).teamAliases['Манчестер Юнайтед'], ['МЮ', 'Ман Юнайтед']);
});

// ---------- лента и уведомления ----------

test('лента футбола: расписание FotMob с русскими названиями; запрос дня — с часовым поясом', async () => {
  const asked = [];
  const source = { day: async (date, tz) => { asked.push([date, tz]); return { fm: { leagues: [{ id: 47, name: 'PL', matches: [fmMatch(7, 1, 2, '2026-09-20T15:00:00Z', { started: true })] }] }, ru }; } };
  const poller = Object.assign(new EventEmitter(), { snapshot: () => ({ ready: true, channels: [], streams: [] }) });
  const settings = Object.assign(new EventEmitter(), { warnings: [], get: (id) => { assert.equal(id, 'football'); return settingsOf(); } });
  const feed = createFeed({ settings, poller, sport: football, source, version: 'v', dayMs: 1e9, retryMs: 1e9 });
  const log = [];
  const stop = feed.subscribe({ date: '20260920', tz: 'Europe/Moscow' }, (event, json) => log.push([event, JSON.parse(json)]));
  await pause();
  stop();
  assert.deepEqual(asked, [['20260920', 'Europe/Moscow']]);
  const day = log.find(([e]) => e === 'day')[1];
  assert.deepEqual([day.leagues[0].matches[0].home.name, day.leagues[0].matches[0].home.score], ['Фулхэм', 1]);
});

test('уведомления футбола: только при фактическом начале матча, один раз; заранее тишина', async () => {
  const KICKOFF = Date.parse('2026-09-20T15:30:00Z');
  const MIN = 60e3;
  const status = { utcTime: new Date(KICKOFF).toISOString(), started: false, finished: false };
  const fm = { leagues: [{ id: 47, matches: [{ id: 7, home: { id: 1, name: 'Fulham' }, away: { id: 2, name: 'Man United' }, status }] }] };
  const poller = new EventEmitter();
  poller.snapshot = () => ({ streams: [] });
  let now = KICKOFF - 60 * MIN;
  const events = [];
  const w = watchFavorites({
    poller, settings: { get: () => settingsOf({ favorites: [{ id: 2, name: 'Манчестер Юнайтед' }] }), on() {} },
    sport: football, source: { day: async () => ({ fm, ru }) },
    onEvent: (e) => events.push([e.kind, e.match.away.name]), now: () => now, log: {},
  });
  const at = async (t) => { now = t; return w.check(); };

  assert.equal(await at(KICKOFF - 40 * MIN), KICKOFF, 'следующая проверка — к началу по расписанию');
  await at(KICKOFF - 10 * MIN);
  assert.deepEqual(events, [], 'за 15 минут больше не напоминаем');
  assert.equal(await at(KICKOFF + 2 * MIN), KICKOFF + 3 * MIN, 'матч задерживается — ждём, проверяя раз в минуту');
  assert.deepEqual(events, []);
  status.started = true;
  await at(KICKOFF + 3 * MIN);
  await at(KICKOFF + 4 * MIN);
  w.stop();
  assert.deepEqual(events, [['kickoff', 'Манчестер Юнайтед']]);
});

// ---------- сервер ----------

test('сервер: расписание, настройки, турниры и «Обновить» — по видам спорта', async (t) => {
  const settings = await openSettings(await tmp());
  const calls = [];
  const unit = (sport, data, extra = {}) => {
    const poller = Object.assign(new EventEmitter(), { snapshot: () => ({ ready: true, updatedAt: 1, channels: [], streams: [] }), retry() { calls.push(`${sport.id}: каналы`); } });
    const source = { day: async () => data, refresh() { calls.push(`${sport.id}: расписание`); }, ...extra };
    return { sport, source, poller, feed: createFeed({ settings, poller, sport, source, version: 'test' }) };
  };
  const allLeagues = {
    international: [{ ccode: 'INT', localizedName: 'Международный', leagues: [{ id: 42, name: 'Champions League', localizedName: 'Лига Чемпионов' }] }],
    countries: [{ ccode: 'RUS', localizedName: 'Россия', leagues: [{ id: 338, name: '1. Division', localizedName: 'ФНЛ' }, { id: 9123, name: 'PFL' }] }],
  };
  const fm = { leagues: [{ id: 47, name: 'Premier League', ccode: 'ENG', matches: [fmMatch(100, 1, 2, '2026-09-20T15:30:00Z', { started: true, liveTime: { short: '67’' } })] }] };
  const units = [unit(tennis, { events: [], stale: null, fetchedAt: 1 }), unit(football, { fm, ru }, { fotmob: { leagues: async () => allLeagues } })];
  const { server, url } = await startServer(createHandler({ settings, units }));
  t.after(() => { for (const u of units) u.feed.close(); server.close(); server.closeAllConnections(); });

  async function day(query) {
    const r = await fetch(`${url}/api/events?${query}`);
    const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
    let text = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return null;
      text += value;
      const found = /event: day\ndata: (.*)\n\n/.exec(text);
      if (found) { await reader.cancel(); return JSON.parse(found[1]); }
    }
  }

  const fb = await day('sport=football&date=20260920&tz=Europe/Moscow');
  assert.deepEqual([fb.leagues[0].name, fb.leagues[0].matches[0].home.name, fb.leagues[0].matches[0].liveTime], ['Премьер-Лига', 'Фулхэм', '67’']);
  assert.deepEqual((await day('date=20260920&tz=Europe/Moscow')).leagues, [], 'без sport — вид, открытый в окне: теннис');
  assert.equal((await fetch(`${url}/api/events?sport=curling&date=20260920`)).status, 400);

  const s = await (await fetch(`${url}/api/settings?sport=football`)).json();
  assert.deepEqual([s.knownLeagues.map((l) => l.id), s.leagues, s.channels.length], [[47, 48, 132, 133, 247, 338], [47, 48, 132, 133, 247, 338], 5]);
  const put = await fetch(`${url}/api/settings?sport=football`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leagues: [47, 42], favorites: [{ id: 2, name: 'МЮ' }] }) });
  assert.deepEqual((await put.json()).leagues, [47, 42]);
  assert.deepEqual([settings.get('tennis').leagues, settings.get('tennis').favorites], [[1, 2], []], 'настройки тенниса не тронуты');

  assert.deepEqual(await (await fetch(`${url}/api/leagues?sport=football`)).json(), { 42: 'Лига Чемпионов', 338: 'Россия · ФНЛ', 9123: 'Россия · PFL' });
  assert.equal((await fetch(`${url}/api/leagues?sport=tennis`)).status, 404, 'у тенниса разряды заданы списком');

  await fetch(`${url}/api/refresh?sport=football`, { method: 'POST' });
  assert.deepEqual(calls, ['football: расписание', 'football: каналы']);

  const csp = (await fetch(`${url}/`)).headers.get('content-security-policy');
  assert.match(csp, /img-src 'self' data: https:\/\/a\.espncdn\.com https:\/\/images\.fotmob\.com;/);
});

// ---------- всё ядро с двумя видами спорта ----------

// подставная сеть: считает запросы по адресам; VK отдаёт по одному эфиру на канал
function fakeNet() {
  const asked = [];
  const json = (body) => new Response(JSON.stringify(body));
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.hostname === 'login.vk.ru') return json({ data: { access_token: 't', expired_at: Math.floor(Date.now() / 1000) + 3600 } });
    if (u.hostname === 'api.vkvideo.ru') {
      const channel = /@([\w.-]+)\/lives/.exec(new URLSearchParams(init.body).get('url'))?.[1];
      asked.push(`vk:${channel}`);
      const title = channel.includes('tennis') ? 'Андреева — Шнайдер' : 'Арсенал — Челси | АПЛ';
      return json({ response: { videos: [{ owner_id: -1, id: asked.length, title, live_status: 'started', date: 1 }] } });
    }
    asked.push(u.hostname);
    if (u.hostname === 'www.fotmob.com') return json(u.pathname.includes('translationmapping') ? { Participants: {} } : { leagues: [] });
    return json({ events: [] });
  };
  return { asked, fetchImpl };
}
const vkAsked = (asked) => [...new Set(asked.filter((a) => a.startsWith('vk:')).map((a) => a.slice(3)))].sort();

test('ядро: каналы VK опрашиваются только у вида спорта, открытого в окне; переключение запускает другой опрос', async (t) => {
  const net = fakeNet();
  const mc = await createMatchCenter({ dataDir: await tmp(), fetchImpl: net.fetchImpl, nodeFetch: net.fetchImpl, version: 'test' });
  t.after(() => mc.close());
  await pause(50);
  assert.deepEqual(vkAsked(net.asked), ['bbtennis_live', 'sportcast_tennis', 'tennis_bolshe', 'tennisprimesport', 'tennistimehere'], 'открыт теннис — читаются только его каналы');
  assert.ok(!net.asked.includes('www.fotmob.com'), 'без избранного и без открытой страницы FotMob не спрашиваем');

  net.asked.length = 0;
  await mc.settings.update({ ui: { sport: 'football' } });
  await pause(50);
  assert.deepEqual(vkAsked(net.asked), ['englishaccent', 'liga_pari', 'pl_forever', 'sportcast.online', 'vishli_football'], 'открыли футбол — читаются его каналы, теннисные — нет');

  // эфиры каждого вида разобраны по его правилам и лежат в его опросе
  const report = buildReport({ app: { name: 'Матч-центр', version: 'test', packaged: false, electron: '1', chrome: '1', node: '1', os: 'x' }, core: mc.diagnostics() });
  assert.match(report, /=== Теннис ===\nНастройки \(только счётчики\):\n {2}каналов: 5, включено: 5, своих: 0\n {2}разрядов: 2; избранных игроков: 0;/);
  assert.match(report, /=== Теннис ===[^=]*VK: круг чтения завершён [\dT:Z-]+ \(опрос остановлен\)\n {2}ok {3}tennisprimesport: через api, эфиров 1/);
  assert.match(report, /=== Футбол ===\nНастройки \(только счётчики\):\n {2}каналов: 5, включено: 5, своих: 0\n {2}турниров: 6; избранных команд: 0;/);
  assert.match(report, /=== Футбол ===[^=]*FotMob:\n {2}запросов ещё не было\n\nVK: круг чтения завершён [\dT:Z-]+\n {2}ok {3}englishaccent: через api, эфиров 1/);
});

test('ядро: уведомление несёт вид спорта; у неоткрытого вида опрос каналов не запускается', async (t) => {
  const dir = await tmp();
  const kickoff = Date.now() - 2 * 60e3;
  await writeFile(path.join(dir, 'settings.json'), JSON.stringify({ version: 2, sports: { football: { favorites: [{ id: 2, name: 'Челси' }] } } }));
  const net = fakeNet();
  const json = (body) => new Response(JSON.stringify(body));
  const fm = { leagues: [{ id: 47, matches: [fmMatch(101, 1, 2, new Date(kickoff).toISOString(), { started: true })] }] };
  const fetchImpl = async (url, init) => {
    const u = new URL(String(url));
    if (u.hostname === 'www.fotmob.com' && u.pathname === '/api/data/matches') { net.asked.push('fotmob:day'); return json(fm); }
    return net.fetchImpl(url, init);
  };
  const mc = await createMatchCenter({ dataDir: dir, fetchImpl, nodeFetch: fetchImpl, version: 'test' });
  t.after(() => mc.close());
  const events = [];
  mc.onNotify((e) => events.push([e.sport, e.kind, e.match.id]));
  await mc.settings.update({ favorites: [{ id: 2, name: 'Челси' }, { id: 3, name: 'Арсенал' }] }, 'football'); // правка избранного — проверка сразу
  await pause(80);
  assert.deepEqual(events, [['football', 'kickoff', 101]]);
  assert.ok(vkAsked(net.asked).every((ch) => ch.includes('tennis')), 'каналы футбола не читались: открыт теннис');
});

test('отчёт: у вида спорта, который не открывали, каналы не опрашиваются', async () => {
  const s = { tennis: resolve({}), football: settingsOf() };
  const settings = { get: (id) => s[id], warnings: [] };
  const poller = (sport, running) => {
    const p = createStreamPoller({ channels: () => s[sport.id].channels, intervalMs: () => 1e9, readers: [], parseTitle: sport.parseTitle, log: {} });
    if (!running) p.stop();
    return p;
  };
  const units = [tennis, football].map((sport, i) => ({ sport, source: sport.createSource({ fetchImpl: answers({}), nodeFetch: answers({}) }), poller: poller(sport, i === 0) }));
  const report = buildReport({ app: { name: 'Матч-центр', version: '3', packaged: true, electron: '1', chrome: '1', node: '1', os: 'x' }, core: coreDiagnostics({ settings, units }) });
  assert.match(report, /=== Теннис ===[^=]*VK: первое чтение ещё идёт\n {2}ждёт tennisprimesport:/);
  assert.match(report, /=== Футбол ===[^=]*VK: каналы не опрашиваются — вид спорта не открыт в окне\n$/);
});

test('отчёт: свои каналы обоих видов спорта заменяются подписями — и в списке, и в тексте ошибок', async () => {
  const s = {
    tennis: resolve({ channels: [{ screenName: 'my_tennis_secret', label: 'Теннис Ивана' }] }),
    football: settingsOf({ channels: [{ screenName: 'my_football_secret', label: 'Футбол Ивана' }] }),
  };
  const settings = { get: (id) => s[id], warnings: [] };
  const fail = async (ch) => { throw new Error(`HTTP 500 https://vkvideo.ru/@${ch.screenName}/lives (${ch.label})`); };
  const units = [tennis, football].map((sport) => ({
    sport,
    source: sport.createSource({ fetchImpl: answers({}), nodeFetch: answers({}) }),
    poller: createStreamPoller({ channels: () => s[sport.id].channels.filter((c) => !c.builtIn), intervalMs: () => 1e9, readers: [{ name: 'api', read: fail }], parseTitle: sport.parseTitle, log: {} }),
  }));
  for (const u of units) { await u.poller.refresh(); u.poller.stop(); }
  const report = buildReport({ app: { name: 'Матч-центр', version: '3', packaged: true, electron: '1', chrome: '1', node: '1', os: 'x' }, core: coreDiagnostics({ settings, units }) });
  assert.match(report, /=== Теннис ===[^=]*сбой свой канал 1: [^\n]*\n\s+ошибка: api: HTTP 500 https:\/\/vkvideo\.ru\/@свой канал 1\/lives \(свой канал 1\)/);
  assert.match(report, /=== Футбол ===[^=]*сбой свой канал 2: [^\n]*\n\s+ошибка: api: HTTP 500 https:\/\/vkvideo\.ru\/@свой канал 2\/lives \(свой канал 2\)/);
  assert.doesNotMatch(report, /my_tennis_secret|my_football_secret|Ивана/);
  assert.match(report, /^Матч-центр — диагностический отчёт/, 'название приложения и заголовки видов целы');
});

test('ФНЛ: эфиры «Лиги PARI» привязываются к командам FotMob, в том числе «ФК Сочи» и «Спартак Кострома»', () => {
  // заголовки и названия — настоящие, с канала liga_pari и из FotMob, ноябрь 2026
  const names = { Participants: { 11: 'Енисей', 12: 'ФК Сочи', 13: 'Шинник', 14: 'Спартак Кострома', 15: 'Велес' } };
  const at = '2026-11-08T12:00:00Z';
  const fm = { leagues: [{ id: 338, name: 'FNL', ccode: 'RUS', matches: [
    fmMatch(1, 11, 12, at, { started: true, finished: true }),
    fmMatch(2, 13, 14, at, { started: true, finished: true }),
    fmMatch(3, 15, 11, at, { started: true, finished: true }),
  ] }] };
  const day = buildDay({ fm, ru: names, settings: settingsOf(), snapshot: { streams: [
    stream('«Енисей» – «Сочи» Лига PARI. 17 тур.', { url: 'a', status: 'finished' }),
    stream('«Шинник» – «Спартак» Лига PARI. 15 тур.', { url: 'b', status: 'finished' }),
  ] } });
  assert.deepEqual(day.leagues[0].matches.map((m) => m.streams.map((s) => s.url)), [['a'], ['b'], []]);
  assert.ok(settingsOf().channels.some((c) => c.screenName === 'liga_pari' && c.builtIn));
});
