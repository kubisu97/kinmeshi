/* 筋メシ - 起動・タブ制御 */
'use strict';

const App = {
  tab: 'home',
  wDate: null,
  mDate: null,
  calMonth: null,
  calSel: null,
  photoTarget: 'meal',
};

function switchTab(tab) {
  App.tab = tab;
  document.querySelectorAll('.tabbar button').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  renderCurrent();
  window.scrollTo(0, 0);
}

function renderCurrent() {
  const el = document.getElementById('screen');
  if (App.tab === 'home') renderHome(el);
  else if (App.tab === 'workout') renderWorkout(el);
  else if (App.tab === 'meals') renderMeals(el);
  else if (App.tab === 'calendar') renderCalendar(el);
  else renderSettings(el);
}

function init() {
  loadState();
  App.wDate = todayStr();
  App.mDate = todayStr();

  // タブ
  document.querySelectorAll('.tabbar button').forEach(b => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });

  // 写真入力（食事 / InBody）
  document.getElementById('photo-input').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    const target = App.photoTarget || 'meal';
    App.photoTarget = 'meal';
    if (!f) return;
    if (target === 'inbody') handleInBodyPhoto(f);
    else if (target === 'progress') handleProgressPhoto(f);
    else handlePhotoFile(f);
  });

  // InBody CSV読み込み
  document.getElementById('csv-input').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) importInbodyCsvFile(f);
  });

  // バックアップ読み込み
  document.getElementById('import-input').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      await importData(f);
      toast('バックアップを読み込みました');
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      toast('読み込めませんでした: ' + err.message);
    }
  });

  // 日付が変わったら今日にリセット
  let lastDay = todayStr();
  setInterval(() => {
    if (todayStr() !== lastDay) {
      lastDay = todayStr();
      App.wDate = lastDay; App.mDate = lastDay;
      renderCurrent();
    }
  }, 60000);

  // ストレージの永続化を要求（iOSがデータを消しにくくなる）
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  initRestTimer();
  switchTab('home');
}

document.addEventListener('DOMContentLoaded', init);
