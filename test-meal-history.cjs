/* いつもの食事：全履歴から・よく食べる順・時間帯・検索（表記ゆれ/中身）・取り消し・過去日・すべて見る */
const H = require('./test-helpers.cjs');

(async () => {
const PORT = 4328;
const server = await H.startServer(PORT);
const URL = `http://localhost:${PORT}/index.html`;
const { check, finish } = H.makeChecker();
const { freshPage, close } = await H.launch();

const D = (n) => H.dayKey(n);
const meal = (id, time, name, kcal, p, extra = {}) => Object.assign({ id, time, name, kcal, p, f: 10, c: 50, items: [], photo: null, src: 'manual' }, extra);
const BENTO_ITEMS = [
  { name: '唐揚げ', amount: '4個', kcal: 400, p: 20, f: 25, c: 10 },
  { name: 'ご飯', amount: '200g', kcal: 312, p: 5, f: 1, c: 70 },
];
/* 12:30 に開いたときの点数（目安）:
   ざるそば 4.06（昼に2回）> 朝のオートミール 3.68（朝に4回）> 鶏むね定食 2.66（夜に5回・少し前）> 日替わり弁当 2.34
   > プロテイン 1.5（マイ定食）> サラダチキン 0.97 > 牛丼 0.78 > ハンバーグ 0.44 ‖ カレーライス 0.34 > 寿司 0.19 > ラーメン 0.10 */
const MEALS = {
  [D(70)]: [meal('r1', '20:00', 'ラーメン', 700, 25)],
  [D(60)]: [meal('c1', '12:10', 'カレーライス', 850, 22)],
  [D(50)]: [meal('u1', '18:00', '寿司', 650, 30)],
  [D(40)]: [meal('t5', '19:00', '鶏むね定食', 600, 45)],
  [D(35)]: [meal('g1', '13:00', '牛丼', 750, 25)],
  [D(30)]: [meal('t4', '19:00', '鶏むね定食', 600, 45)],
  [D(25)]: [meal('h1', '19:00', 'ハンバーグ', 800, 35)],
  [D(20)]: [meal('t3', '19:00', '鶏むね定食', 600, 45)],
  [D(12)]: [meal('t2', '19:00', '鶏むね定食', 600, 45)],
  [D(10)]: [meal('z2', '12:00', 'ざるそば', 400, 14)],
  [D(5)]: [meal('t1', '19:10', '鶏むね定食', 640, 48)], // 一番新しい鶏むね定食（数値はこれが使われる）
  [D(4)]: [meal('o4', '07:00', '朝のオートミール', 380, 30)],
  [D(3)]: [meal('o3', '07:00', '朝のオートミール', 380, 30), meal('z1', '12:00', 'ざるそば', 420, 15)],
  [D(2)]: [meal('o2', '07:10', '朝のオートミール', 380, 30), meal('b1', '12:20', '日替わり弁当', 780, 30, { items: BENTO_ITEMS })],
  [D(1)]: [
    meal('o1', '07:00', '朝のオートミール', 380, 30),
    meal('s1', '19:00', 'サラダチキン', 120, 25),
    meal('pd', '12:00', '未解析の食事', 0, 0, { pending: true, src: 'pending' }),
  ],
};
const FAVS = [{ id: 'f1', name: 'プロテイン', kcal: 120, p: 24, f: 1, c: 3, items: [] }];

async function open(hour, minute = 30) {
  const page = await freshPage();
  const now = new Date(); now.setHours(hour, minute, 0, 0);
  await page.clock.setFixedTime(now);
  await page.route(H.GEN, route => route.fulfill(H.aiOk(JSON.stringify(H.MEAL))));
  await H.seed(page, { meals: MEALS, mealFavs: FAVS });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.click('.tabbar button[data-tab="meals"]');
  await page.waitForSelector('.usual [data-usual]');
  return page;
}
const chipNames = (page, sel = '#screen .usual [data-usual]') => page.$$eval(sel, els => els.map(e => {
  const c = e.cloneNode(true); c.querySelectorAll('small').forEach(x => x.remove());
  return c.textContent.replace('⭐', '').trim();
}));
const todayMeals = async (page, n = 0) => ((await H.readState(page)).meals[D(n)] || []);
const search = async (page, q) => { await page.fill('#screen .usual-q', q); await page.waitForTimeout(120); return chipNames(page); };

/* ========== 1. 並び順：全履歴・よく食べる順・時間帯 ========== */
{
  const page = await open(12);
  const names = await chipNames(page);
  check(names.length === 8, `上位8件が並ぶ（${names.length}件）`);
  check(names[0] === 'ざるそば', `昼（12:30）は昼によく食べるものが先頭（${names[0]}）`);
  check(names.indexOf('鶏むね定食') >= 0 && names.indexOf('鶏むね定食') < names.indexOf('サラダチキン'), '5回食べた鶏むね定食が、昨日1回だけのサラダチキンより上');
  check(names.includes('プロテイン'), 'マイ定食も同じ一覧に並ぶ');
  check(!names.some(n => /未解析/.test(n)), '解析待ちの記録は候補に出ない');
  const torimune = await page.$$eval('#screen .usual [data-usual]', els => (els.find(e => e.textContent.includes('鶏むね定食')) || {}).textContent || '');
  check(/640kcal/.test(torimune) && /P48/.test(torimune) && /5回/.test(torimune), `数値は一番新しい記録を使い、回数も出る（${torimune.replace(/\s+/g, ' ').trim()}）`);
  check(await page.isVisible('#screen .usual-all') && /すべて見る（11）/.test(await page.textContent('#screen .usual-all')), '「すべて見る（11）」が出る（2週間より前の分も数に入る）');
  check(page._errs.length === 0, `JSエラーなし（${page._errs.slice(0, 2).join(';').slice(0, 120)}）`);
}
{
  const page = await open(7);
  const names = await chipNames(page);
  check(names[0] === '朝のオートミール', `朝（7:30）は朝によく食べるものが先頭（${names[0]}）`);
}

/* ========== 2. 検索：2週間より前・表記ゆれ・中身・プリセット・見つからない時 ========== */
{
  const page = await open(12);
  let r = await search(page, 'かれー');
  check(r[0] === 'カレーライス', `ひらがなで2か月前のカレーライスが見つかる（${r.join(',')}）`);
  const curry = await page.textContent('#screen .usual [data-usual]');
  check(/850kcal/.test(curry), '見つかったのは自分の記録（プリセットではなく850kcal）');
  r = await search(page, 'ｶﾚｰ');
  check(r[0] === 'カレーライス', `半角カナでも見つかる（${r[0]}）`);
  r = await search(page, 'ムネ');
  check(r[0] === '鶏むね定食', `カタカナで打っても、ひらがなの記録が見つかる（${r.join(',')}）`);
  r = await search(page, '唐揚げ');
  check(r[0] === '日替わり弁当', `中身（品目名）でも見つかる（${r.join(',')}）`);
  r = await search(page, 'ご飯');
  check(r.indexOf('日替わり弁当') >= 0 && r.some(n => /白ご飯/.test(n)) && r.indexOf('日替わり弁当') < r.findIndex(n => /白ご飯/.test(n)), `自分の記録が先・プリセットが後（${r.join(',')}）`);
  r = await search(page, '未解析');
  check(r.length === 0, '解析待ちの記録は検索にも出ない');
  r = await search(page, 'みつからないごはん');
  check(r.length === 0 && await page.isVisible('#screen [data-usual-new]'), '見つからない時は「新しく記録」が出る');
  check(!await page.isVisible('#screen .usual-all'), '検索中は「すべて見る」を隠す');
  const sent = [];
  page.on('request', r => { if (/:generateContent/.test(r.url())) sent.push(r.postData() || ''); });
  await page.click('#screen [data-usual-new]');
  await page.waitForSelector('#mm-save');
  check(await page.inputValue('#mm-ai-text') === 'みつからないごはん', '手動記録が、探した名前入りで開く');
  const filled = await page.waitForFunction(() => document.querySelector('#mm-kcal').value === '680', null, { timeout: 10000 }).then(() => true).catch(() => false);
  check(filled && sent.some(b => b.includes('みつからないごはん')), 'AIの計算がそのまま始まって数値が入る（ボタンを押し直さなくていい）');
  await page.click('#sheet-close');
  await page.waitForTimeout(200);
  check(await page.inputValue('#screen .usual-q') === '', '手動記録へ移ったら検索語は消える');
  check(page._errs.length === 0, `JSエラーなし（${page._errs.slice(0, 2).join(';').slice(0, 120)}）`);
}

/* ========== 3. 1タップ記録・取り消し・記録済みは下がる ========== */
{
  const page = await open(12);
  await page.click('#screen .usual [data-usual]:nth-child(1)'); // ざるそば
  await page.waitForTimeout(300);
  let tm = await todayMeals(page);
  check(tm.length === 1 && tm[0].name === 'ざるそば' && tm[0].kcal === 420 && tm[0].src === 'recent' && tm[0].photo === null, `1タップで今日に記録（${tm.map(m => `${m.name}${m.kcal}`).join(',')}）`);
  check(tm[0].time === '12:30', `時刻は今（${tm[0].time}）`);
  check(await page.$$eval('#screen .meal-card', e => e.length) === 1, '一覧にすぐ出る');
  check(await page.isVisible('#toast .toast-undo'), '「取り消す」ボタンつきの通知が出る');
  await page.click('#toast .toast-undo');
  await page.waitForTimeout(300);
  tm = await todayMeals(page);
  check(tm.length === 0 && await page.$$eval('#screen .meal-card', e => e.length) === 0, '取り消すと記録が消える');
  check(/取り消しました/.test(await page.textContent('#toast')) && !await page.$('#toast .toast-undo'), `通知が「取り消しました」に変わる`);
  // もう一度記録して、記録済みは下がるか
  await page.click('#screen .usual [data-usual]:nth-child(1)');
  await page.waitForTimeout(300);
  const names = await chipNames(page);
  check(names[0] === '朝のオートミール' && names.includes('ざるそば'), `今日もう記録したものは下に（先頭: ${names[0]}）`);
  const zaru = await page.$eval('#screen .usual [data-usual].done-today', e => e.textContent);
  check(/ざるそば/.test(zaru) && /✓記録済み/.test(zaru), '「✓記録済み」と分かる');
  const wraps = await page.$eval('#screen .usual [data-usual].done-today small', el => [...el.querySelectorAll('.nw')].every(x => x.getClientRects().length === 1));
  check(wraps, '補足の文字が単語の途中で折り返さない');
  // 通知が消えたら、その場所はタップを邪魔しない
  await page.waitForTimeout(5400);
  const pe = await page.$eval('#toast', e => getComputedStyle(e).pointerEvents);
  check(pe === 'none', `消えた通知はタップを邪魔しない（pointer-events: ${pe}）`);
  check(page._errs.length === 0, `JSエラーなし（${page._errs.slice(0, 2).join(';').slice(0, 120)}）`);
}

/* ========== 4. 過去の日に記録（時間帯は見ない・その日の記録済みは下げる） ========== */
{
  const page = await open(12);
  await page.click('#md-prev');
  await page.waitForTimeout(250);
  const names = await chipNames(page);
  check(names[0] === '鶏むね定食', `昨日を開くと時間帯に関係なくよく食べる順（先頭: ${names[0]}）`);
  const before = (await todayMeals(page, 1)).length;
  await page.click('#screen .usual [data-usual]:nth-child(1)');
  await page.waitForTimeout(300);
  const y = await todayMeals(page, 1);
  check(y.length === before + 1 && y[y.length - 1].name === '鶏むね定食' && y[y.length - 1].kcal === 640, `開いている日（昨日）に記録される（${before}→${y.length}件）`);
  check((await todayMeals(page, 0)).length === 0, '今日には入らない');
}

/* ========== 5. すべて見る ========== */
{
  const page = await open(12);
  await page.click('#screen .usual-all');
  await page.waitForSelector('#ua-list .usual-row');
  const title = await page.textContent('.sheet-title');
  const rows = await page.$$eval('#ua-list .usual-row-name', els => els.map(e => e.textContent.replace('⭐', '').trim()));
  check(title === 'いつもの食事（11）' && rows.length === 11, `全件が並ぶ（${title} / ${rows.length}行）`);
  check(rows.includes('ラーメン') && rows.includes('カレーライス') && !rows.some(n => /未解析/.test(n)), '70日前の記録も入り、解析待ちは入らない');
  const meta = await page.$$eval('#ua-list .usual-row-meta', els => els.map(e => e.textContent));
  check(meta.some(t => /5回/.test(t) && /最後/.test(t)), '回数と最後に食べた日が分かる');
  await page.fill('#ua-q', 'らーめん');
  await page.waitForTimeout(120);
  const r = await page.$$eval('#ua-list .usual-row-name', els => els.map(e => e.textContent.trim()));
  check(r[0] === 'ラーメン' && r.includes('ラーメン1杯'), `一覧の中でも検索できる（${r.join(',')}）`);
  await page.click('#ua-list .usual-row');
  await page.waitForTimeout(300);
  check(!await page.$('#sheet-body'), '選ぶとシートが閉じる');
  const tm = await todayMeals(page);
  check(tm.length === 1 && tm[0].name === 'ラーメン' && tm[0].kcal === 700, `選んだものが記録される（${tm.map(m => m.name).join(',')}）`);
  check(await page.isVisible('#toast .toast-undo'), '一覧からでも取り消せる');
  check(page._errs.length === 0, `JSエラーなし（${page._errs.slice(0, 2).join(';').slice(0, 120)}）`);
}

/* ========== 6. 手動記録シート：マイ定食は上、いつもの食事には重複して出さない ========== */
{
  const page = await open(12);
  await page.click('#m-manual');
  await page.waitForSelector('#mm-save');
  const favs = await page.$$eval('#fav-grid [data-fav]', els => els.map(e => e.textContent));
  const usual = await chipNames(page, '#sheet-body .usual [data-usual]');
  check(favs.some(t => /プロテイン/.test(t)) && !usual.includes('プロテイン') && usual.length === 8, `マイ定食は重複しない（いつもの食事 ${usual.length}件）`);
  await page.fill('#sheet-body .usual-q', 'かれー');
  await page.waitForTimeout(120);
  check((await chipNames(page, '#sheet-body .usual [data-usual]'))[0] === 'カレーライス', 'シートの中でも検索できる');
  await page.fill('#sheet-body .usual-q', 'かつどん');
  await page.waitForTimeout(120);
  await page.click('#sheet-body [data-usual-new]');
  check(await page.inputValue('#mm-ai-text') === 'かつどん', '見つからない名前はその場の入力欄に入る');
  const filled = await page.waitForFunction(() => document.querySelector('#mm-kcal').value === '680', null, { timeout: 10000 }).then(() => true).catch(() => false);
  check(filled, 'シートの中でもAIの計算がそのまま始まる');
  await page.click('#fav-grid [data-fav]');
  await page.waitForTimeout(300);
  const tm = await todayMeals(page);
  check(tm.length === 1 && tm[0].name === 'プロテイン' && tm[0].src === 'fav', 'マイ定食のタップで記録（シートは閉じる）');
  check(!await page.$('#sheet-body') && await page.isVisible('#toast .toast-undo'), 'マイ定食も取り消せる');
}

/* ========== 7. 検索中に裏で画面が描き直されても入力が消えない ========== */
{
  const page = await open(12);
  await page.click('#screen .usual-q');
  await page.keyboard.type('そば');
  await page.evaluate(() => { document.querySelector('#screen .usual-q').dataset.mark = '1'; });
  await page.evaluate(() => refreshMealViews()); // AI解析が終わったときと同じ呼び出し
  await page.waitForTimeout(200);
  const same = await page.$('#screen .usual-q[data-mark="1"]');
  check(!!same && await page.inputValue('#screen .usual-q') === 'そば', '入力中は描き直さない（キーボードが閉じない）');
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForTimeout(700);
  const redrawn = !await page.$('#screen .usual-q[data-mark="1"]');
  check(redrawn && await page.inputValue('#screen .usual-q') === 'そば' && (await chipNames(page))[0] === 'ざるそば', '離れたあと描き直しても検索語と結果は残る');
  await page.click('.tabbar button[data-tab="home"]');
  await page.click('.tabbar button[data-tab="meals"]');
  await page.waitForSelector('#screen .usual-q');
  check(await page.inputValue('#screen .usual-q') === '', 'タブを移ると検索語は消える');
  // 日本語変換の確定Enterでは閉じない（普通のEnterでは閉じる）
  await page.focus('#screen .usual-q');
  await page.evaluate(() => { const i = document.querySelector('#screen .usual-q'); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })); });
  const stillFocused = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('usual-q'));
  await page.keyboard.press('Enter');
  const blurred = await page.evaluate(() => !(document.activeElement && document.activeElement.classList.contains('usual-q')));
  check(stillFocused && blurred, `変換確定のEnterでは閉じず、Enterでキーボードを閉じる（${stillFocused}/${blurred}）`);
  check(page._errs.length === 0, `JSエラーなし（${page._errs.slice(0, 2).join(';').slice(0, 120)}）`);
}

/* ========== 8. 記録がまだ無い人 ========== */
{
  const page = await freshPage();
  await H.seed(page);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.click('.tabbar button[data-tab="meals"]');
  await page.waitForSelector('#screen .usual');
  const txt = await page.textContent('#screen .usual');
  check(/一度記録した食事は/.test(txt) && !await page.isVisible('#screen .usual-all'), `空のときは案内だけ出る`);
  const r = await search(page, 'ばなな');
  check(r.some(n => /バナナ/.test(n)), `記録が無くてもプリセットから探して記録できる（${r.join(',')}）`);
  await page.click('#screen .usual [data-usual]');
  await page.waitForTimeout(300);
  const tm = await todayMeals(page);
  check(tm.length === 1 && /バナナ/.test(tm[0].name) && tm[0].src === 'quick', 'プリセットも1タップで記録');
  check(page._errs.length === 0, `JSエラーなし（${page._errs.slice(0, 2).join(';').slice(0, 120)}）`);
}

/* ========== 10. 写真つきの記録は「すべて」に写真が出る（記録し直した方には写真を付けない） ========== */
{
  const page = await freshPage();
  await page.route(H.GEN, route => route.fulfill(H.aiOk(JSON.stringify(H.MEAL))));
  await H.seed(page);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.click('.tabbar button[data-tab="meals"]');
  await page.click('#m-photo');
  await page.setInputFiles('#photo-input', H.ensureFoodJpg());
  await page.waitForFunction(() => {
    const st = JSON.parse(localStorage.getItem('kinmeshi_v1'));
    const m = Object.values(st.meals).flat()[0];
    return m && !m.pending && !document.querySelector('.meal-wrap.analyzing');
  }, null, { timeout: 20000 });
  await page.waitForTimeout(300);
  const names = await chipNames(page);
  check(names[0] === '鶏胸肉と玄米', `写真で記録したものも、解析が終わればすぐ候補に出る（${names.join(',')}）`);
  await page.evaluate(() => openAllUsualMeals());
  await page.waitForSelector('#ua-list img.usual-thumb');
  const hasImg = await page.waitForFunction(() => /^data:image/.test(document.querySelector('#ua-list img.usual-thumb').src), null, { timeout: 5000 }).then(() => true).catch(() => false);
  check(hasImg, '「すべて」の一覧では写真で思い出せる');
  await page.click('#ua-list .usual-row');
  await page.waitForTimeout(300);
  const tm = await todayMeals(page);
  check(tm.length === 2 && !!tm[0].photo && tm[1].photo === null && tm[1].kcal === 680, '記録し直した方は写真なし（写真は元の記録だけのもの）');
  check(page._errs.length === 0, `JSエラーなし（${page._errs.slice(0, 2).join(';').slice(0, 120)}）`);
}

/* ========== 11. APIキーが無い人：新しく記録は名前だけ入れて数値の欄へ ========== */
{
  const page = await freshPage();
  let calls = 0;
  await page.route(H.GEN, route => { calls++; return route.fulfill(H.aiOk(JSON.stringify(H.MEAL))); });
  await H.seed(page, { meals: MEALS, settings: { apiKey: '' } });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.click('.tabbar button[data-tab="meals"]');
  await page.waitForSelector('#screen .usual [data-usual]');
  await search(page, 'かつどん');
  check(/数値を入れて記録/.test(await page.textContent('#screen [data-usual-new]')), 'キーが無いときは「数値を入れて記録」');
  await page.click('#screen [data-usual-new]');
  await page.waitForSelector('#mm-save');
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
  check(await page.inputValue('#mm-name') === 'かつどん' && focused === 'mm-kcal' && calls === 0, `名前が入り、kcalの欄にすぐ打てる（${focused}・AI通信${calls}回）`);
  await page.fill('#mm-kcal', '900');
  await page.click('#mm-save');
  await page.waitForTimeout(300);
  const tm = await todayMeals(page);
  check(tm.length === 1 && tm[0].name === 'かつどん' && tm[0].kcal === 900, 'そのまま保存できる');
  const again = await search(page, 'かつ');
  check(again[0] === 'かつどん', `次からは検索で出る（${again.join(',')}）`);
  check(page._errs.length === 0, `JSエラーなし（${page._errs.slice(0, 2).join(';').slice(0, 120)}）`);
}

/* ========== 9. 表記ゆれの吸収（関数単体） ========== */
{
  const page = await freshPage();
  await H.seed(page);
  await page.goto(URL, { waitUntil: 'networkidle' });
  const r = await page.evaluate(() => [
    mealFold('ｶﾚｰ ライス') === mealFold('かれーらいす'),
    mealFold('ＰＲＯＴＥＩＮ') === mealFold('protein'),
    mealFold('サラダ　チキン') === mealFold('さらだちきん'),
  ]);
  check(r.every(Boolean), `全角半角・大文字小文字・カタカナひらがな・空白を同一視（${r.join(',')}）`);
}

await close();
server.close();
finish();
})();
