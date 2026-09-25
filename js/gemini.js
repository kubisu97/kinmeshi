/* 筋メシ - Gemini API 連携（無料APIキーで動作） */
'use strict';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
/* 優先順。上から順に試す（403/404/混雑なら次へ自動フォールバック） */
const GEMINI_FALLBACK_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.1-flash-lite',
];

/* 通信のねばり強さ（無料枠は混雑時に503を返すので、待って投げ直せばだいたい通る） */
const GEMINI_ATTEMPT_MS = 25000;  // 1回あたりの待ち時間
const GEMINI_TRIES = 3;           // 同じモデルでの試行回数
const GEMINI_BUDGET_MS = 75000;   // 全体の打ち切り時間（無限クルクル防止）
const GEMINI_MAX_MODELS = 3;      // 乗り換えるモデル数の上限

function geminiKey() { return (state.settings.apiKey || '').trim(); }
function geminiModel() { return (state.settings.model || GEMINI_FALLBACK_MODELS[0]).trim(); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* 実際に試すモデルの順番（今の設定を先頭に、残りを候補順で） */
function geminiModelChain() {
  const cur = geminiModel();
  return [cur, ...GEMINI_FALLBACK_MODELS.filter(m => m !== cur)].slice(0, GEMINI_MAX_MODELS);
}

function geminiErrorMessage(status, body) {
  const apiMsg = body && body.error && body.error.message ? body.error.message : '';
  if (status === 400 && /API key/i.test(apiMsg)) return 'APIキーが正しくありません。設定画面で確認してください。';
  if (status === 400) return 'リクエストエラー: ' + apiMsg;
  if (status === 401 || status === 403) return 'APIキーが無効か、権限がありません。設定画面で「接続テスト」を押してください。';
  if (status === 404) return 'モデルが見つかりません。設定画面で「接続テスト」を押すと自動で直せます。';
  if (status === 429) return '無料枠の上限に達しました。少し待つか、明日また試してください。';
  if (status === 503) return 'Googleのサーバーが混雑しています。少し待ってからもう一度試してください。';
  if (status >= 500) return 'Google側で一時的なエラーが発生しています。少し待って再試行してください。';
  return `エラー(${status}): ${apiMsg || '不明なエラー'}`;
}

/* status付きのエラーを投げる（リトライ判定に使う） */
function geminiError(status, body) {
  const e = new Error(geminiErrorMessage(status, body));
  e.status = status;
  e.apiMessage = body && body.error && body.error.message ? body.error.message : '';
  // 待てば直る可能性があるもの
  e.retryable = status === 429 || status === 503 || (status >= 500 && status < 600);
  // 別のモデルなら通る可能性があるもの（混雑・権限なし・存在しない）
  e.tryOtherModel = e.retryable || status === 403 || status === 404;
  return e;
}

async function geminiFetchOnce(path, options, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${GEMINI_BASE}${path}`, { ...options, signal: ctrl.signal });
    let body = null;
    try { body = await res.json(); } catch (e) { /* noop */ }
    if (!res.ok) throw geminiError(res.status, body);
    return body;
  } catch (e) {
    if (e.name === 'AbortError') {
      const t = new Error('通信がタイムアウトしました。もう一度試してください。');
      t.retryable = true; t.tryOtherModel = true;
      throw t;
    }
    if (e.status === undefined && e.retryable === undefined && /fetch|network|Failed/i.test(e.message)) {
      const n = new Error('ネットワークに繋がりませんでした。電波を確認してください。');
      n.retryable = true; n.tryOtherModel = false; n.network = true;
      throw n;
    }
    throw e;
  } finally { clearTimeout(timer); }
}

/* 同じモデルで指数バックオフしながら粘る。attempt(残り時間ms) を最大 GEMINI_TRIES 回 */
async function geminiRetry(attempt, deadline) {
  let last;
  for (let i = 0; i < GEMINI_TRIES; i++) {
    if (Date.now() > deadline) break;
    try {
      return await attempt(Math.max(1000, deadline - Date.now()));
    } catch (e) {
      last = e;
      if (!e.retryable || i === GEMINI_TRIES - 1) throw e;
      // 0.8秒 → 2秒 （±30%のゆらぎを入れて同時再送を散らす）
      const wait = [800, 2000][i] * (0.7 + Math.random() * 0.6);
      if (Date.now() + wait > deadline) throw e;
      await sleep(wait);
    }
  }
  throw last || new Error('通信できませんでした。もう一度試してください。');
}

async function geminiFetchRetry(path, options, deadline, timeoutMs = GEMINI_ATTEMPT_MS) {
  return geminiRetry((left) => geminiFetchOnce(path, options, Math.min(timeoutMs, left)), deadline);
}

/* モデルを乗り換えながら実行する。通ったモデルは設定に記憶する */
async function geminiWithFallback(run) {
  const deadline = Date.now() + GEMINI_BUDGET_MS;
  const chain = geminiModelChain();
  let last;
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    if (Date.now() > deadline) break;
    try {
      const out = await run(model, deadline);
      if (model !== geminiModel()) {
        state.settings.model = model;
        saveState();
        if (typeof toast === 'function') toast(`モデルを ${model} に切り替えました`);
      }
      return out;
    } catch (e) {
      last = e;
      if (!e.tryOtherModel || i === chain.length - 1) throw e;
    }
  }
  throw last || new Error('通信できませんでした。もう一度試してください。');
}

/* ---------- 速さの設定 ----------
   Gemini 3 は temperature を下げるとループ（延々と生成し続ける）を起こすことがあるので触らない。
   「考える深さ」は用途で分ける。写真の読み取り・チャットは最速、メニューや献立は少しだけ考える。 */
const THINK = { fast: 'minimal', light: 'low' };

/* thinkingLevel に対応していないモデルもあるので、弾かれたら段階的に下げる */
const _thinkRejected = new Map(); // model -> Set(level)
function thinkingLadder(model, level) {
  const out = [];
  if (level) out.push(level);
  if (level === 'minimal') out.push('low');
  out.push(null); // 指定なし（モデルの既定）
  const bad = _thinkRejected.get(model);
  return [...new Set(out)].filter(lv => !(bad && bad.has(lv)));
}
function isThinkingConfigError(e) {
  return !!e && e.status === 400 && /thinking/i.test(e.apiMessage || e.message || '');
}

function geminiGenConfig(json, thinking) {
  const cfg = {};
  if (json) cfg.responseMimeType = 'application/json';
  if (thinking) cfg.thinkingConfig = { thinkingLevel: thinking };
  return cfg;
}

/* 返答から本文だけ取り出す（思考パートは除く） */
function geminiTextOf(data) {
  const cand = data && data.candidates && data.candidates[0];
  const parts = cand && cand.content && cand.content.parts;
  return Array.isArray(parts) ? parts.filter(p => !p.thought).map(p => p.text || '').join('') : '';
}
function geminiEmptyError() {
  return new Error('AIから回答が得られませんでした。もう一度試してください。');
}

/* 1モデルぶんの実行。thinkingLevel が弾かれたら下げて同じモデルで再挑戦 */
async function geminiRunModel(model, deadline, contents, opts, send) {
  let last;
  for (const lv of thinkingLadder(model, opts.thinking)) {
    const body = { contents, generationConfig: geminiGenConfig(opts.json, lv) };
    try {
      return await send(model, body, deadline);
    } catch (e) {
      last = e;
      if (!isThinkingConfigError(e) || lv === null) throw e;
      if (!_thinkRejected.has(model)) _thinkRejected.set(model, new Set());
      _thinkRejected.get(model).add(lv);
    }
  }
  throw last || geminiEmptyError();
}

async function geminiPostGenerate(model, body, deadline) {
  const data = await geminiFetchRetry(
    `/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey() },
      body: JSON.stringify(body),
    },
    deadline
  );
  const text = geminiTextOf(data);
  if (!text) throw geminiEmptyError();
  return text;
}

async function geminiGenerate(parts, jsonMode, thinking = THINK.fast) {
  if (!geminiKey()) throw new Error('NO_KEY');
  const contents = [{ role: 'user', parts }];
  return await geminiWithFallback((model, deadline) =>
    geminiRunModel(model, deadline, contents, { json: jsonMode, thinking }, geminiPostGenerate));
}

/* ---------- ストリーミング（できた端から表示） ---------- */

/* SSE（data: {...} の塊）を少しずつ受け取ってJSONにする */
function geminiSseParser(onJson) {
  let buf = '';
  const flush = (block) => {
    const data = block.split('\n')
      .filter(l => l.startsWith('data:'))
      .map(l => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data || data === '[DONE]') return;
    let obj;
    try { obj = JSON.parse(data); } catch (e) { return; }
    onJson(obj);
  };
  return {
    push(chunk) {
      buf = (buf + chunk).replace(/\r\n/g, '\n');
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) { flush(buf.slice(0, i)); buf = buf.slice(i + 2); }
    },
    end() { if (buf.trim()) flush(buf); buf = ''; },
  };
}

/* 1回ぶんのストリーム。まだ1文字も出ていない失敗はリトライ可、途中で切れたら出た分を渡す */
async function geminiStreamOnce(model, body, timeoutMs, onText) {
  const ctrl = new AbortController();
  let timer = setTimeout(() => ctrl.abort(), timeoutMs);
  // 文字が届いている間は待つ。GEMINI_ATTEMPT_MS 何も来なければ打ち切り
  const bump = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), GEMINI_ATTEMPT_MS); };
  let text = '';
  let streamErr = null;
  try {
    const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey() },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let b = null;
      try { b = await res.json(); } catch (e) { /* noop */ }
      throw geminiError(res.status, b);
    }
    bump();
    const parser = geminiSseParser((obj) => {
      if (obj && obj.error) { streamErr = geminiError(obj.error.code || 500, obj); return; }
      const piece = geminiTextOf(obj);
      if (piece) { text += piece; onText(text); }
    });
    let raw = '';
    const feed = (chunk) => { if (raw.length < 200000) raw += chunk; parser.push(chunk); };
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bump();
        feed(dec.decode(value, { stream: true }));
        if (streamErr) break;
      }
      feed(dec.decode());
    } else {
      feed(await res.text());
    }
    parser.end();
    if (streamErr) throw streamErr;
    if (!text) {
      // 念のため：SSEではなく普通のJSON（配列）で返ってきた場合も読む
      try {
        const j = JSON.parse(raw.trim());
        const t = (Array.isArray(j) ? j : [j]).map(geminiTextOf).join('');
        if (t) { text = t; onText(text); }
      } catch (e) { /* noop */ }
    }
    if (!text) throw geminiEmptyError();
    return text;
  } catch (e) {
    let err = e;
    if (e.name === 'AbortError') {
      err = new Error('通信がタイムアウトしました。もう一度試してください。');
      err.retryable = true; err.tryOtherModel = true;
    } else if (e.status === undefined && e.retryable === undefined && /fetch|network|Failed|load/i.test(e.message || '')) {
      err = new Error('ネットワークに繋がりませんでした。電波を確認してください。');
      err.retryable = true; err.tryOtherModel = false; err.network = true;
    }
    if (text) {
      // もう表示し始めているので、やり直すと二重になる。出た分を残して終わる
      err.partial = text;
      err.retryable = false; err.tryOtherModel = false;
    }
    throw err;
  } finally { clearTimeout(timer); }
}

/* 会話をストリーミングで返す。onText(ここまでの全文) が何度も呼ばれる */
async function geminiChatStream(history, onText, thinking = THINK.fast) {
  if (!geminiKey()) throw new Error('NO_KEY');
  const contents = history.map(m => ({ role: m.role, parts: [{ text: m.text }] }));
  return await geminiWithFallback((model, deadline) =>
    geminiRunModel(model, deadline, contents, { thinking }, (mdl, body, dl) =>
      geminiRetry((left) => geminiStreamOnce(mdl, body, Math.min(GEMINI_ATTEMPT_MS, left), onText), dl)));
}

function parseJsonLoose(text) {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

/* ---------- 食事写真の解析 ---------- */
const MEAL_PROMPT = `あなたは経験豊富な管理栄養士です。この食事の写真を分析してください。
写真に写っている料理・食品を特定し、見た目の量から栄養価を推定してください。
日本の一般的な盛り付け量を基準にしてください。

必ず次のJSON形式だけで回答してください（説明文は不要）:
{
  "dish": "食事全体の短い名前（例: 鶏の唐揚げ定食）",
  "items": [
    {"name": "料理名", "amount": "量のめやす（例: 茶碗1杯150g）", "kcal": 数値, "p": タンパク質g数値, "f": 脂質g数値, "c": 炭水化物g数値}
  ],
  "total": {"kcal": 数値, "p": 数値, "f": 数値, "c": 数値},
  "confidence": 0から1の数値,
  "note": "推定の注意点があれば短く（例: ドレッシング込みで計算）"
}
食べ物が写っていない場合は {"dish": null} とだけ回答してください。`;

async function analyzeMealPhoto(dataUrl) {
  const m = dataUrl.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/s);
  if (!m) throw new Error('画像の読み込みに失敗しました');
  const text = await geminiGenerate([
    { inlineData: { mimeType: m[1], data: m[2] } },
    { text: MEAL_PROMPT },
  ], true, THINK.light);
  const obj = parseJsonLoose(text);
  if (!obj || !obj.dish) throw new Error('食べ物を認識できませんでした。明るい場所で全体が写るように撮ってみてください。');
  const total = obj.total || {};
  const items = Array.isArray(obj.items) ? obj.items : [];
  const sum = (k) => items.reduce((a, i) => a + num(i[k]), 0);
  return {
    name: String(obj.dish),
    items,
    kcal: Math.round(num(total.kcal) || sum('kcal')),
    p: round1(num(total.p) || sum('p')),
    f: round1(num(total.f) || sum('f')),
    c: round1(num(total.c) || sum('c')),
    confidence: num(obj.confidence),
    note: obj.note || '',
  };
}

/* ---------- 食事テキストの解析（手動入力のAIアシスト） ---------- */
async function analyzeMealText(desc) {
  const prompt = `あなたは経験豊富な管理栄養士です。私が食べた食事は次の通りです:
「${desc}」

それぞれの栄養価を推定してください。量の記載がないものは日本の一般的な1人前で計算してください。
コンビニやチェーン店の商品名が書かれていれば、その商品の一般的な栄養成分で計算してください。

必ず次のJSON形式だけで回答してください（説明文は不要）:
{
  "dish": "食事全体の短い名前",
  "items": [
    {"name": "品名", "amount": "量のめやす", "kcal": 数値, "p": タンパク質g, "f": 脂質g, "c": 炭水化物g}
  ],
  "total": {"kcal": 数値, "p": 数値, "f": 数値, "c": 数値},
  "confidence": 0から1の数値,
  "note": "推定の注意点があれば短く"
}
食べ物が含まれない場合は {"dish": null} とだけ回答してください。`;
  const text = await geminiGenerate([{ text: prompt }], true, THINK.fast);
  const obj = parseJsonLoose(text);
  if (!obj || !obj.dish) throw new Error('食べ物として認識できませんでした。「カツ丼と味噌汁」のように書いてみてください。');
  const total = obj.total || {};
  const items = Array.isArray(obj.items) ? obj.items : [];
  const sum = (k) => items.reduce((a, i) => a + num(i[k]), 0);
  return {
    name: String(obj.dish),
    items,
    kcal: Math.round(num(total.kcal) || sum('kcal')),
    p: round1(num(total.p) || sum('p')),
    f: round1(num(total.f) || sum('f')),
    c: round1(num(total.c) || sum('c')),
    confidence: num(obj.confidence),
    note: obj.note || '',
  };
}

/* ---------- InBody結果用紙の読み取り ---------- */
const INBODY_PROMPT = `この画像は体成分分析（InBodyなど）の結果用紙、またはInBodyアプリの画面スクリーンショットです。次の項目を読み取ってください。
必ず次のJSON形式だけで回答してください（説明文は不要）:
{
  "date": "測定日をYYYY-MM-DD形式で。読み取れなければnull",
  "weight": 体重kgの数値またはnull,
  "bf": 体脂肪率%の数値またはnull,
  "muscle": 骨格筋量kgの数値またはnull,
  "bmr": 基礎代謝量kcalの数値またはnull,
  "seg": {"armR": 右腕筋肉量kg, "armL": 左腕筋肉量kg, "trunk": 体幹筋肉量kg, "legR": 右脚筋肉量kg, "legL": 左脚筋肉量kg}（部位別筋肉量が読み取れなければnull）,
  "score": InBody点数の数値またはnull
}
体成分の結果用紙でない場合は {"weight": null} とだけ回答してください。`;

async function analyzeInBodyPhoto(dataUrl) {
  const m = dataUrl.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/s);
  if (!m) throw new Error('画像の読み込みに失敗しました');
  const text = await geminiGenerate([
    { inlineData: { mimeType: m[1], data: m[2] } },
    { text: INBODY_PROMPT },
  ], true, THINK.light);
  const obj = parseJsonLoose(text);
  if (!obj || obj.weight == null) throw new Error('InBodyの結果用紙を認識できませんでした。用紙全体が明るく写るように撮ってみてください。');
  const seg = obj.seg && typeof obj.seg === 'object' ? {
    armR: obj.seg.armR != null ? round1(num(obj.seg.armR)) : null,
    armL: obj.seg.armL != null ? round1(num(obj.seg.armL)) : null,
    trunk: obj.seg.trunk != null ? round1(num(obj.seg.trunk)) : null,
    legR: obj.seg.legR != null ? round1(num(obj.seg.legR)) : null,
    legL: obj.seg.legL != null ? round1(num(obj.seg.legL)) : null,
  } : null;
  return {
    date: obj.date || todayStr(),
    weight: num(obj.weight) || null,
    bf: obj.bf != null ? round1(num(obj.bf)) : null,
    muscle: obj.muscle != null ? round1(num(obj.muscle)) : null,
    bmr: obj.bmr != null ? Math.round(num(obj.bmr)) : null,
    seg: seg && Object.values(seg).some(v => v != null) ? seg : null,
    score: obj.score != null ? Math.round(num(obj.score)) : null,
  };
}

/* ---------- AIコーチ（テキスト） ---------- */
function coachPromptText(summary) {
  return `あなたは優秀なパーソナルトレーナー兼管理栄養士です。以下は私のトレーニングと食事の記録です。

${summary}

この記録をもとに、次のトレーニングと食事について具体的なアドバイスを日本語でください。
・良い点をひとつ褒める
・改善点や次にやるべきことを2〜3個、具体的に（種目名・重量・食品名レベルで）
・全体で250文字以内、箇条書き中心で簡潔に

この後、私から追加の質問をすることがあります。質問には理由・根拠を添えて、日本語で簡潔（目安200文字以内）に答えてください。`;
}
async function aiCoachAdvice(summary) {
  return await geminiGenerate([{ text: coachPromptText(summary) }], false, THINK.light);
}

/* マルチターン会話（アドバイスへの追加質問） */
async function geminiChat(history, thinking = THINK.fast) {
  if (!geminiKey()) throw new Error('NO_KEY');
  const contents = history.map(m => ({ role: m.role, parts: [{ text: m.text }] }));
  return await geminiWithFallback((model, deadline) =>
    geminiRunModel(model, deadline, contents, { thinking }, geminiPostGenerate));
}

/* ---------- AIトレーニングメニュー生成 ---------- */
async function aiWorkoutMenu(prompt) {
  const text = await geminiGenerate([{ text: prompt }], true, THINK.light);
  const obj = parseJsonLoose(text);
  if (!obj || !Array.isArray(obj.items) || !obj.items.length) {
    throw new Error('メニューを作れませんでした。条件を変えてもう一度試してください。');
  }
  return obj;
}

/* ---------- AI献立プラン ---------- */
async function aiMealPlan(prompt) {
  const text = await geminiGenerate([{ text: prompt }], true, THINK.light);
  const obj = parseJsonLoose(text);
  const meals = Array.isArray(obj && obj.meals) ? obj.meals : [];
  if (!meals.length) throw new Error('献立を作れませんでした。条件を変えてもう一度試してください。');
  return {
    title: obj.title || '今日の献立',
    note: obj.note || '',
    meals: meals.map(m => ({
      slot: String(m.slot || '食事'),
      name: String(m.name || ''),
      kcal: Math.round(num(m.kcal)),
      p: round1(num(m.p)),
      f: round1(num(m.f)),
      c: round1(num(m.c)),
      items: Array.isArray(m.items) ? m.items : [],
    })).filter(m => m.name),
  };
}

/* ---------- AI週間レポート ---------- */
async function aiWeeklyReport(summary) {
  const prompt = `あなたは優秀なパーソナルトレーナー兼管理栄養士です。以下は私の1週間の記録です。

${summary}

この1週間の週間レポートを日本語で書いてください。構成:
🏆 今週のハイライト（1〜2行。数字で褒める）
🏋️ トレーニング評価（ボリューム・部位バランス・2〜3行）
🍽 食事評価（目標との差・PFCバランス・2〜3行）
🎯 来週の方針（具体的に3つまで。種目名・重量・食品名レベルで）

全体で400字以内。マークダウンの見出し記号は使わず、上の絵文字付き見出しをそのまま使うこと。`;
  return await geminiGenerate([{ text: prompt }], false, THINK.light);
}

/* ---------- モデル一覧（接続テスト） ---------- */
async function geminiListModels() {
  if (!geminiKey()) throw new Error('NO_KEY');
  const data = await geminiFetchRetry(`/models?pageSize=100`, {
    method: 'GET',
    headers: { 'x-goog-api-key': geminiKey() },
  }, Date.now() + 30000, 15000);
  const models = (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(n => /^gemini-/.test(n) && !/embedding|tts|live|image|audio|veo|omni/.test(n));
  return models.sort();
}
