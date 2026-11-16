// Папки данных приложения — на латинице: %APPDATA%\MatchCenter, у запуска из исходников своя
// (см. main.cjs). Объединённое приложение наследует футбольный «Матч-центр», поэтому папка его.
// Раньше она называлась «Матч-центр»: при первом запуске прежняя папка переименовывается
// целиком, так что настройки и избранное сохраняются.
// У отдельного приложения «Матч-центр Теннис» папка была своя — TennisCenter: оттуда один раз
// забираются настройки тенниса (legacyTennisSettings), сама папка остаётся как есть.
const fs = require('node:fs');
const path = require('node:path');

const NAMES = {
  packaged: ['MatchCenter', 'Матч-центр'],
  dev: ['MatchCenter-dev', 'Матч-центр (разработка)'],
};
const TENNIS = { packaged: 'TennisCenter', dev: 'TennisCenter-dev' };

function dataDir(appData, packaged) {
  const [name, oldName] = packaged ? NAMES.packaged : NAMES.dev;
  const dir = path.join(appData, name);
  const old = path.join(appData, oldName);
  if (!fs.existsSync(dir) && fs.existsSync(old)) {
    try {
      fs.renameSync(old, dir);
    } catch {
      // прежняя папка занята — забираем хотя бы настройки
      fs.mkdirSync(dir, { recursive: true });
      try {
        fs.copyFileSync(path.join(old, 'settings.json'), path.join(dir, 'settings.json'));
      } catch {}
    }
  }
  return dir;
}

// файл настроек прежнего теннисного приложения
function legacyTennisSettings(appData, packaged) {
  return path.join(appData, packaged ? TENNIS.packaged : TENNIS.dev, 'settings.json');
}

module.exports = { dataDir, legacyTennisSettings };
