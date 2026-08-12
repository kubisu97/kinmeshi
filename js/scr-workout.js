/* 筋メシ - 筋トレ画面 */
'use strict';

function ensureWorkout(date) {
  if (!state.workouts[date]) state.workouts[date] = { entries: [], memo: '' };
  return state.workouts[date];
}

function unitInputsHtml(ex, s, ei, si) {
  if (ex.unit === 'kg') {
    return `
      <input type="number" inputmode="decimal" step="0.5" min="0" class="set-in w-in" value="${s.w ?? ''}" placeholder="0" data-ei="${ei}" data-si="${si}" data-k="w" aria-label="重量">
      <span class="set-x">kg ×</span>
      <input type="number" inputmode="numeric" step="1" min="0" class="set-in r-in" value="${s.r ?? ''}" placeholder="0" data-ei="${ei}" data-si="${si}" data-k="r" aria-label="回数">
      <span class="set-x">回</span>`;
  }
  if (isCardioDistance(ex)) {
    const pace = cardioPaceText(ex, s.r, s.w);
    return `
      <input type="number" inputmode="numeric" step="1" min="0" class="set-in r-in" value="${s.r ?? ''}" placeholder="0" data-ei="${ei}" data-si="${si}" data-k="r" aria-label="時間（分）">
      <span class="set-x">分</span>
      <input type="number" inputmode="decimal" step="0.1" min="0" class="set-in km-in" value="${s.w ?? ''}" placeholder="－" data-ei="${ei}" data-si="${si}" data-k="w" aria-label="距離（km）">
      <span class="set-x">km</span>
      <span class="set-pace">${pace}</span>`;
  }
  const u = ex.unit === 'min' ? '分' : '回';
  return `
      <input type="number" inputmode="numeric" step="1" min="0" class="set-in r-in wide" value="${s.r ?? ''}" placeholder="0" data-ei="${ei}" data-si="${si}" data-k="r" aria-label="${u}数">
      <span class="set-x">${u}</span>`;
}

function renderWorkout(el) {
  const date = App.wDate;
  const w = workoutOf(date) || { entries: [] };
  const vol = workoutVolume(date);
  const doneSets = workoutDoneSets(date);

  const entriesHtml = w.entries.map((entry, ei) => {
    const ex = exById(entry.exId);
    if (!ex) return '';
    const last = lastSessionOf(entry.exId, date);
    const target = nextTarget(entry.exId, date);
    const setsHtml = entry.sets.map((s, si) => `
      <div class="set-row ${s.done ? 'done' : ''} ${isCardioDistance(ex) ? 'cardio' : ''}">
        <span class="set-no">${si + 1}</span>
        ${unitInputsHtml(ex, s, ei, si)}
        <button class="set-check" data-ei="${ei}" data-si="${si}" aria-label="完了">${s.done ? '✓' : ''}</button>
        <button class="set-del" data-ei="${ei}" data-si="${si}" aria-label="セット削除">✕</button>
      </div>`).join('');
    return `
    <div class="card ex-card">
      <div class="ex-head">
        <div class="ex-head-l">
          <span class="ex-card-art">${exArt(ex.id)}</span>
          <div>
            <div class="ex-name">${esc(ex.name)}</div>
            <div class="ex-meta">
              <span class="chip">${MUSCLES[ex.muscle].label}</span>
              ${last ? `<span class="ex-last">前回 ${fmtDateJa(last.date)}: ${esc(fmtSets(last.sets, ex.unit, ex))}</span>` : '<span class="ex-last">はじめての種目</span>'}
            </div>
          </div>
        </div>
        <button class="icon-btn" data-del-entry="${ei}" aria-label="種目を削除">✕</button>
      </div>
      ${target ? `<div class="ex-target">📈 次の目標: ${esc(target.text)}</div>` : ''}
      <div class="sets">${setsHtml}</div>
      <div class="btn-row">
        <button class="btn ghost small" data-add-set="${ei}">＋ セット追加</button>
        ${last && entry.sets.every(s => !s.done) ? `<button class="btn ghost small" data-copy-last="${ei}">前回をコピー</button>` : ''}
      </div>
    </div>`;
  }).join('');

  // 直近7日ボリューム
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(todayStr(), -i);
    days.push({ label: fmtDateJa(d).slice(0, fmtDateJa(d).indexOf('(')), value: workoutVolume(d), today: d === todayStr(), tip: `${fmtDateJa(d)} ${Math.round(workoutVolume(d)).toLocaleString()}kg` });
  }
  const hasVol = days.some(x => x.value > 0);

  // 部位バランス（直近7日 完了セット数）
  const counts = {};
  for (let i = 0; i < 7; i++) {
    const d = addDays(todayStr(), -i);
    const wd = workoutOf(d);
    if (!wd) continue;
    for (const e of wd.entries) {
      const ex = exById(e.exId);
      if (!ex) continue;
      counts[ex.muscle] = (counts[ex.muscle] || 0) + e.sets.filter(s => s.done).length;
    }
  }

  const cMin = cardioMinutes(date);
  el.innerHTML = `
    <header class="screen-head"><h1 class="screen-title">筋トレ</h1></header>
    ${dateNavHtml(date, 'wd')}
    ${doneSets > 0 ? `<div class="day-summary">${doneSets}セット完了${vol > 0 ? ` ・ 総ボリューム <b>${Math.round(vol).toLocaleString()}</b> kg` : ''}${cMin > 0 ? ` ・ 有酸素 <b>${cMin}</b>分` : ''}</div>` : ''}
    ${entriesHtml || `<div class="empty-note">「＋ 種目を追加」からトレーニングを記録しましょう</div>`}
    <button class="btn primary big" id="add-ex">＋ 種目を追加</button>

    <h2 class="section-title">直近7日のボリューム</h2>
    <section class="card">
      ${hasVol ? weekBars({ data: days, unit: 'kg' }) : '<div class="empty-note small">記録がたまるとグラフが表示されます</div>'}
    </section>

    <h2 class="section-title">部位バランス（直近7日）</h2>
    <section class="card">${muscleBalanceBars(counts)}</section>

    <section class="card coach-card">
      <h2 class="card-title">🤖 AIコーチ</h2>
      <div class="sug-body" id="coach-out">最近の記録をもとに、次のトレーニングと食事のアドバイスをもらえます。</div>
      <button class="btn ghost small" id="coach-btn">アドバイスをもらう</button>
    </section>
  `;

  wireDateNav(el, 'wd', () => App.wDate, v => { App.wDate = v; renderWorkout(el); });

  el.querySelector('#add-ex').addEventListener('click', () => openAddExercise(date, el));

  // セット入力
  el.querySelectorAll('.set-in').forEach(inp => {
    inp.addEventListener('change', () => {
      const { ei, si, k } = inp.dataset;
      const entry = ensureWorkout(date).entries[+ei];
      if (!entry) return;
      entry.sets[+si][k] = inp.value === '' ? null : Number(inp.value);
      saveState();
      // 有酸素はペース表示をその場で更新
      const ex = exById(entry.exId);
      if (ex && isCardioDistance(ex)) {
        const paceEl = inp.closest('.set-row')?.querySelector('.set-pace');
        if (paceEl) paceEl.textContent = cardioPaceText(ex, entry.sets[+si].r, entry.sets[+si].w);
      }
    });
  });
  // 完了チェック
  el.querySelectorAll('.set-check').forEach(btn => {
    btn.addEventListener('click', () => {
      const { ei, si } = btn.dataset;
      const entry = ensureWorkout(date).entries[+ei];
      const s = entry.sets[+si];
      // 値が空なら前のセットから推測して埋める
      if (!s.done && (s.w == null || s.r == null)) {
        const prev = entry.sets[+si - 1];
        if (prev) { s.w = s.w ?? prev.w; s.r = s.r ?? prev.r; }
      }
      s.done = !s.done;
      saveState();
      renderWorkout(el);
    });
  });
  // セット削除
  el.querySelectorAll('.set-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const { ei, si } = btn.dataset;
      ensureWorkout(date).entries[+ei].sets.splice(+si, 1);
      saveState();
      renderWorkout(el);
    });
  });
  // セット追加
  el.querySelectorAll('[data-add-set]').forEach(btn => {
    btn.addEventListener('click', () => {
      const entry = ensureWorkout(date).entries[+btn.dataset.addSet];
      const prev = entry.sets[entry.sets.length - 1];
      entry.sets.push(prev ? { w: prev.w, r: prev.r, done: false } : { w: null, r: null, done: false });
      saveState();
      renderWorkout(el);
    });
  });
  // 前回コピー
  el.querySelectorAll('[data-copy-last]').forEach(btn => {
    btn.addEventListener('click', () => {
      const entry = ensureWorkout(date).entries[+btn.dataset.copyLast];
      const last = lastSessionOf(entry.exId, date);
      if (last) {
        entry.sets = last.sets.map(s => ({ w: s.w ?? null, r: s.r ?? null, done: false }));
        saveState();
        renderWorkout(el);
      }
    });
  });
  // 種目削除
  el.querySelectorAll('[data-del-entry]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ei = +btn.dataset.delEntry;
      const ex = exById(ensureWorkout(date).entries[ei].exId);
      if (await confirmDlg(`「${ex ? ex.name : '種目'}」を今日の記録から削除しますか？`)) {
        ensureWorkout(date).entries.splice(ei, 1);
        saveState();
        renderWorkout(el);
      }
    });
  });

  // AIコーチ
  el.querySelector('#coach-btn').addEventListener('click', async () => {
    const out = el.querySelector('#coach-out');
    if (!state.settings.apiKey) {
      out.textContent = 'AIコーチを使うには、設定画面でGemini APIキー（無料）を設定してください。';
      return;
    }
    const btn = el.querySelector('#coach-btn');
    btn.disabled = true; btn.textContent = '考え中…';
    out.textContent = '記録を分析しています…';
    try {
      const advice = await aiCoachAdvice(buildCoachSummary());
      out.textContent = advice.trim();
    } catch (e) {
      out.textContent = e.message === 'NO_KEY' ? '設定画面でAPIキーを設定してください。' : `エラー: ${e.message}`;
    }
    btn.disabled = false; btn.textContent = 'もう一度きく';
  });

  initChartTips(el);
}

/* 種目追加シート */
function openAddExercise(date, screenEl) {
  let filter = 'all';
  let q = '';
  const body = sheet('種目を追加', `
    <input type="search" class="input" id="ex-search" placeholder="種目名で検索">
    <div class="chip-row" id="muscle-chips">
      <button class="chip sel" data-m="all">すべて</button>
      ${Object.keys(MUSCLES).map(k => `<button class="chip" data-m="${k}">${MUSCLES[k].label}</button>`).join('')}
    </div>
    <div class="ex-list" id="ex-list"></div>
    <details class="custom-ex">
      <summary>＋ カスタム種目を作る</summary>
      <div class="form-grid">
        <input type="text" class="input" id="cx-name" placeholder="種目名（例: ペックフライ）">
        <select class="input" id="cx-muscle">
          ${Object.keys(MUSCLES).map(k => `<option value="${k}">${MUSCLES[k].label}</option>`).join('')}
        </select>
        <select class="input" id="cx-unit">
          <option value="kg">重量×回数で記録</option>
          <option value="bw">回数だけで記録（自重）</option>
          <option value="min">分で記録</option>
        </select>
        <button class="btn primary" id="cx-add">作成して追加</button>
      </div>
    </details>
  `);

  const listEl = body.querySelector('#ex-list');
  const renderList = () => {
    const w = workoutOf(date);
    const inToday = new Set(w ? w.entries.map(e => e.exId) : []);
    const items = allExercises()
      .filter(e => filter === 'all' || e.muscle === filter)
      .filter(e => !q || e.name.toLowerCase().includes(q.toLowerCase()));
    listEl.innerHTML = items.map(e => {
      const last = lastSessionOf(e.id, date);
      return `
      <button class="ex-item ${inToday.has(e.id) ? 'added' : ''}" data-id="${e.id}">
        <span class="ex-item-art">${exArt(e.id)}</span>
        <span class="ex-item-name">${esc(e.name)}</span>
        <span class="ex-item-meta">${MUSCLES[e.muscle].label}${last ? ` ・ 前回 ${esc(fmtSets(last.sets, e.unit, e))}` : ''}</span>
        <span class="ex-item-add">${inToday.has(e.id) ? '追加済' : '＋'}</span>
      </button>`;
    }).join('') || '<div class="empty-note small">見つかりません。下からカスタム種目を作れます。</div>';
    listEl.querySelectorAll('.ex-item').forEach(btn => {
      btn.addEventListener('click', () => addExerciseToDay(btn.dataset.id));
    });
  };

  const addExerciseToDay = (exId) => {
    const w = ensureWorkout(date);
    if (w.entries.some(e => e.exId === exId)) { toast('すでに追加されています'); return; }
    const last = lastSessionOf(exId, date);
    const sets = last
      ? last.sets.map(s => ({ w: s.w ?? null, r: s.r ?? null, done: false }))
      : [{ w: null, r: null, done: false }, { w: null, r: null, done: false }, { w: null, r: null, done: false }];
    w.entries.push({ id: uid(), exId, sets });
    saveState();
    closeSheet();
    renderWorkout(screenEl);
    toast('種目を追加しました');
  };

  body.querySelector('#ex-search').addEventListener('input', e => { q = e.target.value; renderList(); });
  body.querySelectorAll('#muscle-chips .chip').forEach(c => {
    c.addEventListener('click', () => {
      body.querySelectorAll('#muscle-chips .chip').forEach(x => x.classList.remove('sel'));
      c.classList.add('sel');
      filter = c.dataset.m;
      renderList();
    });
  });
  body.querySelector('#cx-add').addEventListener('click', () => {
    const name = body.querySelector('#cx-name').value.trim();
    if (!name) { toast('種目名を入力してください'); return; }
    const ex = { id: 'c' + uid(), name, muscle: body.querySelector('#cx-muscle').value, unit: body.querySelector('#cx-unit').value };
    state.customExercises.push(ex);
    saveState();
    addExerciseToDay(ex.id);
  });

  renderList();
}
