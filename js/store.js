/* 筋メシ - データ保存（localStorage + IndexedDB） */
'use strict';

const DB_KEY = 'kinmeshi_v1';

const DEFAULT_STATE = () => ({
  ver: 1,
  settings: {
    apiKey: '',
    model: 'gemini-3.5-flash',
    targets: { kcal: 2200, p: 130, f: 60, c: 270 },
    profile: { weight: 65, goal: 'keep' }, // goal: cut / keep / gain
    activity: 'mid', // low / mid / high（活動量）
    notifyTime: '21:00',
  },
  inbody: [],                    // {id, date, weight, bf, muscle, bmr}
  customExercises: [],           // {id,name,muscle,unit}
  workouts: {},                  // 'YYYY-MM-DD': {entries:[{id,exId,sets:[{w,r,done}]}], memo}
  meals: {},                     // 'YYYY-MM-DD': [{id,time,name,kcal,p,f,c,photo,src,items,note}]
  createdAt: new Date().toISOString(),
});

let state = null;

function loadState() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      state = JSON.parse(raw);
      // 将来のバージョン移行はここで
      if (!state.settings) state.settings = DEFAULT_STATE().settings;
      if (!state.customExercises) state.customExercises = [];
      if (!state.workouts) state.workouts = {};
      if (!state.meals) state.meals = {};
      if (!state.inbody) state.inbody = [];
      if (!state.settings.activity) state.settings.activity = 'mid';
      return;
    }
  } catch (e) { console.warn('loadState failed', e); }
  state = DEFAULT_STATE();
}

function saveState() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('saveState failed', e);
    if (typeof toast === 'function') toast('保存に失敗しました（容量不足の可能性）');
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------- 日付ユーティリティ ---------- */
function todayStr() { return dateToStr(new Date()); }
function dateToStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function strToDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = strToDate(s); d.setDate(d.getDate() + n); return dateToStr(d); }
function daysBetween(a, b) { return Math.round((strToDate(b) - strToDate(a)) / 86400000); }
const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];
function fmtDateJa(s, withYear) {
  const d = strToDate(s);
  const base = `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS_JA[d.getDay()]})`;
  return withYear ? `${d.getFullYear()}年${base}` : base;
}
function nowTimeStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ---------- 種目 ---------- */
function allExercises() { return PRESET_EXERCISES.concat(state.customExercises); }
function exById(id) { return allExercises().find(e => e.id === id) || null; }

/* ---------- 集計 ---------- */
function mealsOf(date) { return state.meals[date] || []; }
function workoutOf(date) { return state.workouts[date] || null; }

function mealTotals(date) {
  const t = { kcal: 0, p: 0, f: 0, c: 0 };
  for (const m of mealsOf(date)) {
    t.kcal += num(m.kcal); t.p += num(m.p); t.f += num(m.f); t.c += num(m.c);
  }
  return t;
}
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function round1(v) { return Math.round(v * 10) / 10; }

function entryVolume(entry) {
  const ex = exById(entry.exId);
  let vol = 0;
  for (const s of entry.sets) {
    if (!s.done) continue;
    if (ex && ex.unit === 'kg') vol += num(s.w) * num(s.r);
  }
  return vol;
}
function workoutVolume(date) {
  const w = workoutOf(date);
  if (!w) return 0;
  return w.entries.reduce((a, e) => a + entryVolume(e), 0);
}
function workoutMuscles(date) {
  const w = workoutOf(date);
  if (!w) return [];
  const set = new Set();
  for (const e of w.entries) {
    if (e.sets.some(s => s.done)) { const ex = exById(e.exId); if (ex) set.add(ex.muscle); }
  }
  return [...set];
}
function cardioMinutes(date) {
  const w = workoutOf(date);
  if (!w) return 0;
  let min = 0;
  for (const e of w.entries) {
    const ex = exById(e.exId);
    if (!ex || ex.muscle !== 'cardio') continue;
    for (const s of e.sets) { if (s.done) min += num(s.r); }
  }
  return min;
}
function workoutDoneSets(date) {
  const w = workoutOf(date);
  if (!w) return 0;
  return w.entries.reduce((a, e) => a + e.sets.filter(s => s.done).length, 0);
}

/* その種目の直近セッション（指定日より前） */
function lastSessionOf(exId, beforeDate) {
  const dates = Object.keys(state.workouts).filter(d => d < beforeDate).sort().reverse();
  for (const d of dates) {
    const entry = state.workouts[d].entries.find(e => e.exId === exId && e.sets.some(s => s.done));
    if (entry) return { date: d, sets: entry.sets.filter(s => s.done) };
  }
  return null;
}

/* 部位ごとの最終トレーニング日 */
function lastTrainedByMuscle() {
  const res = {};
  const dates = Object.keys(state.workouts).sort();
  for (const d of dates) {
    for (const m of workoutMuscles(d)) res[m] = d;
  }
  return res;
}

/* 連続記録日数（筋トレ or 食事どちらか記録があればOK） */
function streakDays() {
  let n = 0;
  let d = todayStr();
  const hasLog = (x) => mealsOf(x).length > 0 || workoutDoneSets(x) > 0;
  if (!hasLog(d)) d = addDays(d, -1); // 今日まだでも昨日から継続中なら数える
  while (hasLog(d)) { n++; d = addDays(d, -1); }
  return n;
}

/* ---------- InBody ---------- */
function latestInbody() {
  if (!state.inbody || !state.inbody.length) return null;
  return [...state.inbody].sort((a, b) => (a.date || '').localeCompare(b.date || '')).pop();
}
function addInbody(rec) {
  state.inbody.push({ id: uid(), ...rec });
  saveState();
}

/* ---------- 写真（IndexedDB） ---------- */
const PHOTO_DB = 'kinmeshi-photos';
let _idb = null;
function idbOpen() {
  return new Promise((resolve, reject) => {
    if (_idb) return resolve(_idb);
    const req = indexedDB.open(PHOTO_DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('photos', { keyPath: 'id' }); };
    req.onsuccess = () => { _idb = req.result; resolve(_idb); };
    req.onerror = () => reject(req.error);
  });
}
async function photoPut(id, dataUrl) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    tx.objectStore('photos').put({ id, data: dataUrl, ts: Date.now() });
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}
const _photoCache = new Map();
async function photoGet(id) {
  if (!id) return null;
  if (_photoCache.has(id)) return _photoCache.get(id);
  try {
    const db = await idbOpen();
    const data = await new Promise((resolve, reject) => {
      const req = db.transaction('photos').objectStore('photos').get(id);
      req.onsuccess = () => resolve(req.result ? req.result.data : null);
      req.onerror = () => reject(req.error);
    });
    _photoCache.set(id, data);
    return data;
  } catch (e) { return null; }
}
async function photoDel(id) {
  if (!id) return;
  _photoCache.delete(id);
  try {
    const db = await idbOpen();
    db.transaction('photos', 'readwrite').objectStore('photos').delete(id);
  } catch (e) { /* noop */ }
}
async function photoAll() {
  try {
    const db = await idbOpen();
    return await new Promise((resolve, reject) => {
      const req = db.transaction('photos').objectStore('photos').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (e) { return []; }
}

/* ---------- バックアップ ---------- */
async function exportData() {
  const photos = await photoAll();
  // セキュリティ: APIキーはバックアップに含めない（端末の外に出さない）
  const safeState = JSON.parse(JSON.stringify(state));
  if (safeState.settings) safeState.settings.apiKey = '';
  const blob = new Blob([JSON.stringify({ app: 'kinmeshi', ver: 1, state: safeState, photos })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kinmeshi_backup_${todayStr().replace(/-/g, '')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function importData(file) {
  const text = await file.text();
  const obj = JSON.parse(text);
  if (!obj || obj.app !== 'kinmeshi' || !obj.state) throw new Error('筋メシのバックアップファイルではありません');
  // 端末に設定済みのAPIキーは引き継ぐ（バックアップには含まれないため）
  const currentKey = state && state.settings ? state.settings.apiKey : '';
  state = obj.state;
  if (state.settings && !state.settings.apiKey) state.settings.apiKey = currentKey || '';
  saveState();
  if (Array.isArray(obj.photos)) {
    for (const ph of obj.photos) { if (ph && ph.id) await photoPut(ph.id, ph.data); }
  }
}
