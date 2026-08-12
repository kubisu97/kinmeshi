/* 筋メシ - UI部品（シート・トースト・アイコン） */
'use strict';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ボトムシート（モーダル） */
function sheet(title, bodyHtml, { onClose } = {}) {
  closeSheet();
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="overlay" id="overlay">
      <div class="sheet" role="dialog" aria-label="${esc(title)}">
        <div class="sheet-head">
          <div class="sheet-title">${esc(title)}</div>
          <button class="icon-btn" id="sheet-close" aria-label="閉じる">✕</button>
        </div>
        <div class="sheet-body" id="sheet-body">${bodyHtml}</div>
      </div>
    </div>`;
  const overlay = root.querySelector('#overlay');
  requestAnimationFrame(() => overlay.classList.add('show'));
  const close = () => { closeSheet(); if (onClose) onClose(); };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  root.querySelector('#sheet-close').addEventListener('click', close);
  return root.querySelector('#sheet-body');
}
function closeSheet() {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
}

function toast(msg, ms = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), ms);
}

function confirmDlg(msg, okLabel = '削除する') {
  return new Promise(resolve => {
    const body = sheet('確認', `
      <p class="confirm-msg">${esc(msg)}</p>
      <div class="btn-row">
        <button class="btn ghost" id="cf-no">キャンセル</button>
        <button class="btn danger" id="cf-yes">${esc(okLabel)}</button>
      </div>`, { onClose: () => resolve(false) });
    body.querySelector('#cf-no').addEventListener('click', () => { closeSheet(); resolve(false); });
    body.querySelector('#cf-yes').addEventListener('click', () => { closeSheet(); resolve(true); });
  });
}

/* 日付ナビ（‹ 8/10(月) ›） */
function dateNavHtml(dateStr, idPrefix) {
  const isToday = dateStr === todayStr();
  return `
  <div class="date-nav">
    <button class="icon-btn" id="${idPrefix}-prev" aria-label="前の日">‹</button>
    <button class="date-nav-label" id="${idPrefix}-today">${isToday ? '今日 ' : ''}${fmtDateJa(dateStr)}</button>
    <button class="icon-btn" id="${idPrefix}-next" aria-label="次の日" ${isToday ? 'disabled' : ''}>›</button>
  </div>`;
}
function wireDateNav(el, idPrefix, get, set) {
  el.querySelector(`#${idPrefix}-prev`).addEventListener('click', () => { set(addDays(get(), -1)); });
  const next = el.querySelector(`#${idPrefix}-next`);
  if (next) next.addEventListener('click', () => { if (get() < todayStr()) set(addDays(get(), 1)); });
  el.querySelector(`#${idPrefix}-today`).addEventListener('click', () => { set(todayStr()); });
}

/* タブアイコン */
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
  workout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h3M19 12h3"/><rect x="5" y="8" width="3" height="8" rx="1"/><rect x="16" y="8" width="3" height="8" rx="1"/><path d="M8 12h8"/></svg>',
  meals: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
};

/* 提案カード */
function suggestionCardsHtml(sugs) {
  if (!sugs.length) return '';
  return sugs.map(s => `
    <div class="card sug-card" ${s.action ? `data-sug-action="${esc(s.action.type)}"` : ''}>
      <div class="sug-icon">${s.icon}</div>
      <div class="sug-text">
        <div class="sug-title">${esc(s.title)}</div>
        <div class="sug-body">${esc(s.body)}</div>
      </div>
    </div>`).join('');
}
function wireSuggestionCards(el) {
  el.querySelectorAll('[data-sug-action]').forEach(c => {
    c.addEventListener('click', () => {
      const a = c.dataset.sugAction;
      if (a === 'goWorkout') switchTab('workout');
      if (a === 'addMealPhoto') { switchTab('meals'); setTimeout(openMealPhoto, 250); }
    });
  });
}
