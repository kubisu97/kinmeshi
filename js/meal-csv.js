/* 筋メシ - 食事のまとめて入力（CSV・表計算アプリからの貼り付け・手打ち）
   記録を何日か忘れても、あとから一気に入れられるように。
   - CSV（Excel/Numbers/Googleスプレッドシート。UTF-8でもShift_JISでも）
   - 表計算アプリでセルをコピーして貼り付け（タブ区切り）
   - スマホで手打ち：「10/10 朝 オートミール」「昼 カレー 850」のようにスペース区切り
   数値が空なら、過去の同じ名前の記録 → よく食べるもの（プリセット）→ AI の順で埋める。 */
'use strict';

/* ================= 読み取り ================= */

function mcNorm(s) { return String(s == null ? '' : s).normalize('NFKC').trim(); }
const mcPad = (n) => String(n).padStart(2, '0');
const mcMin = (s) => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : null; };

/* 朝・昼・夜などの言葉 → 時刻（「夜食」は「夜」より先に判定） */
const MEAL_SLOT_DEFS = [
  ['ブランチ', '10:30', /^(ブランチ|朝昼(食|ごはん|ご飯)?|brunch)$/i],
  ['夜食', '22:30', /^夜食$/],
  ['朝', '07:30', /^(朝|あさ)(食|ごはん|ご飯|飯|めし)?$|^(モーニング|breakfast)$/i],
  ['昼', '12:30', /^(お?昼|お?ひる)(食|ごはん|ご飯|飯|めし)?$|^(ランチ|lunch)$/i],
  ['夜', '19:00', /^(夕|夜|晩|よる|ばん|ゆう)(食|ごはん|ご飯|飯|めし|はん)?$|^(ディナー|dinner)$/i],
  ['間食', '15:30', /^(間食|おやつ|補食|軽食|snack)$/i],
];
const MC_WEEKDAY_RE = /^\(?[日月火水木金土](曜日?)?\)?$/;
/* 時刻が書いていない行は、その日の中の順番でふる（1件なら昼、3件なら朝昼夜） */
const MC_DEFAULT_TIMES = { 1: ['12:30'], 2: ['12:30', '19:00'], 3: ['07:30', '12:30', '19:00'], many: ['07:30', '10:30', '12:30', '15:30', '19:00', '21:30'] };

/* 時刻：「8:00」「8時30分」「午後7時」「7pm」「朝」「夕食」など */
function mcParseTime(s) {
  s = mcNorm(s).toLowerCase();
  if (!s) return null;
  let m = s.match(/^(午前|午後|am|pm)?\s*(\d{1,2})\s*(?::|時)\s*(\d{1,2})?\s*分?(?::\d{1,2})?\s*(am|pm)?$/);
  if (!m) { const m2 = s.match(/^(\d{1,2})\s*(am|pm)$/); if (m2) m = [s, '', m2[1], '0', m2[2]]; }
  if (m) {
    let h = +m[2];
    const mi = m[3] ? +m[3] : 0;
    const ap = m[1] || m[4] || '';
    if ((ap === '午後' || ap === 'pm') && h < 12) h += 12;
    if ((ap === '午前' || ap === 'am') && h === 12) h = 0;
    if (h > 23 || mi > 59) return null;
    return { time: `${mcPad(h)}:${mcPad(mi)}`, slot: '' };
  }
  for (const [label, time, re] of MEAL_SLOT_DEFS) if (re.test(s)) return { time, slot: label };
  return null;
}
/* 「2026/10/10 8:00」のように日付と時刻が1つのセルに入っている場合の時刻 */
function mcTimeInText(s) {
  const m = mcNorm(s).match(/\s(\d{1,2}:\d{2})/);
  const t = m ? mcParseTime(m[1]) : null;
  return t ? t.time : '';
}

/* 日付：「2026/10/10」「2026-10-10」「10/10」「10月10日」「10/10(土)」「20261010」「昨日」
   戻り値: 'YYYY-MM-DD' / null（日付ではない）/ false（日付の形だけど存在しない日） */
function mcParseDate(s, today = todayStr()) {
  s = mcNorm(s).replace(/^[\[【〔「『(]+/, '').replace(/[\]】〕」』)]+$/, '');
  if (!s) return null;
  if (/^(今日|きょう|today)$/i.test(s)) return today;
  if (/^(昨日|きのう|yesterday)$/i.test(s)) return addDays(today, -1);
  if (/^(一昨日|おととい)$/.test(s)) return addDays(today, -2);
  let y, mo, d, m;
  if ((m = s.match(/^(\d{4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})\s*日?/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})\s*[/\-月]\s*(\d{1,2})\s*日?(?![\d.:])/))
    || (m = s.match(/^(\d{1,2})\.(\d{1,2})(\([日月火水木金土]\))?$/))) { // 「10.10」は1語のときだけ（「1.5人前」を日付にしない）
    mo = +m[1]; d = +m[2];
    y = +today.slice(0, 4);
    if (`${y}-${mcPad(mo)}-${mcPad(d)}` > today) y -= 1; // 年が無くて未来の日付になるなら去年のこと
  } else return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return false;
  return dateToStr(dt);
}

/* 数値：「520」「520kcal」「38g」「約500」「1,200」 */
function mcParseNum(s) {
  s = mcNorm(s).replace(/,/g, '');
  if (!s) return null;
  const m = s.match(/\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return isFinite(n) ? n : null;
}

/* 区切り文字：半分以上の行にタブがあれば表計算からの貼り付け、カンマならCSV、どちらも無ければ手打ち */
function mcDetectDelim(text) {
  const lines = text.split(/\r\n|\r|\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).slice(0, 10);
  if (!lines.length) return null;
  const share = (d) => lines.filter(l => l.includes(d)).length / lines.length;
  if (share('\t') >= 0.5) return '\t';
  if (share(',') >= 0.5) return ',';
  return null;
}

/* CSVを行・セルに分ける（"…" の中のカンマ・改行・"" に対応）。行番号も返す */
function mcCsvRows(text, delim) {
  const rows = [];
  let row = [], cell = '', q = false, line = 1, rowLine = 1;
  const pushCell = () => { row.push(cell); cell = ''; };
  const endRow = () => { pushCell(); rows.push({ line: rowLine, cells: row }); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else { if (ch === '\n') line++; cell += ch; }
      continue;
    }
    if (ch === '"' && cell.trim() === '') { q = true; cell = ''; continue; }
    if (ch === delim) { pushCell(); continue; }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow(); line++; rowLine = line;
      continue;
    }
    cell += ch;
  }
  if (cell !== '' || row.length) endRow();
  return rows.filter(r => r.cells.some(c => c.trim() !== ''));
}

/* 見出しの行（日付,時刻,名前,kcal,P,F,C など）。名前の列があり、2つ以上わかれば見出しとみなす */
const MC_HEAD = [
  ['date', /^(日付|日にち|年月日|月日|日|date|day)$/],
  ['dow', /^(曜日|曜|weekday|dow)$/],
  ['time', /^(時刻|時間|時間帯|タイミング|区分|食事区分|time|slot)$/],
  ['name', /^(名前|食事|食事内容|内容|メニュー|料理|料理名|品名|食品|食品名|食べたもの|食べ物|name|food|meal|menu|item)$/],
  ['kcal', /^(kcal|カロリー|エネルギー|熱量|energy|calorie|calories|cal)$/],
  ['p', /^(p|たんぱく質|タンパク質|蛋白質|たんぱく|タンパク|protein)$/],
  ['f', /^(f|脂質|脂肪|fat)$/],
  ['c', /^(c|炭水化物|糖質|carb|carbs|carbohydrate|carbohydrates)$/],
  ['memo', /^(メモ|備考|note|memo|記録方法|方法)$/],
];
function mcHeadKey(cell) {
  const h = mcNorm(cell).toLowerCase().replace(/[(\[【].*$/, '').replace(/\s+/g, '');
  for (const [k, re] of MC_HEAD) if (re.test(h)) return k;
  return null;
}
function mcHeaderMap(cells) {
  const ci = {};
  let hits = 0;
  cells.forEach((c, i) => { const k = mcHeadKey(c); if (k && ci[k] == null) { ci[k] = i; hits++; } });
  return hits >= 2 && ci.name != null ? ci : null;
}

/* 見出しありのCSVの1行 */
function mcRowByHeader(cells, ci) {
  const g = (k) => (ci[k] == null ? '' : mcNorm(cells[ci[k]]));
  const out = { name: g('name') };
  const ds = g('date');
  if (ds) { out.date = mcParseDate(ds); out.rawDate = ds; const tm = mcTimeInText(ds); if (tm) out.time = tm; }
  const ts = g('time');
  if (ts) { const t = mcParseTime(ts); if (t) Object.assign(out, t); }
  for (const k of ['kcal', 'p', 'f', 'c']) { const v = mcParseNum(g(k)); if (v != null) out[k] = v; }
  return out;
}

/* 見出しなしのCSVの1行：日付, (曜日), (時刻), 名前, kcal, P, F, C の順。日付・時刻は省略可 */
function mcRowByPosition(cells) {
  const c = cells.map(mcNorm);
  const out = {};
  let i = 0;
  const d = mcParseDate(c[0]);
  if (d !== null) { out.date = d; out.rawDate = c[0]; i = 1; const tm = mcTimeInText(c[0]); if (tm) out.time = tm; }
  else if (c[0] === '') i = 1; // 日付の列が空 → 上の行と同じ日
  if (i < c.length && MC_WEEKDAY_RE.test(c[i])) i++;
  if (i < c.length) {
    const t = mcParseTime(c[i]);
    if (t) { Object.assign(out, t); i++; }
    else if (c[i] === '' && i + 1 < c.length && c[i + 1] !== '' && mcParseNum(c[i + 1]) === null) i++; // 時刻の列が空
  }
  out.name = c[i] || '';
  ['kcal', 'p', 'f', 'c'].forEach((k, j) => { const v = mcParseNum(c[i + 1 + j]); if (v != null) out[k] = v; });
  return out;
}

/* 手打ちの1行：「10/10 朝 オートミール 380 30 8 52」「昼 カレー 850kcal P22」「10/10、夜、鶏むね定食」 */
function mcRowByWords(line) {
  const s = mcNorm(line).replace(/^[・\-*•●○◯□■◆◇▶▷>]+\s*/, '')
    // 「10/10朝 …」のように日付のすぐ後ろに続けて書いた場合も分ける
    .replace(/^((?:\d{4}[/\-.年])?\d{1,2}[/\-月]\d{1,2}日?(?:\([日月火水木金土]\))?)(?=[^\s\d/\-.:、])/, '$1 ');
  const spaced = /\s/.test(s);
  const t = s.split(spaced ? /\s+/ : /、/).filter(Boolean);
  const joiner = spaced ? ' ' : '、';
  const out = {};
  if (t.length) {
    const d = mcParseDate(t[0]);
    if (d !== null) {
      out.date = d; out.rawDate = t[0]; t.shift();
      if (t.length && MC_WEEKDAY_RE.test(t[0])) t.shift();
    }
  }
  if (t.length) {
    const k = t[0].indexOf(':'); // 「朝:オートミール」
    if (k > 0 && !mcParseTime(t[0]) && mcParseTime(t[0].slice(0, k))) t.splice(0, 1, ...[t[0].slice(0, k), t[0].slice(k + 1)].filter(Boolean));
    const tm = mcParseTime(t[0]);
    if (tm) { Object.assign(out, tm); t.shift(); }
  }
  // 後ろから数値を拾う（名前は最低1語残す）
  const nums = {};
  const plain = [];
  while (t.length > 1) {
    const last = t[t.length - 1];
    let m;
    if ((m = last.match(/^(\d+(?:\.\d+)?)kcal$/i)) && nums.kcal == null) { nums.kcal = +m[1]; t.pop(); continue; }
    if ((m = last.match(/^([pfc])[:=]?(\d+(?:\.\d+)?)g?$/i)) && nums[m[1].toLowerCase()] == null) { nums[m[1].toLowerCase()] = +m[2]; t.pop(); continue; }
    if ((m = last.match(/^(\d+(?:\.\d+)?)g?$/i))) { plain.unshift({ v: +m[1], tok: last }); t.pop(); continue; }
    break;
  }
  // 「バナナ 2」「ゆで卵 2 140」の小さい数字は個数などの名前の一部
  while (plain.length && nums.kcal == null && plain[0].v < 20) t.push(plain.shift().tok);
  const order = ['kcal', 'p', 'f', 'c'].filter(k => nums[k] == null);
  plain.forEach((x, i) => { if (order[i]) nums[order[i]] = x.v; });
  Object.assign(out, nums);
  out.name = t.join(joiner).trim();
  out.dateOnly = !!out.date && !out.name && !out.time; // 「10/10」だけの行＝以降の日付の見出し
  return out;
}

/* テキスト全体を読む → { rows, errors, skipped } */
function parseMealImportText(text, today = todayStr()) {
  const src = String(text || '').replace(/^﻿/, '').normalize('NFKC');
  const delim = mcDetectDelim(src);
  const raw = [];
  if (delim) {
    const rows = mcCsvRows(src, delim).filter(r => !mcNorm(r.cells[0]).startsWith('#'));
    const ci = rows.length ? mcHeaderMap(rows[0].cells) : null;
    for (let k = ci ? 1 : 0; k < rows.length; k++) {
      raw.push(Object.assign({ line: rows[k].line }, ci ? mcRowByHeader(rows[k].cells, ci) : mcRowByPosition(rows[k].cells)));
    }
  } else {
    let first = true;
    src.split(/\r\n|\r|\n/).forEach((l, k) => {
      const s = l.trim();
      if (!s || s.startsWith('#')) return;
      if (first) { first = false; if (mcHeaderMap(s.split(/\s+/))) return; } // 見出しの行
      raw.push(Object.assign({ line: k + 1 }, mcRowByWords(s)));
    });
  }
  return mcFinalize(raw, today);
}

function mcFinalize(raw, today) {
  const rows = [], errors = [];
  let skipped = 0, cur = null;
  for (const r of raw) {
    if (r.date === false) { errors.push({ line: r.line, msg: `日付が読めません（${r.rawDate}）` }); cur = false; continue; }
    if (r.date) cur = r.date;
    if (!r.name) { if (!r.dateOnly) skipped++; continue; }
    const date = r.date || cur;
    if (date === false) { errors.push({ line: r.line, msg: '上の行の日付が読めなかったので、とばしました' }); continue; }
    if (!date) { errors.push({ line: r.line, msg: '日付がありません（最初の行には日付を書いてください）' }); continue; }
    if (date > today) { errors.push({ line: r.line, msg: `未来の日付です（${fmtDateJa(date)}）` }); continue; }
    rows.push({
      line: r.line, date, time: r.time || '', timeGiven: !!r.time, slot: r.slot || '',
      name: r.name.slice(0, 80),
      kcal: r.kcal ?? null, p: r.p ?? null, f: r.f ?? null, c: r.c ?? null,
    });
  }
  mcFillTimes(rows);
  return { rows, errors, skipped };
}

/* 時刻が書いていない行に時刻をふる。書いた順番を手がかりにする
   （「朝 A / 昼 B / C」のCは夜、「A / 昼 B」のAは朝）。どこにも時刻が無い日は件数で決める */
const MC_TIME_LADDER = ['07:30', '12:30', '19:00', '15:30', '10:30', '21:30', '22:30'];
function mcFillTimes(rows) {
  const byDate = new Map();
  rows.forEach(r => { if (!byDate.has(r.date)) byDate.set(r.date, []); byDate.get(r.date).push(r); });
  for (const list of byDate.values()) {
    const timeless = list.filter(r => !r.time);
    if (!timeless.length) continue;
    if (timeless.length === list.length) {
      const seq = MC_DEFAULT_TIMES[list.length] || MC_DEFAULT_TIMES.many;
      list.forEach((r, i) => { r.time = seq[Math.min(i, seq.length - 1)]; });
      continue;
    }
    const used = new Set(list.filter(r => r.time).map(r => r.time));
    list.forEach((r, k) => {
      if (r.time) return;
      const before = list.slice(0, k).map(x => x.time).filter(Boolean).sort();
      const after = list.slice(k + 1).filter(x => x.timeGiven).map(x => x.time).sort();
      const prev = before[before.length - 1] || '', next = after[0] || '';
      r.time = MC_TIME_LADDER.find(t => (!prev || t > prev) && (!next || t < next) && !used.has(t)) || prev || next || '12:30';
      used.add(r.time);
    });
  }
}

/* ================= 取り込みの計画（数値の補い・重複） ================= */

function mcIsDup(existing, r, key) {
  const t = mcMin(r.time);
  return existing.some(m => m && mealFold(m.name) === key
    && (!r.timeGiven || mcMin(m.time) == null || Math.abs(mcMin(m.time) - t) <= 90));
}

function planMealImport(parsed) {
  const hasKey = !!geminiKey();
  const hist = new Map(mealHistory(todayStr()).map(e => [e.key, e]));
  const quick = new Map(QUICK_FOODS.map(f => [mealFold(f.name), f]));
  const seen = new Set();
  const rows = parsed.rows.map(r => {
    const key = mealFold(r.name);
    const given = ['kcal', 'p', 'f', 'c'].filter(k => r[k] != null);
    const vals = { kcal: r.kcal, p: r.p, f: r.f, c: r.c };
    let src = 'csv', items = [];
    if (given.length < 4) {
      const ref = hist.get(key) || quick.get(key) || null;
      if (ref) {
        for (const k of ['kcal', 'p', 'f', 'c']) if (vals[k] == null) vals[k] = num(ref[k]);
        src = hist.has(key) ? 'hist' : 'preset';
        if (!given.length && Array.isArray(ref.items)) items = ref.items;
      } else if (hasKey) {
        src = 'ai';
      } else {
        src = 'none';
        for (const k of ['kcal', 'p', 'f', 'c']) if (vals[k] == null) vals[k] = 0;
      }
    }
    // すでに同じ記録がある（同じ日・同じ名前・近い時刻）→ 最初はチェックを外しておく
    const sk = `${r.date}|${r.time}|${key}`;
    const dup = mcIsDup(state.meals[r.date] || [], r, key) || seen.has(sk);
    seen.add(sk);
    return Object.assign({}, r, { key, given, vals, src, items, dup, include: !dup });
  });
  return { rows, errors: parsed.errors, skipped: parsed.skipped, hasKey };
}

/* 計画どおりに記録する。数値をAIに聞く分は「解析待ち」にしておき、名前と書いた数値は上書きさせない */
function commitMealImport(plan) {
  const added = [], ai = [], dates = new Set();
  for (const r of plan.rows) {
    if (!r.include) continue;
    const meal = {
      id: uid(), time: r.time, name: r.name,
      kcal: num(r.vals.kcal), p: num(r.vals.p), f: num(r.vals.f), c: num(r.vals.c),
      photo: null, src: 'csv', items: (r.items || []).map(it => Object.assign({}, it)),
    };
    if (r.src === 'ai') {
      Object.assign(meal, { pending: true, src: 'pending', aiText: r.name, edited: { name: true } });
      r.given.forEach(k => { meal.edited[k] = true; });
    }
    if (!state.meals[r.date]) state.meals[r.date] = [];
    state.meals[r.date].push(meal);
    dates.add(r.date);
    added.push({ date: r.date, id: meal.id });
    if (meal.pending) ai.push({ date: r.date, id: meal.id });
  }
  // その日の一覧を時刻順に（あとから昼の分を足しても朝→昼→夜に並ぶ）
  for (const d of dates) state.meals[d].sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
  saveState();
  return { added, ai, dates: [...dates].sort() };
}

function undoMealImport(added) {
  let n = 0;
  for (const { date, id } of added) {
    const arr = state.meals[date] || [];
    const at = arr.findIndex(m => m.id === id);
    if (at >= 0) { arr.splice(at, 1); n++; }
    if (state.meals[date] && !state.meals[date].length) delete state.meals[date];
  }
  saveState();
  return n;
}

/* ================= 画面 ================= */

/* 最後に記録した日から今日までに、2日以上の空きがあればその期間（「10/10〜10/15」） */
function mealGap() {
  const today = todayStr();
  let last = null;
  for (const d of Object.keys(state.meals || {})) {
    if (d < today && (state.meals[d] || []).length && (!last || d > last)) last = d;
  }
  if (!last) return null;
  const between = daysBetween(last, today) - 1;
  if (between < 2 || between > 60) return null;
  return { from: addDays(last, 1), to: addDays(today, -1), days: between };
}

const MC_PLACEHOLDER = '10/10 朝 オートミール\n昼 カレーライス\n夜 鶏むね定食 650\n10/11 朝 プロテイン\n\n（CSVの「日付,時刻,名前,kcal,P,F,C」もそのまま貼れます）';

function mcRange(dates) {
  if (!dates.length) return '';
  const a = fmtDateJa(dates[0]), b = fmtDateJa(dates[dates.length - 1]);
  return a === b ? a : `${a}〜${b}`;
}

function openMealImport({ text = '' } = {}) {
  const gap = mealGap();
  const body = sheet('まとめて入力', `
    <div id="ci-input">
      <div class="hint">1行に1食。<b>日付・時刻・名前</b>があればOK。時刻は「朝・昼・夜・間食」でもよく、日付を省くと上の行と同じ日になります。kcal・P・F・Cが空なら、<b>過去の同じ名前の記録</b> → 無ければ<b>AI</b>が数値を入れます。</div>
      ${gap ? `<div class="an-note ci-gap">🗓 ${esc(fmtDateJa(gap.from))}〜${esc(fmtDateJa(gap.to))}（${gap.days}日分）の記録が空いています。テンプレートにはこの期間の朝・昼・夜の行が入っています</div>` : ''}
      <div class="btn-row ci-files">
        <button class="btn ghost" id="ci-tpl" type="button">📥 テンプレート</button>
        <button class="btn ghost" id="ci-pick" type="button">📂 CSVを選ぶ</button>
      </div>
      <input type="file" id="ci-file" accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values" hidden>
      <div class="qf-label ci-paste-label">または、ここに貼り付け・入力（表計算アプリでコピーしたセルもOK）</div>
      <textarea class="input ci-text" id="ci-text" rows="7" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(MC_PLACEHOLDER)}"></textarea>
      <button class="btn primary ci-read" id="ci-read" type="button">読み込む</button>
    </div>
    <div id="ci-preview" style="display:none"></div>`);
  const ta = body.querySelector('#ci-text');
  ta.value = text;

  body.querySelector('#ci-tpl').addEventListener('click', async () => {
    const t = mealTemplateCsv();
    const r = await saveTextFile(`kinmeshi_meals_${t.from.replace(/-/g, '')}-${t.to.replace(/-/g, '')}.csv`, t.text);
    if (r !== 'cancel') toast('テンプレートを保存しました。名前を書いたら「CSVを選ぶ」で読み込んでください', 3600);
  });
  const fileIn = body.querySelector('#ci-file');
  body.querySelector('#ci-pick').addEventListener('click', () => fileIn.click());
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files && fileIn.files[0];
    fileIn.value = '';
    if (!f) return;
    let buf;
    try { buf = await f.arrayBuffer(); } catch (e) { toast('ファイルを読めませんでした'); return; }
    const head = new Uint8Array(buf.slice(0, 2));
    if (head[0] === 0x50 && head[1] === 0x4b) { // zip＝.xlsx / .numbers
      toast('Excel・Numbersのファイルはそのままでは読めません。「CSV」で保存（書き出し）してから選んでください', 4200);
      return;
    }
    const t = decodeCsvBuffer(buf);
    ta.value = t;
    showMealImportPreview(body, t);
  });
  body.querySelector('#ci-read').addEventListener('click', () => {
    if (!ta.value.trim()) { toast('貼り付けるか、ファイルを選んでください'); ta.focus(); return; }
    showMealImportPreview(body, ta.value);
  });
  return body;
}

const MC_SRC_LABEL = { csv: '', hist: '過去の記録から', preset: 'よく食べるものから', ai: '<b class="ci-ai">AIが計算</b>', none: '数値なし' };

function showMealImportPreview(body, text) {
  const plan = planMealImport(parseMealImportText(text));
  const { rows, errors, skipped, hasKey } = plan;
  const input = body.querySelector('#ci-input');
  const pv = body.querySelector('#ci-preview');

  // 日付ごと・時刻順に並べて表示（チェックは plan.rows の番号で持つ）
  const groups = new Map();
  rows.forEach((r, i) => { if (!groups.has(r.date)) groups.set(r.date, []); groups.get(r.date).push(i); });
  const dates = [...groups.keys()].sort();
  const count = (src) => rows.filter(r => r.src === src).length;
  const sum = [
    count('csv') && `書いた数値 ${count('csv')}`,
    count('hist') && `過去の記録から ${count('hist')}`,
    count('preset') && `プリセットから ${count('preset')}`,
    count('ai') && `AIが計算 ${count('ai')}`,
    count('none') && `数値なし ${count('none')}`,
  ].filter(Boolean);
  const dupN = rows.filter(r => r.dup).length;
  const rowHtml = (i) => {
    const r = rows[i];
    const v = r.vals;
    const valsText = r.src === 'ai'
      ? (r.given.length ? r.given.map(k => (k === 'kcal' ? `${Math.round(v.kcal)}kcal` : `${k.toUpperCase()}${Math.round(v[k])}`)).join(' ') : '')
      : `${Math.round(num(v.kcal))}kcal ・ P${Math.round(num(v.p))}`;
    const src = r.src === 'hist' && r.given.length ? '残りは過去の記録から' : MC_SRC_LABEL[r.src];
    return `
      <label class="ci-row${r.dup ? ' dup' : ''}">
        <input type="checkbox" class="ci-check" data-ci="${i}" ${r.include ? 'checked' : ''}>
        <span class="ci-time">${esc(r.time)}</span>
        <span class="ci-main">
          <span class="ci-name">${esc(r.name)}</span>
          <span class="ci-meta">${metaJoin([valsText, src, r.dup ? 'すでに記録あり' : ''])}</span>
        </span>
      </label>`;
  };

  pv.innerHTML = `
    <div class="ci-head">
      <div class="ci-count">${rows.length ? `<b>${rows.length}件</b>見つかりました（${esc(mcRange(dates))}）` : '取り込める行が見つかりませんでした'}</div>
      ${sum.length ? `<div class="ci-sum">${metaJoin(sum)}</div>` : ''}
    </div>
    ${dupN ? `<div class="hint">同じ日に同じ記録がすでにある${dupN}件は、チェックを外してあります</div>` : ''}
    ${!hasKey && count('none') ? `<div class="an-note">APIキーが未設定なので、数値が空の${count('none')}件は0kcalで記録されます（あとでタップして直せます）</div>` : ''}
    <div class="ci-list">
      ${dates.map(d => `
        <div class="ci-day">${esc(fmtDateJa(d, d.slice(0, 4) !== todayStr().slice(0, 4)))}<span>${groups.get(d).length}件</span></div>
        ${groups.get(d).sort((a, b) => rows[a].time.localeCompare(rows[b].time)).map(rowHtml).join('')}`).join('')}
    </div>
    ${errors.length ? `<div class="an-note err ci-errors"><b>読めなかった行（${errors.length}件）</b>${errors.slice(0, 10).map(e => `<div>${e.line}行目：${esc(e.msg)}</div>`).join('')}${errors.length > 10 ? `<div>…ほか${errors.length - 10}件</div>` : ''}</div>` : ''}
    ${skipped ? `<div class="hint">名前が空の行（${skipped}件）はとばしました</div>` : ''}
    <div class="btn-row ci-actions">
      <button class="btn ghost" id="ci-back" type="button">戻る</button>
      <button class="btn primary" id="ci-go" type="button"></button>
    </div>`;
  input.style.display = 'none';
  pv.style.display = '';
  const sheetEl = body.closest('.sheet');
  if (sheetEl) sheetEl.scrollTop = 0;

  const go = pv.querySelector('#ci-go');
  const sync = () => {
    const n = rows.filter(r => r.include).length;
    go.textContent = n ? `${n}件を取り込む` : '取り込む行がありません';
    go.disabled = !n;
  };
  sync();
  pv.querySelectorAll('.ci-check').forEach(cb => cb.addEventListener('change', () => { rows[+cb.dataset.ci].include = cb.checked; sync(); }));
  pv.querySelector('#ci-back').addEventListener('click', () => { pv.style.display = 'none'; input.style.display = ''; });
  go.addEventListener('click', () => {
    if (go.disabled) return;
    go.disabled = true;
    const res = commitMealImport(plan);
    closeSheet();
    App.mDate = res.dates[res.dates.length - 1] || App.mDate; // 取り込んだ一番新しい日を開く
    if (App.tab !== 'meals') switchTab('meals'); else renderCurrent();
    // 通知は短く（AIの計算中はカードにも出る）
    const md = (d) => { const [, m, dd] = d.split('-').map(Number); return `${m}/${dd}`; };
    const span = res.dates.length > 1 ? `${md(res.dates[0])}〜${md(res.dates[res.dates.length - 1])}` : md(res.dates[0]);
    toastUndo(`📄 ${res.added.length}件を取り込みました（${span}）`, () => {
      undoMealImport(res.added);
      renderCurrent();
      toast('取り込みを取り消しました');
    }, 8000);
    if (res.ai.length) startMealTextAnalyses(res.ai);
  });
}

/* ================= テンプレート・書き出し ================= */

function mcDateCell(d) { const dt = strToDate(d); return `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`; }

/* 空いている期間（無ければ直近1週間）の朝・昼・夜の行を入れたテンプレート */
function mealTemplateCsv() {
  const today = todayStr();
  const gap = mealGap();
  let from = gap ? gap.from : addDays(today, -6);
  if (daysBetween(from, today) > 30) from = addDays(today, -30);
  const lines = [
    '日付,曜日,時刻,名前,kcal,P,F,C',
    '# 名前だけ書けばOK（kcal・P・F・Cは空欄なら過去の記録かAIが入れます）。食べていない枠は空欄のまま。行は足しても消してもOK',
  ];
  for (let d = from; d <= today; d = addDays(d, 1)) {
    const dow = WEEKDAYS_JA[strToDate(d).getDay()];
    for (const slot of ['朝', '昼', '夜']) lines.push(`${mcDateCell(d)},${dow},${slot},,,,,`);
  }
  return { text: lines.join('\r\n') + '\r\n', from, to: today };
}

/* 食事の記録をCSVに（そのまま取り込み直せる形） */
function mealsCsvText() {
  const SRC = { ai: 'AI解析', manual: '手入力', fav: 'マイ定食', recent: 'いつもの食事', quick: 'プリセット', csv: 'CSV', pending: '未解析' };
  const q = (v) => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = ['日付,曜日,時刻,名前,kcal,P,F,C,記録方法'];
  for (const d of Object.keys(state.meals || {}).sort()) {
    const dow = WEEKDAYS_JA[strToDate(d).getDay()];
    for (const m of state.meals[d] || []) {
      if (!m || (m.pending && !(m.edited && m.edited.name))) continue; // 名前もまだ無い写真の記録は除く
      const nums = m.pending ? ['', '', '', ''] : [Math.round(num(m.kcal)), round1(num(m.p)), round1(num(m.f)), round1(num(m.c))];
      lines.push([mcDateCell(d), dow, m.time || '', m.name || '', ...nums, SRC[m.src] || ''].map(q).join(','));
    }
  }
  return lines.join('\r\n') + '\r\n';
}
