/* 筋メシ - AIアドバイザー（記録を全部見て相談できるチャット） */
'use strict';

const Advisor = { busy: false, draft: '', streamText: '' };

/* ---------- コンテキスト作成（AIに渡す記録の要約） ---------- */

/* InBodyの推移（最新5件 ＋ 初回との差分） */
function advInbodyBlock() {
  const list = (state.inbody || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (!list.length) return '（InBodyの記録なし）';
  const L = [];
  const fmt = (r) => {
    const p = [`${r.date}: 体重${r.weight != null ? r.weight + 'kg' : '—'}`];
    if (r.bf != null) p.push(`体脂肪率${r.bf}%`);
    if (r.muscle != null) p.push(`骨格筋量${r.muscle}kg`);
    if (r.bmr != null) p.push(`基礎代謝${r.bmr}kcal`);
    if (r.score != null) p.push(`スコア${r.score}`);
    return p.join(' ');
  };
  for (const r of list.slice(-5)) L.push(fmt(r));
  if (list.length >= 2) {
    const a = list[0], b = list[list.length - 1];
    const d = (x, y) => (x != null && y != null) ? (y - x >= 0 ? '+' : '') + round1(y - x) : null;
    const parts = [];
    const dw = d(a.weight, b.weight); if (dw != null) parts.push(`体重${dw}kg`);
    const db = d(a.bf, b.bf); if (db != null) parts.push(`体脂肪率${db}%`);
    const dm = d(a.muscle, b.muscle); if (dm != null) parts.push(`骨格筋量${dm}kg`);
    if (parts.length) L.push(`初回(${a.date})からの変化: ${parts.join(' / ')}（計${list.length}回測定）`);
  }
  const seg = list[list.length - 1].seg;
  if (seg) {
    L.push(`最新の部位別筋肉量: 右腕${seg.armR ?? '—'} 左腕${seg.armL ?? '—'} 体幹${seg.trunk ?? '—'} 右脚${seg.legR ?? '—'} 左脚${seg.legL ?? '—'}（kg）`);
  }
  return L.join('\n');
}

/* 直近14日のトレーニング詳細 */
function advWorkoutBlock(days = 14) {
  const L = [];
  let trainDays = 0;
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(todayStr(), -i);
    const w = workoutOf(d);
    if (!w || !w.entries.length) continue;
    const parts = w.entries.map(e => {
      const ex = exById(e.exId);
      const done = e.sets.filter(s => s.done);
      if (!ex || !done.length) return null;
      return `${ex.name} ${fmtSets(done, ex.unit, ex)}`;
    }).filter(Boolean);
    if (!parts.length) continue;
    trainDays++;
    const vol = workoutVolume(d);
    L.push(`${fmtDateJa(d)}: ${parts.join(' / ')}${vol ? `（総ボリューム${Math.round(vol).toLocaleString()}kg）` : ''}${w.memo ? ` メモ「${w.memo}」` : ''}`);
  }
  if (!L.length) return '（記録なし）';
  L.push(`→ 直近${days}日でトレーニング${trainDays}日`);
  return L.join('\n');
}

/* 部位別の頻度・最終実施日（4週間） */
function advMuscleBlock() {
  const cnt = {};
  for (let i = 27; i >= 0; i--) {
    const d = addDays(todayStr(), -i);
    for (const m of workoutMuscles(d)) cnt[m] = (cnt[m] || 0) + 1;
  }
  const last = lastTrainedByMuscle();
  const keys = Object.keys(MUSCLES).filter(k => cnt[k] || last[k]);
  if (!keys.length) return '（データなし）';
  return keys.map(k => {
    const ago = last[k] ? daysBetween(last[k], todayStr()) : null;
    return `${MUSCLES[k].label}: 4週で${cnt[k] || 0}回${ago != null ? ` / 最終${ago === 0 ? '今日' : ago + '日前'}` : ''}`;
  }).join(' 、 ');
}

/* 直近7日の食事 */
function advMealBlock(days = 7) {
  const g = state.settings.targets;
  const L = [];
  let kcalSum = 0, pSum = 0, fSum = 0, cSum = 0, n = 0;
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(todayStr(), -i);
    const ms = mealsOf(d);
    if (!ms.length) continue;
    const t = mealTotals(d);
    n++; kcalSum += t.kcal; pSum += t.p; fSum += t.f; cSum += t.c;
    const names = ms.map(m => `${m.time || ''}${m.name}`).join('、');
    L.push(`${fmtDateJa(d)}: ${Math.round(t.kcal)}kcal P${Math.round(t.p)} F${Math.round(t.f)} C${Math.round(t.c)}（${names}）`);
  }
  if (!n) return '（記録なし）';
  L.push(`→ 記録${n}日の平均: ${Math.round(kcalSum / n)}kcal P${Math.round(pSum / n)} F${Math.round(fSum / n)} C${Math.round(cSum / n)}（目標 ${g.kcal}kcal P${g.p} F${g.f} C${g.c}）`);
  return L.join('\n');
}

/* AIに渡す全体コンテキスト */
function buildAdvisorContext() {
  const pf = state.settings.profile;
  const g = state.settings.targets;
  const goalJa = { cut: '減量', keep: '維持', gain: '増量' }[pf.goal] || '維持';
  const actJa = { low: '低い（デスクワーク中心）', mid: '普通', high: '高い（立ち仕事・よく動く）' }[state.settings.activity] || '普通';
  return [
    `【プロフィール】`,
    `目的: ${goalJa} / 申告体重: ${pf.weight}kg / 活動量: ${actJa}`,
    `1日の目標: ${g.kcal}kcal タンパク質${g.p}g 脂質${g.f}g 炭水化物${g.c}g`,
    `連続記録: ${streakDays()}日 / 今日: ${fmtDateJa(todayStr(), true)}`,
    ``,
    `【InBody（体組成）の推移】`,
    advInbodyBlock(),
    ``,
    `【直近14日のトレーニング記録】`,
    advWorkoutBlock(14),
    ``,
    `【部位別の頻度（直近4週）】`,
    advMuscleBlock(),
    ``,
    `【直近7日の食事記録】`,
    advMealBlock(7),
  ].join('\n');
}

/* システム指示（会話の1通目） */
function advisorSystemPrompt() {
  return `あなたは私の専属パーソナルトレーナー兼管理栄養士です。以下が私の実際の記録データです。この数字を根拠にして相談に答えてください。

${buildAdvisorContext()}

【回答のルール】
・友達に話すようなフランクな口調で、ただし内容は専門的に。敬語は不要。
・必ず上の記録の具体的な数字・種目名・食品名を引用して話す（例「先週の胸のボリューム2,400kgって出てるけど」）。
・記録にないことは推測せず「そのデータはまだないね」と正直に言う。
・回答は250文字以内。長い前置きや箇条書きの説明ばかりにせず、会話として返す。
・毎回アドバイスを羅列するのではなく、相談内容にピンポイントで答える。必要なら逆に質問する。
・医療的な診断はしない。痛み・怪我の話が出たら整形外科の受診をすすめる。

まずは記録を見た第一印象を、2〜3文で気軽に話しかけてください。`;
}

/* ---------- 提案の生成（トレーニング / 献立） ---------- */

/* これまでの会話を要約して渡す（希望を反映させるため） */
function advConversationText() {
  const hist = advHistory().filter(m => m.text);
  if (!hist.length) return '（まだ会話なし）';
  return hist.slice(-8).map(m => `${m.role === 'user' ? '私' : 'あなた'}: ${m.text}`).join('\n');
}

/* トレーニングメニュー用プロンプト */
function buildAdvisorMenuPrompt() {
  const L = [];
  L.push('あなたは私の専属パーソナルトレーナーです。私の記録をもとに、次のトレーニングメニューを組んでください。');
  L.push('', '## 私の記録', buildAdvisorContext());
  L.push('', '## これまでの会話（希望が出ていれば必ず反映すること）', advConversationText());
  L.push('', `## 使える種目（必ずこの中のexIdを使うこと。他のIDは禁止）`);
  L.push(`※gym表記: ${Object.keys(GYMS).map(k => `${k}=${GYMS[k]}`).join(' / ')}。会話でジムの指定がなければどこの種目を使ってもよい。`);
  for (const e of allExercises()) {
    L.push(`${e.id}: ${e.name}（${MUSCLES[e.muscle].label}・${e.unit === 'kg' ? '重量kg×回数' : e.unit === 'min' ? '分（rに分）' : '自重・回数のみ'}・gym:${(e.gyms || ['h', 'l']).join('')}）`);
  }
  L.push('', `## ルール
- 会話で部位・時間・ジム・体調の希望が出ていればそれを最優先。なければ記録から判断する
- 数日空いている部位を優先。直近のセッションと同じ部位の連続は避ける（同部位は中2〜3日）
- 重量(w)は【直近14日のトレーニング記録】の実績を基準に漸進的に上げる。実績のない種目は控えめに
- 自重種目はwを省略、有酸素はrに分数を入れる
- 指定がなければ4〜6種目（1種目3セット≒10分の目安）
- rationaleでは必ず私の実際の数字（ボリューム・InBody・最終実施日など）に触れること

必ず次のJSONだけで回答:
{"title":"メニューの短い名前","rationale":"この構成にした理由（140字以内。私の実データに触れる）","items":[{"exId":"px01","sets":[{"w":60,"r":10},{"w":60,"r":10},{"w":60,"r":8}]}],"advice":"一言アドバイス（60字以内）"}`);
  return L.join('\n');
}

/* 献立用プロンプト */
function buildAdvisorMealPrompt() {
  const d = todayStr();
  const g = state.settings.targets;
  const t = mealTotals(d);
  const eaten = mealsOf(d);
  const rem = {
    kcal: Math.max(0, Math.round(g.kcal - t.kcal)),
    p: Math.max(0, Math.round(g.p - t.p)),
    f: Math.max(0, Math.round(g.f - t.f)),
    c: Math.max(0, Math.round(g.c - t.c)),
  };
  const favs = (state.mealFavs || []).slice(0, 12).map(f => `${f.name}(${Math.round(num(f.kcal))}kcal P${Math.round(num(f.p))})`);
  const recent = [];
  const seen = new Set();
  for (let i = 0; i < 14 && recent.length < 12; i++) {
    for (const m of mealsOf(addDays(d, -i))) {
      if (seen.has(m.name)) continue;
      seen.add(m.name);
      recent.push(`${m.name}(${Math.round(num(m.kcal))}kcal P${Math.round(num(m.p))})`);
    }
  }
  const L = [];
  L.push('あなたは私の専属管理栄養士です。今日これから食べる献立を組んでください。');
  L.push('', '## 私の記録', buildAdvisorContext());
  L.push('', '## 今日の状況');
  L.push(`現在時刻: ${nowTimeStr()}`);
  L.push(`今日すでに食べたもの: ${eaten.length ? eaten.map(m => `${m.time || ''}${m.name}(${Math.round(num(m.kcal))}kcal)`).join('、') : 'まだ何も食べていない'}`);
  L.push(`今日の残り: ${rem.kcal}kcal タンパク質${rem.p}g 脂質${rem.f}g 炭水化物${rem.c}g（目標 ${g.kcal}kcal P${g.p} F${g.f} C${g.c}）`);
  if (recent.length) L.push(`最近よく食べているもの: ${recent.join('、')}`);
  if (favs.length) L.push(`登録済みのマイ定食: ${favs.join('、')}`);
  L.push('', '## これまでの会話（希望が出ていれば必ず反映すること）', advConversationText());
  L.push('', `## ルール
- 現在時刻より後の食事だけを提案する（例: 15時なら夕食と間食。朝食は提案しない）
- 合計が「今日の残り」にだいたい収まるようにする。特にタンパク質は残り分を埋めることを優先
- 私が最近食べているものや手に入りやすいもの（コンビニ・スーパー・自炊で現実的なもの）を優先。凝った料理は避ける
- 量は必ず具体的に書く（例「鶏胸肉200g」「白米150g」）
- 栄養価は日本の一般的な食品成分で計算する
- 2〜4食（間食含む）にまとめる
- noteでは残りカロリーとPFCの何をどう埋めたのか、私の実データに触れて説明する

必ず次のJSONだけで回答:
{"title":"献立の短い名前","note":"この献立にした理由（140字以内）","meals":[{"slot":"夕食","name":"献立の短い名前","kcal":数値,"p":数値,"f":数値,"c":数値,"items":[{"name":"品名","amount":"量（例:200g）"}]}]}`);
  return L.join('\n');
}

/* ---------- 提案カードの描画 ---------- */

function advWorkoutCardHtml(menu, idx) {
  return `
    <div class="adv-card" data-card="w" data-idx="${idx}">
      <div class="adv-card-h">🏋️ ${esc(menu.title || 'トレーニングメニュー')}</div>
      ${menu.rationale ? `<div class="adv-card-note">${esc(menu.rationale)}</div>` : ''}
      <div class="menu-list">${menuItemsHtml(menu)}</div>
      ${menu.advice ? `<div class="adv-card-note">💡 ${esc(menu.advice)}</div>` : ''}
      <div class="adv-card-btns">
        <button class="btn primary small" data-act="w-apply">今日の筋トレに登録</button>
        <button class="btn ghost small" data-act="w-routine">⭐ ルーティーン保存</button>
      </div>
      <div class="adv-card-hint">直したいときはチャットで言ってから、もう一度メニューボタンを押すと作り直します（例「スクワット抜いて」）</div>
    </div>`;
}

function advMealCardHtml(plan, idx) {
  const sum = plan.meals.reduce((a, m) => ({
    kcal: a.kcal + num(m.kcal), p: a.p + num(m.p), f: a.f + num(m.f), c: a.c + num(m.c),
  }), { kcal: 0, p: 0, f: 0, c: 0 });
  const allDone = plan.meals.every(m => m.done);
  return `
    <div class="adv-card" data-card="m" data-idx="${idx}">
      <div class="adv-card-h">🍽️ ${esc(plan.title || '今日の献立')}</div>
      ${plan.date && plan.date !== todayStr() ? `<div class="adv-card-note">${esc(fmtDateJa(plan.date))}に作った献立です</div>` : ''}
      ${plan.note ? `<div class="adv-card-note">${esc(plan.note)}</div>` : ''}
      <div class="adv-meals">
        ${plan.meals.map((m, i) => `
          <div class="adv-meal ${m.done ? 'done' : ''}">
            <div class="adv-meal-t">
              <b>${esc(m.slot)}｜${esc(m.name)}</b>
              <span>${Math.round(num(m.kcal))}kcal ・ P${Math.round(num(m.p))} F${Math.round(num(m.f))} C${Math.round(num(m.c))}</span>
              ${m.items && m.items.length ? `<small>${esc(m.items.map(x => `${x.name}${x.amount ? ' ' + x.amount : ''}`).join('、'))}</small>` : ''}
            </div>
            ${m.done
              ? '<span class="adv-meal-done">記録済み</span>'
              : `<button class="btn primary small" data-act="m-eat" data-i="${i}">食べた</button>`}
          </div>`).join('')}
      </div>
      <div class="adv-card-note">合計 ${Math.round(sum.kcal)}kcal ・ P${Math.round(sum.p)} F${Math.round(sum.f)} C${Math.round(sum.c)}</div>
      ${allDone ? '' : `
      <div class="adv-card-btns">
        <button class="btn ghost small" data-act="m-all">まとめて全部記録</button>
      </div>`}
    </div>`;
}

/* ---------- 表示 ---------- */

/* 軽いマークダウン整形（**太字** と ・箇条書き） */
function advFmt(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^[-*]\s+/gm, '・');
}

const ADV_CHIPS = [
  '今の調子どう？',
  '体脂肪ちゃんと落ちてる？',
  '次のトレ何やるべき？',
  'タンパク質足りてる？',
  '停滞してる気がする',
  '弱い部位どこ？',
];

/* ストリーミング中の返答を、いま表示されているログに描く */
function advPaintLive(text) {
  const log = document.getElementById('adv-log');
  if (!log) return;
  let live = document.getElementById('adv-live');
  if (!live) {
    const typing = log.querySelector('.chat-msg.typing');
    if (typing) { typing.classList.remove('typing'); typing.id = 'adv-live'; live = typing; }
    else { live = document.createElement('div'); live.className = 'chat-msg ai'; live.id = 'adv-live'; log.appendChild(live); }
  }
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  live.innerHTML = advFmt(text);
  if (nearBottom) log.scrollTop = log.scrollHeight;
}

function advHistory() {
  if (!Array.isArray(state.advisorChat)) state.advisorChat = [];
  return state.advisorChat;
}

/* 提案カードを、API送信用のテキストに変換する（会話の流れを保つため） */
function advHistForApi() {
  return advHistory().map(m => {
    if (m.kind === 'workout' && m.menu) {
      const list = (m.menu.items || []).map(it => {
        const ex = exById(it.exId);
        return ex ? `${ex.name} ${fmtSets(it.sets, ex.unit, ex)}` : null;
      }).filter(Boolean).join(' / ');
      return { role: 'model', text: `（トレーニングメニューを提案した: ${m.menu.title || ''} ${list}）` };
    }
    if (m.kind === 'meal' && m.plan) {
      const list = (m.plan.meals || []).map(x => `${x.slot}:${x.name}(${Math.round(num(x.kcal))}kcal P${Math.round(num(x.p))})`).join(' / ');
      return { role: 'model', text: `（献立を提案した: ${m.plan.title || ''} ${list}）` };
    }
    return { role: m.role, text: m.text };
  }).filter(m => m.text);
}

/* 提案カードのボタンを配線 */
function wireAdvCards(log, draw) {
  const hist = advHistory();

  log.querySelectorAll('[data-act="w-apply"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const menu = hist[+btn.closest('.adv-card').dataset.idx]?.menu;
      if (!menu) return;
      const date = todayStr();
      const w = ensureWorkout(date);
      const already = new Set(w.entries.map(e => e.exId));
      let added = 0;
      for (const it of menu.items) {
        if (already.has(it.exId)) continue;
        w.entries.push({
          id: uid(), exId: it.exId,
          sets: it.sets.map(s => ({ w: s.w != null ? num(s.w) : null, r: s.r != null ? num(s.r) : null, done: false })),
        });
        added++;
      }
      saveState();
      if (!added) { toast('すべて追加済みの種目でした'); return; }
      App.wDate = date;
      toast(`今日の筋トレに登録しました（${added}種目）🔥`);
      switchTab('workout');
    });
  });

  log.querySelectorAll('[data-act="w-routine"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const menu = hist[+btn.closest('.adv-card').dataset.idx]?.menu;
      if (!menu) return;
      advSaveMenuAsRoutine(menu);
    });
  });

  log.querySelectorAll('[data-act="m-eat"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const entry = hist[+btn.closest('.adv-card').dataset.idx];
      const m = entry && entry.plan && entry.plan.meals[+btn.dataset.i];
      if (!m || m.done) return;
      advRecordMeal(m);
      saveState();
      toast(`🍽️「${m.name}」を記録しました`);
      draw(false);
    });
  });

  log.querySelectorAll('[data-act="m-all"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const entry = hist[+btn.closest('.adv-card').dataset.idx];
      const plan = entry && entry.plan;
      if (!plan) return;
      const todo = plan.meals.filter(m => !m.done);
      if (!todo.length) return;
      if (!(await confirmDlg(`${todo.length}食ぶんをまとめて今日の食事に記録しますか？`, '記録する'))) return;
      for (const m of todo) advRecordMeal(m);
      saveState();
      toast(`🍽️ ${todo.length}食を記録しました`);
      draw(false);
    });
  });
}

/* 献立の1食を食事記録に追加 */
function advRecordMeal(m) {
  const d = todayStr();
  if (!state.meals[d]) state.meals[d] = [];
  state.meals[d].push({
    id: uid(), time: nowTimeStr(), name: m.name,
    kcal: num(m.kcal), p: num(m.p), f: num(m.f), c: num(m.c),
    photo: null, src: 'advisor', items: m.items || [],
  });
  m.done = true;
}

/* メニューをルーティーンとして保存 */
function advSaveMenuAsRoutine(menu) {
  const items = menu.items.map(it => ({ exId: it.exId, sets: it.sets.map(s => ({ w: s.w ?? null, r: s.r ?? null })) }));
  const body = sheet('⭐ ルーティーンに保存', `
    ${state.routines.length ? `
    <div class="qf-label">既存のルーティーンに上書き</div>
    <div class="chip-row">
      ${state.routines.map(r => `<button class="chip" data-ow="${r.id}">⭐ ${esc(r.name)}</button>`).join('')}
    </div>
    <div class="qf-label" style="margin-top:12px">または新しく保存</div>` : ''}
    <label class="f-label">ルーティーン名
      <input type="text" class="input" id="ar-name" value="${esc(menu.title || '')}" placeholder="例: 胸の日A">
    </label>
    <div class="an-note">${menu.items.length}種目（セット・重量ごと）をテンプレとして保存します。</div>
    <div class="btn-row">
      <button class="btn ghost" id="ar-cancel">キャンセル</button>
      <button class="btn primary" id="ar-save">保存する</button>
    </div>`);
  body.querySelectorAll('[data-ow]').forEach(chip => {
    chip.addEventListener('click', async () => {
      const rt = state.routines.find(r => r.id === chip.dataset.ow);
      if (!rt) return;
      if (await confirmDlg(`「${rt.name}」をこのメニュー（${items.length}種目）で上書きしますか？`, '上書きする')) {
        rt.items = items;
        saveState();
        closeSheet();
        toast(`⭐「${rt.name}」を更新しました`);
      }
    });
  });
  body.querySelector('#ar-cancel').addEventListener('click', closeSheet);
  body.querySelector('#ar-save').addEventListener('click', () => {
    const name = body.querySelector('#ar-name').value.trim();
    if (!name) { toast('名前を入力してください'); return; }
    state.routines.push({ id: uid(), name, items });
    saveState();
    closeSheet();
    toast(`⭐「${name}」を保存しました`);
  });
}

function renderAdvisor(el) {
  const hist = advHistory();
  const hasKey = !!(state.settings.apiKey || '').trim();
  el.innerHTML = `
    <header class="screen-head">
      <h1 class="screen-title">AIアドバイザー</h1>
    </header>
    <div class="adv-sub">筋トレ・食事・InBodyの記録を全部見たうえで答えます</div>
    ${!hasKey ? `
      <section class="card">
        <div class="sug-body">AIを使うにはGemini APIキーの設定が必要です。無料で取得できます。</div>
        <button class="btn primary big" id="adv-go-settings">設定を開く</button>
      </section>` : `
      <div class="adv-wrap">
        <div class="adv-log" id="adv-log"></div>
        <div class="adv-actions">
          <button class="btn ghost small" id="adv-gen-w">🏋️ メニューを作る</button>
          <button class="btn ghost small" id="adv-gen-m">🍽️ 献立を作る</button>
        </div>
        <div class="chip-row adv-chips" id="adv-chips">
          ${ADV_CHIPS.map(c => `<button class="chip" data-q="${esc(c)}">${esc(c)}</button>`).join('')}
        </div>
        <div class="chat-input-row">
          <input type="text" class="input" id="adv-in" placeholder="相談を入力…" autocomplete="off" enterkeyhint="send">
          <button class="btn primary" id="adv-send">送信</button>
        </div>
        <div class="adv-foot">
          <button class="btn ghost small" id="adv-reset">会話をリセット</button>
          <button class="btn ghost small" id="adv-data">AIが見ている記録</button>
        </div>
      </div>`}
  `;

  if (!hasKey) {
    el.querySelector('#adv-go-settings').addEventListener('click', () => switchTab('settings'));
    return;
  }

  const log = el.querySelector('#adv-log');
  const inp = el.querySelector('#adv-in');
  const sendBtn = el.querySelector('#adv-send');

  const draw = (scroll = true) => {
    if (!hist.length && !Advisor.busy) {
      log.innerHTML = `
        <div class="adv-empty">
          <div class="adv-empty-ic">💬</div>
          <p>記録をもとに相談できます。<br>下のボタンか、自由入力でどうぞ。</p>
        </div>`;
      return;
    }
    log.innerHTML = hist.map((m, i) => {
      if (m.kind === 'workout' && m.menu) return advWorkoutCardHtml(m.menu, i);
      if (m.kind === 'meal' && m.plan) return advMealCardHtml(m.plan, i);
      return `<div class="chat-msg ${m.role === 'model' ? 'ai' : 'user'}">${advFmt(m.text)}</div>`;
    }).join('') + (Advisor.busy
      ? (Advisor.streamText
        ? `<div class="chat-msg ai" id="adv-live">${advFmt(Advisor.streamText)}</div>`
        : `<div class="chat-msg ai typing">${esc(Advisor.busyLabel || '考え中…')}</div>`)
      : '');
    wireAdvCards(log, draw);
    if (scroll) log.scrollTop = log.scrollHeight;
  };

  const ask = async (q) => {
    if (Advisor.busy) return;
    const text = (q || '').trim();
    if (!text) return;
    hist.push({ role: 'user', text });
    Advisor.busy = true;
    inp.value = ''; Advisor.draft = '';
    sendBtn.disabled = true;
    genW.disabled = true; genM.disabled = true;
    draw();
    Advisor.streamText = '';
    try {
      // 送信のたびに最新の記録でコンテキストを作り直す
      const payload = [{ role: 'user', text: advisorSystemPrompt() }].concat(advHistForApi());
      // できた端から表示する（全部書き終わるのを待たない）
      const a = await geminiChatStream(payload, (full) => { Advisor.streamText = full; advPaintLive(full); });
      hist.push({ role: 'model', text: a.trim() });
      // 会話が長くなりすぎないよう直近30通に保つ
      if (hist.length > 30) hist.splice(0, hist.length - 30);
      saveState();
    } catch (e) {
      if (e.partial && e.partial.trim()) {
        // 途中まで届いた分は残す
        hist.push({ role: 'model', text: e.partial.trim() + '\n\n（通信が途中で切れました。続きはもう一度聞いてください）' });
        saveState();
      } else {
        hist.pop();
        toast(e.message === 'NO_KEY' ? '設定でAPIキーを登録してください' : e.message);
      }
    }
    Advisor.busy = false;
    Advisor.streamText = '';
    sendBtn.disabled = false;
    genW.disabled = false; genM.disabled = false;
    // タブを行き来していたら古い画面を描いても見えないので、今の画面を描き直す
    if (document.getElementById('adv-log') === log) draw();
    else if (App.tab === 'advisor') renderCurrent();
    if (inp.isConnected) inp.focus();
  };

  const genW = el.querySelector('#adv-gen-w');
  const genM = el.querySelector('#adv-gen-m');

  /* 提案（トレーニングメニュー / 献立）を作る */
  const generate = async (type) => {
    if (Advisor.busy) return;
    const isW = type === 'workout';
    hist.push({ role: 'user', text: isW ? '🏋️ トレーニングメニューを作って' : '🍽️ 今日の献立を作って' });
    Advisor.busy = true;
    Advisor.busyLabel = isW ? '記録を見てメニューを組んでいます…' : '残りカロリーを見て献立を考えています…';
    genW.disabled = true; genM.disabled = true; sendBtn.disabled = true;
    draw();
    try {
      if (isW) {
        const menu = await aiWorkoutMenu(buildAdvisorMenuPrompt());
        menu.items = (menu.items || []).filter(it => exById(it.exId) && Array.isArray(it.sets) && it.sets.length);
        if (!menu.items.length) throw new Error('使える種目でメニューを作れませんでした。希望を変えてもう一度試してください。');
        hist.push({ role: 'model', kind: 'workout', menu });
      } else {
        const plan = await aiMealPlan(buildAdvisorMealPrompt());
        plan.date = todayStr();
        plan.meals.forEach(m => { m.done = false; });
        hist.push({ role: 'model', kind: 'meal', plan });
      }
      if (hist.length > 30) hist.splice(0, hist.length - 30);
      saveState();
    } catch (e) {
      hist.pop();
      toast(e.message === 'NO_KEY' ? '設定でAPIキーを登録してください' : e.message);
    }
    Advisor.busy = false;
    Advisor.busyLabel = '';
    genW.disabled = false; genM.disabled = false; sendBtn.disabled = false;
    if (document.getElementById('adv-log') === log) draw();
    else if (App.tab === 'advisor') renderCurrent();
  };

  genW.addEventListener('click', () => generate('workout'));
  genM.addEventListener('click', () => generate('meal'));

  draw();
  inp.value = Advisor.draft || '';
  inp.addEventListener('input', () => { Advisor.draft = inp.value; });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ask(inp.value); } });
  sendBtn.addEventListener('click', () => ask(inp.value));
  el.querySelectorAll('#adv-chips .chip').forEach(c => {
    c.addEventListener('click', () => ask(c.dataset.q));
  });

  el.querySelector('#adv-reset').addEventListener('click', async () => {
    if (!hist.length) return;
    if (!(await confirmDlg('この会話を消してやり直しますか？', 'リセットする'))) return;
    state.advisorChat = [];
    saveState();
    renderCurrent();
  });

  el.querySelector('#adv-data').addEventListener('click', () => {
    sheet('AIが見ている記録', `<pre class="adv-dump">${esc(buildAdvisorContext())}</pre>`);
  });
}
