// Настройки версии 2: общие и по видам спорта; перенос файла версии 1.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { VERSION, migrate, openSettings } from '../src/core/settings.mjs';

const tmp = () => mkdtemp(path.join(os.tmpdir(), 'mc-settings-v2-'));
const soon = new Date(Date.now() + 3600e3).toISOString();
const onDisk = async (dir, name = 'settings.json') => JSON.parse(await readFile(path.join(dir, name), 'utf8'));

// Файл версии 1 — как у установленного теннисного приложения 1.0.9: всё в корне
const V1 = {
  ui: {
    window: { x: 10, y: 20, width: 1180, height: 800, maximized: false },
    theme: 'dark', filters: { streams: false, live: true, favorites: false },
    hideScores: true, trayHintShown: true, leaguesByTime: true,
  },
  notifications: false,
  tray: false,
  autostart: true,
  refreshSeconds: 120,
  channels: [{ screenName: 'my_channel', label: 'Мой канал' }, { screenName: 'bbtennis_live', disabled: true }],
  leagues: [2, 4],
  teamAliases: { 'Соболенко': ['Арина С.'] },
  favorites: [{ id: 9820, name: 'Mirra Andreeva' }, { id: 3623, name: 'Jannik Sinner' }],
  favoriteMatches: [{ id: 7, name: 'Mirra Andreeva — Diana Shnaider', utcTime: soon }],
};

test('файл версии 1 переносится в раздел своего вида спорта, ничего не теряя; прежний файл остаётся копией', async () => {
  const dir = await tmp();
  const text = `${JSON.stringify(V1, null, 2)}\n`;
  await writeFile(path.join(dir, 'settings.json'), text);

  const s = (await openSettings(dir)).get();
  assert.deepEqual(s.favorites, V1.favorites);
  assert.deepEqual(s.favoriteMatches, V1.favoriteMatches);
  assert.deepEqual(s.leagues, [2, 4]);
  assert.deepEqual(s.teamAliases['Соболенко'], ['Сабаленка', 'Арина С.']);
  assert.deepEqual(s.channels.filter((c) => !c.enabled).map((c) => c.screenName), ['bbtennis_live']);
  assert.deepEqual(s.channels.filter((c) => !c.builtIn), [{ screenName: 'my_channel', label: 'Мой канал', enabled: true, builtIn: false }]);
  assert.deepEqual([s.notifications, s.tray, s.autostart, s.refreshSeconds], [false, false, true, 120]);
  assert.deepEqual(s.ui, { ...V1.ui, sport: 'tennis' }, 'интерфейс — как был; открыт вид спорта по умолчанию');

  const saved = await onDisk(dir);
  assert.equal(saved.version, VERSION);
  assert.deepEqual(Object.keys(saved).sort(), ['autostart', 'notifications', 'refreshSeconds', 'sports', 'tray', 'ui', 'version']);
  assert.deepEqual(saved.sports, { tennis: { channels: V1.channels, leagues: V1.leagues, teamAliases: V1.teamAliases, favorites: V1.favorites, favoriteMatches: V1.favoriteMatches } });
  assert.equal(await readFile(path.join(dir, 'settings.v1.json'), 'utf8'), text, 'копия — байт в байт');
});

test('повторное открытие ничего не переносит и копию версии 1 не трогает', async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, 'settings.json'), JSON.stringify(V1));
  await openSettings(dir);
  const [file, backup] = [await readFile(path.join(dir, 'settings.json'), 'utf8'), await readFile(path.join(dir, 'settings.v1.json'), 'utf8')];
  const again = await openSettings(dir);
  assert.deepEqual(again.get().favorites, V1.favorites);
  assert.equal(await readFile(path.join(dir, 'settings.json'), 'utf8'), file);
  assert.equal(await readFile(path.join(dir, 'settings.v1.json'), 'utf8'), backup);

  // появился ещё один файл версии 1 (вернулись на старую версию и обратно) — первая копия остаётся
  await writeFile(path.join(dir, 'settings.json'), JSON.stringify({ favorites: [{ id: 1, name: 'другой' }] }));
  assert.deepEqual((await openSettings(dir)).get().favorites, [{ id: 1, name: 'другой' }]);
  assert.equal(await readFile(path.join(dir, 'settings.v1.json'), 'utf8'), backup);
});

test('новая установка и пустой файл версии 1: файл версии 2 без копии', async () => {
  const fresh = await tmp();
  await openSettings(fresh);
  assert.deepEqual(await onDisk(fresh), { version: VERSION, sports: {} });
  const empty = await tmp();
  await writeFile(path.join(empty, 'settings.json'), '{}');
  await openSettings(empty);
  assert.deepEqual(await onDisk(empty), { version: VERSION, sports: {} });
  assert.deepEqual((await readdir(empty)).sort(), ['settings.json']);
});

test('файл версии 1 другого вида спорта уходит в его раздел и не смешивается с теннисом', async () => {
  // так будет с настройками футбольного приложения: его номера турниров и команд теннису чужие
  const dir = await tmp();
  const football = { leagues: [47, 48], favorites: [{ id: 8456, name: 'Манчестер Сити' }], channels: [{ screenName: 'pl_forever', disabled: true }], tray: false };
  await writeFile(path.join(dir, 'settings.json'), JSON.stringify(football));
  const settings = await openSettings(dir, { v1Sport: 'football' });

  const s = settings.get('tennis');
  assert.deepEqual([s.favorites, s.leagues, s.tray], [[], [1, 2], false], 'теннис — по умолчанию, общие настройки перенесены');
  assert.ok(s.channels.every((c) => c.builtIn && c.enabled));

  await settings.update({ favorites: [{ id: 9820, name: 'Mirra Andreeva' }] });
  const saved = await onDisk(dir);
  const { tray, ...section } = football;
  assert.deepEqual(saved.sports, { football: section, tennis: { favorites: [{ id: 9820, name: 'Mirra Andreeva' }] } }, 'раздел неизвестного приложению вида сохраняется как есть');
  assert.equal(saved.tray, false);
});

test('migrate: файл версии 2 не меняется; файл без раздела sports получает пустой', () => {
  const v2 = { version: 2, tray: false, sports: { tennis: { leagues: [3] }, football: { leagues: [47] } } };
  assert.deepEqual(migrate(v2), v2);
  assert.deepEqual(migrate({ version: 2, sports: 'сломано' }).sports, {});
  assert.deepEqual(migrate({ tray: false, ui: { theme: 'dark' } }), { version: 2, tray: false, ui: { theme: 'dark' }, sports: {} });
});

test('правка вида спорта: общие поля — в корень файла, остальное — в раздел вида; неизвестный вид — ошибка 400', async () => {
  const dir = await tmp();
  const settings = await openSettings(dir);
  let changes = 0;
  settings.on('change', () => { changes++; });
  const after = await settings.update({ leagues: [3], tray: false, ui: { theme: 'dark' } }, 'tennis');
  assert.deepEqual([after.leagues, after.tray, after.ui.theme], [[3], false, 'dark']);
  assert.deepEqual(await onDisk(dir), { version: VERSION, tray: false, ui: { theme: 'dark' }, sports: { tennis: { leagues: [3] } } });

  // раздел, вернувшийся к встроенным значениям, из файла уходит
  await settings.update({ leagues: [1, 2] });
  assert.deepEqual((await onDisk(dir)).sports, {});

  await assert.rejects(settings.update({ tray: true }, 'curling'), { status: 400, message: /Неизвестный вид спорта: «curling»/ });
  assert.throws(() => settings.get('curling'), { status: 400 });
  await assert.rejects(settings.update({ ui: { sport: 'curling' } }), { status: 400 });
  assert.deepEqual([settings.get().tray, changes], [false, 2], 'отклонённые правки ничего не меняют');

  await settings.update({ ui: { sport: 'tennis' } });
  assert.equal(settings.get().ui.sport, 'tennis');
  assert.equal((await onDisk(dir)).ui.sport, 'tennis');
});

test('вид спорта, которого приложение не знает, в ui.sport заменяется видом по умолчанию', async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, 'settings.json'), JSON.stringify({ version: 2, ui: { sport: 'curling', theme: 'dark' }, sports: {} }));
  const s = (await openSettings(dir)).get();
  assert.deepEqual([s.ui.sport, s.ui.theme], ['tennis', 'dark']);
});
