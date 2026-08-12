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
  `;

  el.querySelector('#cal-prev').addEventListener('click', () => { App.calMonth = calShiftMonth(ym, -1); renderCalendar(el); });
  const next = el.querySelector('#cal-next');
  if (next) next.addEventListener('click', () => { App.calMonth = calShiftMonth(ym, 1); renderCalendar(el); });
  el.querySelector('#cal-now').addEventListener('click', () => { App.calMonth = today.slice(0, 7); App.calSel = today; renderCalendar(el); });

  el.querySelectorAll('.cal-cell').forEach(c => {
    c.addEventListener('click', () => { App.calSel = c.dataset.d; renderCalendar(el); });
  });
  wireCalDetail(el);
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
