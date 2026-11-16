// Страница с двумя видами спорта: футбольная строка матча, переключатель, тексты по видам.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { markFavorites, sections } from '../src/web/filter.mjs';
import { parseAliases } from '../src/web/format.mjs';
import footballView from '../src/web/sports/football.mjs';
import { sportViews } from '../src/web/sports/index.mjs';
import tennisView from '../src/web/sports/tennis.mjs';
import { emptyHtml, footHtml, notices, rowHtml, sectionHeadHtml, sportTabsHtml } from '../src/web/view.mjs';
import { sports } from '../src/sports/index.mjs';

const team = (id, name, score = null) => ({ id, ids: [id], name, score });
const match = (o = {}) => ({
  id: 7, utcTime: '2026-09-20T14:00:00Z', timeKnown: true, started: false, finished: false, cancelled: false,
  liveTime: null, reason: null, home: team(1, 'Фулхэм'), away: team(2, 'Манчестер Юнайтед'), streams: [], ...o,
});
const view = (o = {}) => ({ sport: footballView, favIds: new Set(), hidden: () => false, ...o });
const lg = { id: 47, name: 'Премьер-Лига', country: 'Англия' };
const row = (m, v = view(), extra = {}) => rowHtml({ key: `m:${m.id}`, m, lg, ...extra }, v);

test('у каждого вида спорта из ядра есть описание для страницы с тем же набором полей', () => {
  assert.deepEqual(Object.keys(sportViews).sort(), sports.map((s) => s.id).sort());
  const shape = (v) => Object.entries(v).map(([k, x]) => `${k}:${typeof x}`).sort();
  assert.deepEqual(shape(footballView), shape(tennisView));
  assert.deepEqual(Object.keys(footballView.settings).sort(), Object.keys(tennisView.settings).sort());
  for (const s of sports) {
    assert.equal(sportViews[s.id].id, s.id);
    assert.equal(sportViews[s.id].sourceName, s.sourceName, 'источник на странице называется так же, как в отчёте');
  }
});

test('футбол, rowHtml: логотипы, время и колокольчик у будущего матча; счёта и раунда нет', () => {
  const html = row(match());
  assert.match(html, /<div class="when">\d\d:\d\d<button type="button" class="bell"/);
  assert.match(html, /src="https:\/\/images\.fotmob\.com\/image_resources\/logo\/teamlogo\/1_small\.png"/);
  assert.match(html, /<span class="name">Фулхэм<\/span>/);
  assert.doesNotMatch(html, /class="score"|class="sets"|class="flags"|lg-tag/);
  assert.match(html, /class="stream find" href="https:\/\/vkvideo\.ru\/search\?q=/);
});

test('футбол, rowHtml: счёт и статусы FotMob как есть; победитель выделен только после конца', () => {
  const live = row(match({ started: true, liveTime: '67’', home: team(1, 'Фулхэм', 2), away: team(2, 'МЮ', 1) }));
  assert.match(live, /<div class="when live">67’<\/div>/);
  assert.deepEqual([...live.matchAll(/<span class="score">(\d)<\/span>/g)].map((x) => x[1]), ['2', '1']);
  assert.doesNotMatch(live, /class="team win"/);
  assert.doesNotMatch(live, /data-remind/, 'у начавшегося матча колокольчика нет');
  const done = row(match({ started: true, finished: true, reason: 'AET', home: team(1, 'Фулхэм', 2), away: team(2, 'МЮ', 3) }));
  assert.match(done, /<div class="when">AET<\/div>/);
  assert.match(done, /<div class="team win">\s*<img[^>]*teamlogo\/2_small/);
  assert.match(row(match({ started: true, finished: true })), /<div class="when">FT<\/div>/, 'без причины — FT');
  assert.match(row(match({ cancelled: true })), /<div class="when">Canc\.<\/div>/);
  assert.match(row(match({ started: true })), /<div class="when live">LIVE<\/div>/);
});

test('футбол, rowHtml: без спойлеров вместо счёта «?»; ★ — команда в избранном', () => {
  const m = match({ started: true, finished: true, home: team(1, 'Фулхэм', 2), away: team(2, 'МЮ', 0) });
  const hidden = row(m, view({ hidden: () => true }));
  assert.equal((hidden.match(/class="score masked" data-reveal="7"/g) || []).length, 2);
  assert.doesNotMatch(hidden, /class="team win"|<span class="score">/);
  const fav = row(m, view({ favIds: new Set([2]) }));
  assert.match(fav, /class="star on" data-fav="2" data-name="МЮ" aria-pressed="true"\s+title="Убрать из избранного"/);
  assert.match(fav, /class="star" data-fav="1" data-name="Фулхэм" aria-pressed="false"\s+title="В избранное — уведомлю о начале каждого матча команды"/);
});

test('футбол: шапка турнира с логотипом; в блоке «Сейчас в эфире» у матча — название турнира; всё экранируется', () => {
  assert.equal(sectionHeadHtml({ lg, rows: [1, 2] }, footballView),
    '<img loading="lazy" src="https://images.fotmob.com/image_resources/logo/leaguelogo/47.png" alt=""> Премьер-Лига <small>Англия</small><span class="count">2</span>');
  assert.match(sectionHeadHtml({ live: true, rows: [1] }, footballView), /^Сейчас в эфире/);
  assert.match(row(match({ started: true }), view(), { showLeague: true }), /^<div class="lg-tag">Премьер-Лига<\/div>/);
  const evil = rowHtml({ key: 'm:1', m: match({ home: team('1"><script>', '<b>x</b>') }), lg: { id: '"><img>', name: '<i>', country: '' }, showLeague: true }, view());
  assert.doesNotMatch(evil, /<script>|<b>x<\/b>|<i>/);
  assert.doesNotMatch(sectionHeadHtml({ lg: { id: '"><img onerror=x>', name: 'x', country: '' }, rows: [] }, footballView), /<img onerror/);
});

test('тексты по виду спорта: пустой день, источник в полосе сбоя и в подвале', () => {
  assert.match(emptyHtml(false, footballView), /Турниры выбираются в настройках/);
  assert.match(emptyHtml(false, tennisView), /разряды выбираются в настройках/);
  assert.match(emptyHtml(true, footballView), /Сбросить фильтры/);
  assert.match(notices({ day: { stale: { message: 'x' } }, sourceName: 'FotMob' })[0][1], /<b>FotMob сейчас недоступен<\/b>/);
  assert.match(notices({ day: { stale: { message: 'x' } } })[0][1], /<b>Источник расписания сейчас недоступен<\/b>/);
  const now = new Date(2026, 10, 14, 15, 0).getTime();
  const foot = footHtml({ version: '3.0.0', day: { fetchedAt: new Date(2026, 10, 14, 14, 58).getTime(), stale: null }, sourceName: 'FotMob', sports: 2 }, now);
  assert.match(foot, />счёт FotMob от 14:58<\/span>/);
  assert.match(foot, /<kbd>1<\/kbd> <kbd>2<\/kbd> вид спорта$/);
  assert.doesNotMatch(footHtml({ version: '3.0.0', day: null, sourceName: 'ESPN', sports: 1 }, now), /вид спорта/);
  assert.match(parseAliases('Арсенал', footballView.settings.aliasWord).error, /нужно «Команда = вариант, вариант»/);
  assert.match(parseAliases('Синнер', tennisView.settings.aliasWord).error, /нужно «Игрок = вариант, вариант»/);
});

test('переключатель вида спорта: вкладки по порядку с сервера, открытая отмечена; один вид — переключателя нет', () => {
  const list = [{ id: 'tennis', label: 'Теннис' }, { id: 'football', label: 'Футбол' }];
  const html = sportTabsHtml(list, 'football');
  assert.deepEqual([...html.matchAll(/data-sport="(\w+)" class="(\w*)" aria-selected="(\w+)" title="([^"]+)"/g)].map((x) => x.slice(1)),
    [['tennis', '', 'false', 'Теннис (1)'], ['football', 'on', 'true', 'Футбол (2)']]);
  assert.equal(sportTabsHtml([list[0]], 'tennis'), '');
  assert.equal(sportTabsHtml(undefined, 'tennis'), '');
  assert.doesNotMatch(sportTabsHtml([{ id: 'a"b', label: '<x>' }, list[0]], 'tennis'), /<x>|a"b/);
});

test('футбол: фильтры, поиск и избранное работают с командами', () => {
  const day = { leagues: [
    { ...lg, matches: [match({ id: 1 }), match({ id: 2, home: team(3, 'Арсенал'), away: team(4, 'Челси'), started: true, streams: [{ status: 'started' }] })] },
    { id: 48, name: 'Чемпионшип', country: 'Англия', matches: [match({ id: 3, home: team(5, 'Рексем'), away: team(6, 'Саутгемптон') })] },
  ] };
  const NO = { streams: false, live: false, favorites: false };
  const keys = (o) => sections({ day, isToday: true, filters: NO, q: '', ...o }).map((s) => `${s.key}=${s.rows.map((r) => r.m.id)}`);
  assert.deepEqual(keys(), ['live=2', 'lg:47=1,2', 'lg:48=3']);
  assert.deepEqual(keys({ q: 'челси' }), ['live=2', 'lg:47=2'], 'поиск по команде');
  assert.deepEqual(keys({ q: 'чемпионшип' }), ['lg:48=3'], 'поиск по турниру');
  markFavorites(day, { favorites: [{ id: 6 }], favoriteMatches: [{ id: 1 }] });
  assert.deepEqual(keys({ filters: { ...NO, favorites: true } }), ['lg:47=1', 'lg:48=3']);
});

test('страница импортирует только файлы, которые отдаёт сервер: модули видов спорта лежат в sports/', async () => {
  const web = new URL('../src/web/', import.meta.url);
  const names = (await readdir(new URL('sports/', web))).sort();
  assert.deepEqual(names, ['football.mjs', 'index.mjs', 'parts.mjs', 'tennis.mjs']);
  for (const name of names) {
    const text = await readFile(new URL(`sports/${name}`, web), 'utf8');
    for (const [, dep] of text.matchAll(/from '([^']+)'/g)) assert.match(dep, /^\.\.?\/[\w-]+\.mjs$/, `${name}: ${dep}`);
  }
});
