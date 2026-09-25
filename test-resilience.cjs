/* 503リトライ・モデル自動切替・写真を失わない記録の確認 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

(async () => {
const ROOT = process.cwd();
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(4326, r));

const fail = [], ok = [];
const check = (cond, label) => { (cond ? ok : fail).push(label); console.log(`${cond ? '✅' : '❌'} ${label}`); };

// テスト用の食事写真
require('child_process').execSync(`python3 -c "
from PIL import Image, ImageDraw
img = Image.new('RGB', (800, 600), (200, 160, 110))
d = ImageDraw.Draw(img)
d.ellipse([150, 100, 650, 500], fill=(240, 240, 235))
img.save('shots/food.jpg', quality=85)
"`);

const browser = await chromium.launch();
// シナリオごとに独立したコンテキスト（localStorageを持ち越さない）
const contexts = [];
const freshPage = async () => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  contexts.push(c);
  return await c.newPage();
};

const seed = (page, model) => page.addInitScript((mdl) => {
  localStorage.setItem('kinmeshi_v1', JSON.stringify({
    ver: 1,
    settings: { apiKey: 'K', model: mdl, targets: { kcal: 2200, p: 130, f: 60, c: 270 }, profile: { weight: 68, goal: 'cut' }, activity: 'mid', restSec: 90 },
    inbody: [], routines: [], mealFavs: [], progressPhotos: [], advisorChat: [], customExercises: [],
    workouts: {}, meals: {}, createdAt: new Date().toISOString(),
  }));
}, model);

const MEAL_JSON = JSON.stringify({ dish: '鶏胸肉と玄米', items: [{ name: '鶏胸肉', amount: '200g', kcal: 220, p: 46, f: 3, c: 0 }], total: { kcal: 680, p: 55, f: 12, c: 78 }, confidence: 0.9, note: '' });
const aiOk = (t) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] }) });
const err = (code, msg) => ({ status: code, contentType: 'application/json', body: JSON.stringify({ error: { code, message: msg } }) });

/* ========== 1. 503が続いてもリトライで成功する ========== */
{
  const page = await freshPage();
  let calls = [];
  await page.route('**generativelanguage.googleapis.com/**:generateContent', async route => {
    calls.push(route.request().url());
    // 最初の2回は503、3回目で成功（無料枠の混雑を再現）
    await route.fulfill(calls.length < 3 ? err(503, 'The model is overloaded.') : aiOk(MEAL_JSON));
  });
  await seed(page, 'gemini-3.5-flash');
  await page.goto('http://localhost:4326/index.html', { waitUntil: 'networkidle' });
  await page.click('.tabbar button[data-tab="meals"]');
  await page.click('#m-photo');
  await page.setInputFiles('#photo-input', 'shots/food.jpg');
  const t0 = Date.now();
  await page.waitForSelector('#an-save', { timeout: 20000 });
  const took = Date.now() - t0;
  check(calls.length === 3, `503が2回続いても自動リトライして成功する（通信${calls.length}回）`);
  check(await page.inputValue('#an-name') === '鶏胸肉と玄米', 'リトライ後にAI解析の結果が表示される');
  check(took < 15000, `待ち時間が現実的（${(took / 1000).toFixed(1)}秒）`);
  const sameModel = calls.every(u => u.includes('gemini-3.5-flash'));
  check(sameModel, '混雑リトライ中は同じモデルを使う');
  await page.close();
}

/* ========== 2. モデルが404ならほかのモデルへ自動で乗り換える ========== */
{
  const page = await freshPage();
  const used = [];
  await page.route('**generativelanguage.googleapis.com/**:generateContent', async route => {
    const u = route.request().url();
    const m = (u.match(/models\/([^:]+):/) || [])[1];
    used.push(m);
    await route.fulfill(m === 'gemini-9.9-dead' ? err(404, 'model not found') : aiOk(MEAL_JSON));
  });
  await seed(page, 'gemini-9.9-dead');
  await page.goto('http://localhost:4326/index.html', { waitUntil: 'networkidle' });
  await page.click('.tabbar button[data-tab="meals"]');
  await page.click('#m-photo');
  await page.setInputFiles('#photo-input', 'shots/food.jpg');
  await page.waitForSelector('#an-save', { timeout: 20000 });
  check(used.length >= 2 && used[0] === 'gemini-9.9-dead', '死んだモデルを最初に試す');
  check(used[1] && used[1] !== 'gemini-9.9-dead', `使えないモデルなら自動で次へ乗り換える（${used[1]}）`);
  check(await page.inputValue('#an-name') === '鶏胸肉と玄米', '乗り換え後にちゃんと解析できる');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('kinmeshi_v1')).settings.model);
  check(saved === used[1], `通ったモデルを設定に記憶する（${saved}）`);
  await page.close();
}

/* ========== 3. 全モデルが混雑していても、写真は絶対に残る ========== */
{
  const page = await freshPage();
  let n = 0;
  await page.route('**generativelanguage.googleapis.com/**:generateContent', async route => { n++; await route.fulfill(err(503, 'overloaded')); });
  await seed(page, 'gemini-3.5-flash');
  await page.goto('http://localhost:4326/index.html', { waitUntil: 'networkidle' });
  await page.click('.tabbar button[data-tab="meals"]');
  await page.click('#m-photo');
  await page.setInputFiles('#photo-input', 'shots/food.jpg');
  await page.waitForSelector('#an-later', { timeout: 90000 });
  check(await page.isVisible('.analyze-preview'), '【重要】AIが全部落ちても写真は画面に残っている');
  check(await page.isVisible('#an-name') && await page.isVisible('#an-kcal'), '【重要】その場で名前とカロリーを入力できる');
  check(await page.isVisible('#an-later'), '「写真だけ先に記録」ボタンが出る');
  check(await page.isVisible('#an-retryai'), '「もう一度AIに聞く」ボタンが出る');
  const msg = await page.textContent('.an-note.err');
  check(/混雑/.test(msg), `原因が分かる文言になっている（${msg.slice(0, 40)}）`);

  // 写真だけ先に記録
  await page.click('#an-later');
  await page.waitForTimeout(600);
  const meals = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('kinmeshi_v1'));
    const d = new Date(); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return s.meals[k] || [];
  });
  check(meals.length === 1, '【重要】写真だけでも記録が1件残る');
  check(meals[0].pending === true && !!meals[0].photo, '未解析フラグと写真IDが付く');
  check(await page.isVisible('.meal-wrap.pending'), '一覧で未解析として目立つ');
  check(await page.isVisible('.meal-reanalyze'), 'あとから解析するボタンが出る');

  // AIが復活したら再解析できる
  await page.unroute('**generativelanguage.googleapis.com/**:generateContent');
  await page.route('**generativelanguage.googleapis.com/**:generateContent', route => route.fulfill(aiOk(MEAL_JSON)));
  await page.click('.meal-reanalyze');
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('kinmeshi_v1'));
    const d = new Date(); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return s.meals[k][0];
  });
  check(after.name === '鶏胸肉と玄米' && after.kcal === 680, '【重要】あとから解析すると数値が埋まる');
  check(after.pending === false && after.src === 'ai', '解析済みに変わる');
  check(!await page.isVisible('.meal-wrap.pending'), '未解析の表示が消える');
  check(await page.$$eval('.meal-card', e => e.length) === 1, '記録が二重にならない');
  await page.close();
}

/* ========== 4. APIキーが無効なときは無駄に粘らない ========== */
{
  const page = await freshPage();
  let n = 0;
  await page.route('**generativelanguage.googleapis.com/**:generateContent', async route => { n++; await route.fulfill(err(400, 'API key not valid')); });
  await seed(page, 'gemini-3.5-flash');
  await page.goto('http://localhost:4326/index.html', { waitUntil: 'networkidle' });
  await page.click('.tabbar button[data-tab="meals"]');
  await page.click('#m-photo');
  await page.setInputFiles('#photo-input', 'shots/food.jpg');
  await page.waitForSelector('#an-later', { timeout: 20000 });
  check(n === 1, `キーが不正なときはリトライせず即座に知らせる（通信${n}回）`);
  check(/APIキー/.test(await page.textContent('.an-note.err')), 'キーの問題だと分かる文言');
  await page.close();
}

/* ========== 5. 設定の接続テストが実際に生成まで試して自動修復する ========== */
{
  const page = await freshPage();
  await page.route('**generativelanguage.googleapis.com/v1beta/models?*', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ models: [
      { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
    ] }) }));
  await page.route('**generativelanguage.googleapis.com/**:generateContent', route => route.fulfill(aiOk('OK')));
  await seed(page, 'gemini-9.9-dead');
  await page.goto('http://localhost:4326/index.html', { waitUntil: 'networkidle' });
  await page.click('.tabbar button[data-tab="settings"]');
  await page.click('#st-test');
  await page.waitForFunction(() => /接続OK|❌/.test(document.querySelector('#st-test-out').textContent), { timeout: 20000 });
  const out = await page.textContent('#st-test-out');
  check(/✅ 接続OK/.test(out), `接続テストが成功する（${out.slice(0, 60)}）`);
  check(/自動で切り替え/.test(out), '使えないモデルだったことを伝えて自動で直す');
  const model = await page.evaluate(() => JSON.parse(localStorage.getItem('kinmeshi_v1')).settings.model);
  check(model === 'gemini-3.5-flash', `使えるモデルが保存される（${model}）`);
  await page.close();
}

/* ========== 6. 成功時のふるまいは今まで通り ========== */
{
  const page = await freshPage();
  let n = 0;
  await page.route('**generativelanguage.googleapis.com/**:generateContent', async route => { n++; await route.fulfill(aiOk(MEAL_JSON)); });
  await seed(page, 'gemini-3.5-flash');
  await page.goto('http://localhost:4326/index.html', { waitUntil: 'networkidle' });
  await page.click('.tabbar button[data-tab="meals"]');
  await page.click('#m-photo');
  await page.setInputFiles('#photo-input', 'shots/food.jpg');
  await page.waitForSelector('#an-save', { timeout: 15000 });
  check(n === 1, '成功するときは余計な通信をしない');
  check(await page.isVisible('#an-retry'), '成功時は「撮り直す」ボタン');
  check(!await page.isVisible('#an-later'), '成功時に「写真だけ先に記録」は出ない');
  await page.click('#an-save');
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('kinmeshi_v1'));
    const d = new Date(); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return s.meals[k][0];
  });
  check(m.src === 'ai' && m.kcal === 680 && !!m.photo && m.pending === false, '今まで通りAI記録として保存される');
  await page.screenshot({ path: 'shots/meals-ok.png' });
  await page.close();
}

for (const c of contexts) await c.close();
await browser.close();
server.close();
console.log(`\n===== ${ok.length} passed / ${fail.length} failed =====`);
if (fail.length) { fail.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
})();
