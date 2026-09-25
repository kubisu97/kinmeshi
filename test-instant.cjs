/* 「即座に反応」の確認：写真は撮った瞬間に記録／AIは裏で解析／競合（削除・手修正）／自動再開／チャットのストリーミング */
const H = require('./test-helpers.cjs');
const { execSync } = require('child_process');

(async () => {
const PORT = 4329;
const server = await H.startServer(PORT);
const URL = `http://localhost:${PORT}/index.html`;
const { check, finish } = H.makeChecker();
const food = H.ensureFoodJpg();
const { freshPage, close } = await H.launch();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const today = H.dayKey();
const meal0 = async (page) => ((await H.readState(page)).meals[today] || [])[0];

/* 遅れて返事するモック（AIが考えている時間を再現） */
async function slowAi(page, ms, reply = H.aiOk(JSON.stringify(H.MEAL)), onReq) {
  await page.route(H.GEN, async route => {
    if (onReq) onReq(route.request());
    await sleep(ms);
    await route.fulfill(typeof reply === 'function' ? reply() : reply);
  }, { times: 50 });
}
async function openMeals(page) {
  await page.click('.tabbar button[data-tab="meals"]');
  await page.waitForTimeout(150);
}
async function snap(page) {
  await page.click('#m-photo');
  await page.setInputFiles('#photo-input', food);
  // 画像の縮小と保存だけ待つ（AIは待たない）
  await page.waitForFunction((k) => ((JSON.parse(localStorage.getItem('kinmeshi_v1')).meals[k]) || []).length > 0, today, { timeout: 5000 });
}
const settled = (page, timeout = 30000) => page.waitForFunction(() => !document.querySelector('.meal-wrap.analyzing'), null, { timeout });

/* ========== A. 撮った瞬間に記録完了、AIは裏で ========== */
{
  const page = await freshPage();
  let reqBody = null;
  await slowAi(page, 2500, undefined, (req) => { reqBody = JSON.parse(req.postData() || '{}'); });
  await H.seed(page);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await openMeals(page);
  const t0 = Date.now();
  await snap(page);
  const tRecorded = Date.now() - t0;
  check(tRecorded < 1500, `【重要】撮ってから記録完了まで ${tRecorded}ms（AIを待たない）`);
  check(!(await page.$('.sheet')), '【重要】解析待ちの画面が出ない（すぐ次の操作ができる）');
  const m1 = await meal0(page);
  check(m1 && m1.pending && !!m1.photo, 'AIの前に写真つきで記録されている');
  await page.waitForSelector('.meal-wrap.analyzing', { timeout: 2000 });
  check(/AIが解析中/.test(await page.textContent('.meal-wrap.analyzing .meal-name')), '一覧で「AIが解析中…」と分かる');
  check(!!(await page.$('.meal-wrap.analyzing .spinner')), 'くるくるが出る');
  check(!(await page.$('.meal-reanalyze')), '解析中は再解析ボタンを出さない');

  await settled(page);
  const m2 = await meal0(page);
  check(m2.name === '鶏胸肉と玄米' && m2.kcal === 680 && m2.p === 55 && !m2.pending && m2.src === 'ai', '【重要】裏の解析が終わると数値が自動で入る');
  check(/680/.test(await page.textContent('.meal-card .meal-kcal')), '一覧の数値も更新される');
  check(/✨ 鶏胸肉と玄米 680kcal/.test(await page.textContent('#toast')), '終わったら通知で分かる');

  // 送った中身：Googleの推奨どおり
  const gc = reqBody.generationConfig || {};
  check(!('temperature' in gc), '【重要】temperatureを送っていない（ループの原因を除去）');
  check(gc.thinkingConfig && gc.thinkingConfig.thinkingLevel === 'low', `写真はthinking=low（${gc.thinkingConfig && gc.thinkingConfig.thinkingLevel}）`);
  check(gc.responseMimeType === 'application/json', 'JSONモードは維持');
  const img = reqBody.contents[0].parts.find(p => p.inlineData).inlineData.data;
  const dims = execSync(`python3 -c "import sys,base64,io;from PIL import Image;im=Image.open(io.BytesIO(base64.b64decode(sys.stdin.read())));print(max(im.size))"`, { input: img }).toString().trim();
  check(+dims <= 768, `送る画像は768px以下（${dims}px）で送信が速い`);
  check(page._errs.length === 0, `JSエラーなし (${page._errs.join(';').slice(0, 100)})`);
}

/* ========== B. 解析中に削除しても、あとから復活しない ========== */
{
  const page = await freshPage();
  await slowAi(page, 2500);
  await H.seed(page);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await openMeals(page);
  await snap(page);
  await page.click('.meal-card');
  await page.waitForSelector('#md-del');
  check(await page.isVisible('#md-busy'), '詳細にも「解析中」と出る');
  await page.click('#md-del');
  await page.click('#cf-yes');
  await sleep(3500);
  const st = await H.readState(page);
  check((st.meals[today] || []).length === 0, '【重要】解析中に消した記録が、解析完了後に復活しない');
  check(page._errs.length === 0, `JSエラーなし (${page._errs.join(';').slice(0, 100)})`);
}

/* ========== C. 解析中に名前だけ直したら、名前は自分の、数値はAIの ========== */
{
  const page = await freshPage();
  await slowAi(page, 2500);
  await H.seed(page);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await openMeals(page);
  await snap(page);
  await page.click('.meal-card');
  await page.waitForSelector('#md-name');
  await page.fill('#md-name', '親子丼');
  await page.click('#md-save');
  await settled(page);
  const m = await meal0(page);
  check(m.name === '親子丼', `【重要】自分で直した名前はAIに上書きされない（${m.name}）`);
  check(m.kcal === 680 && !m.pending, '触っていない数値はAIが入れる');
}

/* ========== D. 詳細を開いたまま解析が終わっても、古い表示で上書きしない ========== */
{
  const page = await freshPage();
  await slowAi(page, 2000);
  await H.seed(page);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await openMeals(page);
  await snap(page);
  await page.click('.meal-card');
  await page.waitForSelector('#md-kcal');
  await page.fill('#md-kcal', '500'); // カロリーだけ先に自分で入れる
  await page.waitForFunction(() => document.querySelector('#md-busy').style.display === 'none', null, { timeout: 10000 });
  check(await page.inputValue('#md-name') === '鶏胸肉と玄米', '開いている詳細に、AIの結果がその場で入る');
  check(await page.inputValue('#md-kcal') === '500', '自分で入力中の欄は書き換えない');
  check(await page.inputValue('#md-p') === '55', '触っていない欄は最新の値になる');
  await page.click('#md-save');
  await page.waitForTimeout(300);
  const m = await meal0(page);
  check(m.kcal === 500 && m.name === '鶏胸肉と玄米' && m.p === 55, `【重要】保存しても古い表示で上書きしない（${m.name} ${m.kcal}kcal P${m.p}）`);

  // 何も変えずに保存 → 何も変わらない
  await page.click('.meal-card');
  await page.waitForSelector('#md-save');
  await page.click('#md-save');
  await page.waitForTimeout(300);
  const m2 = await meal0(page);
  check(m2.kcal === 500 && m2.p === 55 && m2.f === 12, '何も変えずに保存しても値は変わらない');
}

/* ========== E. 全部落ちても写真は残り、あとからボタンで解析できる ========== */
{
  const page = await freshPage();
  let mode = 'down';
  await page.route(H.GEN, async route => {
    if (mode === 'up') await sleep(600); // 復活後は普通の速さで返す
    await route.fulfill(mode === 'down' ? H.aiErr(503, 'overloaded') : H.aiOk(JSON.stringify(H.MEAL)));
  });
  await H.seed(page);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await openMeals(page);
  await snap(page);
  await settled(page, 90000);
  const m = await meal0(page);
  check(m.pending && !!m.photo, '【重要】AIが全滅しても写真つきの記録は残る');
  check(await page.isVisible('.meal-wrap.pending .meal-reanalyze'), '「AIで解析する」ボタンが出る');
  check(/未解析/.test(await page.textContent('.meal-wrap.pending .meal-meta')), '「未解析」と分かる');
  mode = 'up';
  await page.click('.meal-reanalyze');
  await page.waitForSelector('.meal-wrap.analyzing', { timeout: 3000 });
  await settled(page);
  const m2 = await meal0(page);
  check(m2.kcal === 680 && !m2.pending, 'ボタンを押すと解析されて数値が入る');
  check((await H.readState(page)).meals[today].length === 1, '記録が二重にならない');
}

/* ========== F. 撮ってすぐ閉じても、次に開いたとき自動で解析の続き ========== */
{
  const page = await freshPage();
  let mode = 'down';
  await page.route(H.GEN, async route => {
    await route.fulfill(mode === 'down' ? H.aiErr(503, 'overloaded') : H.aiOk(JSON.stringify(H.MEAL)));
  });
  await H.seed(page);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await openMeals(page);
  await snap(page);
  await settled(page, 90000);
  check((await meal0(page)).pending, '（準備）いったん未解析のまま残る');
  mode = 'up';
  await page.reload({ waitUntil: 'networkidle' });   // アプリを開き直した想定
  await page.waitForFunction((k) => {
    const m = (JSON.parse(localStorage.getItem('kinmeshi_v1')).meals[k] || [])[0];
    return m && !m.pending;
  }, today, { timeout: 20000 });
  const m = await meal0(page);
  check(m.kcal === 680, '【重要】開き直すと、ボタンを押さなくても自動で解析される');
}

/* ========== G. 何度やっても解析できない写真は、自動では2回で諦める ========== */
{
  const page = await freshPage();
  let calls = 0;
  await page.route(H.GEN, async route => { calls++; await route.fulfill(H.aiOk(JSON.stringify({ dish: null }))); });
  await H.seed(page);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await openMeals(page);
  await snap(page);
  await settled(page);
  const c1 = calls;
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(2500);
  const c2 = calls;
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(2500);
  const c3 = calls;
  check(c1 === 1 && c2 === 2 && c3 === 2, `食べ物でない写真は自動再解析を2回で止める（通信 ${c1}→${c2}→${c3}）`);
  const m = await meal0(page);
  check(m.pending && m.aiTries === 2, 'ボタンでの手動解析はいつでもできる状態で残る');
  await openMeals(page);
  check(await page.isVisible('.meal-reanalyze'), '再解析ボタンは出ている');
}

/* ========== H. 相談チャット：できた端から表示（ストリーミング） ========== */
{
  const page = await freshPage();
  await H.seed(page);
  await page.goto(URL, { waitUntil: 'networkidle' });
  // 3回に分けて届くSSE（\r\n がチャンクの境目で割れるケースも入れる）
  await page.evaluate(() => {
    const orig = window.fetch;
    window.__streamCalls = [];
    window.fetch = (url, opts) => {
      if (String(url).includes(':streamGenerateContent')) {
        window.__streamCalls.push({ url: String(url), body: JSON.parse(opts.body) });
        const enc = new TextEncoder();
        const ev = (t) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}`;
        // 3つ目は区切りの \r\n が次のチャンクとの境目で割れる（届くまで表示できないのが正しい）
        const chunks = [ev('体脂肪、') + '\r\n\r\n', ev('ちゃんと') + '\r\n\r\n', ev('落ちてる') + '\r', '\n\r\n' + ev('よ。') + '\r\n\r\n'];
        const stream = new ReadableStream({
          async start(c) {
            for (const ch of chunks) { await new Promise(r => setTimeout(r, 500)); c.enqueue(enc.encode(ch)); }
            c.close();
          },
        });
        return Promise.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
      }
      return orig(url, opts);
    };
  });
  await page.click('.tabbar button[data-tab="advisor"]');
  await page.waitForSelector('#adv-in');
  await page.evaluate(() => {
    window.__snaps = [];
    const log = document.getElementById('adv-log');
    new MutationObserver(() => {
      const live = document.getElementById('adv-live');
      if (live) { const t = live.textContent; if (window.__snaps[window.__snaps.length - 1] !== t) window.__snaps.push(t); }
    }).observe(log, { childList: true, subtree: true, characterData: true });
  });
  const t0 = Date.now();
  await page.fill('#adv-in', '体脂肪ちゃんと落ちてる？');
  await page.press('#adv-in', 'Enter');
  await page.waitForSelector('#adv-live', { timeout: 3000 });
  const tFirst = Date.now() - t0;
  await page.waitForFunction(() => !document.getElementById('adv-live') && !document.querySelector('.chat-msg.typing'), null, { timeout: 10000 });
  const snaps = await page.evaluate(() => window.__snaps);
  check(snaps.length >= 3, `【重要】返事が少しずつ表示される（${snaps.map(s => `「${s}」`).join('→')}）`);
  check(snaps[0] === '体脂肪、' && snaps[1] === '体脂肪、ちゃんと' && snaps.every((s, i) => i === 0 || s.startsWith(snaps[i - 1])), '前の続きに文字が足されていく');
  check(tFirst < 1500, `最初の文字が出るまで ${tFirst}ms（全部書き終わるのを待たない）`);
  const msgs = await page.$$eval('.chat-msg.ai', els => els.map(e => e.textContent));
  check(msgs[msgs.length - 1] === '体脂肪、ちゃんと落ちてるよ。', `\\r\\nが割れても最後まで正しくつながる（${msgs[msgs.length - 1]}）`);
  const call = (await page.evaluate(() => window.__streamCalls))[0];
  check(/:streamGenerateContent\?alt=sse/.test(call.url), 'ストリーミングのAPIを使っている');
  const gc = call.body.generationConfig || {};
  check(!('temperature' in gc) && gc.thinkingConfig && gc.thinkingConfig.thinkingLevel === 'minimal', `チャットはthinking=minimal・temperatureなし（${JSON.stringify(gc)}）`);
  const st = await H.readState(page);
  check(st.advisorChat[st.advisorChat.length - 1].text === '体脂肪、ちゃんと落ちてるよ。', '会話は保存される');
}

/* ========== I. ストリーミングも503ならリトライ ========== */
{
  const page = await freshPage();
  let n = 0;
  await page.route(H.STREAM, async route => {
    n++;
    await route.fulfill(n === 1 ? H.aiErr(503, 'overloaded') : H.sseOk('やあ', '、元気？'));
  });
  await H.seed(page);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.click('.tabbar button[data-tab="advisor"]');
  await page.fill('#adv-in', 'こんにちは');
  await page.press('#adv-in', 'Enter');
  await page.waitForFunction(() => !document.querySelector('.chat-msg.typing') && !document.getElementById('adv-live') && document.querySelectorAll('.chat-msg.ai').length > 0, null, { timeout: 15000 });
  const last = await page.$$eval('.chat-msg.ai', els => els[els.length - 1].textContent);
  check(n === 2 && last === 'やあ、元気？', `ストリーミングでも503なら投げ直して通る（${n}回, 「${last}」）`);
}

/* ========== J. 途中で回線が切れたら、出た分は残す ========== */
{
  const page = await freshPage();
  await H.seed(page);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const orig = window.fetch;
    window.__n = 0;
    window.fetch = (url, opts) => {
      if (String(url).includes(':streamGenerateContent')) {
        window.__n++;
        const enc = new TextEncoder();
        const stream = new ReadableStream({
          async start(c) {
            await new Promise(r => setTimeout(r, 300));
            c.enqueue(enc.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '先週の胸は2,400kgで' }] } }] })}\r\n\r\n`));
            await new Promise(r => setTimeout(r, 300));
            c.error(new TypeError('network error'));
          },
        });
        return Promise.resolve(new Response(stream, { status: 200 }));
      }
      return orig(url, opts);
    };
  });
  await page.click('.tabbar button[data-tab="advisor"]');
  await page.fill('#adv-in', '胸どう？');
  await page.press('#adv-in', 'Enter');
  await page.waitForFunction(() => !document.getElementById('adv-live') && !document.querySelector('.chat-msg.typing') && document.querySelectorAll('.chat-msg.ai').length > 0, null, { timeout: 10000 });
  const last = await page.$$eval('.chat-msg.ai', els => els[els.length - 1].textContent);
  const n = await page.evaluate(() => window.__n);
  check(/先週の胸は2,400kgで/.test(last) && /途中で切れました/.test(last), '途中で切れても、届いた分は残して切れたことを伝える');
  check(n === 1, `表示し始めた後はやり直さない（二重表示を防ぐ／${n}回）`);
  check(await page.$$eval('.chat-msg.user', e => e.length) === 1, '自分の質問も残っている');
}

/* ========== K. 返事の途中でタブを移動して戻っても、固まらない ========== */
{
  const page = await freshPage();
  await H.seed(page);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const orig = window.fetch;
    window.fetch = (url, opts) => {
      if (String(url).includes(':streamGenerateContent')) {
        const enc = new TextEncoder();
        const ev = (t) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\r\n\r\n`;
        const stream = new ReadableStream({
          async start(c) {
            for (const t of ['一つ目、', '二つ目、', '三つ目。']) { await new Promise(r => setTimeout(r, 700)); c.enqueue(enc.encode(ev(t))); }
            c.close();
          },
        });
        return Promise.resolve(new Response(stream, { status: 200 }));
      }
      return orig(url, opts);
    };
  });
  await page.click('.tabbar button[data-tab="advisor"]');
  await page.fill('#adv-in', 'テスト');
  await page.press('#adv-in', 'Enter');
  await page.waitForSelector('#adv-live', { timeout: 3000 });
  await page.click('.tabbar button[data-tab="home"]');
  await sleep(400);
  await page.click('.tabbar button[data-tab="advisor"]');
  await page.waitForSelector('#adv-live', { timeout: 2000 });
  const mid = await page.textContent('#adv-live');
  check(/一つ目、/.test(mid), `戻った画面にも途中までの返事が出ている（「${mid}」）`);
  await page.waitForFunction(() => !document.getElementById('adv-live') && !document.querySelector('.chat-msg.typing'), null, { timeout: 8000 });
  const last = await page.$$eval('.chat-msg.ai', els => els[els.length - 1].textContent);
  check(last === '一つ目、二つ目、三つ目。', `【重要】「考え中…」で固まらず最後まで表示される（${last}）`);
}

/* ========== L. SSEの読み取り（1文字ずつ届く最悪ケース） ========== */
{
  const page = await freshPage();
  await H.seed(page);
  await page.goto(URL, { waitUntil: 'networkidle' });
  const got = await page.evaluate(() => {
    const out = [];
    const p = geminiSseParser(o => out.push(geminiTextOf(o)));
    const ev = (t) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }, { text: 'ひみつ', thought: true }] } }] })}\r\n\r\n`;
    const all = ev('あ') + ev('い') + ': コメント行\n\n' + ev('う');
    for (const ch of all) p.push(ch);
    p.end();
    return out;
  });
  check(got.join('') === 'あいう', `1文字ずつ届いても正しく読める（${got.join('|')}）`);
  check(!got.join('').includes('ひみつ'), 'AIの思考パートは本文に混ぜない');
}

await close();
server.close();
finish();
})();
