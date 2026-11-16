// Диалог настроек открытого вида спорта. save(patch) отправляет изменения на сервер; при ошибке
// её текст показывается в диалоге. sport — описание вида для страницы (sports/<вид>.mjs),
// label — его название; leagueNames — { номер: название } турниров источника, для добавленных по номеру.
import { esc, parseAliases, parseChannel } from './format.mjs';

const $ = (s, el) => el.querySelector(s);
const $$ = (s, el) => [...el.querySelectorAll(s)];

export function openSettingsDialog(dlg, { settings: s, sport, label = '', leagueNames = {}, save }) {
  const t = sport.settings;
  const draft = s.channels.map((c) => ({ ...c }));
  // турниры, добавленные по номеру, — после известных
  const extra = s.leagues.filter((id) => !s.knownLeagues.some((k) => k.id === id));
  const leagueName = (id) => leagueNames[id] || `Турнир ${id}`;
  const leagues = [...s.knownLeagues, ...extra.map((id) => ({ id, name: leagueName(id) }))];
  const several = (s.sports || []).length > 1;
  const own = several && label ? ` · ${esc(label)}` : ''; // чьи это каналы и турниры, когда видов несколько
  const refreshOptions = [...new Set([30, 60, 120, 300, s.refreshSeconds])].sort((a, b) => a - b);
  const aliasText = Object.entries(s.userAliases).map(([t, n]) => `${t} = ${n.join(', ')}`).join('\n');
  dlg.innerHTML = `<form class="sheet" novalidate>
    <header><h2>Настройки</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header>
    <div class="body">
      <section><h3>Каналы VK${own}</h3><ul class="chan-list" id="chan-list"></ul>
        <div class="add-row"><input class="field" id="chan-url" placeholder="Ссылка на канал: ${t.channelExample}">
          <input class="field" id="chan-label" placeholder="Название (необязательно)"><button type="button" class="btn" id="chan-add">Добавить</button></div>
        <p class="hint" id="chan-hint">Встроенные каналы можно выключить, добавленные — удалить.</p></section>
      <section><h3>${t.leaguesTitle}${own}</h3><div class="checks" id="leagues">${leagues.map((l) => `<label class="check">
          <input type="checkbox" name="league" value="${l.id}" ${s.leagues.includes(l.id) ? 'checked' : ''}> ${esc(l.name)}</label>`).join('')}</div>
        ${t.leagueAdd ? `<div class="add-row"><input class="field" id="league-id" inputmode="numeric" placeholder="${esc(t.leagueAdd.placeholder)}">
          <button type="button" class="btn" id="league-add">Добавить</button></div>` : ''}
        ${t.leaguesHint ? `<p class="hint">${t.leaguesHint}</p>` : ''}</section>
      <section><h3>Обновление и уведомления${several ? ' · все виды спорта' : ''}</h3>
        <label class="row">Перечитывать каналы VK каждые <select class="field" id="refresh">${refreshOptions.map((v) =>
          `<option value="${v}" ${v === s.refreshSeconds ? 'selected' : ''}>${v < 60 ? `${v} с` : `${+(v / 60).toFixed(1)} мин`}</option>`).join('')}</select></label>
        <label class="row"><input type="checkbox" class="switch" id="notify" ${s.notifications ? 'checked' : ''}> ${several ? 'Уведомлять о начале матчей избранных' : t.notifyLabel}</label>
        <p class="hint">${t.notifyHint}
          ${t.favoritesWord}: ${s.favorites.length ? s.favorites.map((f) => esc(f.name)).join(', ') : 'пока нет'}.
          Матчи: ${s.favoriteMatches.length ? s.favoriteMatches.map((f) => esc(f.name)).join(', ') : 'пока нет'}.</p>
        <label class="row"><input type="checkbox" class="switch" id="tray" ${s.tray ? 'checked' : ''}> Сворачивать в трей при закрытии окна</label>
        <p class="hint">Так уведомления приходят и при закрытом окне. Выйти — правой кнопкой по значку в трее.</p>
        <label class="row"><input type="checkbox" class="switch" id="autostart" ${s.autostart ? 'checked' : ''}> Запускать вместе с Windows</label>
        <p class="hint">С включённым треем приложение стартует свёрнутым.</p></section>
      <section><h3>${t.aliasesTitle}${own}</h3>
        <textarea class="field" id="aliases" rows="4" placeholder="${t.aliasesPlaceholder}">${esc(aliasText)}</textarea>
        <p class="hint">${t.aliasesHint}</p></section>
    </div>
    <footer><span class="err" id="save-err" role="alert"></span><button type="button" class="btn" data-close>Отмена</button><button type="submit" class="btn primary">Сохранить</button></footer>
  </form>`;

  const renderChannels = () => {
    $('#chan-list', dlg).innerHTML = draft.map((c, i) => `<li class="${c.enabled ? '' : 'off'}" data-i="${i}">
      <input type="checkbox" class="switch" data-toggle ${c.enabled ? 'checked' : ''} aria-label="Читать канал">
      <input class="field" data-label value="${esc(c.label)}" aria-label="Название канала">
      <a href="https://vkvideo.ru/@${esc(c.screenName)}/lives" target="_blank" rel="noopener">@${esc(c.screenName)}</a>
      ${c.builtIn ? '' : '<button type="button" class="remove" data-remove aria-label="Удалить канал">✕</button>'}</li>`).join('');
  };
  renderChannels();

  const list = $('#chan-list', dlg);
  list.addEventListener('input', (e) => {
    const li = e.target.closest('li');
    if (e.target.matches('[data-label]')) draft[li.dataset.i].label = e.target.value;
  });
  list.addEventListener('change', (e) => {
    if (!e.target.matches('[data-toggle]')) return;
    const li = e.target.closest('li');
    draft[li.dataset.i].enabled = e.target.checked;
    li.classList.toggle('off', !e.target.checked);
  });
  list.addEventListener('click', (e) => {
    if (!e.target.closest('[data-remove]')) return;
    draft.splice(Number(e.target.closest('li').dataset.i), 1);
    renderChannels();
  });

  const hint = $('#chan-hint', dlg);
  const addChannel = () => {
    const screenName = parseChannel($('#chan-url', dlg).value);
    if (!screenName) { hint.textContent = `Не похоже на ссылку канала VK Видео: нужно что-то вроде ${t.channelExample}`; return; }
    if (draft.some((c) => c.screenName === screenName)) { hint.textContent = `Канал @${screenName} уже есть в списке`; return; }
    draft.push({ screenName, label: $('#chan-label', dlg).value.trim() || screenName, enabled: true, builtIn: false });
    $('#chan-url', dlg).value = '';
    $('#chan-label', dlg).value = '';
    hint.textContent = `Канал @${screenName} добавлен — сохраните настройки.`;
    renderChannels();
  };
  $('#chan-add', dlg).addEventListener('click', addChannel);
  $('#chan-url', dlg).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addChannel(); } });

  // турнир по номеру из адреса на сайте источника: отмечаем уже известный или добавляем новый
  $('#league-add', dlg)?.addEventListener('click', () => {
    const id = Number(($('#league-id', dlg).value.match(/\d+/) || [])[0]);
    if (!id) return;
    const box = $(`input[name="league"][value="${id}"]`, dlg);
    if (box) box.checked = true;
    else $('#leagues', dlg).insertAdjacentHTML('beforeend', `<label class="check"><input type="checkbox" name="league" value="${id}" checked> ${esc(leagueName(id))}</label>`);
    $('#league-id', dlg).value = '';
  });

  // слушаем форму, а не сам диалог: форма создаётся заново при каждом открытии, диалог — один на всё время
  $('form', dlg).addEventListener('click', (e) => { if (e.target.closest('[data-close]')) dlg.close(); });
  $('form', dlg).addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#save-err', dlg);
    const { aliases: userAliases, error } = parseAliases($('#aliases', dlg).value, t.aliasWord);
    if (error) { err.textContent = error; return; }
    const submit = $('button[type="submit"]', dlg);
    submit.disabled = true;
    try {
      await save({
        channels: draft.map(({ screenName, label, enabled }) => ({ screenName, label, enabled })),
        leagues: $$('input[name="league"]:checked', dlg).map((i) => Number(i.value)),
        refreshSeconds: Number($('#refresh', dlg).value),
        notifications: $('#notify', dlg).checked,
        userAliases,
        tray: $('#tray', dlg).checked,
        autostart: $('#autostart', dlg).checked,
      });
      dlg.close();
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      submit.disabled = false;
    }
  });
  dlg.showModal();
}
