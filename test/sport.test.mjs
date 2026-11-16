// Граница «вид спорта»: что ядро получает от описания вида и что передаёт дальше.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createCache } from '../src/core/cache.mjs';
import { FormatError } from '../src/core/shape.mjs';
import { createStreamPoller } from '../src/core/streams.mjs';
import { defaultSport, sports } from '../src/sports/index.mjs';
import tennis from '../src/sports/tennis/index.mjs';

test('описание вида спорта: у каждого вида есть всё, чем пользуется ядро', () => {
  assert.equal(defaultSport, sports[0]);
  for (const sport of sports) {
    for (const key of ['id', 'label', 'sourceName']) assert.equal(typeof sport[key], 'string', `${sport.id}: ${key}`);
    for (const key of ['createSource', 'dayQuery', 'buildDay', 'health', 'parseTitle']) assert.equal(typeof sport[key], 'function', `${sport.id}: ${key}`);
    for (const key of ['channels', 'leagues', 'knownLeagues']) assert.ok(Array.isArray(sport.defaults[key]), `${sport.id}: defaults.${key}`);
    assert.equal(typeof sport.defaults.teamAliases, 'object');
    assert.ok(sport.imageHosts.every((h) => /^https:\/\/[\w.-]+$/.test(h)), `${sport.id}: imageHosts — только https-адреса без пути`);
    assert.deepEqual(Object.keys(sport.texts).sort(), ['favorites', 'leagues']);
  }
});

test('теннис: запрос дня — туры выбранных разрядов; источник ходит в сеть через nodeFetch', async () => {
  assert.deepEqual(tennis.dayQuery({ leagues: [1, 3] }), ['atp']);
  assert.deepEqual(tennis.dayQuery({ leagues: [1, 2] }), ['atp', 'wta']);
  const urls = [];
  const source = tennis.createSource({
    fetchImpl: async () => { throw new Error('сетевой стек приложения теннису не нужен'); },
    nodeFetch: async (url) => { urls.push(url); return new Response(JSON.stringify({ events: [] })); },
  });
  await source.day('20261113', tennis.dayQuery({ leagues: [2] }));
  assert.ok(urls.length && urls.every((u) => u.includes('/tennis/wta/scoreboard')));
  // состояние источника для отчёта — с общим полем name
  assert.deepEqual(tennis.health(source).map((h) => [h.name, typeof h.okAt, h.error]), [['wta', 'number', null]]);
});

test('опрос каналов: способ чтения получает разбор заголовка своего вида спорта', async () => {
  const got = [];
  const p = createStreamPoller({
    channels: () => [{ screenName: 'a' }], intervalMs: () => 1e9, log: {},
    parseTitle: tennis.parseTitle,
    readers: [{ name: 'api', read: async (ch, parseTitle) => { got.push(parseTitle('Андреева — Шнайдер')?.teams); return []; } }],
  });
  await p.refresh();
  p.stop();
  assert.deepEqual(got, [['андреева', 'шнайдер']]);
});

test('кэш: одновременные запросы объединяются; при сбое — прежнее значение с пометкой; expire заставляет спросить заново', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const cache = createCache({ maxEntries: 2 });
  let calls = 0;
  let fail = null;
  const load = async () => { calls++; if (fail) throw fail; return { n: calls }; };

  const [a, b] = await Promise.all([cache.get('k', 60e3, load), cache.get('k', 60e3, load)]);
  assert.equal(calls, 1);
  assert.deepEqual([a, b], [{ n: 1, fetchedAt: 1000 }, { n: 1, fetchedAt: 1000 }]);
  assert.equal((await cache.get('k', 60e3, load)).n, 1, 'до срока — из кэша');

  cache.expire();
  fail = new FormatError('формат');
  t.mock.timers.tick(5000);
  assert.deepEqual(await cache.get('k', 60e3, load), { n: 1, fetchedAt: 1000, stale: { message: 'формат', format: true } });
  fail = new Error('нет сети');
  cache.expire((key) => key === 'k');
  assert.deepEqual((await cache.get('k', 60e3, load)).stale, { message: 'нет сети', format: false });
  await assert.rejects(cache.get('new', 60e3, load), /нет сети/, 'прежнего значения нет — ошибка');

  // источник снова отвечает: после сбоя следующий запрос идёт в сеть, пометка пропадает
  fail = null;
  const fresh = await cache.get('k', 60e3, load);
  assert.deepEqual([fresh.stale, fresh.fetchedAt], [undefined, 6000]);
  const before = calls;
  cache.expire((key) => key === 'other');
  await cache.get('k', 60e3, load);
  assert.equal(calls, before, 'сброс чужого ключа этот не трогает');
});

test('в общем ядре нет слов конкретного вида спорта и его источника', () => {
  const dir = new URL('../src/core/', import.meta.url);
  for (const name of readdirSync(dir)) {
    const text = readFileSync(new URL(name, dir), 'utf8');
    assert.doesNotMatch(text, /espn|tennis|fotmob|football|players\.json|tournaments\.json/i, name);
  }
});
