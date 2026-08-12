/* 筋メシ - Gemini API 連携（無料APIキーで動作） */
'use strict';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_FALLBACK_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

function geminiKey() { return (state.settings.apiKey || '').trim(); }
function geminiModel() { return (state.settings.model || 'gemini-3.5-flash').trim(); }

function geminiErrorMessage(status, body) {
  const apiMsg = body && body.error && body.error.message ? body.error.message : '';
  if (status === 400 && /API key/i.test(apiMsg)) return 'APIキーが正しくありません。設定画面で確認してください。';
  if (status === 400) return 'リクエストエラー: ' + apiMsg;
  if (status === 401 || status === 403) return 'APIキーが無効か、権限がありません。設定画面で確認してください。';
  if (status === 404) return `モデル「${geminiModel()}」が見つかりません。設定画面で別のモデルを選んでください。`;
  if (status === 429) return '無料枠の上限に達しました。1〜2分待つか、明日また試してください。';
  if (status >= 500) return 'Google側で一時的なエラーが発生しています。少し待って再試行してください。';
  return `エラー(${status}): ${apiMsg || '不明なエラー'}`;
}

async function geminiFetch(path, options, timeoutMs = 60000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${GEMINI_BASE}${path}`, { ...options, signal: ctrl.signal });
    let body = null;
    try { body = await res.json(); } catch (e) { /* noop */ }
    if (!res.ok) throw new Error(geminiErrorMessage(res.status, body));
    return body;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('通信がタイムアウトしました。電波の良い場所で再試行してください。');
    throw e;
  } finally { clearTimeout(timer); }
}

async function geminiGenerate(parts, jsonMode) {
  if (!geminiKey()) throw new Error('NO_KEY');
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.3,
      ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
    },
  };
  const data = await geminiFetch(
    `/models/${encodeURIComponent(geminiModel())}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey() },
      body: JSON.stringify(body),
    }
  );
  const cand = data && data.candidates && data.candidates[0];
  const text = cand && cand.content && cand.content.parts
    ? cand.content.parts.map(p => p.text || '').join('')
    : '';
  if (!text) throw new Error('AIから回答が得られませんでした。もう一度試してください。');
  return text;
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
  ], true);
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
  const text = await geminiGenerate([{ text: prompt }], true);
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
  ], true);
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
async function aiCoachAdvice(summary) {
  const prompt = `あなたは優秀なパーソナルトレーナー兼管理栄養士です。以下は私のトレーニングと食事の記録です。

${summary}

この記録をもとに、次のトレーニングと食事について具体的なアドバイスを日本語でください。
・良い点をひとつ褒める
・改善点や次にやるべきことを2〜3個、具体的に（種目名・重量・食品名レベルで）
・全体で250文字以内、箇条書き中心で簡潔に`;
  return await geminiGenerate([{ text: prompt }], false);
}

/* ---------- AIトレーニングメニュー生成 ---------- */
async function aiWorkoutMenu(prompt) {
  const text = await geminiGenerate([{ text: prompt }], true);
  const obj = parseJsonLoose(text);
  if (!obj || !Array.isArray(obj.items) || !obj.items.length) {
    throw new Error('メニューを作れませんでした。条件を変えてもう一度試してください。');
  }
  return obj;
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
  return await geminiGenerate([{ text: prompt }], false);
}

/* ---------- モデル一覧（接続テスト） ---------- */
async function geminiListModels() {
  if (!geminiKey()) throw new Error('NO_KEY');
  const data = await geminiFetch(`/models?pageSize=100`, {
    method: 'GET',
    headers: { 'x-goog-api-key': geminiKey() },
  }, 20000);
  const models = (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(n => /^gemini-/.test(n) && !/embedding|tts|live|image|audio|veo|omni/.test(n));
  return models.sort();
}
