// Общее для сопоставления эфиров VK с матчами: нечёткое сравнение написаний и порядок эфиров
// у матча. Сами правила — как искать участников в заголовке и когда считать их совпавшими —
// у каждого вида спорта свои (src/sports/<вид>/match.mjs) и сюда намеренно не вынесены.

function bigrams(s) {
  const out = new Set();
  const t = s.replace(/ /g, '');
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

// Нечёткое сравнение (опечатки, «Миллуол»/«Миллуолл», «Дабровски»/«Дабровский»).
// Ниже 0.72 считаем разными: иначе «Манчестер Сити» ≈ «Манчестер Юнайтед».
export function dice(a, b) {
  const A = bigrams(a), B = bigrams(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const d = (2 * inter) / (A.size + B.size || 1);
  return d >= 0.72 ? d : 0;
}

const RANK = { started: 0, upcoming: 1, finished: 2, failed: 3 };
// Внутри статуса: записи — по дате создания видео, идущие и запланированные — по времени начала
// (не по зрителям: иначе кнопки меняются местами при каждом обновлении)
function withinStatus(x, y) {
  if (x.status === 'finished') return (x.created ?? x.time ?? 0) - (y.created ?? y.time ?? 0);
  return (x.time ?? 0) - (y.time ?? 0);
}

// Порядок эфиров матча: идущие (всегда впереди), затем запланированные, затем записи
export const streamOrder = (x, y) => RANK[x.status] - RANK[y.status] || withinStatus(x, y);
