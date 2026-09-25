/* Gemini通信の粘り強さ：503リトライ・モデル自動切替・キー不正は即通知・thinking非対応の自動回避・接続テストの自動修復 */
const H = require('./test-helpers.cjs');

(async () => {
const PORT = 4326;
const server = await H.startServer(PORT);
const URL = `http://localhost:${PORT}/index.html`;
const { check, finish } = H.makeChecker();
const food = H.ensureFoodJpg();
const { freshPage, close } = await H.launch();

/* 写真を撮って、裏の解析が終わる（pendingが消える or 解析中が終わる）まで待つ */
async function snapAndSettle(page, timeout = 90000) {
  await page.click('.tabbar button[data-tab="meals"]');
  await page.click('#m-photo');
  await page.setInputFiles('#photo-input', food);
  await page.waitForFunction(() => {
    const d = new Date(); const p = x => String(x).padStart(2, '0');
    const k = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const m = (JSON.parse(localStorage.getItem('kinmeshi_v1')).meals[k] || [])[0];
    return m && !document.querySelector('.meal-wrap.analyzing');
  }, null, { timeout });
  const st = await H.readState(page);
  return (st.meals[H.dayKey()] || [])[0];
}

/* ========== 1. 503が続いても自動リトライで成功 ========== */
{
  const page = await freshPage();
  const calls = [];
  await page.route(H.GEN, async route => {
    calls.push(route.request().url());
    await route.fulfill(calls.length < 3 ? H.aiErr(503, 'The model is overloaded.') : H.aiOk(JSON.stringify(H.MEAL)));
  });
  await H.seed(page);
  await page.goto(URL, { waitUntil: 'networkidle' });
  const t0 = Date.now();
  const m = await snapAndSettle(page);
  const took = Date.now() - t0;
  check(calls.length === 3, `503が2回続いても自動リトライして成功（通信${calls.length}回）`);
  check(m && m.name === '鶏胸肉と玄米' && m.kcal === 680 && !m.pending, 'リトライ後に数値が入る');
  check(took < 15000, `全体の時間が現実的（${(took / 1000).toFixed(1)}秒）`);
  check(calls.every(u => u.includes('gemini-3.5-flash:')), '混雑リトライ中は同じモデルを使う');
}

/* ========== 2. 使えないモデル（404）は自動で乗り換えて記憶 ========== */
{
  const page = await freshPage();
  const used = [];
  await page.route(H.GEN, async route => {
    const mdl = (route.request().url().match(/models\/([^:]+):/) || [])[1];
    used.push(mdl);
    await route.fulfill(mdl === 'gemini-9.9-dead' ? H.aiErr(404, 'model not found') : H.aiOk(JSON.stringify(H.MEAL)));
  });
  await H.seed(page, { settings: { model: 'gemini-9.9-dead' } });
  await page.goto(URL, { waitUntil: 'networkidle' });
  const m = await snapAndSettle(page);
  check(used[0] === 'gemini-9.9-dead' && used[1] && used[1] !== 'gemini-9.9-dead', `404なら次のモデルへ（${used[0]} → ${used[1]}）`);
  check(m && m.kcal === 680, '乗り換え後に解析できる');
  const st = await H.readState(page);
  check(st.settings.model === used[1], `通ったモデルを記憶（${st.settings.model}）`);
}

/* ========== 3. キーが不正（400）ならリトライせず即通知・写真は残る ========== */
{
  const page = await freshPage();
  let n = 0;
  await page.route(H.GEN, async route => { n++; await route.fulfill(H.aiErr(400, 'API key not valid. Please pass a valid API key.')); });
  await H.seed(page);
  await page.goto(URL, { waitUntil: 'networkidle' });
  const m = await snapAndSettle(page, 20000);
  check(n === 1, `キー不正ならリトライしない（通信${n}回）`);
  check(m && m.pending && !!m.photo, '失敗しても写真つきの記録は残る');
  const toast = await page.textContent('#toast');
  check(/APIキー/.test(toast), `キーの問題だと分かる通知（${toast.slice(0, 40)}）`);
}

/* ========== 4. thinkingLevel非対応のモデルでも自動で下げて通る ========== */
{
  const page = await freshPage();
  const levels = [];
  await page.route(H.GEN, async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    const lv = body.generationConfig && body.generationConfig.thinkingConfig && body.generationConfig.thinkingConfig.thinkingLevel;
    levels.push(lv || null);
    // このモデルは thinkingLevel を一切受け付けない想定
    if (lv) return route.fulfill(H.aiErr(400, `Invalid value at 'generation_config.thinking_config.thinking_level': "${lv}" is not supported for this model.`));
    await route.fulfill(H.aiOk(JSON.stringify(H.MEAL)));
  });
  await H.seed(page);
  await page.goto(URL, { waitUntil: 'networkidle' });
  const m = await snapAndSettle(page);
  check(levels[0] === 'low' && levels[levels.length - 1] === null, `弾かれたら指定なしまで下げる（${levels.map(x => x || 'なし').join(' → ')}）`);
  check(m && m.kcal === 680, 'thinking非対応でも解析できる');
  // 2回目は最初から通る設定で送る（同じ400を繰り返さない）
  levels.length = 0;
  await page.click('#m-photo');
  await page.setInputFiles('#photo-input', food);
  await page.waitForFunction(() => document.querySelectorAll('.meal-card').length === 2 && !document.querySelector('.meal-wrap.analyzing'), null, { timeout: 20000 });
  check(levels.length === 1 && levels[0] === null, `弾かれた設定は覚えて次から送らない（${levels.length}回）`);
}

/* ========== 5. 設定の接続テストが実際に生成まで試して自動修復 ========== */
{
  const page = await freshPage();
  await page.route('**generativelanguage.googleapis.com/v1beta/models?*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ models: [
      { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
    ] }) }));
  await page.route(H.GEN, route => route.fulfill(H.aiOk('OK')));
  await H.seed(page, { settings: { model: 'gemini-9.9-dead' } });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.click('.tabbar button[data-tab="settings"]');
  await page.click('#st-test');
  await page.waitForFunction(() => /接続OK|❌/.test(document.querySelector('#st-test-out').textContent), null, { timeout: 20000 });
  const out = await page.textContent('#st-test-out');
  check(/✅ 接続OK/.test(out) && /自動で切り替え/.test(out), `使えないモデルを自動で直す（${out.slice(0, 50)}）`);
  const st = await H.readState(page);
  check(st.settings.model === 'gemini-3.5-flash', `使えるモデルが保存される（${st.settings.model}）`);
}

await close();
server.close();
finish();
})();
