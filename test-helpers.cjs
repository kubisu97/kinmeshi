/* テスト共通の道具（静的サーバ・シード・Geminiのモック） */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json',
};

function startServer(port) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  return new Promise(r => server.listen(port, () => r(server)));
}

function makeChecker() {
  const ok = [], fail = [];
  const check = (cond, label) => { (cond ? ok : fail).push(label); console.log(`${cond ? '✅' : '❌'} ${label}`); };
  const finish = () => {
    console.log(`\n===== ${ok.length} passed / ${fail.length} failed =====`);
    if (fail.length) { fail.forEach(f => console.log('  ❌ ' + f)); process.exitCode = 1; }
  };
  return { check, finish };
}

/* テスト用の食事写真を作る（無ければ） */
function ensureFoodJpg() {
  fs.mkdirSync(path.join(ROOT, 'shots'), { recursive: true });
  const out = path.join(ROOT, 'shots', 'food.jpg');
  if (!fs.existsSync(out)) {
    require('child_process').execSync(`python3 -c "
from PIL import Image, ImageDraw
img = Image.new('RGB', (800, 600), (200, 160, 110))
d = ImageDraw.Draw(img)
d.ellipse([150, 100, 650, 500], fill=(240, 240, 235))
img.save('${out}', quality=85)
"`);
  }
  return out;
}

/* 日付キー（テスト側で使う） */
function dayKey(n = 0) {
  const d = new Date(); d.setDate(d.getDate() - n);
  const p = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ページを開く前に状態を仕込む。extra で上書き可 */
function seed(page, extra = {}) {
  return page.addInitScript((ex) => {
    if (sessionStorage.getItem('__seeded')) return; // リロードでは上書きしない
    sessionStorage.setItem('__seeded', '1');
    const base = {
      ver: 1,
      settings: { apiKey: 'K', model: 'gemini-3.5-flash', targets: { kcal: 2200, p: 130, f: 60, c: 270 }, profile: { weight: 68, goal: 'cut' }, activity: 'mid', restSec: 90, notifyTime: '21:00' },
      inbody: [], routines: [], mealFavs: [], progressPhotos: [], advisorChat: [], customExercises: [],
      workouts: {}, meals: {}, createdAt: new Date().toISOString(),
    };
    const baseSettings = base.settings;
    const st = Object.assign(base, ex);
    if (ex.settings) st.settings = Object.assign({}, baseSettings, ex.settings);
    localStorage.setItem('kinmeshi_v1', JSON.stringify(st));
  }, extra);
}

const aiOk = (t) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] }) });
const aiErr = (code, msg) => ({ status: code, contentType: 'application/json', body: JSON.stringify({ error: { code, message: msg } }) });
/* SSEのレスポンス（複数チャンク） */
const sseOk = (...pieces) => ({
  status: 200, contentType: 'text/event-stream',
  body: pieces.map(t => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] } }] })}\r\n\r\n`).join(''),
});

const GEN = '**generativelanguage.googleapis.com/**:generateContent';
const STREAM = '**generativelanguage.googleapis.com/**:streamGenerateContent*';

const MEAL = { dish: '鶏胸肉と玄米', items: [{ name: '鶏胸肉', amount: '200g', kcal: 220, p: 46, f: 3, c: 0 }], total: { kcal: 680, p: 55, f: 12, c: 78 }, confidence: 0.9, note: '' };

async function launch() {
  const browser = await chromium.launch();
  const contexts = [];
  const freshPage = async () => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    contexts.push(c);
    const page = await c.newPage();
    page._errs = [];
    page.on('pageerror', e => page._errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page._errs.push(m.text()); });
    return page;
  };
  const close = async () => { for (const c of contexts) await c.close(); await browser.close(); };
  return { browser, freshPage, close };
}

/* localStorageの状態を読む */
const readState = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('kinmeshi_v1')));

module.exports = { startServer, makeChecker, ensureFoodJpg, dayKey, seed, aiOk, aiErr, sseOk, GEN, STREAM, MEAL, launch, readState };
