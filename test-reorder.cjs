/* 種目の並べ替え：今日のメニュー（▲▼・ドラッグ）とマイルーチン */
const H = require('./test-helpers.cjs');

(async () => {
const PORT = 4330;
const server = await H.startServer(PORT);
const URL = `http://localhost:${PORT}/index.html`;
const { check, finish } = H.makeChecker();
const { freshPage, close } = await H.launch();

const D = (n) => H.dayKey(n);
const ENTRIES = [
  { id: 'e1', exId: 'px01', sets: [{ w: 60, r: 10, done: true }, { w: 60, r: 10, done: false }] }, // ベンチプレス
  { id: 'e2', exId: 'px02', sets: [{ w: 20, r: 12, done: false }] },                                  // ダンベルプレス
  { id: 'e3', exId: 'px04', sets: [{ w: null, r: null, done: false }] },                              // チェストプレス
];
const ROUTINE = { id: 'r1', name: '胸の日', items: [
  { exId: 'px01', sets: [{ w: 60, r: 10 }] }, { exId: 'px02', sets: [{ w: 20, r: 12 }] }, { exId: 'px04', sets: [{ w: 40, r: 12 }] },
] };
const order = async (page, date = D(0)) => ((await H.readState(page)).workouts[date] || { entries: [] }).entries.map(e => e.id).join(',');
const cardNames = (page) => page.$$eval('#screen .ex-card .ex-name', els => els.map(e => e.textContent));
const rowNames = (page) => page.$$eval('#ro-list .ro-t b', els => els.map(e => e.textContent));

async function open(seed) {
  const page = await freshPage();
  await H.seed(page, seed);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.click('.tabbar button[data-tab="workout"]');
  await page.waitForTimeout(250);
  return page;
}

/* ドラッグ：row 番目の ≡ をつかんで steps 段動かす（マイナスで上） */
async function drag(page, row, steps) {
  const handles = await page.$$('#ro-list .ro-handle');
  const rows = await page.$$('#ro-list .ro-row');
  const hb = await handles[row].boundingBox();
  const r0 = await rows[0].boundingBox(), r1 = await rows[1].boundingBox();
  const step = r1.y - r0.y;
  const x = hb.x + hb.width / 2, y = hb.y + hb.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + steps * step * 0.55, { steps: 6 });
  await page.mouse.move(x, y + steps * step, { steps: 6 });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/* ========== 1. 今日のメニュー：▲▼とドラッグ ========== */
{
  const page = await open({ workouts: { [D(0)]: { entries: JSON.parse(JSON.stringify(ENTRIES)), memo: '' } } });
  check(/3種目/.test(await page.textContent('#screen .ex-list-head')) && await page.isVisible('#reorder-ex'), '種目が2つ以上あると「↕ 順番を変える」が出る');
  check((await cardNames(page)).join(',') === 'ベンチプレス,ダンベルプレス,チェストプレス', '最初は登録した順');
  await page.click('#reorder-ex');
  await page.waitForSelector('#ro-list .ro-row');
  check((await rowNames(page)).join(',') === 'ベンチプレス,ダンベルプレス,チェストプレス', '並べ替え画面に今の順番');
  check(await page.isDisabled('#ro-list [data-up="0"]') && await page.isDisabled('#ro-list [data-down="2"]'), '一番上の▲・一番下の▼は押せない');
  const sub = await page.textContent('#ro-list .ro-row:nth-child(1) .ro-t span');
  check(sub === '2セット ・ 1完了', `セット数と完了数が出る（${sub}）`);

  await page.click('#ro-list [data-down="0"]');
  check(await order(page) === 'e2,e1,e3' && (await rowNames(page)).join(',') === 'ダンベルプレス,ベンチプレス,チェストプレス', `▼で1つ下へ（${await order(page)}）`);
  check(await page.$eval('#ro-list .ro-row:nth-child(2)', e => e.classList.contains('moved')), '動かした行が光る');

  await drag(page, 2, -2); // チェストプレスを一番上へ
  check(await order(page) === 'e3,e2,e1', `≡をドラッグして一番上へ（${await order(page)}）`);
  await drag(page, 0, 1); // 一番上を1つ下へ
  check(await order(page) === 'e2,e3,e1', `ドラッグで1つ下へ（${await order(page)}）`);
  await drag(page, 1, 0); // 動かさずに離す
  check(await order(page) === 'e2,e3,e1', '動かさずに離したら変わらない');

  await page.click('#ro-done');
  await page.waitForTimeout(250);
  check(!await page.$('#sheet-body') && (await cardNames(page)).join(',') === 'ダンベルプレス,チェストプレス,ベンチプレス', '完了で閉じて、画面の順番も変わる');

  // 並べ替えたあとも入力は正しい種目に入る
  const wIn = page.locator('#screen .ex-card').nth(1).locator('.set-in[data-k="w"]').first();
  await wIn.fill('45');
  await wIn.press('Tab');
  await page.waitForTimeout(150);
  const st = await H.readState(page);
  const e3 = st.workouts[D(0)].entries.find(e => e.id === 'e3');
  check(e3.sets[0].w === 45 && st.workouts[D(0)].entries[1].id === 'e3', '並べ替えたあとも重量は正しい種目に保存');
  const e1 = st.workouts[D(0)].entries.find(e => e.id === 'e1');
  check(e1.sets[0].done === true && e1.sets[0].w === 60 && e1.sets.length === 2, '完了チェックやセットはそのまま');

  // ✕で閉じても反映される
  await page.click('#reorder-ex');
  await page.click('#ro-list [data-up="2"]');
  await page.click('#sheet-close');
  await page.waitForTimeout(250);
  check((await cardNames(page)).join(',') === 'ダンベルプレス,ベンチプレス,チェストプレス', '✕で閉じても画面に反映');
  // 再読み込みしても残る
  await page.reload({ waitUntil: 'networkidle' });
  await page.click('.tabbar button[data-tab="workout"]');
  await page.waitForTimeout(250);
  check((await cardNames(page)).join(',') === 'ダンベルプレス,ベンチプレス,チェストプレス', '開き直しても順番が残る');
  check(page._errs.length === 0, `JSエラーなし（${page._errs.slice(0, 2).join(';').slice(0, 140)}）`);
}

/* ========== 2. マイルーチンの順番 → 今日にセットするとその順 ========== */
{
  const page = await open({ routines: [JSON.parse(JSON.stringify(ROUTINE))] });
  check(!await page.$('#reorder-ex'), '種目が無い日はボタンを出さない');
  await page.click('[data-rt="r1"]');
  await page.waitForSelector('#rt-reorder');
  await page.click('#rt-reorder');
  await page.waitForSelector('#ro-list .ro-row');
  const sub = await page.textContent('#ro-list .ro-row:nth-child(3) .ro-t span');
  check(/40kg×12/.test(sub), `ルーチンは重量×回数も出る（${sub}）`);
  await page.click('#ro-list [data-up="2"]'); // チェストプレスを2番目へ
  await drag(page, 0, 2);                       // ベンチプレスを一番下へ
  await page.click('#ro-done');
  await page.waitForSelector('.menu-list .menu-item');
  const items = await page.$$eval('.menu-list .menu-item-t b', els => els.map(e => e.textContent));
  check(items.join(',') === 'チェストプレス,ダンベルプレス,ベンチプレス', `完了でルーチンの画面に戻り、新しい順で並ぶ（${items.join(',')}）`);
  const st = await H.readState(page);
  check(st.routines[0].items.map(i => i.exId).join(',') === 'px04,px02,px01' && st.routines[0].items[0].sets[0].w === 40, 'ルーチンに保存される（セットの中身もそのまま）');
  await page.click('#rt-apply');
  await page.waitForTimeout(300);
  check((await cardNames(page)).join(',') === 'チェストプレス,ダンベルプレス,ベンチプレス', '今日にセットすると並べ替えた順で入る');
  check(page._errs.length === 0, `JSエラーなし（${page._errs.slice(0, 2).join(';').slice(0, 140)}）`);
}

/* ========== 3. 1種目だけならボタンは出さない ========== */
{
  const page = await open({ workouts: { [D(0)]: { entries: [JSON.parse(JSON.stringify(ENTRIES[0]))], memo: '' } } });
  check(!await page.$('#reorder-ex'), '1種目だけなら並べ替えボタンは出ない');
}

await close();
server.close();
finish();
})();
