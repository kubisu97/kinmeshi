/* 筋メシ - 設定画面 */
'use strict';

function autoCalcTargets(weight, goal) {
  const base = Math.round(weight * 33);
  const kcal = base + (goal === 'gain' ? 300 : goal === 'cut' ? -400 : 0);
  const p = Math.round(weight * 2);
  const f = Math.round(kcal * 0.25 / 9);
  const c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4));
  return { kcal, p, f, c };
}

function renderSettings(el) {
  const s = state.settings;
  el.innerHTML = `
    <header class="screen-head"><h1 class="screen-title">設定</h1></header>

    <section class="card">
      <h2 class="card-title">プロフィールと目標</h2>
      <div class="form-grid">
        <div class="grid2">
          <label class="f-label">体重(kg)<input type="number" inputmode="decimal" class="input" id="st-weight" value="${s.profile.weight}"></label>
          <label class="f-label">目的
            <select class="input" id="st-goal">
              <option value="cut" ${s.profile.goal === 'cut' ? 'selected' : ''}>減量</option>
              <option value="keep" ${s.profile.goal === 'keep' ? 'selected' : ''}>維持</option>
              <option value="gain" ${s.profile.goal === 'gain' ? 'selected' : ''}>増量</option>
            </select>
          </label>
        </div>
        <button class="btn ghost small" id="st-auto">体重と目的から目標を自動計算</button>
        <div class="grid4">
          <label class="f-label">kcal<input type="number" inputmode="numeric" class="input" id="st-kcal" value="${s.targets.kcal}"></label>
          <label class="f-label">P(g)<input type="number" inputmode="numeric" class="input" id="st-p" value="${s.targets.p}"></label>
          <label class="f-label">F(g)<input type="number" inputmode="numeric" class="input" id="st-f" value="${s.targets.f}"></label>
          <label class="f-label">C(g)<input type="number" inputmode="numeric" class="input" id="st-c" value="${s.targets.c}"></label>
        </div>
      </div>
    </section>

    <section class="card">
      <h2 class="card-title">AI設定（Gemini 無料API）</h2>
      <div class="form-grid">
        <label class="f-label">APIキー
          <div class="key-row">
            <input type="password" class="input" id="st-key" value="${esc(s.apiKey)}" placeholder="AIza...（設定ガイド参照）" autocomplete="off">
            <button class="icon-btn" id="st-key-eye" aria-label="表示切替">👁</button>
          </div>
        </label>
        <label class="f-label">モデル
          <select class="input" id="st-model">
            ${GEMINI_FALLBACK_MODELS.map(m => `<option value="${m}" ${s.model === m ? 'selected' : ''}>${m}</option>`).join('')}
            ${GEMINI_FALLBACK_MODELS.includes(s.model) ? '' : `<option value="${esc(s.model)}" selected>${esc(s.model)}</option>`}
          </select>
        </label>
        <button class="btn ghost small" id="st-test">接続テスト</button>
        <div class="an-note" id="st-test-out" style="display:none"></div>
        <div class="hint">キーはこのiPhoneの中だけに保存されます。写真の解析時のみGoogleのAPIに送信されます。キー取得: <b>aistudio.google.com</b> →「Get API key」（無料）</div>
      </div>
    </section>

    <section class="card">
      <h2 class="card-title">毎日の通知</h2>
      <div class="form-grid">
        <label class="f-label">通知したい時刻<input type="time" class="input" id="st-notify" value="${s.notifyTime}"></label>
        <div class="hint">iPhoneの「ショートカット」アプリで一度だけ設定すると、毎日「今日は何食べましたか？」と通知が届きます。</div>
        <details class="guide">
          <summary>設定手順を見る（2分）</summary>
          <ol class="guide-steps">
            <li>「ショートカット」アプリを開く → 下の「オートメーション」タブ</li>
            <li>右上「＋」→「時刻」を選ぶ → <b id="st-notify-echo">${s.notifyTime}</b>・毎日 に設定</li>
            <li>「すぐに実行」を選んで「次へ」</li>
            <li>アクションで「通知を表示」を検索して追加</li>
            <li>本文に「今日は何食べましたか？📷 筋メシで記録しよう」と入力</li>
            <li>「完了」で終わり。明日から毎日届きます 🎉</li>
          </ol>
        </details>
      </div>
    </section>

    <section class="card">
      <h2 class="card-title">データ</h2>
      <div class="form-grid">
        <div class="btn-row">
          <button class="btn ghost" id="st-export">バックアップ書き出し</button>
          <button class="btn ghost" id="st-import">読み込み</button>
        </div>
        <div class="hint">データはすべてこのiPhoneの中に保存されます。機種変更の前や月1回のバックアップをおすすめします。</div>
        <button class="btn danger ghost small" id="st-reset">全データを削除</button>
      </div>
    </section>

    <div class="about">筋メシ v1.0 ・ あなた専用の筋トレ＆食事管理</div>
  `;

  const $ = id => el.querySelector(id);

  // プロフィール・目標
  const saveTargets = () => {
    state.settings.profile.weight = num($('#st-weight').value) || s.profile.weight;
    state.settings.profile.goal = $('#st-goal').value;
    state.settings.targets = {
      kcal: Math.max(0, Math.round(num($('#st-kcal').value))),
      p: Math.max(0, Math.round(num($('#st-p').value))),
      f: Math.max(0, Math.round(num($('#st-f').value))),
      c: Math.max(0, Math.round(num($('#st-c').value))),
    };
    saveState();
  };
  ['#st-weight', '#st-goal', '#st-kcal', '#st-p', '#st-f', '#st-c'].forEach(id => {
    $(id).addEventListener('change', saveTargets);
  });
  $('#st-auto').addEventListener('click', () => {
    const t = autoCalcTargets(num($('#st-weight').value) || 65, $('#st-goal').value);
    $('#st-kcal').value = t.kcal; $('#st-p').value = t.p; $('#st-f').value = t.f; $('#st-c').value = t.c;
    saveTargets();
    toast(`目標を計算しました: ${t.kcal}kcal / P${t.p} F${t.f} C${t.c}`);
  });

  // AI設定
  $('#st-key').addEventListener('change', () => { state.settings.apiKey = $('#st-key').value.trim(); saveState(); });
  $('#st-key-eye').addEventListener('click', () => {
    const k = $('#st-key');
    k.type = k.type === 'password' ? 'text' : 'password';
  });
  $('#st-model').addEventListener('change', () => { state.settings.model = $('#st-model').value; saveState(); });
  $('#st-test').addEventListener('click', async () => {
    const out = $('#st-test-out');
    out.style.display = 'block';
    state.settings.apiKey = $('#st-key').value.trim();
    saveState();
    if (!state.settings.apiKey) { out.textContent = 'APIキーを入力してください。'; return; }
    out.textContent = '接続しています…';
    try {
      const models = await geminiListModels();
      out.textContent = `✅ 接続OK！ 使えるモデル ${models.length}件`;
      const sel = $('#st-model');
      const cur = state.settings.model;
      const known = new Set(models);
      // 現在の選択が使えない場合は先頭の使えるモデルに
      sel.innerHTML = models.map(m => `<option value="${m}" ${m === cur ? 'selected' : ''}>${m}</option>`).join('');
      if (!known.has(cur) && models.length) {
        const pick = models.find(m => /flash/.test(m) && !/lite|preview/.test(m)) || models[0];
        sel.value = pick;
        state.settings.model = pick;
        saveState();
        out.textContent += `。モデルを ${pick} に設定しました。`;
      }
    } catch (e) {
      out.textContent = `❌ ${e.message === 'NO_KEY' ? 'APIキーを入力してください。' : e.message}`;
    }
  });

  // 通知時刻
  $('#st-notify').addEventListener('change', () => {
    state.settings.notifyTime = $('#st-notify').value || '21:00';
    saveState();
    el.querySelector('#st-notify-echo').textContent = state.settings.notifyTime;
  });

  // データ
  $('#st-export').addEventListener('click', () => exportData().then(() => toast('バックアップを書き出しました')));
  $('#st-import').addEventListener('click', () => document.getElementById('import-input').click());
  $('#st-reset').addEventListener('click', async () => {
    if (await confirmDlg('筋トレ・食事のすべてのデータを削除します。元に戻せません。よろしいですか？', '全部削除する')) {
      localStorage.removeItem(DB_KEY);
      try { indexedDB.deleteDatabase(PHOTO_DB); } catch (e) { /* noop */ }
      location.reload();
    }
  });
}
