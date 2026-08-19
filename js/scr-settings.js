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
      <h2 class="card-title">InBody連携</h2>
      <div class="form-grid">
        <div id="ib-latest">${inbodyLatestHtml()}</div>
        <div class="btn-row wrap">
          <button class="btn ghost small" id="ib-photo">📷 読み取り</button>
          <button class="btn ghost small" id="ib-clip">📋 取り込み</button>
          <button class="btn ghost small" id="ib-csv">📂 CSV</button>
          <button class="btn ghost small" id="ib-manual">手動</button>
        </div>
        <details class="guide">
          <summary>InBodyアプリと自動連携する（初回のみ3分）</summary>
          <ol class="guide-steps">
            <li><b>InBodyアプリ</b>の設定で「ヘルスケア連携（Apple Health）」をON。測定データがiPhoneのヘルスケアに入るようになります</li>
            <li><b>ショートカット</b>アプリ →「＋」で新規作成 → 名前を「InBody取り込み」に</li>
            <li>アクション「<b>ヘルスケアサンプルを検索</b>」を追加 → 種類「<b>体重</b>」・並び順「開始日」降順・上限「1」</li>
            <li>同じアクションをもう一度追加 → 種類「<b>体脂肪率</b>」・同じ設定</li>
            <li>アクション「<b>テキスト</b>」を追加して次のように入力（〔〕は上の結果の変数を選ぶ）:<br>体重: 〔体重のサンプル〕<br>体脂肪率: 〔体脂肪率のサンプル〕</li>
            <li>アクション「<b>クリップボードにコピー</b>」を追加して完了</li>
            <li><b>使い方</b>: 測定後にショートカットを実行 → 筋メシのこの画面で「📋 取り込み」。ショートカットをホーム画面に置けば1タップです</li>
          </ol>
          <div class="hint">※ヘルスケアには骨格筋量・基礎代謝の項目が無いため、この方法で取れるのは体重・体脂肪率（＋除脂肪体重）まで。全項目を記録したい月1回はInBodyアプリの画面スクショ→「📷 読み取り」がおすすめ。</div>
        </details>
        <div class="hint">📂 CSV: 「測定日」と「体重」の列があるCSVなら何でも一括取り込みできます（ジムのLookinBodyからの書き出し、自分の記録表など）。重複する日付は自動でスキップ。</div>
        <div class="grid2">
          <label class="f-label">活動量
            <select class="input" id="st-activity">
              <option value="low" ${s.activity === 'low' ? 'selected' : ''}>低め（運動は週1〜2）</option>
              <option value="mid" ${s.activity === 'mid' ? 'selected' : ''}>普通（週2〜3トレ）</option>
              <option value="high" ${s.activity === 'high' ? 'selected' : ''}>高め（週4以上）</option>
            </select>
          </label>
          <label class="f-label">目標に反映
            <button class="btn primary" id="ib-calc" ${latestInbody() ? '' : 'disabled'}>InBodyから計算</button>
          </label>
        </div>
        <div class="hint">基礎代謝×活動量から目標カロリー、除脂肪体重からタンパク質目標を計算します。測定のたびに読み取れば履歴も残ります。</div>
        ${state.inbody.length ? `
        <details class="guide">
          <summary>測定履歴（${state.inbody.length}件）</summary>
          <div id="ib-history">
            ${[...state.inbody].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(r => `
              <div class="ib-row">
                <span>${esc(r.date || '?')}</span>
                <span class="ib-row-v">${r.weight != null ? r.weight + 'kg' : ''} ${r.bf != null ? '/ ' + r.bf + '%' : ''} ${r.muscle != null ? '/ 筋' + r.muscle + 'kg' : ''} ${r.bmr != null ? '/ ' + r.bmr + 'kcal' : ''}</span>
                <button class="set-del" data-ib-del="${r.id}" aria-label="削除">✕</button>
              </div>`).join('')}
          </div>
        </details>` : ''}
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

    <div class="about">筋メシ v2.3.1 ・ あなた専用の筋トレ＆食事管理</div>
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

  // InBody
  $('#ib-photo').addEventListener('click', () => {
    if (!state.settings.apiKey) { toast('先に下のAI設定でAPIキーを設定してください'); return; }
    App.photoTarget = 'inbody';
    document.getElementById('photo-input').click();
  });
  $('#ib-manual').addEventListener('click', openInbodyManual);
  $('#ib-clip').addEventListener('click', importInbodyFromClipboard);
  $('#ib-csv').addEventListener('click', () => document.getElementById('csv-input').click());
  $('#st-activity').addEventListener('change', () => { state.settings.activity = $('#st-activity').value; saveState(); });
  const ibCalc = $('#ib-calc');
  if (ibCalc) ibCalc.addEventListener('click', () => {
    const rec = latestInbody();
    if (!rec) return;
    const t = calcTargetsFromInbody(rec, state.settings.activity, state.settings.profile.goal);
    state.settings.targets = { kcal: t.kcal, p: t.p, f: t.f, c: t.c };
    if (rec.weight) state.settings.profile.weight = rec.weight;
    saveState();
    renderSettings(el);
    toast(`目標を更新: ${t.kcal}kcal / P${t.p} F${t.f} C${t.c}`);
  });
  el.querySelectorAll('[data-ib-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (await confirmDlg('この測定記録を削除しますか？')) {
        state.inbody = state.inbody.filter(r => r.id !== btn.dataset.ibDel);
        saveState();
        renderSettings(el);
      }
    });
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

/* ---------- InBody ---------- */
function inbodyLatestHtml() {
  const r = latestInbody();
  if (!r) return '<div class="hint">ジムで測ったInBodyの結果用紙を写真で読み取ると、体重・体脂肪率・骨格筋量・基礎代謝を記録できます。</div>';
  return `
    <div class="ib-grid">
      <div class="ib-cell"><b>${r.weight ?? '–'}</b><span>体重kg</span></div>
      <div class="ib-cell"><b>${r.bf ?? '–'}</b><span>体脂肪%</span></div>
      <div class="ib-cell"><b>${r.muscle ?? '–'}</b><span>骨格筋kg</span></div>
      <div class="ib-cell"><b>${r.bmr ? r.bmr.toLocaleString() : '–'}</b><span>基礎代謝</span></div>
    </div>
    <div class="hint" style="text-align:center">最終測定: ${esc(r.date || '?')}</div>`;
}

function calcTargetsFromInbody(rec, activity, goal) {
  const w = num(rec.weight) || 65;
  const lbm = rec.bf != null ? w * (1 - num(rec.bf) / 100) : null;
  const bmr = num(rec.bmr) || (lbm ? Math.round(370 + 21.6 * lbm) : Math.round(w * 22));
  const af = { low: 1.35, mid: 1.55, high: 1.75 }[activity] || 1.55;
  let kcal = Math.round(bmr * af);
  kcal += goal === 'gain' ? 300 : goal === 'cut' ? -400 : 0;
  const p = Math.round(lbm ? lbm * 2.3 : w * 2);
  const f = Math.round(kcal * 0.25 / 9);
  const c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4));
  return { kcal, p, f, c, bmr };
}

function inbodyFormHtml(r) {
  return `
    <div class="grid2">
      <label class="f-label">測定日<input type="date" class="input" id="ib-date" value="${esc(r.date || todayStr())}"></label>
      <label class="f-label">体重(kg)<input type="number" inputmode="decimal" step="0.1" class="input" id="ib-w" value="${r.weight ?? ''}"></label>
    </div>
    <div class="grid2">
      <label class="f-label">体脂肪率(%)<input type="number" inputmode="decimal" step="0.1" class="input" id="ib-bf" value="${r.bf ?? ''}"></label>
      <label class="f-label">骨格筋量(kg)<input type="number" inputmode="decimal" step="0.1" class="input" id="ib-m" value="${r.muscle ?? ''}"></label>
    </div>
    <label class="f-label">基礎代謝量(kcal)<input type="number" inputmode="numeric" class="input" id="ib-bmr" value="${r.bmr ?? ''}"></label>`;
}

function saveInbodyFromForm(body) {
  const v = id => { const x = body.querySelector(id).value; return x === '' ? null : Number(x); };
  const weight = v('#ib-w');
  if (!weight) { toast('体重を入力してください'); return false; }
  addInbody({
    date: body.querySelector('#ib-date').value || todayStr(),
    weight, bf: v('#ib-bf'), muscle: v('#ib-m'),
    bmr: v('#ib-bmr') ? Math.round(v('#ib-bmr')) : null,
  });
  return true;
}

function openInbodyManual() {
  const body = sheet('InBodyを手動入力', `
    <div class="form-grid">
      ${inbodyFormHtml({})}
      <div class="btn-row">
        <button class="btn ghost" id="ib-cancel">キャンセル</button>
        <button class="btn primary" id="ib-save">保存する</button>
      </div>
    </div>`);
  body.querySelector('#ib-cancel').addEventListener('click', closeSheet);
  body.querySelector('#ib-save').addEventListener('click', () => {
    if (saveInbodyFromForm(body)) { closeSheet(); renderCurrent(); toast('InBodyを記録しました 💪'); }
  });
}

async function handleInBodyPhoto(file) {
  if (!file) return;
  let apiImg, thumb;
  try {
    [apiImg, thumb] = await Promise.all([downscale(file, 1280, 0.85), downscale(file, 520, 0.7)]);
  } catch (e) { toast('画像を読み込めませんでした'); return; }

  const body = sheet('InBody読み取り', `
    <img class="analyze-preview" src="${thumb}" alt="InBody結果">
    <div class="analyze-status" id="ib-status"><span class="spinner"></span> AIが結果用紙を読み取っています…</div>
    <div id="ib-result"></div>
  `);

  try {
    const r = await analyzeInBodyPhoto(apiImg);
    body.querySelector('#ib-status').style.display = 'none';
    body.querySelector('#ib-result').innerHTML = `
      <div class="an-note">読み取り結果を確認してください。間違っていたら直せます。</div>
      <div class="form-grid">
        ${inbodyFormHtml(r)}
        <div class="btn-row">
          <button class="btn ghost" id="ib-retry">撮り直す</button>
          <button class="btn primary" id="ib-save">保存する</button>
        </div>
      </div>`;
    body.querySelector('#ib-retry').addEventListener('click', () => {
      closeSheet();
      App.photoTarget = 'inbody';
      document.getElementById('photo-input').click();
    });
    body.querySelector('#ib-save').addEventListener('click', () => {
      if (saveInbodyFromForm(body)) { closeSheet(); renderCurrent(); toast('InBodyを記録しました 💪'); }
    });
  } catch (e) {
    body.querySelector('#ib-status').style.display = 'none';
    const msg = e.message === 'NO_KEY' ? 'AI設定でAPIキーを設定してください。' : e.message;
    body.querySelector('#ib-result').innerHTML = `
      <div class="an-note err">読み取れませんでした：${esc(msg)}</div>
      <div class="btn-row">
        <button class="btn ghost" id="ib-manual2">手動で入力</button>
        <button class="btn primary" id="ib-retry2">もう一度</button>
      </div>`;
    body.querySelector('#ib-manual2').addEventListener('click', () => { closeSheet(); openInbodyManual(); });
    body.querySelector('#ib-retry2').addEventListener('click', () => {
      closeSheet();
      App.photoTarget = 'inbody';
      document.getElementById('photo-input').click();
    });
  }
}

/* クリップボード（ショートカット経由のヘルスケアデータ等）から取り込み */
function parseInbodyText(text) {
  const pick = (re) => { const m = text.match(re); return m ? Number(m[1].replace(/,/g, '')) : null; };
  const weight = pick(/体重[^\d]*([\d.]+)/) ?? pick(/weight[^\d]*([\d.]+)/i);
  let bf = pick(/体脂肪率?[^\d]*([\d.]+)/) ?? pick(/body ?fat[^\d]*([\d.]+)/i);
  const lbm = pick(/除脂肪体重[^\d]*([\d.]+)/) ?? pick(/lean ?body ?mass[^\d]*([\d.]+)/i);
  const muscle = pick(/骨格筋量?[^\d]*([\d.]+)/);
  const bmr = pick(/基礎代謝量?[^\d]*([\d,]+)/);
  // 体脂肪率が無くても除脂肪体重があれば逆算できる
  if (bf == null && lbm != null && weight) bf = round1((1 - lbm / weight) * 100);
  let date = todayStr();
  const dm = text.match(/(\d{4})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})/);
  if (dm) date = `${dm[1]}-${String(dm[2]).padStart(2, '0')}-${String(dm[3]).padStart(2, '0')}`;
  if (weight == null) return null;
  return { date, weight, bf, muscle, bmr: bmr ? Math.round(bmr) : null };
}

async function importInbodyFromClipboard() {
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch (e) {
    toast('クリップボードを読めませんでした。もう一度タップして許可してください');
    return;
  }
  const r = parseInbodyText(text || '');
  if (!r) {
    toast('体重のデータが見つかりません。上のガイドの手順でショートカットを実行してから押してください');
    return;
  }
  const body = sheet('取り込み内容の確認', `
    <div class="an-note">クリップボードから読み取りました。確認して保存してください。</div>
    <div class="form-grid">
      ${inbodyFormHtml(r)}
      <div class="btn-row">
        <button class="btn ghost" id="ib-cancel">キャンセル</button>
        <button class="btn primary" id="ib-save">保存する</button>
      </div>
    </div>`);
  body.querySelector('#ib-cancel').addEventListener('click', closeSheet);
  body.querySelector('#ib-save').addEventListener('click', () => {
    if (saveInbodyFromForm(body)) { closeSheet(); renderCurrent(); toast('InBodyを取り込みました 💪'); }
  });
}

/* CSVからの一括取り込み（LookinBody書き出し・自作の記録表など） */
function decodeCsvBuffer(buf) {
  const tryDec = (enc) => { try { return new TextDecoder(enc).decode(buf); } catch (e) { return null; } };
  let t = tryDec('utf-8') || '';
  if (t.includes('�')) {
    const s = tryDec('shift_jis');
    if (s && !s.includes('�')) t = s;
  }
  return t.replace(/^﻿/, '');
}

function parseInbodyCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const delim = (lines[0].match(/\t/g) || []).length >= 2 ? '\t' : ',';
  const split = (l) => l.split(delim).map(c => c.replace(/^"|"$/g, '').trim());
  const head = split(lines[0]);
  const findCol = (res) => head.findIndex(h => res.some(re => re.test(h)));
  const ci = {
    date: findCol([/測定日|日時|日付|date/i]),
    weight: findCol([/^体重|weight/i]),
    bf: findCol([/体脂肪率|PBF|percent ?body ?fat|body ?fat ?(%|percent)/i]),
    muscle: findCol([/^骨格筋量|SMM|skeletal muscle mass/i]),
    bmr: findCol([/基礎代謝|BMR|basal/i]),
    lbm: findCol([/除脂肪|LBM|lean body/i]),
    armR: findCol([/右腕筋肉量/]),
    armL: findCol([/左腕筋肉量/]),
    trunk: findCol([/体幹筋肉量/]),
    legR: findCol([/右脚筋肉量/]),
    legL: findCol([/左脚筋肉量/]),
    score: findCol([/InBody点数|InBody ?Score/i]),
  };
  if (ci.date < 0 || ci.weight < 0) return [];
  const parseDate = (s) => {
    s = String(s || '');
    let m = s.match(/(\d{4})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    m = s.match(/^(\d{4})(\d{2})(\d{2})/); // InBody形式: 20260719163029
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${m[2]}-${m[3]}`;
    return null;
  };
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = split(lines[i]);
    const numAt = (idx) => {
      if (idx < 0 || c[idx] == null || c[idx] === '') return null;
      const n = Number(String(c[idx]).replace(/[^\d.]/g, ''));
      return isFinite(n) && n > 0 ? n : null;
    };
    const date = parseDate(c[ci.date]);
    if (!date) continue;
    const weight = numAt(ci.weight);
    if (!weight) continue;
    let bf = numAt(ci.bf);
    const lbm = numAt(ci.lbm);
    if (bf == null && lbm != null) bf = round1((1 - lbm / weight) * 100);
    const bmrV = numAt(ci.bmr);
    const seg = {
      armR: numAt(ci.armR), armL: numAt(ci.armL), trunk: numAt(ci.trunk),
      legR: numAt(ci.legR), legL: numAt(ci.legL),
    };
    const hasSeg = Object.values(seg).some(v => v != null);
    out.push({
      date, weight, bf, muscle: numAt(ci.muscle), bmr: bmrV ? Math.round(bmrV) : null,
      seg: hasSeg ? seg : null, score: numAt(ci.score),
    });
  }
  return out;
}

async function importInbodyCsvFile(file) {
  let recs = [];
  try {
    recs = parseInbodyCsv(decodeCsvBuffer(await file.arrayBuffer()));
  } catch (e) { /* noop */ }
  if (!recs.length) {
    toast('CSVから測定データを見つけられませんでした（「測定日」と「体重」の列が必要です）');
    return;
  }
  // 重複日付は不足項目だけ補完（部位別データ等を後から足せる）
  let merged = 0;
  for (const r of recs) {
    const ex = state.inbody.find(x => x.date === r.date);
    if (!ex) continue;
    let touched = false;
    for (const k of ['bf', 'muscle', 'bmr', 'seg', 'score']) {
      if ((ex[k] == null || ex[k] === undefined) && r[k] != null) { ex[k] = r[k]; touched = true; }
    }
    if (touched) merged++;
  }
  const existing = new Set(state.inbody.map(r => r.date));
  const fresh = recs.filter(r => !existing.has(r.date));
  const body = sheet('CSV取り込みの確認', `
    <div class="an-note">${recs.length}件の測定データが見つかりました（新規 ${fresh.length}件 / 重複 ${recs.length - fresh.length}件${merged ? `・うち${merged}件は不足項目を補完` : ''}）</div>
    ${fresh.length ? `<div class="an-items">
      ${fresh.slice(0, 5).map(r => `<div class="an-item"><span>${esc(r.date)}</span><span>${r.weight}kg${r.bf != null ? ' / ' + r.bf + '%' : ''}${r.bmr ? ' / ' + r.bmr + 'kcal' : ''}</span></div>`).join('')}
      ${fresh.length > 5 ? `<div class="an-item"><span>…ほか ${fresh.length - 5}件</span><span></span></div>` : ''}
    </div>` : ''}
    <div class="btn-row">
      <button class="btn ghost" id="csv-cancel">キャンセル</button>
      <button class="btn primary" id="csv-ok" ${fresh.length ? '' : 'disabled'}>${fresh.length}件を取り込む</button>
    </div>`);
  body.querySelector('#csv-cancel').addEventListener('click', closeSheet);
  body.querySelector('#csv-ok').addEventListener('click', () => {
    for (const r of fresh) state.inbody.push({ id: uid(), ...r });
    saveState(); // 補完分も保存
    closeSheet();
    renderCurrent();
    toast(`${fresh.length}件のInBodyデータを取り込みました 💪`);
  });
  if (merged) saveState();
}
