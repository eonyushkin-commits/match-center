// Разметка: данные → HTML-строка. Без DOM и без общего состояния — всё нужное приходит аргументами.
// Каркас общий; строку участника, шапку турнира и тексты даёт вид спорта (sports/<вид>.mjs).
import { STATUS, audience, esc, hhmm, isLive, stamp } from './format.mjs';

// Шапка раздела: «Сейчас в эфире» или турнир — как его показывает вид спорта
export function sectionHeadHtml(s, sport) {
  return s.live
    ? `Сейчас в эфире<span class="count">${s.rows.length}</span>`
    : `${sport.leagueHeadHtml(s.lg)}<span class="count">${s.rows.length}</span>`;
}

// у канала бывает несколько эфиров на матч (перезапуск) — нумеруем: «Sportcast», «Sportcast 2»
function streamLabels(streams) {
  const seen = {};
  return streams.map((s) => ((seen[s.channel] = (seen[s.channel] || 0) + 1) > 1 ? `${s.channel} ${seen[s.channel]}` : s.channel));
}

// Строка матча. view: { sport — вид спорта страницы, favIds — Set участников в избранном,
// hidden(m) — прятать ли счёт }.
export function rowHtml({ key, m, lg, showLeague }, view) {
  const { sport } = view;
  const live = isLive(m);
  const when = esc(sport.whenText(m, live, hhmm(m.utcTime)));
  const hidden = view.hidden(m);
  const mask = `<button type="button" class="score masked" data-reveal="${m.id}" title="Показать счёт">?</button>`;
  const team = (t, other) => sport.teamHtml(t, other, m, {
    fav: t.id != null && view.favIds.has(t.id), hidden, showScore: m.started || m.finished, mask,
  });

  const labels = streamLabels(m.streams);
  let chips = m.streams.map((s, i) => {
    const aud = audience(s);
    return `<a class="stream ${s.status}"
      href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(aud ? `${s.title}\n${aud.title}` : s.title)}" data-play>
      <span class="tag">${STATUS[s.status] || ''}</span>${esc(labels[i])}${aud ? `<span class="aud">${esc(aud.text)}</span>` : ''}</a>`;
  }).join('');
  if (!chips && !m.finished && !m.cancelled) {
    const q = encodeURIComponent(`${m.home.name} ${m.away.name}`);
    chips = `<a class="stream find" href="https://vkvideo.ru/search?q=${q}" target="_blank" rel="noopener">Искать в VK</a>`;
  }
  const bell = !m.started && !m.cancelled && m.timeKnown
    ? `<button type="button" class="bell${m.remind ? ' on' : ''}" data-remind aria-pressed="${!!m.remind}"
        title="${m.remind ? 'Не напоминать' : 'Уведомить о начале матча'}">🔔</button>` : '';
  const meta = sport.metaOf(m).map(esc).join(' · ');
  // турнир, а под ним раунд и корт — отдельными строками над участниками: справа от счёта они
  // сдвигали бы счёт у каждого матча по-своему
  return `${showLeague ? `<div class="lg-tag">${esc(sport.leagueTag(lg))}</div>` : ''}${meta ? `<div class="lg-tag meta">${meta}</div>` : ''}<div class="when${live ? ' live' : ''}">${when}${bell}</div>
    <div class="teams">${team(m.home, m.away)}${team(m.away, m.home)}</div>
    <div class="side"></div>
    ${chips ? `<div class="streams">${chips}</div>` : ''}`;
}

export function emptyHtml(filtered, sport) {
  if (filtered) return '<b>Нет матчей по выбранным фильтрам</b><button type="button" class="btn" data-action="reset-filters">Сбросить фильтры</button>';
  return `<b>В этот день матчей нет</b>${esc(sport.emptyHint)}`;
}

// ---------- обновление приложения: «Скачать» → «Установить» ----------
// Крестик прячет полосу до следующего шага (загрузилось, ошибка) или до перезапуска приложения
export const updateKey = (u) => `${u.version}:${u.state}`;
const HIDE = {
  available: 'Скрыть — напомню при следующем запуске',
  downloading: 'Скрыть — загрузка продолжится',
  ready: 'Скрыть — обновление установится при выходе из приложения',
  error: 'Скрыть',
};

export function updateHtml(u) {
  if (!HIDE[u.state]) return null;
  const v = esc(u.version);
  const notes = u.notes ? ` <a href="${esc(u.notes)}" target="_blank" rel="noopener">Что нового ↗</a>` : '';
  const hide = `<button type="button" class="icon-btn" data-action="update-dismiss" aria-label="Скрыть" title="${HIDE[u.state]}">✕</button>`;
  if (u.state === 'available') return `<span><b>Доступна версия ${v}.</b>${notes}</span>
    <span class="actions"><button type="button" class="btn primary" data-action="update-download">Скачать</button>${hide}</span>`;
  if (u.state === 'downloading') return `<span><b>Загружается версия ${v}…</b> ${u.percent || 0}%</span><progress max="100" value="${u.percent || 0}"></progress>
    <span class="actions">${hide}</span>`;
  if (u.state === 'ready') return `<span><b>Версия ${v} загружена.</b> Приложение перезапустится — открытая трансляция прервётся.${notes}</span>
    <span class="actions"><button type="button" class="btn primary" data-action="update-install">Установить</button>${hide}</span>`;
  return `<span><b>Не удалось загрузить обновление:</b> ${esc(u.error)}</span>
    <span class="actions"><button type="button" class="btn" data-action="update-download">Повторить</button>${hide}</span>`;
}

// Полосы над списком: обновление, ошибки, недоступные источники → [[класс, html], …].
// sourceName — как называется источник расписания открытого вида спорта
export function notices({ error, day, status, saveError, update: u, updateDismissed, sourceName = 'Источник расписания' }, now = Date.now()) {
  const out = [];
  // когда источник ответил последний раз: «от 14:58», без времени — «полученное ранее»
  const since = day?.fetchedAt ? ` от ${stamp(day.fetchedAt, now)}` : ', полученное ранее';
  if (error && day) out.push(['bad', `<b>Не удалось обновить расписание:</b> ${esc(error)}. Показано расписание${since}.`]);
  if (day?.stale?.format) out.push(['bad', `<b>${esc(day.stale.message)}.</b> Показано расписание${since}.`]);
  else if (day?.stale) out.push(['', `<b>${esc(sourceName)} сейчас недоступен</b> — показано расписание${since}.`]);
  for (const w of status?.warnings || []) out.push(['bad', esc(w)]);
  const vk = status?.vk;
  if (vk?.ready && vk.channels.length && vk.channels.every((c) => c.ok === false))
    out.push(['bad', '<b>Не удалось прочитать ни один канал VK.</b> Каналы читаются только с российского адреса. <button type="button" data-action="status">Подробнее</button>']);
  if (saveError) out.push(['bad', `<b>Не удалось сохранить настройки:</b> ${esc(saveError)}`]);
  const update = u && updateDismissed !== updateKey(u) && updateHtml(u);
  if (update) out.unshift(['update', update]);
  return out;
}

// Подвал: версия, свежесть счёта и подсказка по клавишам. fetchedAt — когда источник последний
// раз ответил на этот день (не когда перерисовали страницу); при сбое — прежнее время с пометкой.
// sports — сколько видов спорта в переключателе: при нескольких — подсказка про клавиши 1, 2…
export function footHtml({ version, day, sourceName = '', sports = 1 }, now = Date.now()) {
  const fresh = day?.fetchedAt
    ? ` · <span class="${day.stale ? 'stale' : ''}" title="Когда ${esc(sourceName)} последний раз прислал расписание и счёт этого дня">счёт ${esc(sourceName)} от ${stamp(day.fetchedAt, now)}${day.stale ? ' (не обновляется)' : ''}</span>`
    : '';
  const keys = sports > 1 ? ` · ${Array.from({ length: sports }, (_, i) => `<kbd>${i + 1}</kbd>`).join(' ')} вид спорта` : '';
  return `Матч-центр ${esc(version)}${fresh} · <kbd>←</kbd> <kbd>→</kbd> дни · <kbd>/</kbd> поиск · <kbd>R</kbd> обновить${keys}`;
}

// Переключатель вида спорта в шапке. sports — [{ id, label }], current — открытый вид
export function sportTabsHtml(sports, current) {
  if (!sports || sports.length < 2) return '';
  return sports.map((s, i) => `<button type="button" role="tab" data-sport="${esc(s.id)}" class="${s.id === current ? 'on' : ''}" aria-selected="${s.id === current}" title="${esc(s.label)} (${i + 1})">${esc(s.label)}</button>`).join('');
}

// ---------- панель каналов ----------
export function statusBadge(vk) {
  if (!vk?.ready) return { cls: 'wait', text: 'VK…' };
  const bad = vk.channels.filter((c) => c.ok === false).length;
  const cls = !vk.channels.length ? '' : !bad ? 'ok' : bad === vk.channels.length ? 'bad' : 'warn';
  return { cls, text: `${vk.streamCount} эфиров · ${hhmm(vk.updatedAt)}` };
}

// copy: null — кнопки отчёта нет (страница без приложения); 'idle' | 'done' | 'failed'
export function popoverHtml(vk, refreshSeconds, copy = null) {
  const rows = (vk?.channels || []).map((c) => {
    const cls = c.ok === null ? 'wait' : c.ok ? 'ok' : 'bad';
    const how = c.ok === null ? 'читается…' : c.ok ? (c.via === 'api' ? 'через API' : 'через страницу канала') : esc(c.error);
    const when = c.okAt ? ` · данные от ${hhmm(c.okAt)}` : '';
    return `<div class="chan"><span class="dot ${cls}"></span><b>${esc(c.label)}</b><span class="n">${c.count} эфиров</span><small>${how}${c.ok === null ? '' : when}</small></div>`;
  }).join('');
  return `<h4>Каналы VK</h4>${rows || '<div class="empty">Каналов нет — добавьте их в настройках</div>'}
    <div class="actions"><span>Обновляются раз в ${refreshSeconds ?? 60} с</span>${copy ? copyButton(copy) : ''}</div>`;
}

const COPY_TEXT = { idle: 'Скопировать отчёт', done: 'Отчёт скопирован', failed: 'Не удалось скопировать' };
function copyButton(copy) {
  return `<button type="button" class="btn" data-action="diagnostics" title="Версия, ОС и состояние источников — без путей, токенов и содержимого настроек">${COPY_TEXT[copy]}</button>`;
}
