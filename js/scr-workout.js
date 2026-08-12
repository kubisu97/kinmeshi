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
    <button class="btn ghost big" id="ai-menu" style="margin-top:8px">🤖 AIとメニューを作る</button>

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
  el.querySelector('#ai-menu').addEventListener('click', () => openAiMenu(date, el));

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
  let gymF = 'all';
  let filter = 'all';
  let q = '';
  const body = sheet('種目を追加', `
    <input type="search" class="input" id="ex-search" placeholder="種目名・マシン名で検索">
    <div class="chip-row" id="gym-chips">
      <button class="chip gym sel" data-g="all">すべて</button>
      <button class="chip gym" data-g="h">🏢 ${GYMS.h}</button>
      <button class="chip gym" data-g="l">🏢 ${GYMS.l}</button>
    </div>
    <div class="chip-row" id="muscle-chips">
      <button class="chip sel" data-m="all">全部位</button>
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
      .filter(e => gymF === 'all' || (e.gyms || []).includes(gymF))
      .filter(e => filter === 'all' || e.muscle === filter)
      .filter(e => !q || e.name.toLowerCase().includes(q.toLowerCase()) || (e.desc || '').includes(q));

    // 部位ごとにグループ表示
    let html = '';
    for (const mk of Object.keys(MUSCLES)) {
      const group = items.filter(e => e.muscle === mk);
      if (!group.length) continue;
      if (!(filter !== 'all')) html += `<div class="ex-group">${MUSCLES[mk].label}</div>`;
      html += group.map(e => {
        const last = lastSessionOf(e.id, date);
        return `
        <button class="ex-item ${inToday.has(e.id) ? 'added' : ''}" data-id="${e.id}">
          <span class="ex-item-art">${exArt(e.id)}</span>
          <span class="ex-item-name">${esc(e.name)}</span>
          <span class="ex-item-desc">${esc(e.desc || MUSCLES[e.muscle].label)}</span>
          ${last ? `<span class="ex-item-last">前回 ${esc(fmtSets(last.sets, e.unit, e))}</span>` : ''}
          <span class="ex-item-add">${inToday.has(e.id) ? '追加済' : '＋'}</span>
        </button>`;
      }).join('');
    }
    listEl.innerHTML = html || '<div class="empty-note small">見つかりません。下からカスタム種目を作れます。</div>';
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
  body.querySelectorAll('#gym-chips .chip').forEach(c => {
    c.addEventListener('click', () => {
      body.querySelectorAll('#gym-chips .chip').forEach(x => x.classList.remove('sel'));
      c.classList.add('sel');
      gymF = c.dataset.g;
      renderList();
    });
  });
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

/* ---------- AIメニュー作成 ---------- */
function inbodyInsightText() {
  const r = latestInbody();
  if (!r) return '';
  const L = [];
  L.push(`体重${r.weight}kg${r.bf != null ? ` / 体脂肪率${r.bf}%` : ''}${r.muscle != null ? ` / 骨格筋量${r.muscle}kg` : ''}${r.score != null ? ` / InBody点数${r.score}` : ''}（測定日 ${r.date}）`);
  if (r.seg) {
    const s = r.seg;
    const segs = [];
    if (s.armR != null) segs.push(`右腕${s.armR}`);
    if (s.armL != null) segs.push(`左腕${s.armL}`);
    if (s.trunk != null) segs.push(`体幹${s.trunk}`);
    if (s.legR != null) segs.push(`右脚${s.legR}`);
    if (s.legL != null) segs.push(`左脚${s.legL}`);
    if (segs.length) L.push(`部位別筋肉量(kg): ${segs.join(' / ')}`);
    if (s.armR != null && s.armL != null) {
      const d = round1(Math.abs(s.armR - s.armL) / Math.max(s.armR, s.armL) * 100);
      if (d >= 3) L.push(`腕の左右差: ${d}%（${s.armR > s.armL ? '左' : '右'}が弱い）`);
    }
    if (s.legR != null && s.legL != null) {
      const d = round1(Math.abs(s.legR - s.legL) / Math.max(s.legR, s.legL) * 100);
      if (d >= 3) L.push(`脚の左右差: ${d}%（${s.legR > s.legL ? '左' : '右'}が弱い）`);
    }
  }
  return L.join('\n');
}

function buildMenuPrompt(prefs, prevMenu, tweak) {
  const g = state.settings;
  const goalJa = { cut: '減量', keep: '維持', gain: '増量' }[g.profile.goal] || '維持';
  const last = lastTrainedByMuscle();
  const L = [];
  L.push('あなたは優秀なパーソナルトレーナーです。今日のトレーニングメニューを作ってください。');
  L.push('', '## 私の情報');
  L.push(`目的: ${goalJa} / 体重: ${g.profile.weight}kg`);
  const ib = inbodyInsightText();
  if (ib) L.push('', '## InBody測定（体組成）', ib, '※部位別データから弱点や左右差が見えたら、それを補う種目選びをして、rationaleで理由に触れること。');
  L.push('', '## 部位ごとの最終トレーニング日');
  for (const k of Object.keys(MUSCLES)) {
    if (k === 'cardio') continue;
    const d = last[k];
    L.push(`${MUSCLES[k].label}: ${d ? `${daysBetween(d, todayStr())}日前` : '記録なし'}`);
  }
  L.push('', '## 直近の種目実績（重量の参考）');
  const dates = Object.keys(state.workouts).sort().reverse().slice(0, 8);
  const seen = new Set(); const recs = [];
  for (const d of dates) {
    for (const e of (state.workouts[d].entries || [])) {
      if (seen.has(e.exId) || recs.length >= 10) continue;
      const ex = exById(e.exId);
      const done = e.sets.filter(s => s.done);
      if (!ex || !done.length) continue;
      seen.add(e.exId);
      recs.push(`${ex.name}: ${fmtSets(done, ex.unit, ex)}（${fmtDateJa(d)}）`);
    }
  }
  L.push(recs.length ? recs.join('\n') : '（まだ記録が少ない。初心者向けの控えめな重量で）');
  L.push('', '## 今日の希望');
  L.push(`部位: ${prefs.muscles.length ? prefs.muscles.map(k => MUSCLES[k].label).join('・') : 'おまかせ'} / 時間: 約${prefs.time}分 / 強度: ${prefs.intensity}`);
  if (prefs.memo) L.push(`メモ: ${prefs.memo}`);
  L.push('', '## 使える種目（必ずこの中のexIdを使うこと）');
  const pool = allExercises().filter(e => prefs.gym === 'all' || (e.gyms || []).includes(prefs.gym));
  for (const e of pool) {
    L.push(`${e.id}: ${e.name}（${MUSCLES[e.muscle].label}・${e.unit === 'kg' ? '重量kg×回数' : e.unit === 'min' ? '分（wは任意でkm）' : '自重・回数のみ'}）`);
  }
  if (prevMenu && tweak) {
    L.push('', '## さっき提案してくれたメニュー', JSON.stringify(prevMenu));
    L.push('', '## 修正の希望', tweak, '※この希望を反映して作り直すこと。');
  }
  L.push('', `ルール:
- 種目数は時間に収める（筋トレ1種目3セット≒10分、有酸素はr=分をそのまま計上）
- 数日空いている部位を優先。ただし希望部位があれば最優先
- 重量(w)は実績を基準に漸進的に。自重種目はwを省略。有酸素はrに分
- 必ず次のJSONだけで回答:
{"title":"メニューの短い名前","rationale":"この構成にした理由（120字以内。InBodyや履歴に触れる）","items":[{"exId":"px01","sets":[{"w":60,"r":10},{"w":60,"r":10},{"w":60,"r":8}]}],"advice":"一言アドバイス（60字以内）"}`);
  return L.join('\n');
}

function menuItemsHtml(menu) {
  const rows = [];
  for (const it of menu.items) {
    const ex = exById(it.exId);
    if (!ex || !Array.isArray(it.sets) || !it.sets.length) continue;
    rows.push(`
      <div class="menu-item">
        ${exArt(ex.id)}
        <div class="menu-item-t">
          <b>${esc(ex.name)}</b>
          <span>${esc(fmtSets(it.sets, ex.unit, ex))}</span>
        </div>
      </div>`);
  }
  return rows.join('');
}

function openAiMenu(date, screenEl) {
  if (!state.settings.apiKey) {
    const body = sheet('AIメニューの準備', `
      <p class="confirm-msg">AIメニュー作成には、無料のGemini APIキーが必要です（設定タブから5分で設定できます）。</p>
      <div class="btn-row"><button class="btn primary" id="am-go">設定へ</button></div>`);
    body.querySelector('#am-go').addEventListener('click', () => { closeSheet(); switchTab('settings'); });
    return;
  }

  let currentMenu = null;
  const body = sheet('🤖 AIとメニューを作る', `
    <div class="qf-label">今日やりたい部位（複数OK・未選択＝おまかせ）</div>
    <div class="chip-row" id="am-muscles">
      ${Object.keys(MUSCLES).map(k => `<button class="chip" data-m="${k}">${MUSCLES[k].label}</button>`).join('')}
    </div>
    <div class="grid2">
      <label class="f-label">時間
        <select class="input" id="am-time">
          <option value="30">30分</option>
          <option value="45">45分</option>
          <option value="60" selected>60分</option>
          <option value="90">90分</option>
        </select>
      </label>
      <label class="f-label">きつさ
        <select class="input" id="am-int">
          <option value="軽め">軽め</option>
          <option value="普通" selected>普通</option>
          <option value="追い込む">追い込む</option>
        </select>
      </label>
    </div>
    <label class="f-label" style="margin-top:8px">場所
      <select class="input" id="am-gym">
        <option value="all">どこでも</option>
        <option value="h">🏢 ${GYMS.h}</option>
        <option value="l">🏢 ${GYMS.l}</option>
      </select>
    </label>
    <label class="f-label" style="margin-top:8px">メモ（任意）
      <input type="text" class="input" id="am-memo" placeholder="例: 腰が痛いので腰にやさしく">
    </label>
    <button class="btn primary big" id="menu-gen" style="margin-top:12px">メニューを作ってもらう</button>
    <div id="menu-out"></div>
  `);

  body.querySelectorAll('#am-muscles .chip').forEach(c => {
    c.addEventListener('click', () => c.classList.toggle('sel'));
  });

  const getPrefs = () => ({
    muscles: [...body.querySelectorAll('#am-muscles .chip.sel')].map(c => c.dataset.m),
    time: body.querySelector('#am-time').value,
    intensity: body.querySelector('#am-int').value,
    gym: body.querySelector('#am-gym').value,
    memo: body.querySelector('#am-memo').value.trim(),
  });

  const generate = async (tweak) => {
    const genBtn = body.querySelector('#menu-gen');
    const out = body.querySelector('#menu-out');
    genBtn.disabled = true; genBtn.textContent = 'AIが考え中…';
    out.innerHTML = '<div class="analyze-status"><span class="spinner"></span> あなたの記録とInBodyを分析しています…</div>';
    try {
      const menu = await aiWorkoutMenu(buildMenuPrompt(getPrefs(), tweak ? currentMenu : null, tweak));
      menu.items = (menu.items || []).filter(it => exById(it.exId) && Array.isArray(it.sets) && it.sets.length);
      if (!menu.items.length) throw new Error('使える種目でメニューを作れませんでした。条件を変えてみてください。');
      currentMenu = menu;
      out.innerHTML = `
        <div class="menu-title">${esc(menu.title || '今日のメニュー')}</div>
        ${menu.rationale ? `<div class="an-note">${esc(menu.rationale)}</div>` : ''}
        <div class="menu-list">${menuItemsHtml(menu)}</div>
        ${menu.advice ? `<div class="hint">💡 ${esc(menu.advice)}</div>` : ''}
        <div class="btn-row">
          <button class="btn ghost" id="menu-tweak-btn">✎ 修正を頼む</button>
          <button class="btn primary" id="menu-apply">このメニューで始める</button>
        </div>
        <div id="menu-tweak-box" style="display:none; margin-top:8px">
          <input type="text" class="input" id="menu-tweak-text" placeholder="例: スクワットを抜いて、腹筋を足して">
          <button class="btn ghost small" id="menu-regen" style="margin-top:8px">この希望で作り直す</button>
        </div>`;
      out.querySelector('#menu-apply').addEventListener('click', () => {
        const w = ensureWorkout(date);
        const already = new Set(w.entries.map(e => e.exId));
        let added = 0;
        for (const it of currentMenu.items) {
          if (already.has(it.exId)) continue;
          w.entries.push({
            id: uid(), exId: it.exId,
            sets: it.sets.map(s => ({ w: s.w != null ? num(s.w) : null, r: s.r != null ? num(s.r) : null, done: false })),
          });
          added++;
        }
        saveState();
        closeSheet();
        renderWorkout(screenEl);
        toast(added ? `メニューを追加しました（${added}種目）🔥` : 'すべて追加済みの種目でした');
      });
      out.querySelector('#menu-tweak-btn').addEventListener('click', () => {
        out.querySelector('#menu-tweak-box').style.display = 'block';
        out.querySelector('#menu-tweak-text').focus();
      });
      out.querySelector('#menu-regen').addEventListener('click', () => {
        const t = out.querySelector('#menu-tweak-text').value.trim();
        if (!t) { toast('修正の希望を入力してください'); return; }
        generate(t);
      });
    } catch (e) {
      out.innerHTML = `<div class="an-note err">${esc(e.message === 'NO_KEY' ? '設定タブでAPIキーを設定してください' : e.message)}</div>`;
    }
    genBtn.disabled = false;
    genBtn.textContent = currentMenu ? '条件を変えて作り直す' : 'メニューを作ってもらう';
  };

  body.querySelector('#menu-gen').addEventListener('click', () => generate(null));
}
