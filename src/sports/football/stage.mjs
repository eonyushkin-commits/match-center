// FotMob tournamentStage: число у тура/раунда или название стадии плей-офф.
const STAGES = {
  final: 'Финал',
  semifinal: 'Полуфинал',
  semifinals: 'Полуфинал',
  quarterfinal: 'Четвертьфинал',
  quarterfinals: 'Четвертьфинал',
  'round of 16': '1/8 финала',
  'round of 32': '1/16 финала',
  'round of 64': '1/32 финала',
  'round of 128': '1/64 финала',
  'group stage': 'Групповой этап',
  'league stage': 'Этап лиги',
};

export function stageLabel(value, leagueName = '') {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const text = String(value).trim();
  if (!text) return '';
  if (/^\d+$/.test(text)) {
    // В расписании нет отдельного признака кубка: используем название турнира.
    const cup = /кубок|\bcup\b|\bcopa\b|\bcoppa\b|\bcoupe\b|pokal/i.test(leagueName);
    return `${Number(text)}-й ${cup ? 'раунд' : 'тур'}`;
  }
  const key = text.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ');
  return STAGES[key] || STAGES[key.replace(/ /g, '')] || text;
}
