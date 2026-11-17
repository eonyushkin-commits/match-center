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
  // у кого было футбольное приложение, тому первым открывается футбол — с его настройками
  const f = settings.get();
  assert.deepEqual([f.ui.sport, f.leagues, f.favorites, f.channels.find((c) => c.screenName === 'pl_forever').enabled], ['football', [47, 48], football.favorites, false]);

  await settings.update({ favorites: [{ id: 9820, name: 'Mirra Andreeva' }] }, 'tennis');
  const saved = await onDisk(dir);
  const { tray, ...section } = football;
  assert.deepEqual(saved.sports, { football: section, tennis: { favorites: [{ id: 9820, name: 'Mirra Andreeva' }] } });
  assert.deepEqual([saved.tray, saved.ui], [false, { sport: 'football' }]);
});

test('раздел вида спорта, которого приложение не знает, сохраняется в файле как есть', async () => {
  const dir = await tmp();
  const curling = { leagues: [7], favorites: [{ id: 1, name: 'x' }] };
  await writeFile(path.join(dir, 'settings.json'), JSON.stringify({ ...curling, tray: false }));
  const settings = await openSettings(dir, { v1Sport: 'curling' });
  assert.equal(settings.get().ui.sport, 'tennis', 'неизвестный вид первым не открывается');
  await settings.update({ leagues: [3] });
  assert.deepEqual((await onDisk(dir)).sports, { curling, tennis: { leagues: [3] } });
});

// ---------- настройки из прежнего отдельного приложения ----------

const TENNIS_V1 = { favorites: [{ id: 9820, name: 'Mirra Andreeva' }], leagues: [2, 4], tray: false, ui: { theme: 'dark', window: { x: 1, y: 2, width: 900, height: 700, maximized: false } } };
async function legacy(body) {
  const file = path.join(await tmp(), 'settings.json');
  await writeFile(file, typeof body === 'string' ? body : JSON.stringify(body));
  return file;
}

test('перенос из прежнего приложения: у футбольной установки появляется раздел тенниса, общие настройки остаются свои', async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, 'settings.json'), JSON.stringify({ leagues: [47], favorites: [{ id: 8456, name: 'Манчестер Сити' }], ui: { theme: 'light' } }));
  const importFrom = { tennis: await legacy(TENNIS_V1) };
  const settings = await openSettings(dir, { v1Sport: 'football', importFrom });

  const t = settings.get('tennis');
  assert.deepEqual([t.favorites, t.leagues], [TENNIS_V1.favorites, [2, 4]]);
  assert.deepEqual([t.tray, t.ui.theme, t.ui.window, t.ui.sport], [true, 'light', null, 'football'], 'трей, тема и окно — как были в футбольном приложении');
  assert.deepEqual(settings.get('football').favorites, [{ id: 8456, name: 'Манчестер Сити' }]);
  const saved = await onDisk(dir);
  assert.deepEqual(saved.imported, ['tennis']);
  assert.deepEqual(JSON.parse(await readFile(importFrom.tennis, 'utf8')), TENNIS_V1, 'файл прежнего приложения не тронут');

  // забирается один раз: удалённое избранное не возвращается; отметка переживает правки
  await settings.update({ favorites: [] }, 'tennis');
  const again = await openSettings(dir, { v1Sport: 'football', importFrom });
  assert.deepEqual(again.get('tennis').favorites, []);
  assert.deepEqual((await onDisk(dir)).imported, ['tennis']);
});

test('перенос из прежнего приложения: своего файла не было — берутся и общие настройки, открывается перенесённый вид', async () => {
  const dir = await tmp();
  const settings = await openSettings(dir, { v1Sport: 'football', importFrom: { tennis: await legacy(TENNIS_V1) } });
  const s = settings.get();
  assert.deepEqual([s.ui.sport, s.tray, s.ui.theme, s.ui.window?.width, s.favorites], ['tennis', false, 'dark', 900, TENNIS_V1.favorites]);
  assert.deepEqual((await readdir(dir)).sort(), ['settings.json'], 'копия версии 1 не нужна: переносили не свой файл');
});

test('перенос из прежнего приложения: файл уже версии 2 — берётся раздел вида; заполненный раздел не заменяется', async () => {
  const v2 = { version: 2, tray: false, sports: { tennis: { leagues: [3] }, football: { leagues: [99] } } };
  const a = await tmp();
  const fromV2 = await openSettings(a, { importFrom: { tennis: await legacy(v2) } });
  assert.deepEqual([fromV2.get('tennis').leagues, fromV2.get('football').leagues], [[3], [47, 48, 132, 133, 247, 338]], 'чужой раздел из того файла не берём');

  const b = await tmp();
  await writeFile(path.join(b, 'settings.json'), JSON.stringify({ version: 2, sports: { tennis: { leagues: [4] } } }));
  const kept = await openSettings(b, { importFrom: { tennis: await legacy(TENNIS_V1) } });
  assert.deepEqual([kept.get('tennis').leagues, kept.get('tennis').favorites], [[4], []]);
  assert.deepEqual((await onDisk(b)).imported, ['tennis'], 'но попытка запомнена — второй раз не переносим');
});

test('перенос из прежнего приложения: файла нет или он повреждён — запуск как обычно, без отметки', async () => {
  for (const source of [path.join(await tmp(), 'нет', 'settings.json'), await legacy('{ "leagues": [2, }'), await legacy('[1, 2]')]) {
    const dir = await tmp();
    const settings = await openSettings(dir, { importFrom: { tennis: source } });
    assert.deepEqual([settings.get().leagues, settings.warnings], [[1, 2], []]);
    assert.deepEqual(await onDisk(dir), { version: VERSION, sports: {} });
  }
});

test('migrate: файл версии 2 не меняется; файл без раздела sports получает пустой', () => {
  const v2 = { version: 2, tray: false, sports: { tennis: { leagues: [3] }, football: { leagues: [47] } } };
  assert.deepEqual(migrate(v2), v2);
  assert.deepEqual(migrate({ version: 2, sports: 'сломано' }).sports, {});
  assert.deepEqual(migrate({ tray: false, ui: { theme: 'dark' } }), { version: 2, tray: false, ui: { theme: 'dark', sport: 'tennis' }, sports: {} });
  assert.deepEqual(migrate({ leagues: [47] }, 'football'), { version: 2, ui: { sport: 'football' }, sports: { football: { leagues: [47] } } }, 'первым откроется вид прежнего приложения');
  assert.deepEqual(migrate({ ui: { sport: 'tennis' }, leagues: [47] }, 'football').ui, { sport: 'tennis' }, 'уже выбранный вид не меняется');
  assert.deepEqual(migrate({}, 'football'), { version: 2, sports: {} });
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
