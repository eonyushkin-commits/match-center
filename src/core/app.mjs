// Всё ядро вместе: настройки, сервер и — на каждый вид спорта — источник расписания, опрос
// каналов VK, лента для страницы и уведомления.
import { coreDiagnostics } from './diagnostics.mjs';
import { createFeed } from './feed.mjs';
import { createHandler, startServer } from './server.mjs';
import { openSettings } from './settings.mjs';
import { createStreamPoller } from './streams.mjs';
import { createVkApi } from './vk-api.mjs';
import { watchFavorites } from './watch.mjs';
import { sports as allSports } from '../sports/index.mjs';

// fetchImpl — сетевой стек приложения (в Electron — Chromium: системный прокси и сертификаты как
// в браузере), им читается VK; nodeFetch — встроенный fetch Node.js для источников, которые
// запросы Chromium отклоняют. Каким из них пользоваться, решает вид спорта (createSource).
export async function createMatchCenter({ dataDir, fetchImpl = fetch, nodeFetch = fetch, pageReader = null, version, sports = allSports }) {
  const settings = await openSettings(dataDir);
  // способы чтения каналов — общие для всех видов спорта: один токен VK, одно скрытое окно
  const readers = [createVkApi(fetchImpl), pageReader].filter(Boolean);
  const listeners = new Set();

  const units = sports.map((sport) => {
    const poller = createStreamPoller({
      channels: () => settings.get(sport.id).channels.filter((c) => c.enabled),
      intervalMs: () => settings.get(sport.id).refreshSeconds * 1000,
      readers,
      parseTitle: sport.parseTitle,
    });
    poller.stop(); // запустится, когда вид спорта откроют в окне
    const source = sport.createSource({ fetchImpl, nodeFetch });
    const watcher = watchFavorites({
      poller, settings, sport, source,
      onEvent: (event) => listeners.forEach((fn) => fn({ ...event, sport: sport.id })),
    });
    const feed = createFeed({ settings, poller, sport, source, version });
    return { sport, source, poller, watcher, feed };
  });

  // Каналы VK опрашиваются только у вида спорта, открытого в окне (ui.sport): у остальных
  // опрос стоит, пока на них не переключатся. Уведомления о матчах избранных работают у всех
  // видов — им нужно только расписание; у неоткрытого вида в них нет сведений об эфирах.
  function activate() {
    const open = settings.get().ui.sport;
    for (const { sport, poller } of units) {
      if (sport.id !== open) poller.stop();
      else if (poller.running()) poller.sync(); // поменялись каналы или частота — перечитываем сразу
      else poller.start();
    }
  }
  settings.on('change', activate);

  const { server, url } = await startServer(createHandler({ settings, units }));
  activate();

  return {
    settings,
    url,
    // уведомления о матчах избранных: { kind: 'kickoff', sport, date, match } — только при фактическом начале
    onNotify: (fn) => listeners.add(fn),
    // состояние источников для диагностического отчёта (см. diagnostics.mjs)
    diagnostics: () => coreDiagnostics({ settings, units }),
    close() {
      for (const { poller, watcher, feed } of units) {
        poller.stop();
        watcher.stop();
        feed.close();
      }
      server.close();
      server.closeAllConnections(); // открытые ленты страницы
    },
  };
}
