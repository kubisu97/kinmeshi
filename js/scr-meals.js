/* 筋メシ - 食事画面 */
'use strict';

function renderMeals(el) {
  const date = App.mDate;
  const meals = mealsOf(date);
  const t = mealTotals(date);
  const g = state.settings.targets;
  const sugs = mealSuggestions(date);

  const mealsHtml = meals.map((m, i) => {
    const busy = m.pending && isMealAnalyzing(m.id);
    const idle = m.pending && !busy;
    return `
    <div class="meal-wrap${busy ? ' analyzing' : ''}${idle ? ' pending' : ''}">
      <button class="card meal-card" data-mi="${i}">
        ${m.photo ? `<img class="meal-thumb" data-photo="${m.photo}" alt="">` : `<div class="meal-thumb noimg">🍽</div>`}
        <div class="meal-info">
          <div class="meal-name">${busy && !(m.edited && m.edited.name) ? 'AIが解析中…' : esc(m.name)}</div>
          <div class="meal-meta">${esc(m.time || '')}${m.src === 'ai' ? ' ・ AI解析' : ''}${busy ? ' ・ 数秒で数値が入ります' : ''}${idle ? ' ・ 未解析' : ''}</div>
          ${busy ? '' : `<div class="meal-pfc">P ${Math.round(num(m.p))} ・ F ${Math.round(num(m.f))} ・ C ${Math.round(num(m.c))}</div>`}
        </div>
        <div class="meal-kcal">${busy ? '<span class="spinner"></span>' : `<b>${Math.round(num(m.kcal))}</b><span>kcal</span>`}</div>
      </button>
      ${idle ? `<button class="btn ghost small meal-reanalyze" data-re="${i}">🔄 AIで解析する</button>` : ''}
    </div>`;
  }).join('');

  el.innerHTML = `
    <header class="screen-head"><h1 class="screen-title">食事</h1></header>
    ${dateNavHtml(date, 'md')}

    <section class="card">
      <div class="meters">
        ${pfcMeterRow('カロリー', '--c-p', t.kcal, g.kcal, 'kcal')}
        ${pfcMeterRow('P タンパク質', '--c-p', t.p, g.p, 'g')}
        ${pfcMeterRow('F 脂質', '--c-f', t.f, g.f, 'g')}
        ${pfcMeterRow('C 炭水化物', '--c-c', t.c, g.c, 'g')}
      </div>
    </section>

    <div class="quick-row">
      <button class="btn quick" id="m-photo">${ICONS.camera}<span>写真でAI解析</span></button>
      <button class="btn quick" id="m-manual">${ICONS.pen}<span>手動で記録</span></button>
    </div>

    ${recentMealChipsHtml()}

    ${meals.length ? mealsHtml : '<div class="empty-note">まだ記録がありません。写真を撮ってみましょう 📷</div>'}

    ${sugs.length ? `<h2 class="section-title">提案</h2>${suggestionCardsHtml(sugs)}` : ''}
  `;

  wireDateNav(el, 'md', () => App.mDate, v => { App.mDate = v; renderMeals(el); });
  el.querySelector('#m-photo').addEventListener('click', openMealPhoto);
  el.querySelector('#m-manual').addEventListener('click', () => openManualMeal());
  wireRecentMeals(el, false);
  el.querySelectorAll('.meal-card').forEach(c => {
    c.addEventListener('click', () => openMealDetail(+c.dataset.mi));
  });
  el.querySelectorAll('.meal-reanalyze').forEach(b => {
    b.addEventListener('click', () => { reanalyzeMeal(+b.dataset.re); });
  });
  wireSuggestionCards(el);
  loadThumbs(el);
}

function loadThumbs(root) {
  root.querySelectorAll('img[data-photo]').forEach(async img => {
    const data = await photoGet(img.dataset.photo);
    if (data) img.src = data;
  });
}

/* ---------- 写真からAI解析 ---------- */
function openMealPhoto() {
  if (!state.settings.apiKey) {
    const body = sheet('AI解析の準備', `
      <p class="confirm-msg">写真からの自動解析には、無料のGemini APIキーが必要です（設定は5分で終わります）。設定画面の手順に沿って取得してください。</p>
      <div class="btn-row">
        <button class="btn ghost" id="np-manual">手動で記録する</button>
        <button class="btn primary" id="np-go">設定へ</button>
      </div>`);
    body.querySelector('#np-go').addEventListener('click', () => { closeSheet(); switchTab('settings'); });
    body.querySelector('#np-manual').addEventListener('click', () => { closeSheet(); openManualMeal(); });
    return;
  }
  App.photoTarget = 'meal';
  document.getElementById('photo-input').click();
}

async function handlePhotoFile(file) {
  if (!file) return;
  let apiImg, thumb;
  try {
    // 解析用は768pxで十分（小さいほど送信が速い）。保存・表示用は520px
    [apiImg, thumb] = await Promise.all([downscale(file, 768, 0.8), downscale(file, 520, 0.72)]);
  } catch (e) { toast('画像を読み込めませんでした'); return; }

  // 撮った瞬間に記録を完了させる。AIの結果は待たない
  const date = App.mDate;
  const photoId = uid();
  await photoPut(photoId, thumb);
  const meal = {
    id: uid(), time: nowTimeStr(), name: '未解析の食事',
    kcal: 0, p: 0, f: 0, c: 0,
    photo: photoId, src: 'pending', pending: true, items: [], note: '',
  };
  if (!state.meals[date]) state.meals[date] = [];
  state.meals[date].push(meal);
  saveState();
  toast('📷 記録しました。数値はAIがあとで入れます');
  startMealAnalysis(date, meal.id, apiImg);
}

/* ---------- 裏でのAI解析 ---------- */
const _mealAnalyzing = new Set(); // 解析中の食事ID（このセッション内だけ）
let _mealDetailHook = null;       // 詳細シートを開いている間の更新フック

function isMealAnalyzing(id) { return _mealAnalyzing.has(id); }

function findMeal(date, id) {
  return (state.meals[date] || []).find(x => x.id === id) || null;
}

/* 食事タブ・ホームを見ているときだけ描き直す（入力中の他タブを邪魔しない） */
function refreshMealViews() {
  if (App.tab === 'meals' || App.tab === 'home') renderCurrent();
}

/* AIの結果を反映。ユーザーが手で直した項目は上書きしない */
function applyMealAnalysis(m, r) {
  const ed = m.edited || {};
  if (!ed.name) m.name = r.name;
  if (!ed.kcal) m.kcal = r.kcal;
  if (!ed.p) m.p = r.p;
  if (!ed.f) m.f = r.f;
  if (!ed.c) m.c = r.c;
  m.items = r.items || [];
  m.note = r.note || '';
  m.src = 'ai';
  m.pending = false;
  delete m.aiTries;
}

async function startMealAnalysis(date, id, imgDataUrl, { manual = false } = {}) {
  if (_mealAnalyzing.has(id)) return false;
  _mealAnalyzing.add(id);
  refreshMealViews();
  let ok = false;
  try {
    const r = await analyzeMealPhoto(imgDataUrl);
    const m = findMeal(date, id);
    if (m) { // 解析中に削除されていたら何もしない
      applyMealAnalysis(m, r);
      saveState();
      if (_mealDetailHook && _mealDetailHook.id === id) _mealDetailHook.refresh(m);
      toast(`✨ ${m.name} ${Math.round(num(m.kcal))}kcal（タップで修正できます）`, 3200);
    }
    ok = true;
  } catch (e) {
    const m = findMeal(date, id);
    if (m && !e.network && e.message !== 'NO_KEY') {
      m.aiTries = (m.aiTries || 0) + 1;
      saveState();
    }
    if (manual || m) {
      toast(e.message === 'NO_KEY'
        ? '設定でAPIキーを登録してください'
        : `AI解析できませんでした（${e.message}）。写真は記録済みです`, 3200);
    }
  } finally {
    _mealAnalyzing.delete(id);
    refreshMealViews();
  }
  return ok;
}

/* 未解析の食事をあとから解析する（ボタン） */
async function reanalyzeMeal(idx) {
  const m = mealsOf(App.mDate)[idx];
  if (!m || !m.photo) return;
  const data = await photoGet(m.photo);
  if (!data) { toast('写真が見つかりませんでした'); return; }
  await startMealAnalysis(App.mDate, m.id, data, { manual: true });
}

/* アプリを開いた時・戻ってきた時に、途中だった解析を自動で再開する
   （撮ってすぐ画面を閉じても、次に開けば数字が入っている） */
let _mealResumeRunning = false;
async function resumePendingAnalyses() {
  if (_mealResumeRunning || !state || !state.meals || !geminiKey()) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  _mealResumeRunning = true;
  try {
    const dates = [todayStr(), addDays(todayStr(), -1)];
    const queue = [];
    for (const d of dates) {
      for (const m of (state.meals[d] || [])) {
        if (m.pending && m.photo && !_mealAnalyzing.has(m.id) && (m.aiTries || 0) < 2) queue.push([d, m.id, m.photo]);
      }
    }
    for (const [d, id, photo] of queue.slice(0, 3)) {
      const data = await photoGet(photo);
      if (!data) continue;
      if (!await startMealAnalysis(d, id, data)) break; // 失敗したら今回はここまで
    }
  } finally { _mealResumeRunning = false; }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) resumePendingAnalyses(); });

function downscale(file, maxSize, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image load error')); };
    img.src = url;
  });
}

/* ---------- 手動記録 ---------- */
function openManualMeal() {
  const hasKey = !!state.settings.apiKey;
  const body = sheet('食事を記録', `
    ${mealFavChipsHtml()}
    ${recentMealChipsHtml()}
    ${hasKey ? `
    <div class="ai-text-box">
      <div class="qf-label">🤖 食べたものを書くだけでAIが計算</div>
      <textarea class="input" id="mm-ai-text" rows="2" placeholder="例: カツ丼と味噌汁とサラダ。あとビール500ml"></textarea>
      <button class="btn primary small" id="mm-ai-btn" style="margin-top:8px">AIにカロリーを計算してもらう</button>
      <div id="mm-ai-out"></div>
    </div>` : `
    <div class="an-note">🤖 APIキーを設定すると「食べたものを書くだけでAIがカロリー計算」が使えます（設定タブから）</div>`}
    <div class="qf-label">よく食べるものからタップで追加</div>
    <div class="qf-grid">
      ${QUICK_FOODS.map((f, i) => `<button class="qf-chip" data-qf="${i}">${esc(f.name)}<small>${f.kcal}kcal</small></button>`).join('')}
    </div>
    <div class="form-grid">
      <label class="f-label">名前<input type="text" class="input" id="mm-name" placeholder="例: 昼食（幕の内弁当）"></label>
      <div class="grid4">
        <label class="f-label">kcal<input type="number" inputmode="numeric" class="input" id="mm-kcal" value=""></label>
        <label class="f-label">P(g)<input type="number" inputmode="decimal" class="input" id="mm-p" value=""></label>
        <label class="f-label">F(g)<input type="number" inputmode="decimal" class="input" id="mm-f" value=""></label>
        <label class="f-label">C(g)<input type="number" inputmode="decimal" class="input" id="mm-c" value=""></label>
      </div>
      <label class="f-label">時刻<input type="time" class="input" id="mm-time" value="${nowTimeStr()}"></label>
      <div class="btn-row">
        <button class="btn ghost" id="mm-clear">クリア</button>
        <button class="btn primary" id="mm-save">保存する</button>
      </div>
    </div>
  `);
  const get = id => body.querySelector(id);
  wireMealFavs(body);
  wireRecentMeals(body, true);

  // AIテキスト解析
  const aiBtn = get('#mm-ai-btn');
  if (aiBtn) aiBtn.addEventListener('click', async () => {
    const desc = get('#mm-ai-text').value.trim();
    if (!desc) { toast('食べたものを入力してください'); return; }
    aiBtn.disabled = true; aiBtn.textContent = 'AIが計算中…';
    const out = get('#mm-ai-out');
    out.innerHTML = '';
    try {
      const r = await analyzeMealText(desc);
      get('#mm-name').value = r.name;
      get('#mm-kcal').value = r.kcal;
      get('#mm-p').value = r.p;
      get('#mm-f').value = r.f;
      get('#mm-c').value = r.c;
      body._aiItems = r.items || [];
      const itemsHtml = r.items && r.items.length ? `
        <div class="an-items">${r.items.map(i => `<div class="an-item"><span>${esc(i.name)}<small> ${esc(i.amount || '')}</small></span><span>${Math.round(num(i.kcal))}kcal</span></div>`).join('')}</div>` : '';
      out.innerHTML = `${r.note ? `<div class="an-note">${esc(r.note)}</div>` : ''}${itemsHtml}
        <div class="hint">下の欄に反映しました。数値は直せます。そのまま保存でOK</div>`;
    } catch (e) {
      out.innerHTML = `<div class="an-note err">${esc(e.message === 'NO_KEY' ? '設定タブでAPIキーを設定してください' : e.message)}</div>`;
    }
    aiBtn.disabled = false; aiBtn.textContent = 'AIにカロリーを計算してもらう';
  });

  body.querySelectorAll('.qf-chip[data-qf]').forEach(chip => {
    chip.addEventListener('click', () => {
      const f = QUICK_FOODS[+chip.dataset.qf];
      const nameEl = get('#mm-name');
      nameEl.value = nameEl.value ? `${nameEl.value}、${f.name}` : f.name;
      get('#mm-kcal').value = Math.round(num(get('#mm-kcal').value) + f.kcal);
      get('#mm-p').value = round1(num(get('#mm-p').value) + f.p);
      get('#mm-f').value = round1(num(get('#mm-f').value) + f.f);
      get('#mm-c').value = round1(num(get('#mm-c').value) + f.c);
    });
  });
  get('#mm-clear').addEventListener('click', () => {
    ['#mm-name', '#mm-kcal', '#mm-p', '#mm-f', '#mm-c'].forEach(id => get(id).value = '');
  });
  get('#mm-save').addEventListener('click', () => {
    const name = get('#mm-name').value.trim();
    if (!name) { toast('名前を入力するか、食品をタップしてください'); return; }
    if (!state.meals[App.mDate]) state.meals[App.mDate] = [];
    state.meals[App.mDate].push({
      id: uid(), time: get('#mm-time').value || nowTimeStr(), name,
      kcal: num(get('#mm-kcal').value), p: num(get('#mm-p').value),
      f: num(get('#mm-f').value), c: num(get('#mm-c').value),
      photo: null, src: body._aiItems && body._aiItems.length ? 'ai' : 'manual',
      items: body._aiItems || [],
    });
    saveState();
    closeSheet();
    renderCurrent();
    toast('食事を記録しました 🍽');
  });
}

/* ---------- 食事の詳細・編集 ---------- */
function openMealDetail(index) {
  const meals = state.meals[App.mDate] || [];
  const m = meals[index];
  if (!m) return;
  const itemsHtml = m.items && m.items.length ? `
    <div class="an-items">${m.items.map(i => `<div class="an-item"><span>${esc(i.name)}<small> ${esc(i.amount || '')}</small></span><span>${Math.round(num(i.kcal))}kcal</span></div>`).join('')}</div>` : '';
  const busy = m.pending && isMealAnalyzing(m.id);
  const body = sheet('食事の詳細', `
    ${m.photo ? `<img class="analyze-preview" data-photo="${m.photo}" alt="">` : ''}
    <div class="an-note" id="md-busy" ${busy ? '' : 'style="display:none"'}><span class="spinner"></span> AIが解析中です。終わると空欄に数値が自動で入ります</div>
    <div id="md-extra">
      ${m.note ? `<div class="an-note">${esc(m.note)}</div>` : ''}
      ${itemsHtml}
    </div>
    <div class="form-grid">
      <label class="f-label">名前<input type="text" class="input" id="md-name" value="${m.pending ? '' : esc(m.name)}" placeholder="${m.pending ? '未解析（手で入れてもOK）' : ''}"></label>
      <div class="grid4">
        <label class="f-label">kcal<input type="number" inputmode="numeric" class="input" id="md-kcal" value="${m.pending ? '' : num(m.kcal)}"></label>
        <label class="f-label">P(g)<input type="number" inputmode="decimal" class="input" id="md-p" value="${m.pending ? '' : num(m.p)}"></label>
        <label class="f-label">F(g)<input type="number" inputmode="decimal" class="input" id="md-f" value="${m.pending ? '' : num(m.f)}"></label>
        <label class="f-label">C(g)<input type="number" inputmode="decimal" class="input" id="md-c" value="${m.pending ? '' : num(m.c)}"></label>
      </div>
      <label class="f-label">時刻<input type="time" class="input" id="md-time" value="${esc(m.time || '')}"></label>
      <div class="btn-row">
        <button class="btn danger ghost" id="md-del">削除</button>
        <button class="btn ghost" id="md-fav">⭐ マイ定食に</button>
        <button class="btn primary" id="md-save">保存する</button>
      </div>
    </div>
  `);
  loadThumbs(body);

  // 開いた時点の値を覚えておき、保存時は「実際に変えた項目」だけ書き込む
  // （開いている間にAIの解析が終わっても、古い表示で上書きしないため）
  const FIELDS = ['name', 'kcal', 'p', 'f', 'c', 'time'];
  const $in = (k) => body.querySelector(`#md-${k}`);
  const initial = {};
  FIELDS.forEach(k => { initial[k] = $in(k).value; });
  const dirty = (k) => $in(k).value !== initial[k];

  // 開いている間にAIが終わったら、触っていない欄だけ最新の値に差し替える
  _mealDetailHook = {
    id: m.id,
    refresh(mm) {
      if (!body.isConnected) return;
      const vals = { name: mm.name, kcal: num(mm.kcal), p: num(mm.p), f: num(mm.f), c: num(mm.c) };
      for (const k of Object.keys(vals)) {
        if (!dirty(k)) { $in(k).value = vals[k]; initial[k] = $in(k).value; }
      }
      $in('name').placeholder = '';
      body.querySelector('#md-busy').style.display = 'none';
      body.querySelector('#md-extra').innerHTML = `
        ${mm.note ? `<div class="an-note">${esc(mm.note)}</div>` : ''}
        ${mm.items && mm.items.length ? `<div class="an-items">${mm.items.map(i => `<div class="an-item"><span>${esc(i.name)}<small> ${esc(i.amount || '')}</small></span><span>${Math.round(num(i.kcal))}kcal</span></div>`).join('')}</div>` : ''}`;
    },
  };
  body.querySelector('#md-fav').addEventListener('click', () => {
    if (m.pending && !$in('name').value.trim()) { toast('先に名前を入れてください（または解析が終わるのを待ってください）'); return; }
    saveMealAsFav({
      name: body.querySelector('#md-name').value.trim() || m.name,
      kcal: body.querySelector('#md-kcal').value, p: body.querySelector('#md-p').value,
      f: body.querySelector('#md-f').value, c: body.querySelector('#md-c').value,
      items: m.items,
    });
  });
  body.querySelector('#md-save').addEventListener('click', () => {
    const changed = FIELDS.filter(dirty);
    if (!changed.length) { _mealDetailHook = null; closeSheet(); return; }
    if (!m.edited) m.edited = {};
    for (const k of changed) {
      const v = $in(k).value;
      if (k === 'name') { if (v.trim()) { m.name = v.trim(); m.edited.name = true; } }
      else if (k === 'time') { if (v) m.time = v; }
      else { m[k] = num(v); m.edited[k] = true; }
    }
    // 数値を全部自分で入れたら、もうAIを待つ必要はない
    if (m.pending && ['kcal', 'p', 'f', 'c'].every(k => m.edited[k])) {
      m.pending = false;
      m.src = 'manual';
    }
    saveState();
    _mealDetailHook = null;
    closeSheet();
    renderCurrent();
    toast('更新しました');
  });
  body.querySelector('#md-del').addEventListener('click', async () => {
    if (await confirmDlg(`「${m.name}」を削除しますか？`)) {
      if (m.photo) await photoDel(m.photo);
      const at = meals.indexOf(m);
      if (at >= 0) meals.splice(at, 1);
      _mealDetailHook = null;
      saveState();
      renderCurrent();
      toast('削除しました');
    }
  });
}

/* ---------- マイ定食（お気に入り食事） ---------- */
function mealFavChipsHtml() {
  if (!state.mealFavs.length) return '';
  return `
    <div class="qf-label" style="display:flex;justify-content:space-between;align-items:center">
      <span>⭐ マイ定食（タップで即記録）</span>
      <button class="fav-edit-toggle" id="fav-edit">編集</button>
    </div>
    <div class="qf-grid" id="fav-grid">
      ${state.mealFavs.map(f => `
        <button class="qf-chip fav" data-fav="${f.id}">
          ${esc(f.name)}<small>${Math.round(num(f.kcal))}kcal ・ P${Math.round(num(f.p))}</small>
          <span class="fav-del" data-fav-del="${f.id}" style="display:none">✕</span>
        </button>`).join('')}
    </div>`;
}

function wireMealFavs(body) {
  const editBtn = body.querySelector('#fav-edit');
  if (!editBtn) return;
  let editing = false;
  editBtn.addEventListener('click', () => {
    editing = !editing;
    editBtn.textContent = editing ? '完了' : '編集';
    body.querySelectorAll('.fav-del').forEach(x => x.style.display = editing ? 'flex' : 'none');
  });
  body.querySelectorAll('[data-fav]').forEach(chip => {
    chip.addEventListener('click', async (ev) => {
      const delBtn = ev.target.closest('[data-fav-del]');
      const fav = state.mealFavs.find(f => f.id === chip.dataset.fav);
      if (!fav) return;
      if (delBtn) {
        if (await confirmDlg(`マイ定食「${fav.name}」を削除しますか？`)) {
          state.mealFavs = state.mealFavs.filter(f => f.id !== fav.id);
          saveState();
          closeSheet();
          openManualMeal();
        }
        return;
      }
      if (editing) return;
      if (!state.meals[App.mDate]) state.meals[App.mDate] = [];
      state.meals[App.mDate].push({
        id: uid(), time: nowTimeStr(), name: fav.name,
        kcal: num(fav.kcal), p: num(fav.p), f: num(fav.f), c: num(fav.c),
        photo: null, src: 'fav', items: fav.items || [],
      });
      saveState();
      closeSheet();
      renderCurrent();
      toast(`⭐「${fav.name}」を記録しました`);
    });
  });
}

/* ---------- 最近の食事（作り置き向け・直近2週間から再記録） ---------- */
let _recentMeals = [];
function recentMealChipsHtml() {
  const favNames = new Set(state.mealFavs.map(f => f.name));
  const seen = new Set();
  const recents = [];
  const dates = Object.keys(state.meals)
    .filter(d => d <= todayStr() && daysBetween(d, todayStr()) <= 14)
    .sort().reverse();
  for (const d of dates) {
    const arr = state.meals[d] || [];
    for (let i = arr.length - 1; i >= 0 && recents.length < 8; i--) {
      const m = arr[i];
      if (!m.name || m.pending || seen.has(m.name) || favNames.has(m.name)) continue;
      seen.add(m.name);
      recents.push(m);
    }
    if (recents.length >= 8) break;
  }
  _recentMeals = recents;
  if (!recents.length) return '';
  return `
    <div class="qf-label">🕐 最近の食事（2週間・タップで再記録）</div>
    <div class="qf-grid" id="recent-grid">
      ${recents.map((m, i) => `
        <button class="qf-chip" data-recent="${i}">
          ${esc(m.name)}<small>${Math.round(num(m.kcal))}kcal ・ P${Math.round(num(m.p))}</small>
        </button>`).join('')}
    </div>`;
}

function wireRecentMeals(root, inSheet) {
  root.querySelectorAll('[data-recent]').forEach(chip => {
    chip.addEventListener('click', () => {
      const m = _recentMeals[+chip.dataset.recent];
      if (!m) return;
      if (!state.meals[App.mDate]) state.meals[App.mDate] = [];
      state.meals[App.mDate].push({
        id: uid(), time: nowTimeStr(), name: m.name,
        kcal: num(m.kcal), p: num(m.p), f: num(m.f), c: num(m.c),
        photo: null, src: 'recent', items: m.items || [],
      });
      saveState();
      if (inSheet) closeSheet();
      renderCurrent();
      toast(`🕐「${m.name}」を記録しました`);
    });
  });
}

function saveMealAsFav(m) {
  const name = m.name.trim();
  if (!name) return;
  const rec = { id: uid(), name, kcal: num(m.kcal), p: num(m.p), f: num(m.f), c: num(m.c), items: m.items || [] };
  const idx = state.mealFavs.findIndex(f => f.name === name);
  if (idx >= 0) state.mealFavs[idx] = { ...rec, id: state.mealFavs[idx].id };
  else state.mealFavs.push(rec);
  saveState();
  toast(`⭐ マイ定食に保存しました`);
}
