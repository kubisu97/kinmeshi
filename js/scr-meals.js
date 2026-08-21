/* 筋メシ - 食事画面 */
'use strict';

function renderMeals(el) {
  const date = App.mDate;
  const meals = mealsOf(date);
  const t = mealTotals(date);
  const g = state.settings.targets;
  const sugs = mealSuggestions(date);

  const mealsHtml = meals.map((m, i) => `
    <button class="card meal-card" data-mi="${i}">
      ${m.photo ? `<img class="meal-thumb" data-photo="${m.photo}" alt="">` : `<div class="meal-thumb noimg">🍽</div>`}
      <div class="meal-info">
        <div class="meal-name">${esc(m.name)}</div>
        <div class="meal-meta">${esc(m.time || '')}${m.src === 'ai' ? ' ・ AI解析' : ''}</div>
        <div class="meal-pfc">P ${Math.round(num(m.p))} ・ F ${Math.round(num(m.f))} ・ C ${Math.round(num(m.c))}</div>
      </div>
      <div class="meal-kcal"><b>${Math.round(num(m.kcal))}</b><span>kcal</span></div>
    </button>`).join('');

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
    [apiImg, thumb] = await Promise.all([downscale(file, 1024, 0.85), downscale(file, 520, 0.72)]);
  } catch (e) { toast('画像を読み込めませんでした'); return; }

  const body = sheet('AI解析', `
    <img class="analyze-preview" src="${thumb}" alt="食事の写真">
    <div class="analyze-status" id="an-status"><span class="spinner"></span> AIが写真を分析しています…</div>
    <div id="an-result"></div>
  `);

  try {
    const r = await analyzeMealPhoto(apiImg);
    const conf = r.confidence >= 0.75 ? '' : '<div class="an-note">⚠ 推定に自信がありません。数値を確認してください。</div>';
    const itemsHtml = r.items && r.items.length ? `
      <div class="an-items">${r.items.map(i => `<div class="an-item"><span>${esc(i.name)}<small> ${esc(i.amount || '')}</small></span><span>${Math.round(num(i.kcal))}kcal</span></div>`).join('')}</div>` : '';
    body.querySelector('#an-status').style.display = 'none';
    body.querySelector('#an-result').innerHTML = `
      ${conf}
      ${r.note ? `<div class="an-note">${esc(r.note)}</div>` : ''}
      ${itemsHtml}
      <div class="form-grid">
        <label class="f-label">名前<input type="text" class="input" id="an-name" value="${esc(r.name)}"></label>
        <div class="grid4">
          <label class="f-label">kcal<input type="number" inputmode="numeric" class="input" id="an-kcal" value="${r.kcal}"></label>
          <label class="f-label">P(g)<input type="number" inputmode="decimal" class="input" id="an-p" value="${r.p}"></label>
          <label class="f-label">F(g)<input type="number" inputmode="decimal" class="input" id="an-f" value="${r.f}"></label>
          <label class="f-label">C(g)<input type="number" inputmode="decimal" class="input" id="an-c" value="${r.c}"></label>
        </div>
        <div class="btn-row">
          <button class="btn ghost" id="an-retry">撮り直す</button>
          <button class="btn primary" id="an-save">保存する</button>
        </div>
      </div>`;
    body.querySelector('#an-retry').addEventListener('click', () => { closeSheet(); document.getElementById('photo-input').click(); });
    body.querySelector('#an-save').addEventListener('click', async () => {
      const photoId = uid();
      await photoPut(photoId, thumb);
      const meal = {
        id: uid(), time: nowTimeStr(),
        name: body.querySelector('#an-name').value.trim() || r.name,
        kcal: num(body.querySelector('#an-kcal').value),
        p: num(body.querySelector('#an-p').value),
        f: num(body.querySelector('#an-f').value),
        c: num(body.querySelector('#an-c').value),
        photo: photoId, src: 'ai', items: r.items || [], note: r.note || '',
      };
      if (!state.meals[App.mDate]) state.meals[App.mDate] = [];
      state.meals[App.mDate].push(meal);
      saveState();
      closeSheet();
      renderCurrent();
      toast('食事を記録しました 🍽');
    });
  } catch (e) {
    body.querySelector('#an-status').style.display = 'none';
    const msg = e.message === 'NO_KEY' ? '設定画面でGemini APIキーを設定してください。' : e.message;
    body.querySelector('#an-result').innerHTML = `
      <div class="an-note err">解析できませんでした：${esc(msg)}</div>
      <div class="btn-row">
        <button class="btn ghost" id="an-manual">手動で記録</button>
        <button class="btn primary" id="an-retry2">もう一度</button>
      </div>`;
    body.querySelector('#an-manual').addEventListener('click', () => { closeSheet(); openManualMeal(); });
    body.querySelector('#an-retry2').addEventListener('click', () => { closeSheet(); document.getElementById('photo-input').click(); });
  }
}

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
  const body = sheet('食事の詳細', `
    ${m.photo ? `<img class="analyze-preview" data-photo="${m.photo}" alt="">` : ''}
    ${m.note ? `<div class="an-note">${esc(m.note)}</div>` : ''}
    ${itemsHtml}
    <div class="form-grid">
      <label class="f-label">名前<input type="text" class="input" id="md-name" value="${esc(m.name)}"></label>
      <div class="grid4">
        <label class="f-label">kcal<input type="number" inputmode="numeric" class="input" id="md-kcal" value="${num(m.kcal)}"></label>
        <label class="f-label">P(g)<input type="number" inputmode="decimal" class="input" id="md-p" value="${num(m.p)}"></label>
        <label class="f-label">F(g)<input type="number" inputmode="decimal" class="input" id="md-f" value="${num(m.f)}"></label>
        <label class="f-label">C(g)<input type="number" inputmode="decimal" class="input" id="md-c" value="${num(m.c)}"></label>
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
  body.querySelector('#md-fav').addEventListener('click', () => {
    saveMealAsFav({
      name: body.querySelector('#md-name').value.trim() || m.name,
      kcal: body.querySelector('#md-kcal').value, p: body.querySelector('#md-p').value,
      f: body.querySelector('#md-f').value, c: body.querySelector('#md-c').value,
      items: m.items,
    });
  });
  body.querySelector('#md-save').addEventListener('click', () => {
    m.name = body.querySelector('#md-name').value.trim() || m.name;
    m.kcal = num(body.querySelector('#md-kcal').value);
    m.p = num(body.querySelector('#md-p').value);
    m.f = num(body.querySelector('#md-f').value);
    m.c = num(body.querySelector('#md-c').value);
    m.time = body.querySelector('#md-time').value || m.time;
    saveState();
    closeSheet();
    renderCurrent();
    toast('更新しました');
  });
  body.querySelector('#md-del').addEventListener('click', async () => {
    if (await confirmDlg(`「${m.name}」を削除しますか？`)) {
      if (m.photo) await photoDel(m.photo);
      meals.splice(index, 1);
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
      if (!m.name || seen.has(m.name) || favNames.has(m.name)) continue;
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
