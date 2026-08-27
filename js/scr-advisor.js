/* 筋メシ - AIアドバイザー（記録を全部見て相談できるチャット） */
'use strict';

const Advisor = { busy: false, draft: '' };

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

function advHistory() {
  if (!Array.isArray(state.advisorChat)) state.advisorChat = [];
  return state.advisorChat;
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
    log.innerHTML = hist.map(m =>
      `<div class="chat-msg ${m.role === 'model' ? 'ai' : 'user'}">${advFmt(m.text)}</div>`
    ).join('') + (Advisor.busy ? '<div class="chat-msg ai typing">考え中…</div>' : '');
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
    draw();
    try {
      // 送信のたびに最新の記録でコンテキストを作り直す
      const payload = [{ role: 'user', text: advisorSystemPrompt() }].concat(hist);
      const a = await geminiChat(payload);
      hist.push({ role: 'model', text: a.trim() });
      // 会話が長くなりすぎないよう直近30通に保つ
      if (hist.length > 30) hist.splice(0, hist.length - 30);
      saveState();
    } catch (e) {
      hist.pop();
      toast(e.message === 'NO_KEY' ? '設定でAPIキーを登録してください' : e.message);
    }
    Advisor.busy = false;
    sendBtn.disabled = false;
    draw();
    inp.focus();
  };

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
