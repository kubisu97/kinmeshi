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

    ${usualMealsHtml()}

    ${meals.length ? mealsHtml : '<div class="empty-note">まだ記録がありません。写真を撮ってみましょう 📷</div>'}

    ${sugs.length ? `<h2 class="section-title">提案</h2>${suggestionCardsHtml(sugs)}` : ''}
  `;

  wireDateNav(el, 'md', () => App.mDate, v => { App.mDate = v; renderMeals(el); });
  el.querySelector('#m-photo').addEventListener('click', openMealPhoto);
  el.querySelector('#m-manual').addEventListener('click', () => openManualMeal());
  wireUsualMeals(el);
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
  if (App.tab !== 'meals' && App.tab !== 'home') return;
  // 「いつもの食事」の検索を打っている最中は描き直さない（キーボードが閉じてしまう）。
  // 入力欄から離れたら描き直す（直後のタップを消さないよう少し待つ）
  const ae = document.activeElement;
  if (ae && ae.classList && ae.classList.contains('usual-q') && document.getElementById('screen').contains(ae)) {
    if (!ae._refreshLater) {
      ae._refreshLater = true;
      ae.addEventListener('blur', () => { ae._refreshLater = false; setTimeout(refreshMealViews, 350); }, { once: true });
    }
    return;
  }
  renderCurrent();
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
function openManualMeal(prefill = '') {
  const hasKey = !!state.settings.apiKey;
  if (prefill) _usualQ = ''; // 検索から来たときは、戻ったあと検索語を残さない
  const body = sheet('食事を記録', `
    ${mealFavChipsHtml()}
    ${usualMealsHtml({ excludeFavs: true })}
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
  wireUsualMeals(body, { inSheet: true });

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

  // （ボタンの配線が終わってから）
  if (prefill) {
    // 検索で見つからなかった名前を入れておき、AIがあればそのまま計算を始める
    get('#mm-name').value = prefill;
    const t = get('#mm-ai-text');
    if (t) t.value = prefill;
    const b = get('#mm-ai-btn');
    if (t && b) b.click();
    else get('#mm-kcal').focus(); // AIが無ければ、すぐ数値を打てるように
  }
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
      recordUsualMeal(Object.assign({}, fav, { fav: true }), { inSheet: true });
    });
  });
}

/* ---------- いつもの食事（全期間の履歴から・よく食べる順） ----------
   以前は「直近2週間・新しい順・8件」だけで、それより前に食べたものは打ち直すしかなかった。
   全期間を名前ごとにまとめ、よく食べる順（最近ほど重く）に並べる。今の時間帯によく食べるものは上に。
   上位に無くても、検索か「すべて見る」から2タップで届く。 */

let _usualQ = ''; // 食事タブの検索語（裏の解析などで画面が描き直されても消えないように）
function resetMealSearch() { _usualQ = ''; }

/* 表記ゆれを吸収した比較用の文字列（全角半角・大文字小文字・カタカナ/ひらがな・空白） */
const _foldMemo = new Map();
function mealFold(s) {
  s = String(s || '');
  let v = _foldMemo.get(s);
  if (v !== undefined) return v;
  if (_foldMemo.size > 5000) _foldMemo.clear();
  v = mealFoldRaw(s);
  _foldMemo.set(s, v);
  return v;
}
function mealFoldRaw(s) {
  return s.normalize('NFKC').toLowerCase()
    .replace(/[ァ-ヶ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/\s+/g, '');
}
function mealHourOf(t) { const m = /^(\d{1,2}):/.exec(t || ''); return m ? +m[1] : null; }
function mealHourGap(a, b) { const d = Math.abs(a - b) % 24; return Math.min(d, 24 - d); }

/* forDate に記録する前提で、候補を点数順に返す */
function mealHistory(forDate = App.mDate) {
  const today = todayStr();
  const nowH = forDate === today ? new Date().getHours() : null; // 過去の日を埋めるときは時間帯を見ない
  const map = new Map();
  for (const d of Object.keys(state.meals || {})) {
    if (d > today) continue;
    const age = Math.max(0, daysBetween(d, today));
    for (const m of state.meals[d] || []) {
      if (!m || !m.name || m.pending) continue;
      const key = mealFold(m.name);
      if (!key) continue;
      let e = map.get(key);
      if (!e) { e = { key, count: 0, score: 0, stamp: '', photoStamp: '' }; map.set(key, e); }
      e.count++;
      let w = Math.exp(-age / 30);                                          // 30日前の記録は約1/3の重み
      const h = mealHourOf(m.time);
      if (nowH != null && h != null && mealHourGap(h, nowH) <= 2) w *= 2.5; // いつもこの時間帯に食べている
      e.score += w;
      const stamp = `${d} ${m.time || ''}`;
      if (stamp >= e.stamp) {                                               // 数値は一番新しい記録のものを使う
        Object.assign(e, { stamp, last: d, name: m.name, kcal: num(m.kcal), p: num(m.p), f: num(m.f), c: num(m.c), items: m.items || [] });
      }
      if (m.photo && stamp >= e.photoStamp) { e.photo = m.photo; e.photoStamp = stamp; } // 一覧で思い出す手がかり
    }
  }
  // マイ定食は必ず候補に入れ、少し優先する（数値はマイ定食に登録した内容）
  for (const f of state.mealFavs || []) {
    const key = mealFold(f.name);
    if (!key) continue;
    const e = map.get(key) || { key, count: 0, score: 0 };
    Object.assign(e, { fav: true, name: f.name, kcal: num(f.kcal), p: num(f.p), f: num(f.f), c: num(f.c), items: f.items || [] });
    e.score += 1.5;
    map.set(key, e);
  }
  // その日にもう記録したものは下げる（同じものを二重に押しにくく）
  const done = new Set((state.meals[forDate] || []).filter(m => m && m.name && !m.pending).map(m => mealFold(m.name)));
  for (const e of map.values()) { if (done.has(e.key)) { e.score *= 0.3; e.doneToday = true; } }
  return [...map.values()].sort((a, b) => (b.score - a.score) || String(b.stamp || '').localeCompare(String(a.stamp || '')));
}

/* 検索：名前で一致 → 中身（品目名）で一致 → よく食べるもの（プリセット）の順。各グループ内はよく食べる順 */
function searchMeals(query, hist) {
  const q = mealFold(query);
  if (!q) return [];
  const byName = [], byItem = [];
  for (const e of hist) {
    if (mealFold(e.name).includes(q)) byName.push(e);
    else if ((e.items || []).some(it => mealFold(it.name).includes(q))) byItem.push(e);
  }
  const out = byName.concat(byItem);
  const have = new Set(out.map(e => e.key));
  for (const f of QUICK_FOODS) {
    const key = mealFold(f.name);
    if (have.has(key) || !key.includes(q)) continue;
    have.add(key);
    out.push({ key, quick: true, name: f.name, kcal: f.kcal, p: f.p, f: f.f, c: f.c, items: [], count: 0 });
  }
  return out.slice(0, 30);
}

/* 「・」区切りの補足。途中で折り返すなら区切りの位置で（「記録済」「み」のように割れないように） */
function metaJoin(parts) { return parts.filter(Boolean).map(x => `<span class="nw">${x}</span>`).join(' ・ '); }

function usualChipHtml(e, i) {
  const meta = [`${Math.round(num(e.kcal))}kcal`, `P${Math.round(num(e.p))}`];
  if (e.doneToday) meta.push('✓記録済み');
  else if (e.count >= 2) meta.push(`${e.count}回`);
  return `
    <button class="qf-chip${e.fav ? ' fav' : ''}${e.doneToday ? ' done-today' : ''}" data-usual="${i}">
      <span class="usual-name">${e.fav ? '⭐ ' : ''}${esc(e.name)}</span><small>${metaJoin(meta)}</small>
    </button>`;
}

/* 食事タブ／手動記録シートに置く「いつもの食事」ブロック（中身は wireUsualMeals で描く） */
function usualMealsHtml({ excludeFavs = false } = {}) {
  return `
    <div class="usual" data-exclude-favs="${excludeFavs ? 1 : 0}">
      <div class="usual-head">
        <div class="qf-label">🍽 いつもの食事（タップで記録）</div>
        <button class="usual-all" type="button">すべて見る</button>
      </div>
      <input type="search" class="input usual-q" placeholder="🔍 食べたものを探す（例: カレー）" autocomplete="off" enterkeyhint="search" aria-label="食べたものを探す">
      <div class="qf-grid usual-grid"></div>
    </div>`;
}

/* 候補を1つ記録する。押し間違えてもすぐ戻せるよう、取り消しボタンつきの通知を出す */
function recordUsualMeal(e, { inSheet = false } = {}) {
  const date = App.mDate;
  if (!state.meals[date]) state.meals[date] = [];
  const meal = {
    id: uid(), time: nowTimeStr(), name: e.name,
    kcal: num(e.kcal), p: num(e.p), f: num(e.f), c: num(e.c),
    photo: null, // 写真は使い回さない（元の記録を消したときに写真も消えるため）
    src: e.fav ? 'fav' : (e.quick ? 'quick' : 'recent'),
    items: (e.items || []).map(it => Object.assign({}, it)),
  };
  state.meals[date].push(meal);
  saveState();
  _usualQ = '';
  if (inSheet) closeSheet();
  renderCurrent();
  toastUndo(`${e.fav ? '⭐' : '🍽'}「${e.name}」を記録しました`, () => {
    const arr = state.meals[date] || [];
    const at = arr.findIndex(x => x.id === meal.id);
    if (at < 0) return;
    arr.splice(at, 1);
    saveState();
    renderCurrent();
    toast('取り消しました');
  });
}

/* Enterでキーボードを閉じる（日本語の変換確定のEnterは除く） */
function blurOnEnter(input) {
  input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || ev.isComposing || ev.keyCode === 229) return;
    ev.preventDefault();
    input.blur();
  });
}

function wireUsualMeals(root, { inSheet = false } = {}) {
  const box = root.querySelector('.usual');
  if (!box) return;
  const grid = box.querySelector('.usual-grid');
  const input = box.querySelector('.usual-q');
  const allBtn = box.querySelector('.usual-all');
  const full = mealHistory();
  // 手動記録シートではマイ定食が上に並んでいるので、ここには出さない
  const all = box.dataset.excludeFavs === '1' ? full.filter(e => !e.fav) : full;
  let shown = [];
  if (!inSheet) input.value = _usualQ;

  const paint = () => {
    const q = input.value.trim();
    shown = q ? searchMeals(q, all) : all.slice(0, 8);
    let html = shown.map(usualChipHtml).join('');
    if (q) {
      if (!shown.length) html += `<div class="usual-empty">「${esc(q)}」の記録はまだありません</div>`;
      html += `<button class="qf-chip new" type="button" data-usual-new="1">＋「${esc(q)}」を新しく記録<small>${state.settings.apiKey ? 'AIがカロリーを計算します' : '数値を入れて記録'}</small></button>`;
    } else if (!shown.length) {
      html = '<div class="usual-empty">一度記録した食事は、ここからタップで同じものを記録できます</div>';
    }
    grid.innerHTML = html;
    allBtn.style.display = !q && full.length > shown.length ? '' : 'none';
    allBtn.textContent = `すべて見る（${full.length}）`;
  };
  paint();

  input.addEventListener('input', () => { if (!inSheet) _usualQ = input.value; paint(); });
  blurOnEnter(input);
  grid.addEventListener('click', (ev) => {
    const chip = ev.target.closest('[data-usual]');
    if (chip) { const e = shown[+chip.dataset.usual]; if (e) recordUsualMeal(e, { inSheet }); return; }
    if (!ev.target.closest('[data-usual-new]')) return;
    const name = input.value.trim();
    if (!inSheet) {
      // 名前は手動記録へ引き継ぎ、食事タブの検索は空に戻す
      input.value = ''; _usualQ = ''; paint();
      openManualMeal(name);
      return;
    }
    // 手動記録シートの中なら、その場の入力欄に入れる
    const n = root.querySelector('#mm-name');
    const t = root.querySelector('#mm-ai-text');
    const b = root.querySelector('#mm-ai-btn');
    if (n) n.value = name;
    if (t) t.value = name;
    if (t && b && !b.disabled) b.click();
    else (n || input).focus();
  });
  allBtn.addEventListener('click', () => openAllUsualMeals());
}

/* 全部の候補を一覧で（「あれ何だったっけ」を写真と日付で思い出す用） */
function openAllUsualMeals() {
  const all = mealHistory();
  const body = sheet(`いつもの食事（${all.length}）`, `
    <input type="search" class="input usual-q" id="ua-q" placeholder="🔍 名前や中身で探す" autocomplete="off" enterkeyhint="search" aria-label="名前や中身で探す">
    <div class="usual-list" id="ua-list"></div>`);
  const input = body.querySelector('#ua-q');
  const list = body.querySelector('#ua-list');
  let shown = [];
  const paint = () => {
    const q = input.value.trim();
    shown = q ? searchMeals(q, all) : all;
    list.innerHTML = shown.length ? shown.map((e, i) => `
      <button class="usual-row${e.doneToday ? ' done-today' : ''}" type="button" data-ua="${i}">
        ${e.photo ? `<img class="usual-thumb" data-photo="${esc(e.photo)}" alt="">` : '<span class="usual-thumb noimg">🍽</span>'}
        <span class="usual-row-text">
          <span class="usual-row-name">${e.fav ? '⭐ ' : ''}${esc(e.name)}</span>
          <span class="usual-row-meta">${metaJoin([
            `${Math.round(num(e.kcal))}kcal`,
            `P${Math.round(num(e.p))} F${Math.round(num(e.f))} C${Math.round(num(e.c))}`,
            e.count ? `${e.count}回` : '',
            e.last ? `最後 ${esc(fmtDateJa(e.last))}` : '',
            e.doneToday ? '✓記録済み' : '',
          ])}</span>
        </span>
      </button>`).join('') : `<div class="usual-empty">${q ? `「${esc(q)}」の記録はまだありません` : 'まだ記録がありません'}</div>`;
    loadThumbs(list);
  };
  paint();
  input.addEventListener('input', paint);
  blurOnEnter(input);
  list.addEventListener('click', (ev) => {
    const row = ev.target.closest('[data-ua]');
    if (row) { const e = shown[+row.dataset.ua]; if (e) recordUsualMeal(e, { inSheet: true }); }
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
