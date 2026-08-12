/* 筋メシ - 記録カレンダー画面 */
'use strict';

function calMonthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${y}年${m}月`;
}
function calShiftMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function renderCalendar(el) {
  if (!App.calMonth) App.calMonth = todayStr().slice(0, 7);
  if (!App.calSel) App.calSel = todayStr();
  const ym = App.calMonth;
  const [y, m] = ym.split('-').map(Number);
  const startPad = new Date(y, m - 1, 1).getDay(); // 0=日
  const daysInMonth = new Date(y, m, 0).getDate();
  const rows = Math.ceil((startPad + daysInMonth) / 7);
  const today = todayStr();

  let trainDays = 0, mealDays = 0;
  let cellsHtml = '';
  for (let i = 0; i < rows * 7; i++) {
    const d = new Date(y, m - 1, i - startPad + 1);
    const dstr = dateToStr(d);
    const inMonth = d.getMonth() === m - 1;
    const hasW = workoutDoneSets(dstr) > 0;
    const hasM = mealsOf(dstr).length > 0;
    if (inMonth && hasW) trainDays++;
    if (inMonth && hasM) mealDays++;
    cellsHtml += `
      <button class="cal-cell ${inMonth ? '' : 'other'} ${dstr === today ? 'today' : ''} ${dstr === App.calSel ? 'sel' : ''}" data-d="${dstr}">
        <span class="dnum">${d.getDate()}</span>
        <span class="cal-dots">${hasW ? '<i class="cd w"></i>' : ''}${hasM ? '<i class="cd m"></i>' : ''}</span>
      </button>`;
  }

  const dows = ['日', '月', '火', '水', '木', '金', '土'];

  el.innerHTML = `
    <header class="screen-head"><h1 class="screen-title">記録</h1></header>
    <div class="cal-head">
      <button class="icon-btn" id="cal-prev" aria-label="前の月">‹</button>
      <button class="date-nav-label" id="cal-now">${calMonthLabel(ym)}</button>
      <button class="icon-btn" id="cal-next" aria-label="次の月" ${ym >= today.slice(0, 7) ? 'disabled' : ''}>›</button>
    </div>
    <div class="cal-stats">この月: 筋トレ <b>${trainDays}</b>日 ・ 食事記録 <b>${mealDays}</b>日${streakDays() > 0 ? ` ・ 🔥${streakDays()}日連続` : ''}</div>
    <div class="cal-grid">
      ${dows.map((w, i) => `<span class="cal-dow ${i === 0 ? 'sun' : ''}${i === 6 ? 'sat' : ''}">${w}</span>`).join('')}
      ${cellsHtml}
    </div>
    <div class="cal-legend"><span><i class="cd w"></i> 筋トレ</span><span><i class="cd m"></i> 食事</span></div>
    <div id="cal-detail">${calDetailHtml(App.calSel)}</div>

    <h2 class="section-title">体組成の推移</h2>
    <section class="card">${inbodyTrendHtml()}</section>

    <h2 class="section-title">進捗写真</h2>
    <section class="card">${progressPhotosHtml()}</section>

    <section class="card coach-card">
      <h2 class="card-title">📋 AI週間レポート</h2>
      <div class="sug-body" id="wr-out">${state.weeklyReport ? esc(state.weeklyReport.text) : 'この1週間のトレーニングと食事をAIが総括して、来週の方針を提案します。'}</div>
      ${state.weeklyReport ? `<div class="hint">生成日: ${esc(state.weeklyReport.date)}</div>` : ''}
      <button class="btn ghost small" id="wr-btn">${state.weeklyReport ? 'もう一度生成' : '今週のレポートを生成'}</button>
    </section>
  `;

  el.querySelector('#cal-prev').addEventListener('click', () => { App.calMonth = calShiftMonth(ym, -1); renderCalendar(el); });
  const next = el.querySelector('#cal-next');
  if (next) next.addEventListener('click', () => { App.calMonth = calShiftMonth(ym, 1); renderCalendar(el); });
  el.querySelector('#cal-now').addEventListener('click', () => { App.calMonth = today.slice(0, 7); App.calSel = today; renderCalendar(el); });

  el.querySelectorAll('.cal-cell').forEach(c => {
    c.addEventListener('click', () => { App.calSel = c.dataset.d; renderCalendar(el); });
  });
  wireCalDetail(el);
  wireProgressPhotos(el);
  wireWeeklyReport(el);
  loadThumbs(el);
  initChartTips(el);
}

function calDetailHtml(dstr) {
  const w = workoutOf(dstr);
  const meals = mealsOf(dstr);
  const t = mealTotals(dstr);
  const g = state.settings.targets;
  const vol = workoutVolume(dstr);
  const cMin = cardioMinutes(dstr);
  const doneSets = workoutDoneSets(dstr);
  const muscles = workoutMuscles(dstr);

  const wHtml = doneSets > 0 ? `
    <div class="cal-sec">
      <div class="cal-sec-head">🏋️ 筋トレ <span class="cal-sec-sub">${doneSets}セット${vol > 0 ? ` ・ ${Math.round(vol).toLocaleString()}kg` : ''}${cMin > 0 ? ` ・ 有酸素${cMin}分` : ''}</span></div>
      <div class="tw-main" style="margin-bottom:6px">${muscles.map(k => `<span class="chip">${MUSCLES[k].label}</span>`).join('')}</div>
      ${w.entries.map(e => {
        const ex = exById(e.exId);
        const done = e.sets.filter(s => s.done);
        if (!ex || done.length === 0) return '';
        return `<div class="cal-line"><span>${esc(ex.name)}</span><span class="cal-line-r">${esc(fmtSets(done, ex.unit, ex))}</span></div>`;
      }).join('')}
      <button class="btn ghost small" id="cal-open-workout">筋トレタブで開く</button>
    </div>` : '';

  const mHtml = meals.length > 0 ? `
    <div class="cal-sec">
      <div class="cal-sec-head">🍽 食事 <span class="cal-sec-sub">${Math.round(t.kcal)} / ${g.kcal}kcal ・ P${Math.round(t.p)} F${Math.round(t.f)} C${Math.round(t.c)}</span></div>
      ${meals.map(mm => `<div class="cal-line"><span>${esc(mm.time || '')} ${esc(mm.name)}</span><span class="cal-line-r">${Math.round(num(mm.kcal))}kcal</span></div>`).join('')}
      <button class="btn ghost small" id="cal-open-meals">食事タブで開く</button>
    </div>` : '';

  return `
    <section class="card">
      <h2 class="card-title">${fmtDateJa(dstr, true)}</h2>
      ${wHtml}${mHtml}
      ${!wHtml && !mHtml ? `
        <div class="empty-note small">この日の記録はありません</div>
        <div class="btn-row">
          <button class="btn ghost small" id="cal-open-workout">筋トレを記録</button>
          <button class="btn ghost small" id="cal-open-meals">食事を記録</button>
        </div>` : ''}
    </section>`;
}

function wireCalDetail(el) {
  const ow = el.querySelector('#cal-open-workout');
  if (ow) ow.addEventListener('click', () => { App.wDate = App.calSel; switchTab('workout'); });
  const om = el.querySelector('#cal-open-meals');
  if (om) om.addEventListener('click', () => { App.mDate = App.calSel; switchTab('meals'); });
}

/* ---------- 体組成の推移 ---------- */
function inbodyTrendHtml() {
  const recs = [...state.inbody].filter(r => r.date).sort((a, b) => a.date.localeCompare(b.date)).slice(-20);
  const mk = (key, label, unit) => {
    const pts = recs.filter(r => r[key] != null).map(r => ({ v: num(r[key]), label: fmtDateJa(r.date) }));
    if (pts.length < 2) return '';
    return `<div class="trend-label">${label}</div>${lineChart({ points: pts, unit })}`;
  };
  const charts = mk('weight', '体重', 'kg') + mk('bf', '体脂肪率', '%') + mk('muscle', '骨格筋量', 'kg');
  return charts || '<div class="empty-note small">InBodyを2回以上取り込むと推移グラフが表示されます（設定タブ→InBody連携）</div>';
}

/* ---------- 進捗写真 ---------- */
function progressPhotosHtml() {
  const list = [...state.progressPhotos].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return `
    <div class="pp-grid">
      ${list.map(p => `<button class="pp-cell" data-pp="${p.id}"><img data-photo="${p.id}" alt=""><span>${esc((p.date || '').slice(2))}</span></button>`).join('')}
      <button class="pp-cell pp-add" id="pp-add">📷<span>追加</span></button>
    </div>
    ${list.length >= 2 ? '<button class="btn ghost small" id="pp-compare" style="margin-top:8px">最初と最新を比較</button>' : ''}
    ${list.length ? '' : '<div class="hint">月1回、同じ場所・同じポーズで撮ると変化がわかりやすい。写真はこのiPhoneの中にだけ保存されます。</div>'}`;
}

function wireProgressPhotos(el) {
  const add = el.querySelector('#pp-add');
  if (add) add.addEventListener('click', () => {
    App.photoTarget = 'progress';
    document.getElementById('photo-input').click();
  });
  el.querySelectorAll('[data-pp]').forEach(c => c.addEventListener('click', () => openProgressPhoto(c.dataset.pp)));
  const cmp = el.querySelector('#pp-compare');
  if (cmp) cmp.addEventListener('click', () => {
    const list = [...state.progressPhotos].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const a = list[0], b = list[list.length - 1];
    const body = sheet('進捗の比較', `
      <div class="pp-compare">
        <div><img data-photo="${a.id}" alt=""><span>${esc(a.date)}</span></div>
        <div><img data-photo="${b.id}" alt=""><span>${esc(b.date)}</span></div>
      </div>`);
    loadThumbs(body);
  });
}

async function handleProgressPhoto(file) {
  if (!file) return;
  try {
    const img = await downscale(file, 900, 0.8);
    const photoId = uid();
    await photoPut(photoId, img);
    state.progressPhotos.push({ id: photoId, date: todayStr() });
    saveState();
    renderCurrent();
    toast('進捗写真を保存しました 📸');
  } catch (e) { toast('画像を読み込めませんでした'); }
}

function openProgressPhoto(id) {
  const p = state.progressPhotos.find(x => x.id === id);
  if (!p) return;
  const body = sheet(`📸 ${p.date}`, `
    <img class="pp-full" data-photo="${p.id}" alt="">
    <div class="btn-row"><button class="btn danger ghost" id="pp-del">削除</button></div>`);
  loadThumbs(body);
  body.querySelector('#pp-del').addEventListener('click', async () => {
    if (await confirmDlg('この進捗写真を削除しますか？')) {
      await photoDel(p.id);
      state.progressPhotos = state.progressPhotos.filter(x => x.id !== id);
      saveState();
      closeSheet();
      renderCurrent();
    }
  });
}

/* ---------- AI週間レポート ---------- */
function wireWeeklyReport(el) {
  const btn = el.querySelector('#wr-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const out = el.querySelector('#wr-out');
    if (!state.settings.apiKey) { out.textContent = '設定タブでGemini APIキー（無料）を設定すると使えます。'; return; }
    btn.disabled = true; btn.textContent = 'AIが1週間を分析中…';
    try {
      const text = await aiWeeklyReport(buildWeeklySummary());
      state.weeklyReport = { date: todayStr(), text: text.trim() };
      saveState();
      out.textContent = state.weeklyReport.text;
    } catch (e) {
      out.textContent = `エラー: ${e.message === 'NO_KEY' ? 'APIキーを設定してください' : e.message}`;
    }
    btn.disabled = false; btn.textContent = 'もう一度生成';
  });
}
