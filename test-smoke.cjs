/* 変更が既存機能を壊していないかの確認 */
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
await new Promise(r => server.listen(4327, r));

const fail = [], ok = [];
const check = (cond, label) => { (cond ? ok : fail).push(label); console.log(`${cond ? '✅' : '❌'} ${label}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });

const aiOk = (t) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] }) });
// 相談チャットはストリーミング（SSE）
await page.route('**generativelanguage.googleapis.com/**:streamGenerateContent*', route => route.fulfill({
  status: 200, contentType: 'text/event-stream',
  body: ['了解。', 'いい感じだよ。'].map(t => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\r\n\r\n`).join(''),
}));
await page.route('**generativelanguage.googleapis.com/**:generateContent', async route => {
  const b = JSON.parse(route.request().postData() || '{}');
  const p = b.contents.map(c => c.parts.map(x => x.text || '').join('')).join('\n');
  if (/"exId"/.test(p)) return route.fulfill(aiOk(JSON.stringify({ title: 'T', rationale: 'R', items: [{ exId: 'px01', sets: [{ w: 60, r: 10 }] }], advice: 'A' })));
  if (/"slot"/.test(p)) return route.fulfill(aiOk(JSON.stringify({ title: 'P', note: 'N', meals: [{ slot: '夕食', name: 'テスト飯', kcal: 600, p: 40, f: 15, c: 60, items: [] }] })));
  if (/"dish"/.test(p)) return route.fulfill(aiOk(JSON.stringify({ dish: 'テスト飯', items: [], total: { kcal: 600, p: 40, f: 15, c: 60 }, confidence: 0.9 })));
  return route.fulfill(aiOk('了解。いい感じだよ。'));
});

const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); const p = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
await page.addInitScript((d0, d1) => {
  localStorage.setItem('kinmeshi_v1', JSON.stringify({
    ver: 1,
    settings: { apiKey: 'K', model: 'gemini-3.5-flash', targets: { kcal: 2200, p: 130, f: 60, c: 270 }, profile: { weight: 68, goal: 'cut' }, activity: 'mid', restSec: 90, notifyTime: '21:00' },
    inbody: [{ id: 'i1', date: d1, weight: 68.2, bf: 17.4, muscle: 32.4, bmr: 1610, score: 82 }],
    routines: [{ id: 'r1', name: '胸の日', items: [{ exId: 'px01', sets: [{ w: 50, r: 10 }] }] }],
    mealFavs: [{ id: 'f1', name: 'プロテイン', kcal: 120, p: 24, f: 1, c: 3, items: [] }],
    progressPhotos: [], advisorChat: [], customExercises: [],
    workouts: { [d1]: { entries: [{ id: 'e1', exId: 'px01', sets: [{ w: 60, r: 10, done: true }] }], memo: '' } },
    meals: { [d0]: [{ id: 'm1', time: '08:00', name: 'オートミール', kcal: 420, p: 38, f: 8, c: 52, items: [] }] },
    createdAt: new Date().toISOString(),
  }));
}, day(0), day(1));

await page.goto('http://localhost:4327/index.html', { waitUntil: 'networkidle' });

/* 各タブが開く */
for (const [tab, marker] of [['home', '今日のカロリー'], ['workout', '種目を追加'], ['meals', '食事'], ['calendar', ''], ['advisor', 'AIアドバイザー'], ['settings', '設定']]) {
  await page.click(`.tabbar button[data-tab="${tab}"]`);
  await page.waitForTimeout(350);
  const txt = await page.textContent('#screen');
  check(txt.length > 30 && (!marker || txt.includes(marker)), `${tab}タブが開く`);
}

/* 食事: 既存記録のタップ→詳細（一覧のDOMを変えたので要確認） */
await page.click('.tabbar button[data-tab="meals"]');
await page.waitForSelector('.meal-card');
check(await page.$$eval('.meal-card', e => e.length) === 1, '既存の食事が一覧に出る');
check(!await page.isVisible('.meal-reanalyze'), '解析済みの記録に再解析ボタンは出ない');
await page.click('.meal-card');
await page.waitForSelector('#sheet-body');
const dTitle = await page.textContent('.sheet-title');
const dName = await page.inputValue('#md-name').catch(async () => await page.inputValue('#sheet-body input[type="text"]'));
check(dTitle === '食事の詳細' && dName === 'オートミール', `食事の詳細が開き、内容が入っている（${dName}）`);
await page.click('#sheet-close');

/* 食事: 手動記録 */
await page.waitForTimeout(200);
await page.click('#m-manual');
await page.waitForSelector('#mm-save');
await page.fill('#mm-name', 'スモーク飯');
await page.fill('#mm-kcal', '500');
await page.click('#mm-save');
await page.waitForTimeout(500);
check(await page.$$eval('.meal-card', e => e.length) === 2, '手動で食事を記録できる');

/* 食事: いつもの食事から再記録（全履歴・マイ定食も並ぶ） */
await page.waitForTimeout(200);
check(await page.$$eval('.usual [data-usual]', e => e.length) >= 2, 'いつもの食事が食事タブに並ぶ');
await page.click('.usual [data-usual]');
await page.waitForTimeout(500);
check(await page.$$eval('.meal-card', e => e.length) === 3, 'いつもの食事から1タップで再記録できる');

/* 筋トレ: 種目追加 */
await page.click('.tabbar button[data-tab="workout"]');
await page.waitForTimeout(300);
await page.click('#add-ex');
await page.waitForSelector('.chip.gym');
check(await page.$$eval('.chip.gym', e => e.length) === 5, 'ジムチップ（すべて＋4店舗）が出る');
await page.click('#sheet-close');

/* 筋トレ: AIメニュー */
await page.waitForTimeout(200);
await page.click('#ai-menu');
await page.waitForSelector('#menu-gen');
await page.click('#menu-gen');
await page.waitForSelector('#menu-apply', { timeout: 20000 });
check(/ベンチプレス/.test(await page.textContent('#menu-out')), 'AIメニュー作成が動く');
await page.click('#menu-apply');
await page.waitForTimeout(500);
check(/ベンチプレス/.test(await page.textContent('#screen')), 'AIメニューを今日に登録できる');

/* 相談タブ: チャット・メニュー・献立 */
await page.click('.tabbar button[data-tab="advisor"]');
await page.waitForSelector('#adv-in');
await page.fill('#adv-in', '調子どう？');
await page.press('#adv-in', 'Enter');
await page.waitForFunction(() => !document.getElementById('adv-live') && !document.querySelector('.chat-msg.typing') && document.querySelectorAll('.chat-msg.ai').length > 0, null, { timeout: 20000 });
const reply = await page.$$eval('.chat-msg.ai', els => els[els.length - 1].textContent);
check(reply === '了解。いい感じだよ。', `相談チャットがストリーミングで動く（${reply}）`);
await page.click('#adv-gen-w');
await page.waitForSelector('.adv-card[data-card="w"]', { timeout: 20000 });
check(true, '相談タブのメニュー提案が動く');
await page.click('#adv-gen-m');
await page.waitForSelector('.adv-card[data-card="m"]', { timeout: 20000 });
check(true, '相談タブの献立提案が動く');
await page.click('.adv-card[data-card="m"] [data-act="m-eat"][data-i="0"]');
await page.waitForSelector('.adv-meal.done', { timeout: 5000 });
check(true, '献立の「食べた」で記録できる');

/* 設定: 各項目が壊れていない */
await page.click('.tabbar button[data-tab="settings"]');
await page.waitForTimeout(300);
const st = await page.textContent('#screen');
check(/v2\.11\.0/.test(st), 'バージョン表示が v2.11.0');
check(/InBody連携/.test(st) && /AI設定/.test(st) && /データ/.test(st), '設定の各セクションが出る');

/* タイマー */
await page.click('.tabbar button[data-tab="workout"]');
await page.waitForTimeout(300);
await page.evaluate(() => { state.settings.restSec = 60; startRestTimer(true); });
await page.waitForTimeout(300);
const t0 = await page.textContent('#rt-big .rtb-time');
await page.click('#rtb-minus');
const t1 = await page.textContent('#rt-big .rtb-time');
check(t0 === '1:00' && /0:(30|29)/.test(t1), `タイマーの−30秒が効く（${t0}→${t1}）`);
await page.click('#rtb-skip');

check(errs.length === 0, `JSエラーなし (${errs.slice(0, 2).join(';').slice(0, 150)})`);

await browser.close();
server.close();
console.log(`\n===== ${ok.length} passed / ${fail.length} failed =====`);
if (fail.length) { fail.forEach(f => console.log('  ❌ ' + f)); process.exit(1); }
})();
