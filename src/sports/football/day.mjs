// Расписание дня: турниры из настроек в заданном порядке, русские названия, привязанные эфиры.
import { expect, isObject } from '../../core/shape.mjs';
import { createNamer, matchStreams } from './match.mjs';
import { stageLabel } from './stage.mjs';

const okTeam = (t) => isObject(t) && t.id != null && typeof t.name === 'string';
// проверяем только матчи выбранных турниров: остальные сотни матчей дня приложению не нужны
function checked(m) {
  expect(m?.id != null && okTeam(m.home) && okTeam(m.away) && typeof m.status?.utcTime === 'string',
    'FotMob', `у матча ${m?.id ?? '?'} нет команд или времени начала`);
  return m;
}

// fm — расписание дня (fotmob.day), ru — русские названия (fotmob.names)
export function buildDay({ fm, ru, settings, snapshot }) {
  const order = settings.leagues;
  const favorites = new Set(settings.favorites.map((f) => f.id));
  const favoriteMatches = new Set(settings.favoriteMatches.map((f) => f.id));
  const namesOf = createNamer(ru, settings.teamAliases);
  const leagueId = (lg) => lg.primaryId ?? lg.id;

  // У турнира с группами или этапами (ЧМ: «Grp. A», «Grp. B»…) FotMob отдаёт несколько записей
  // с одним основным номером — собираем их в один раздел: раздел на странице один на номер.
  const parts = new Map(order.map((id) => [id, []]));
  for (const lg of fm.leagues || []) parts.get(leagueId(lg))?.push(lg);

  const leagues = [...parts].filter(([, list]) => list.length).map(([id, list]) => {
    const [lg] = list; // у сезонных этапов lg.id свой (напр. 938218 у Чемпионшипа), логотип — под основным
    const matches = list.flatMap((part) => (part.matches || []).map(checked).map((m) => ({
      id: m.id,
      round: stageLabel(m.tournamentStage, part.name),
      utcTime: m.status.utcTime,
      timeKnown: true, // время начала у FotMob назначено всегда
      home: team(m.home, ru),
      away: team(m.away, ru),
      started: !!m.status.started,
      finished: !!m.status.finished,
      cancelled: !!m.status.cancelled,
      liveTime: m.status.liveTime?.short || null, // как отдаёт FotMob: «67’», «HT»
      reason: m.status.reason?.short || null, // «FT», «AET», «Pen»…
      // избранный: одна из команд в избранном или сам матч отмечен колокольчиком
      remind: favoriteMatches.has(m.id),
      favorite: favorites.has(m.home.id) || favorites.has(m.away.id) || favoriteMatches.has(m.id),
      streams: matchStreams(m, namesOf(m.home), namesOf(m.away), snapshot.streams),
    })));
    if (list.length > 1) matches.sort((a, b) => Date.parse(a.utcTime) - Date.parse(b.utcTime));
    return {
      id,
      name: ru.TournamentTemplates?.[id] || ru.TournamentTemplates?.[lg.id] || lg.name,
      country: ru.CountryCodes?.[lg.ccode] || lg.ccode || '',
      stages: [...new Set(matches.map((m) => m.round).filter(Boolean))],
      matches,
    };
  });

  return {
    leagues,
    // stale — { message, format }: показано полученное ранее; смена формата важнее сбоя сети
    stale: [fm.stale, ru.stale].find((s) => s?.format) || fm.stale || ru.stale || null,
    fetchedAt: fm.fetchedAt ?? null, // когда FotMob последний раз прислал расписание
  };
}

// ids — номера, по которым сторона попадает в избранное: у команды он один
const team = (t, ru) => ({ id: t.id, ids: [t.id], name: ru.Participants?.[t.id] || t.name, score: t.score ?? null });
