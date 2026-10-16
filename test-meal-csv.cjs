/* まとめて入力（CSV・貼り付け・手打ち）：読み取り・数値の補い・AIまとめ計算・重複・取り消し・テンプレート・書き出し */
const H = require('./test-helpers.cjs');
const fs = require('fs');
const path = require('path');

(async () => {
const PORT = 4329;
const server = await H.startServer(PORT);
const URL = `http://localhost:${PORT}/index.html`;
const { check, finish } = H.makeChecker();
const { freshPage, close } = await H.launch();
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const D = (n) => H.dayKey(n);
const md = (n) => { const [, m, d] = D(n).split('-').map(Number); return `${m}/${d}`; };
const ymd = (n) => { const [y, m, d] = D(n).split('-').map(Number); return `${y}/${m}/${d}`; };
const meal = (id, time, name, kcal, p, extra = {}) => Object.assign({ id, time, name, kcal, p, f: 10, c: 50, items: [], photo: null, src: 'manual' }, extra);

/* AIのまとめ計算のモック：名前ごとに決まった数値を返す */
const AI_VALUES = {
  '鶏むね定食': { kcal: 700, p: 50, f: 15, c: 70 },
  'バナナ 2': { kcal: 180, p: 2, f: 0.4, c: 45 },
  'ゆで卵 2': { kcal: 160, p: 12, f: 10, c: 0.4 },
};
function batchReply(body) {
  const prompt = body.contents.map(c => c.parts.map(x => x.text || '').join('')).join('\n');
  const items = [...prompt.matchAll(/^(\d+)\. (.+)$/gm)].map(m => ({ i: +m[1], name: m[2].trim() }));
  const meals = items.map(({ i, name }) => Object.assign({ i }, AI_VALUES[name] || { kcal: 300, p: 10, f: 10, c: 40 }));
  return H.aiOk(JSON.stringify({ meals }));
}
const isBatch = (body) => /件は、私が食べた食事の記録です/.test(JSON.stringify(body));

async function open({ meals = {}, favs = [], settings, ai = 'ok', hour = 12 } = {}) {
  const page = await freshPage();
  const now = new Date(); now.setHours(hour, 30, 0, 0);
  await page.clock.setFixedTime(now);
  page._ai = { mode: ai, calls: [] };
  await page.route(H.GEN, async route => {
    const body = JSON.parse(route.request().postData() || '{}');
    if (isBatch(body)) page._ai.calls.push(JSON.stringify(body));
    if (page._ai.mode === 'bad-key') return route.fulfill(H.aiErr(400, 'API key not valid. Please pass a valid API key.'));
    if (isBatch(body)) return route.fulfill(batchReply(body));
    return route.fulfill(H.aiOk(JSON.stringify(H.MEAL)));
  });
  await H.seed(page, Object.assign({ meals, mealFavs: favs }, settings ? { settings } : {}));
  await page.goto(URL, { waitUntil: 'networkidle' });
  return page;
}
const parse = (page, text) => page.evaluate((t) => parseMealImportText(t), text);
const pick = (r) => r.rows.map(x => [x.date, x.time, x.name, x.kcal, x.p, x.f, x.c].map(v => (v == null ? '' : v)).join('|'));
const stateOf = (page) => H.readState(page);
const errs = (page) => `JSエラーなし（${page._errs.slice(0, 2).join(';').slice(0, 140)}）`;

const HISTORY = {
  [D(20)]: [meal('h1', '12:10', 'カレーライス', 850, 22, { f: 15, c: 120 })],
  [D(7)]: [meal('h2', '19:00', 'ハンバーグ', 800, 35)],
};
const FAVS = [{ id: 'f1', name: 'プロテイン', kcal: 120, p: 24, f: 1, c: 3, items: [] }];

/* ========== 1. 読み取り（形式ごと） ========== */
{
  const page = await open({ meals: HISTORY, favs: FAVS });
  // 手打ち（スペース区切り・日付の省略・朝昼夜・数値・個数）
  let r = await parse(page, [
    `${md(6)} 朝 オートミール 380 30 8 52`,
    '昼 カレーライス',
    '夜 鶏むね定食 650',
    `${md(5)}`,
    '朝:プロテイン',
    '間食 バナナ 2',
    '夜 ゆで卵 2 140',
  ].join('\n'));
  check(JSON.stringify(pick(r)) === JSON.stringify([
    `${D(6)}|07:30|オートミール|380|30|8|52`,
    `${D(6)}|12:30|カレーライス||||`,
    `${D(6)}|19:00|鶏むね定食|650|||`,
    `${D(5)}|07:30|プロテイン||||`,
    `${D(5)}|15:30|バナナ 2||||`,
    `${D(5)}|19:00|ゆで卵 2|140|||`,
  ]) && r.errors.length === 0, `手打ち：日付の省略・朝昼夜・数値・「バナナ 2」（${pick(r).join(' / ')}）`);

  // CSV（BOM・見出し・"…"の中のカンマと""・日付の省略・12時）
  r = await parse(page, `﻿日付,時刻,名前,kcal,P,F,C\r\n${ymd(4)},8:00,"カツ丼, 味噌汁",1100,35,30,150\r\n,12時,"ラーメン ""大盛り""",900,,,\r\n`);
  check(JSON.stringify(pick(r)) === JSON.stringify([`${D(4)}|08:00|カツ丼, 味噌汁|1100|35|30|150`, `${D(4)}|12:00|ラーメン "大盛り"|900|||`]), `CSV：引用符の中のカンマ・""・日付の省略（${pick(r).join(' / ')}）`);

  // 表計算アプリからのコピー（タブ区切り・日本語の見出し・単位つき）
  r = await parse(page, `日付\t時間帯\t食事\tカロリー\tたんぱく質(g)\t脂質(g)\t炭水化物(g)\n${md(3)}(月)\t夕食\t焼き魚定食\t650kcal\t40g\t18g\t80g\n`);
  check(JSON.stringify(pick(r)) === JSON.stringify([`${D(3)}|19:00|焼き魚定食|650|40|18|80`]), `表計算からの貼り付け（タブ区切り）（${pick(r).join(' / ')}）`);

  // 見出しなしCSV・日付と時刻が1セル・曜日の列・時刻の列が空
  r = await parse(page, `${ymd(2)} 7:45,オートミール,380\n${ymd(2)},火,昼,そば\n${ymd(2)},,牛丼,750\n`);
  check(JSON.stringify(pick(r)) === JSON.stringify([`${D(2)}|07:45|オートミール|380|||`, `${D(2)}|12:30|そば||||`, `${D(2)}|19:00|牛丼|750|||`]), `見出しなしCSV（${pick(r).join(' / ')}）`);

  // 日本語の読点区切り・日付に続けて「朝」・「1.5人前」は日付にしない・全角数字
  r = await parse(page, `${md(1)}、朝、オートミール、３８０\n${md(1)}昼 カレー\n1.5人前 ペペロンチーノ\n`);
  check(JSON.stringify(pick(r)) === JSON.stringify([`${D(1)}|07:30|オートミール|380|||`, `${D(1)}|12:30|カレー||||`, `${D(1)}|19:00|1.5人前 ペペロンチーノ||||`]), `「、」区切り・「10/10朝」・「1.5人前」（${pick(r).join(' / ')}）`);

  // エラー：存在しない日・未来の日付（年あり）・日付が読めなかった次の行・最初の行に日付なし
  const ty = Number(D(0).slice(0, 4));
  r = await parse(page, `昼 そば\n2/30 朝 パン\n昼 うどん\n${ty + 1}/1/1 朝 もち\n`);
  check(r.rows.length === 0 && r.errors.length === 4 && /日付がありません/.test(r.errors[0].msg) && /日付が読めません/.test(r.errors[1].msg) && /上の行/.test(r.errors[2].msg) && /未来/.test(r.errors[3].msg),
    `読めない行は理由つきでとばす（${r.errors.map(e => `${e.line}:${e.msg}`).join(' / ')}）`);

  // 年なしの日付が未来になるなら去年
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  r = await parse(page, `${tomorrow.getMonth() + 1}/${tomorrow.getDate()} 朝 パン`);
  check(r.rows.length === 1 && r.rows[0].date.slice(0, 4) === String(tomorrow.getFullYear() - 1), `年なしで未来なら去年の日付（${r.rows[0] && r.rows[0].date}）`);

  // テンプレートの空欄・コメント行はとばす
  r = await parse(page, `日付,曜日,時刻,名前,kcal,P,F,C\n# メモ\n${ymd(1)},水,朝,,,,,\n${ymd(1)},水,昼,そば,,,,\n${ymd(1)},水,夜,,,,,\n`);
  check(r.rows.length === 1 && r.rows[0].name === 'そば' && r.skipped === 2, `テンプレートの空欄・コメント行（${r.rows.length}件・とばし${r.skipped}）`);
  check(page._errs.length === 0, errs(page));
}

/* ========== 2. 貼り付け → 確認 → 取り込み → AIが空の数値をまとめて計算 ========== */
const PASTE = [
  `${md(6)} 朝 オートミール 380 30 8 52`, '昼 カレーライス', '夜 鶏むね定食 650',
  `${md(5)} 朝 プロテイン`, '間食 バナナ 2', '夜 ゆで卵 2 140',
].join('\n');
{
  const page = await open({ meals: HISTORY, favs: FAVS });
  await page.click('.tabbar button[data-tab="meals"]');
  await page.waitForSelector('#m-bulk');
  const link = await page.textContent('#m-bulk');
  check(/まとめて入力/.test(link) && /6日分が空いています/.test(link), `食事タブに入口と空いている期間（${link.replace(/\s+/g, ' ').trim()}）`);
  await page.click('#m-bulk');
  await page.waitForSelector('#ci-text');
  check(/6日分/.test(await page.textContent('#sheet-body')), 'シートにも空いている期間が出る');
  await page.fill('#ci-text', PASTE);
  await page.click('#ci-read');
  await page.waitForSelector('#ci-preview .ci-row');
  await page.screenshot({ path: path.join(SHOTS, 'csv-preview.png') });
  const head = await page.textContent('#ci-preview .ci-head');
  check(/6件/.test(head) && /書いた数値 1/.test(head) && /過去の記録から 2/.test(head) && /AIが計算 3/.test(head), `確認画面：件数と数値の出どころ（${head.replace(/\s+/g, ' ').trim()}）`);
  const curry = await page.$$eval('#ci-preview .ci-row', els => (els.find(e => e.textContent.includes('カレーライス')) || {}).textContent || '');
  check(/850kcal/.test(curry) && /過去の記録から/.test(curry), `カレーライスは20日前の記録の数値（${curry.replace(/\s+/g, ' ').trim()}）`);
  check(await page.textContent('#ci-go') === '6件を取り込む', '取り込むボタンに件数');
  await page.click('#ci-go');
  await page.waitForTimeout(300);
  check(!await page.$('#sheet-body'), 'シートが閉じる');
  check(/6件を取り込みました/.test(await page.textContent('#toast')) && await page.isVisible('#toast .toast-undo'), `取り込み完了の通知に「取り消す」（${(await page.textContent('#toast')).slice(0, 40)}）`);
  check((await page.textContent('.date-nav-label')).includes(md(5)), `一番新しい取り込み日（${md(5)}）を開く`);
  // AIのまとめ計算が終わるのを待つ
  await page.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem('kinmeshi_v1')).meals).flat().every(m => !m.pending), null, { timeout: 20000 });
  check(page._ai.calls.length === 1 && ['鶏むね定食', 'バナナ 2', 'ゆで卵 2'].every(n => page._ai.calls[0].includes(n)), `空の数値は1回の通信でまとめて計算（通信${page._ai.calls.length}回）`);
  const st = await stateOf(page);
  const d6 = st.meals[D(6)], d5 = st.meals[D(5)];
  check(d6.map(m => `${m.time} ${m.name}`).join(',') === '07:30 オートミール,12:30 カレーライス,19:00 鶏むね定食', `日付ごと・時刻順に入る（${d6.map(m => m.name).join(',')}）`);
  const oat = d6[0], cur = d6[1], tori = d6[2];
  check(oat.kcal === 380 && oat.p === 30 && oat.src === 'csv', '書いた数値はそのまま');
  check(cur.kcal === 850 && cur.p === 22 && cur.f === 15 && cur.c === 120, '空の数値は過去の同じ名前の記録から');
  check(d5[0].name === 'プロテイン' && d5[0].kcal === 120 && d5[0].p === 24, 'マイ定食の数値も使う');
  check(tori.kcal === 650 && tori.p === 50 && tori.c === 70 && tori.name === '鶏むね定食' && tori.src === 'ai', `書いたkcalはAIに上書きさせない（${tori.kcal}kcal P${tori.p}）`);
  const egg = d5.find(m => m.name === 'ゆで卵 2'), ban = d5.find(m => m.name === 'バナナ 2');
  check(egg.kcal === 140 && egg.p === 12 && ban.kcal === 180 && !egg.aiText && !egg.pending, `AIの数値が入り、名前もそのまま（ゆで卵${egg.kcal} / バナナ${ban.kcal}）`);
  await page.waitForTimeout(300);
  check(await page.$$eval('#screen .meal-card', e => e.length) === 3 && !await page.$('#screen .meal-wrap.analyzing'), '画面にも反映（解析中の表示が消える）');
  const link2 = await page.textContent('#m-bulk');
  check(/4日分が空いています/.test(link2), `空いている期間が縮む（${link2.replace(/\s+/g, ' ').trim()}）`);
  check(page._errs.length === 0, errs(page));
}

/* ========== 3. 取り消し ========== */
{
  const page = await open({ meals: HISTORY, favs: FAVS });
  await page.evaluate(() => openMealImport());
  await page.fill('#ci-text', PASTE);
  await page.click('#ci-read');
  await page.click('#ci-go');
  await page.waitForSelector('#toast .toast-undo');
  await page.click('#toast .toast-undo');
  await page.waitForTimeout(400);
  const st = await stateOf(page);
  check(!st.meals[D(6)] && !st.meals[D(5)] && st.meals[D(20)].length === 1, '取り消すと取り込んだ分だけ消える（前からの記録は残る）');
  check(/取り込みを取り消しました/.test(await page.textContent('#toast')), '取り消しの通知');
  await page.waitForTimeout(1500);
  const after = await stateOf(page);
  check(!after.meals[D(6)] && !after.meals[D(5)], '取り消したあとAIの結果が戻ってこない');
  check(page._errs.length === 0, errs(page));
}

/* ========== 4. すでにある記録は外しておく・チェックで選べる ========== */
{
  const page = await open({ meals: Object.assign({}, HISTORY, { [D(2)]: [meal('x1', '07:40', 'オートミール', 380, 30)] }) });
  await page.evaluate(() => openMealImport());
  await page.fill('#ci-text', `${md(2)} 朝 オートミール\n昼 そば 450\n夜 オートミール`);
  await page.click('#ci-read');
  await page.waitForSelector('#ci-preview .ci-row');
  const rows = await page.$$eval('#ci-preview .ci-row', els => els.map(e => ({ t: e.textContent.replace(/\s+/g, ' ').trim(), on: e.querySelector('input').checked })));
  check(rows.length === 3 && rows[0].on === false && /すでに記録あり/.test(rows[0].t) && rows[1].on && rows[2].on, `朝のオートミールは記録済み→外す・夜の別の時刻は入れる（${rows.map(r => `${r.on ? '☑' : '☐'}${r.t.slice(0, 14)}`).join(' / ')}）`);
  check(await page.textContent('#ci-go') === '2件を取り込む', '外した分は数えない');
  await page.click('#ci-preview .ci-row.dup input');
  check(await page.textContent('#ci-go') === '3件を取り込む', 'チェックで戻せる');
  await page.click('#ci-preview .ci-row.dup input');
  await page.click('#ci-go');
  await page.waitForTimeout(300);
  const st = await stateOf(page);
  check(st.meals[D(2)].length === 3 && st.meals[D(2)].map(m => m.time).join(',') === '07:40,12:30,19:00', `元の記録と合わせて時刻順（${st.meals[D(2)].map(m => `${m.time}${m.name}`).join(',')}）`);
  // 書き出したCSVを読み直すと全部「記録済み」
  const csv = await page.evaluate(() => mealsCsvText());
  await page.evaluate(() => openMealImport());
  await page.fill('#ci-text', csv);
  await page.click('#ci-read');
  await page.waitForSelector('#ci-preview .ci-row');
  const all = await page.$$eval('#ci-preview .ci-check', els => els.map(e => e.checked));
  check(all.length > 0 && all.every(v => !v) && await page.isDisabled('#ci-go'), `書き出したCSVを読み直しても二重にならない（${all.length}件すべて外す）`);
  check(page._errs.length === 0, errs(page));
}

/* ========== 5. ファイルから（Shift_JIS・UTF-8・Excelファイルの案内） ========== */
{
  const page = await open({ meals: HISTORY });
  const sj = path.join(SHOTS, 'meals_sjis.csv');
  require('child_process').execSync(`python3 -c "
import sys
open(sys.argv[1], 'wb').write(('日付,時刻,名前,kcal,P,F,C\\r\\n${ymd(3)},朝,納豆ごはん,400,15,6,70\\r\\n,夜,豚の生姜焼き定食,,,,\\r\\n').encode('cp932'))
" ${sj}`);
  await page.evaluate(() => openMealImport());
  await page.setInputFiles('#ci-file', sj);
  await page.waitForSelector('#ci-preview .ci-row');
  const names = await page.$$eval('#ci-preview .ci-name', els => els.map(e => e.textContent));
  check(names.join(',') === '納豆ごはん,豚の生姜焼き定食', `Shift_JIS（Excelの普通のCSV）も文字化けしない（${names.join(',')}）`);
  check(/豚の生姜焼き定食/.test(await page.inputValue('#ci-text')), '読んだ内容は入力欄にも入る（戻って直せる）');
  await page.click('#ci-back');
  const xl = path.join(SHOTS, 'fake.xlsx');
  fs.writeFileSync(xl, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]));
  await page.setInputFiles('#ci-file', xl);
  await page.waitForTimeout(300);
  check(/CSV.*保存/.test(await page.textContent('#toast')), `Excelのファイルを選んだら案内（${(await page.textContent('#toast')).slice(0, 40)}）`);
  check(page._errs.length === 0, errs(page));
}

/* ========== 6. テンプレート（空いている期間の朝昼夜）→ 書いて読み込む ========== */
{
  const page = await open({ meals: HISTORY });
  await page.evaluate(() => openMealImport());
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#ci-tpl')]);
  const file = path.join(SHOTS, 'template.csv');
  await dl.saveAs(file);
  const buf = fs.readFileSync(file);
  const text = buf.toString('utf8');
  const lines = text.replace(/^﻿/, '').trim().split(/\r\n/);
  check(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, 'BOM付き（Excelで開いても文字化けしない）');
  check(lines[0] === '日付,曜日,時刻,名前,kcal,P,F,C' && lines[1].startsWith('#'), '見出しと説明の行');
  check(lines.length === 2 + 7 * 3 && lines[2].startsWith(`${ymd(6)},`) && lines[2].includes(',朝,') && lines[lines.length - 1].startsWith(`${ymd(0)},`), `空いている日から今日まで朝昼夜の行（${lines.length - 2}行・${dl.suggestedFilename()}）`);
  // 2行だけ名前を書いて読み込む
  const filled = text.replace(`${ymd(6)},${lines[2].split(',')[1]},朝,`, `${ymd(6)},${lines[2].split(',')[1]},朝,オートミール`)
    .replace(`${ymd(5)},${lines[5].split(',')[1]},夜,`, `${ymd(5)},${lines[5].split(',')[1]},夜,カレーライス`);
  fs.writeFileSync(path.join(SHOTS, 'template-filled.csv'), filled);
  await page.setInputFiles('#ci-file', path.join(SHOTS, 'template-filled.csv'));
  await page.waitForSelector('#ci-preview .ci-row');
  const pv = await page.textContent('#ci-preview');
  check(/2件/.test(pv) && /名前が空の行（19件）はとばしました/.test(pv), `書いた行だけ取り込み、空欄はとばす（${(pv.match(/名前が空の行（\d+件）/) || [''])[0]}）`);
  check(page._errs.length === 0, errs(page));
}

/* ========== 7. AIが使えなかったとき：記録は残り、あとで再解析できる ========== */
{
  const page = await open({ meals: HISTORY, ai: 'bad-key' });
  await page.evaluate(() => openMealImport());
  await page.fill('#ci-text', `${md(4)} 夜 からあげ定食`);
  await page.click('#ci-read');
  await page.click('#ci-go');
  await page.waitForFunction(() => /APIキー|計算できませんでした/.test(document.getElementById('toast').textContent), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  let m = (await stateOf(page)).meals[D(4)][0];
  check(m.pending && m.aiText === 'からあげ定食' && m.name === 'からあげ定食' && (m.aiTries || 0) === 1, `失敗しても記録は残る（解析待ち・試行${m.aiTries}回）`);
  check(await page.isVisible('#screen .meal-reanalyze'), 'カードに「AIで解析する」ボタン');
  const cardName = await page.textContent('#screen .meal-name');
  check(cardName === 'からあげ定食', `名前はちゃんと出る（${cardName}）`);
  // 詳細を開くと名前が入っている
  await page.click('#screen .meal-card');
  await page.waitForSelector('#md-name');
  check(await page.inputValue('#md-name') === 'からあげ定食' && await page.inputValue('#md-kcal') === '', '詳細：名前は表示、数値は空欄');
  await page.click('#sheet-close');
  page._ai.mode = 'ok';
  await page.click('#screen .meal-reanalyze');
  await page.waitForFunction(() => { const m = Object.values(JSON.parse(localStorage.getItem('kinmeshi_v1')).meals).flat().find(x => x.name === 'からあげ定食'); return m && !m.pending; }, null, { timeout: 15000 });
  m = (await stateOf(page)).meals[D(4)][0];
  check(m.kcal === 300 && m.src === 'ai' && !m.aiTries, `ボタンで計算し直せる（${m.kcal}kcal）`);
  check(page._errs.length === 0, errs(page));
}

/* ========== 8. 途中でアプリを閉じても、次に開いたら古い日付の分も計算する ========== */
{
  const pend = (id, name, extra = {}) => Object.assign(meal(id, '19:00', name, 0, 0, { f: 0, c: 0 }), { pending: true, src: 'pending', aiText: name, edited: { name: true } }, extra);
  const page = await open({ meals: Object.assign({}, HISTORY, { [D(10)]: [pend('p1', '鶏むね定食', { kcal: 650, edited: { name: true, kcal: true } }), pend('p2', 'バナナ 2', { time: '15:30' })] }) });
  await page.waitForFunction(() => Object.values(JSON.parse(localStorage.getItem('kinmeshi_v1')).meals).flat().every(m => !m.pending), null, { timeout: 15000 }).catch(() => {});
  const ms = (await stateOf(page)).meals[D(10)];
  check(ms.every(m => !m.pending) && ms.find(m => m.name === '鶏むね定食').kcal === 650 && ms.find(m => m.name === 'バナナ 2').kcal === 180 && page._ai.calls.length === 1, `10日前の解析待ちも起動時にまとめて計算（通信${page._ai.calls.length}回）`);
  check(page._errs.length === 0, errs(page));
}

/* ========== 9. APIキーが無いとき ========== */
{
  const page = await open({ meals: HISTORY, settings: { apiKey: '' } });
  await page.evaluate(() => openMealImport());
  await page.fill('#ci-text', `${md(3)} 昼 謎の定食\n夜 カレーライス`);
  await page.click('#ci-read');
  await page.waitForSelector('#ci-preview .ci-row');
  check(/APIキーが未設定/.test(await page.textContent('#ci-preview')), '数値なしになる行があると案内');
  await page.click('#ci-go');
  await page.waitForTimeout(300);
  const ms = (await stateOf(page)).meals[D(3)];
  check(ms.length === 2 && ms[0].kcal === 0 && !ms[0].pending && ms[1].kcal === 850 && page._ai.calls.length === 0, 'キーが無くても取り込める（過去の記録があれば数値も入る）');
}

/* ========== 10. 設定からの入口と書き出し ========== */
{
  const photoPending = { id: 'pp', time: '08:00', name: '未解析の食事', kcal: 0, p: 0, f: 0, c: 0, photo: 'ph1', src: 'pending', pending: true, items: [] };
  const page = await open({ meals: Object.assign({}, HISTORY, { [D(1)]: [photoPending, meal('q1', '12:00', 'カツ丼, 大盛り', 1100, 35)] }) });
  await page.click('.tabbar button[data-tab="settings"]');
  await page.waitForSelector('#st-meal-csv');
  check(/v2\.12\.0/.test(await page.textContent('#screen')), 'バージョン表示 v2.12.0');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#st-meal-out')]);
  const out = path.join(SHOTS, 'export.csv');
  await dl.saveAs(out);
  const lines = fs.readFileSync(out, 'utf8').replace(/^﻿/, '').trim().split(/\r\n/);
  check(lines[0] === '日付,曜日,時刻,名前,kcal,P,F,C,記録方法' && lines.length === 4 && lines.some(l => l.includes('"カツ丼, 大盛り",1100,35')) && !lines.some(l => l.includes('未解析')), `食事をCSVで書き出せる（${lines.length - 1}件・名前のカンマは"…"で囲む）`);
  await page.click('#st-meal-csv');
  await page.waitForSelector('#ci-text');
  await page.fill('#ci-text', `${md(4)} 夜 そば 450`);
  await page.click('#ci-read');
  await page.click('#ci-go');
  await page.waitForTimeout(400);
  check(await page.$eval('.tabbar button[data-tab="meals"]', b => b.classList.contains('active')) && (await page.textContent('.date-nav-label')).includes(md(4)), '設定から取り込んだら食事タブのその日を開く');
  check(page._errs.length === 0, errs(page));
}

await close();
server.close();
finish();
})();
