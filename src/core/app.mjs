// Всё ядро вместе: настройки, опрос каналов, источник расписания вида спорта, сервер и уведомления.
import { coreDiagnostics } from './diagnostics.mjs';
import { createFeed } from './feed.mjs';
import { createHandler, startServer } from './server.mjs';
import { openSettings } from './settings.mjs';
import { createStreamPoller } from './streams.mjs';
import { createVkApi } from './vk-api.mjs';
import { watchFavorites } from './watch.mjs';
import { defaultSport } from '../sports/index.mjs';

// fetchImpl — сетевой стек приложения (в Electron — Chromium: системный прокси и сертификаты как
// в браузере), им читается VK; nodeFetch — встроенный fetch Node.js для источников, которые
// запросы Chromium отклоняют. Каким из них пользоваться, решает вид спорта (createSource).
export async function createMatchCenter({ dataDir, fetchImpl = fetch, nodeFetch = fetch, pageReader = null, version, sport = defaultSport }) {
  const settings = await openSettings(dataDir);
  const readers = [createVkApi(fetchImpl), pageReader].filter(Boolean);
  const poller = createStreamPoller({
    channels: () => settings.get().channels.filter((c) => c.enabled),
    intervalMs: () => settings.get().refreshSeconds * 1000,
    readers,
    parseTitle: sport.parseTitle,
  });
  const source = sport.createSource({ fetchImpl, nodeFetch });

  settings.on('change', () => poller.sync());

  const listeners = new Set();
  const watcher = watchFavorites({ poller, settings, sport, source, onEvent: (event) => listeners.forEach((fn) => fn(event)) });
  const feed = createFeed({ settings, poller, sport, source, version });

  const { server, url } = await startServer(createHandler({ settings, poller, source, feed, imageHosts: sport.imageHosts }));
  poller.refresh();

  return {
    settings,
    url,
    // уведомления о матчах избранных: { kind: 'kickoff', date, match } — только при фактическом начале
    onNotify: (fn) => listeners.add(fn),
    // состояние источников для диагностического отчёта (см. diagnostics.mjs)
    diagnostics: () => coreDiagnostics({ settings, poller, sport, source }),
    close() {
      poller.stop();
      watcher.stop();
      feed.close();
      server.close();
      server.closeAllConnections(); // открытые ленты страницы
    },
  };
}
