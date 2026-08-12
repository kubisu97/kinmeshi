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
