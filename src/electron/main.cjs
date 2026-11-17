// Главный процесс: поднимает ядро матч-центра, показывает окно, живёт в трее, уведомляет о матчах
// избранных игроков и команд, открывает плеер в отдельных окнах и обновляется из GitHub Releases.
const {
  app, BrowserWindow, Menu, Notification, Tray, clipboard, dialog, ipcMain, nativeImage, nativeTheme, net, screen, shell,
} = require('electron');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { keepContentRatio } = require('./aspect.cjs');
const { dataDir, legacyTennisSettings } = require('./data-dir.cjs');
const { configurePlayerAudio } = require('./player-audio.cjs');

// Объединённое приложение наследует футбольный «Матч-центр»: тот же идентификатор и та же папка
// данных — его установки обновляются на месте
const APP_ID = 'ru.sportcenter.matchcenter';
const NAME = 'Матч-центр';
const PRELOAD = path.join(__dirname, 'preload.cjs');
const PLAYER_PRELOAD = path.join(__dirname, 'preload-player.cjs');
// Пользовательское изображение: PNG для окон/трея, многоразмерный ICO — для exe/установщика.
const ICON = path.join(__dirname, '..', 'assets', 'icon.png');
const RELEASES = 'https://github.com/eonyushkin-commits/match-center/releases';
const load = (file) => import(pathToFileURL(path.join(__dirname, '..', file)).href);

// во внешний браузер отдаём только обычные веб-ссылки
function openExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

// Запросы к главному процессу принимаются только от главной страницы приложения
const fromMainPage = (event) => !!win && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame;

function fail(e) {
  dialog.showErrorBox(`${NAME} не запустился`, String(e?.stack || e));
  app.exit(1);
}

// окно открывается там, где его закрыли, если этот монитор всё ещё подключён
function restoreBounds(saved) {
  const def = { width: 1180, height: 900 };
  if (!saved?.width || !saved?.height) return def;
  const visible = screen.getAllDisplays().some(({ workArea: a }) =>
    saved.x < a.x + a.width - 100 && saved.x + saved.width > a.x + 100 && saved.y >= a.y - 10 && saved.y < a.y + a.height - 100);
  return visible ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : { width: saved.width, height: saved.height };
}

// папка данных — на латинице; запуск из исходников не должен делить профиль с установленным
// приложением (и мешать ему), у него своя папка. Заданный ключом --user-data-dir профиль
// не трогаем (так запускаются проверки npm run smoke)
const ownProfile = !app.commandLine.hasSwitch('user-data-dir');
if (ownProfile) app.setPath('userData', dataDir(app.getPath('appData'), app.isPackaged));

let win = null;
let mc = null;
let tray = null;
const playerWindows = new Set();
let quitting = false; // true — выходим по-настоящему, а не прячемся в трей
const startHidden = process.argv.includes('--hidden'); // автозапуск с Windows — сразу в трей
const notifications = new Set(); // держим ссылки, иначе на Windows клик по уведомлению теряется

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// Открыть матч из уведомления: показать окно и попросить страницу открыть вид спорта и раскрыть
// матч (с плеером, если идёт эфир)
function openMatch(sport, date, id) {
  showWindow();
  win?.webContents.send('open-match', { sport, date, id });
}

function notify({ title, body, onClick }) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON });
  notifications.add(n);
  n.on('close', () => notifications.delete(n));
  n.on('click', () => {
    notifications.delete(n);
    onClick?.();
  });
  n.show();
}

// ---------- окно ----------
async function start() {
  const [{ createMatchCenter }, { pageReader }] = await Promise.all([
    load('core/app.mjs'), load('electron/page-reader.mjs'),
  ]);
  mc = await createMatchCenter({
    dataDir: app.getPath('userData'),
    fetchImpl: net.fetch, // VK — сетевой стек Chromium: системный прокси и сертификаты как в браузере
    nodeFetch: (...args) => globalThis.fetch(...args), // встроенный fetch Node.js — для источников, которым он нужен (см. app.mjs)
    pageReader,
    version: app.getVersion(),
    // Прежние настройки: файл версии 1 в своей папке остался от футбольного «Матч-центра»,
    // настройки тенниса один раз забираются из папки отдельного теннисного приложения.
    // С заданным профилем (--user-data-dir, проверки) чужие папки не читаем.
    settingsFrom: {
      v1Sport: 'football',
      importFrom: ownProfile ? { tennis: legacyTennisSettings(app.getPath('appData'), app.isPackaged) } : {},
    },
  });

  const s = mc.settings.get();
  const toTray = startHidden && s.tray;
  win = new BrowserWindow({
    ...restoreBounds(s.ui.window),
    minWidth: 380,
    minHeight: 480,
    show: false,
    // запуск сразу в трей: без этого страница считает себя видимой и подписывается на ленту впустую
    paintWhenInitiallyHidden: !toTray,
    title: `${NAME} · v${app.getVersion()}`,
    icon: ICON,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e1116' : '#f3f5f8',
    autoHideMenuBar: true,
    // Сессия VK только в памяти: вход не сохраняется между запусками.
    // Тема, фильтры и избранное хранятся в настройках приложения, а не в браузере.
    webPreferences: { partition: 'matchcenter', spellcheck: false, preload: PRELOAD },
  });
  win.webContents.session.setSpellCheckerEnabled(false);
  if (s.ui.window?.maximized) win.maximize();
  // заголовок окна — название страницы («Матч-центр | Футбол») с версией
  win.on('page-title-updated', (e, title) => {
    e.preventDefault();
    win.setTitle(`${title || NAME} · v${app.getVersion()}`);
  });
  if (!toTray) win.once('ready-to-show', () => win.show());

  // Открытие официального плеера разрешено только главной странице приложения.
  ipcMain.handle('player:open', (event, { src, title } = {}) => {
    if (!fromMainPage(event)) return;
    let source;
    try { source = new URL(src); } catch { return; }
    if (source.protocol !== 'https:' || !/^(vkvideo\.ru|vk\.com|vk\.ru)$/.test(source.hostname) || source.pathname !== '/video_ext.php') return;
    const muted = playerWindows.size > 0;
    source.searchParams.set('js_api', '1');
    source.searchParams.set('mute', muted ? '1' : '0');
    // VK отказывает iframe на локальной странице. Официальный плеер как
    // самостоятельная страница воспроизводит тот же эфир без подмены запросов.
    const player = new BrowserWindow({
      width: 800, height: 450, minWidth: 320, minHeight: 180, useContentSize: true,
      alwaysOnTop: true, backgroundColor: '#000', autoHideMenuBar: true,
      title: typeof title === 'string' ? title : 'Трансляция',
      icon: ICON,
      // preload лишь задаёт высокое качество по умолчанию и ничего не открывает странице VK
      webPreferences: { partition: 'matchcenter', spellcheck: false, nodeIntegration: false, contextIsolation: true, sandbox: true, preload: PLAYER_PRELOAD },
    });
    playerWindows.add(player);
    player.once('closed', () => playerWindows.delete(player));
    configurePlayerAudio(player.webContents, { muted, url: source.href });
    keepContentRatio(player, 16 / 9);
    player.webContents.setWindowOpenHandler(({ url: target }) => { openExternal(target); return { action: 'deny' }; });
    player.webContents.on('will-navigate', (e, target) => {
      if (target !== source.href) { e.preventDefault(); openExternal(target); }
    });
    player.loadURL(source.href).catch((e) => console.error('VK player:', e.message));
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  // Окно приложения не уходит на чужую страницу (например, если плеер VK попробует открыть свой
  // сайт на месте окна) — такая ссылка открывается в браузере
  const keepLocal = (contents) => contents.on('will-navigate', (e, url) => {
    if (!url.startsWith(mc.url)) {
      e.preventDefault();
      openExternal(url);
    }
  });
  keepLocal(win.webContents);

  // размер и положение сохраняем по ходу дела — закрытию окна ничего ждать не нужно
  let boundsTimer = null;
  const saveBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      mc.settings.update({ ui: { window: { ...win.getNormalBounds(), maximized: win.isMaximized() } } }).catch(() => {});
    }, 800);
  };
  for (const event of ['resize', 'move', 'maximize', 'unmaximize']) win.on(event, saveBounds);

  // Закрытие окна при включённом трее прячет его: так продолжают приходить уведомления
  win.on('close', (e) => {
    if (quitting || !mc.settings.get().tray) return;
    e.preventDefault();
    win.hide();
    if (!mc.settings.get().ui.trayHintShown) {
      notify({ title: `${NAME} работает в трее`, body: 'Уведомления о матчах избранных продолжат приходить. Выйти — правой кнопкой по значку в трее.', onClick: showWindow });
      mc.settings.update({ ui: { trayHintShown: true } }).catch(() => {});
    }
  });
  win.on('closed', () => {
    win = null;
    app.quit();
  });

  mc.onNotify(({ sport, date, match }) => {
    const title = `${match.home.name} — ${match.away.name}`;
    const label = mc.sports.find((x) => x.id === sport)?.label;
    // эфиры известны только у вида спорта, открытого в окне: у остальных каналы не опрашиваются
    const live = mc.settings.get().ui.sport === sport && match.streams.find((x) => x.status === 'started');
    const body = `${label ? `${label} · м` : 'М'}атч начался${live ? ` · смотреть: ${live.channel}` : ''}`;
    notify({ title, body, onClick: () => openMatch(sport, date, match.id) });
  });

  trayImage = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16, quality: 'best' });
  mc.settings.on('change', applyAppSettings);
  applyAppSettings(mc.settings.get());

  await win.loadURL(mc.url);
  setupUpdates();
}

// ---------- трей и автозапуск ----------
let trayImage = null;
function applyAppSettings(s) {
  if (s.tray && !tray && trayImage) {
    tray = new Tray(trayImage);
    tray.setToolTip(NAME);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: `Открыть ${NAME}`, click: showWindow },
      { type: 'separator' },
      { label: 'Выход', click: () => app.quit() },
    ]));
    tray.on('click', showWindow);
  } else if (!s.tray && tray) {
    tray.destroy();
    tray = null;
  }
  // автозапуск прописывается только у установленного приложения; скрыто — если есть трей, где жить
  const login = JSON.stringify([s.autostart, s.tray]);
  if (app.isPackaged && login !== appliedLogin) {
    appliedLogin = login;
    app.setLoginItemSettings({ openAtLogin: s.autostart, args: s.tray ? ['--hidden'] : [] });
  }
}
let appliedLogin = null;

// ---------- обновление в два шага: «Скачать» → «Установить» ----------
let updater = null;
let update = { state: 'none' }; // none | available | downloading | ready | error

function setUpdate(next) {
  update = next;
  win?.webContents.send('update', update);
}

function setupUpdates() {
  if (!app.isPackaged) return; // в разработке обновляться не из чего
  ({ autoUpdater: updater } = require('electron-updater'));
  updater.logger = null;
  updater.autoDownload = false; // качаем только по кнопке
  updater.autoInstallOnAppQuit = true; // скачали, но не нажали «Установить» — поставится при выходе
  updater.on('update-available', (info) => {
    if (update.state !== 'downloading' && update.state !== 'ready') setUpdate({ state: 'available', version: info.version, notes: `${RELEASES}/tag/v${info.version}` });
  });
  updater.on('download-progress', (p) => setUpdate({ ...update, state: 'downloading', percent: Math.floor(p.percent) }));
  updater.on('update-downloaded', (info) => setUpdate({ state: 'ready', version: info.version, notes: `${RELEASES}/tag/v${info.version}` }));
  updater.on('error', (e) => {
    if (update.state === 'downloading') setUpdate({ ...update, state: 'error', error: e.message });
  });
  const check = () => updater.checkForUpdates().catch(() => {}); // нет сети — проверим в следующий раз
  check();
  setInterval(check, 6 * 3600e3);
}

ipcMain.handle('update:get', () => update);
ipcMain.handle('update:download', () => {
  if (!updater || !['available', 'error'].includes(update.state)) return;
  setUpdate({ ...update, state: 'downloading', percent: 0 });
  updater.downloadUpdate().catch(() => {}); // ошибку сообщит событие 'error'
});
ipcMain.handle('update:install', () => {
  if (update.state !== 'ready') return;
  quitting = true;
  updater.quitAndInstall(true, true); // тихо поставить и сразу открыть новую версию
});

async function checkUpdatesNow() {
  if (!updater) {
    dialog.showMessageBox(win, { message: 'Обновления проверяются только в установленном приложении.' });
    return;
  }
  try {
    const r = await updater.checkForUpdates();
    const latest = r?.updateInfo?.version;
    if (!latest || latest === app.getVersion()) dialog.showMessageBox(win, { message: `У вас последняя версия (${app.getVersion()}).` });
    else {
      showWindow(); // о новой версии скажет полоса в окне — даже если её скрыли крестиком
      win?.webContents.send('update', { ...update, manual: true });
    }
  } catch (e) {
    dialog.showMessageBox(win, { type: 'warning', message: 'Не удалось проверить обновления', detail: e.message });
  }
}

// ---------- диагностика ----------
// Отчёт для отправки другим: версия, ОС, состояние источников. Пути с именем пользователя
// заменяются подписями, остальное очищает core/diagnostics.mjs
async function copyDiagnostics() {
  if (!mc) return false;
  const { buildReport } = await load('core/diagnostics.mjs');
  const paths = [['<userData>', 'userData'], ['<appData>', 'appData'], ['<temp>', 'temp'], ['~', 'home']]
    .map(([label, name]) => [label, app.getPath(name)]);
  const text = buildReport({
    app: {
      name: NAME, version: app.getVersion(), packaged: app.isPackaged,
      electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
      os: `${os.type()} ${os.release()} ${os.arch()}`,
    },
    core: mc.diagnostics(),
  }, { paths });
  await clipboard.writeText(text); // в Electron 44 буфер обмена асинхронный
  return true;
}

// кнопка «Скопировать отчёт» в панели каналов
ipcMain.handle('diagnostics:copy', (event) => fromMainPage(event) && copyDiagnostics());

async function copyDiagnosticsFromMenu() {
  try {
    if (await copyDiagnostics()) {
      dialog.showMessageBox(win, {
        message: 'Отчёт скопирован в буфер обмена',
        detail: 'В нём нет путей с именем пользователя, токенов и содержимого настроек. Вставьте его в сообщение о проблеме.',
      });
    }
  } catch (e) {
    dialog.showMessageBox(win, { type: 'warning', message: 'Не удалось собрать отчёт', detail: e.message });
  }
}

// ---------- меню ----------
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{
    label: NAME,
    submenu: [
      { role: 'reload', label: 'Обновить страницу' },
      { label: 'Папка с настройками', click: () => shell.openPath(app.getPath('userData')) },
      { label: 'Проверить обновления', click: checkUpdatesNow },
      { label: 'Скопировать отчёт для диагностики', click: copyDiagnosticsFromMenu },
      { type: 'separator' },
      { role: 'resetZoom', label: 'Обычный масштаб' },
      { role: 'zoomIn', label: 'Крупнее' },
      { role: 'zoomOut', label: 'Мельче' },
      { type: 'separator' },
      { role: 'toggleDevTools', label: 'Инструменты разработчика' },
      { label: 'Выход', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
    ],
  }]));
}

// ---------- запуск ----------
if (!app.requestSingleInstanceLock()) {
  app.quit(); // приложение уже открыто — второе окно не нужно, первое покажется само
} else {
  // Без этого Windows не показывает уведомления с названием приложения. У запуска из исходников —
  // свой идентификатор: иначе Windows связывает кнопку установленного приложения на панели задач
  // с ярлыком «Electron», который создаётся для уведомлений, и показывает значок Electron.
  app.setAppUserModelId(app.isPackaged ? APP_ID : `${APP_ID}.dev`);
  app.on('second-instance', showWindow);
  app.on('window-all-closed', () => {}); // выходим только по «Выход»: главное окно прячется в трей
  app.on('before-quit', () => {
    quitting = true;
    mc?.close();
  });
  buildMenu();
  app.whenReady().then(start).catch(fail);
}
