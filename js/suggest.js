/* 筋メシ - 提案ロジック（ルールベース、オフラインで動作） */
'use strict';

/* その種目の「次の目標」を計算（漸進性過負荷） */
function nextTarget(exId, date) {
  const ex = exById(exId);
  const last = lastSessionOf(exId, date || todayStr());
  if (!ex || !last || last.sets.length === 0) return null;
  if (ex.unit === 'kg') {
    const top = last.sets.reduce((a, s) => Math.max(a, num(s.w)), 0);
    const topSets = last.sets.filter(s => num(s.w) === top);
    const maxReps = topSets.reduce((a, s) => Math.max(a, num(s.r)), 0);
    if (maxReps >= 10) {
      const inc = top >= 60 ? 5 : 2.5;
      return { text: `${top + inc}kg × 8回に挑戦`, w: top + inc, r: 8 };
    }
    return { text: `${top}kg × ${maxReps + 1}回に挑戦`, w: top, r: maxReps + 1 };
  }
  if (ex.unit === 'bw') {
    const maxReps = last.sets.reduce((a, s) => Math.max(a, num(s.r)), 0);
    return { text: `${maxReps + 1}回に挑戦`, r: maxReps + 1 };
  }
  // 有酸素: 距離を記録していれば距離+0.5km、なければ時間+5分
  if (isCardioDistance(ex)) {
    const maxKm = last.sets.reduce((a, s) => Math.max(a, num(s.w)), 0);
    if (maxKm > 0) return { text: `${round1(maxKm + 0.5)}kmに挑戦`, w: round1(maxKm + 0.5) };
  }
  const maxMin = last.sets.reduce((a, s) => Math.max(a, num(s.r)), 0);
  return { text: `${maxMin + 5}分に挑戦`, r: maxMin + 5 };
}

/* 有酸素のペース表示（種目に応じて単位を変える） */
const CARDIO_SPEED_IDS = ['px62', 'px87', 'px88'];   // バイク・クロストレーナー系=km/h
const CARDIO_NODIST_IDS = ['px64', 'px89'];          // 縄跳び・ステップ=時間のみ
function cardioPaceText(ex, min, km) {
  min = num(min); km = num(km);
  if (!min || !km) return '';
  if (CARDIO_SPEED_IDS.includes(ex.id)) return (km / (min / 60)).toFixed(1) + 'km/h'; // 速度表示
  if (ex.id === 'px63') {                                                       // 水泳=/100m
    const sec100 = (min * 60) / (km * 10);
    return `${Math.floor(sec100 / 60)}'${String(Math.round(sec100 % 60)).padStart(2, '0')}"/100m`;
  }
  let sec = (min * 60) / km;                                                     // ラン等=/km
  let m = Math.floor(sec / 60), s = Math.round(sec % 60);
  if (s === 60) { m += 1; s = 0; }
  return `${m}'${String(s).padStart(2, '0')}"/km`;
}
function isCardioDistance(ex) { return ex.muscle === 'cardio' && !CARDIO_NODIST_IDS.includes(ex.id); }

function fmtSets(sets, unit, ex) {
  return sets.map(s => {
    if (unit === 'kg') return `${num(s.w)}kg×${num(s.r)}`;
    if (ex && isCardioDistance(ex) && num(s.w) > 0) {
      const pace = cardioPaceText(ex, s.r, s.w);
      return `${num(s.w)}km/${num(s.r)}分${pace ? `(${pace})` : ''}`;
    }
    return unit === 'min' ? `${num(s.r)}分` : `${num(s.r)}回`;
  }).join(', ');
}

/* 筋トレの提案カード */
function workoutSuggestions(date) {
  const out = [];
  const d = date || todayStr();
  const hasHistory = Object.keys(state.workouts).some(k => workoutDoneSets(k) > 0);

  if (!hasHistory) {
    out.push({
      icon: '🏋️', title: 'まずは記録から始めよう',
      body: '「胸・背中・脚」の3部位を週1回ずつ回すのが続けやすい王道です。今日はベンチプレス・ラットプルダウン・スクワットの3種目×3セットはどうですか？',
    });
    return out;
  }

  // 連続トレ日数 → 休養提案
  let consec = 0;
  for (let i = 1; i <= 7; i++) {
    if (workoutDoneSets(addDays(d, -i)) > 0) consec++; else break;
  }
  if (consec >= 3 && workoutDoneSets(d) === 0) {
    out.push({ icon: '😴', title: `${consec}日連続でトレーニング中`, body: '筋肉は休んでいる間に成長します。今日は休養か、軽い有酸素・ストレッチにするのも手です。' });
  }

  // 部位の空き日数
  const last = lastTrainedByMuscle();
  const stale = [];
  for (const key of Object.keys(MUSCLES)) {
    if (key === 'cardio') continue;
    if (!last[key]) continue; // 一度もやっていない部位は無理に勧めない
    const gap = daysBetween(last[key], d);
    if (gap >= 4) stale.push({ key, gap });
  }
  stale.sort((a, b) => b.gap - a.gap);
  for (const s of stale.slice(0, 2)) {
    const exs = allExercises().filter(e => e.muscle === s.key).slice(0, 3).map(e => e.name).join('・');
    out.push({
      icon: '📅', title: `${MUSCLES[s.key].label}を${s.gap}日鍛えていません`,
      body: `今日は${MUSCLES[s.key].label}の日にしませんか？ 例: ${exs}`,
      action: { type: 'goWorkout' },
    });
  }

  // 直近種目の重量アップ提案
  const recentExIds = new Set();
  const dates = Object.keys(state.workouts).filter(k => k < d).sort().reverse().slice(0, 6);
  for (const k of dates) for (const e of state.workouts[k].entries) recentExIds.add(e.exId);
  for (const exId of [...recentExIds].slice(0, 8)) {
    const ex = exById(exId);
    if (!ex || ex.unit !== 'kg') continue;
    const t = nextTarget(exId, d);
    const lastS = lastSessionOf(exId, d);
    if (t && lastS) {
      out.push({
        icon: '📈', title: `${ex.name}は${t.text}`,
        body: `前回(${fmtDateJa(lastS.date)})は ${fmtSets(lastS.sets, ex.unit, ex)}。少しずつ負荷を上げるのが成長の近道です。`,
        action: { type: 'goWorkout' },
      });
      break; // 1件だけ
    }
  }

  if (out.length === 0) {
    out.push({ icon: '👍', title: 'いいペースです', body: '各部位バランスよく回せています。この調子で続けましょう。' });
  }
  return out;
}

/* 食事の提案カード */
function mealSuggestions(date) {
  const d = date || todayStr();
  const out = [];
  const t = mealTotals(d);
  const g = state.settings.targets;
  const isToday = d === todayStr();
  const hour = new Date().getHours();
  const meals = mealsOf(d);
  const trainedToday = workoutDoneSets(d) > 0;

  if (meals.length === 0) {
    if (isToday && hour >= 12) {
      out.push({ icon: '📷', title: '今日はまだ食事の記録がありません', body: '写真を撮るだけでAIがカロリーとPFCを推定します。まずは1食から。', action: { type: 'addMealPhoto' } });
    }
    return out;
  }

  const remainKcal = g.kcal - t.kcal;
  const remainP = g.p - t.p;

  // タンパク質不足
  if (remainP > 15) {
    const fixes = [];
    let acc = 0;
    for (const f of PROTEIN_FIXES) {
      if (acc >= remainP) break;
      fixes.push(f.name); acc += f.p;
      if (fixes.length >= 2) break;
    }
    out.push({
      icon: '🍗', title: `タンパク質があと ${Math.round(remainP)}g 足りません`,
      body: `目標 ${g.p}g に対して現在 ${Math.round(t.p)}g。${fixes.join(' ＋ ')} などで補えます。${trainedToday ? 'トレーニングした日は特にしっかり摂りましょう。' : ''}`,
    });
  }

  // カロリー超過 / 残り
  if (remainKcal < -100) {
    out.push({ icon: '⚠️', title: `目標より ${Math.abs(Math.round(remainKcal))}kcal オーバー`, body: state.settings.profile.goal === 'gain' ? '増量中なら問題なし。タンパク質中心なら理想的です。' : 'この後の食事は野菜・スープ・タンパク質中心の軽めにするとリカバリーできます。' });
  } else if (isToday && hour >= 17 && remainKcal > 600 && state.settings.profile.goal !== 'cut') {
    out.push({ icon: '🍚', title: `あと ${Math.round(remainKcal)}kcal 摂れます`, body: '夕食をしっかり食べても目標内です。炭水化物＋タンパク質をバランスよく。' });
  }

  // 脂質オーバー
  if (t.f > g.f * 1.3) {
    out.push({ icon: '🥗', title: '今日は脂質が多め', body: `脂質 ${Math.round(t.f)}g / 目標 ${g.f}g。次の食事は揚げ物を避けて、和食系にすると整います。` });
  }

  // トレ日の炭水化物
  if (trainedToday && t.c < g.c * 0.5 && (isToday ? hour >= 15 : true)) {
    out.push({ icon: '🍙', title: 'トレーニングした日は炭水化物も大事', body: `筋肉の回復にはタンパク質と一緒に炭水化物も必要です。おにぎりやバナナを足しましょう（現在 ${Math.round(t.c)}g / 目標 ${g.c}g）。` });
  }

  if (out.length === 0) {
    out.push({ icon: '✨', title: '今日の食事はいいバランス', body: 'カロリーもPFCも目標に沿っています。この調子！' });
  }
  return out;
}

/* AI週間レポート用のサマリー */
function buildWeeklySummary() {
  const g = state.settings.targets;
  const pf = state.settings.profile;
  const goalJa = { cut: '減量', keep: '維持', gain: '増量' }[pf.goal] || '維持';
  const L = [];
  L.push(`目的: ${goalJa} / 目標: ${g.kcal}kcal P${g.p} F${g.f} C${g.c}`);
  const ib = latestInbody();
  if (ib) L.push(`最新InBody: 体重${ib.weight}kg${ib.bf != null ? ` 体脂肪率${ib.bf}%` : ''}${ib.muscle != null ? ` 骨格筋量${ib.muscle}kg` : ''}`);
  L.push('', '■この7日間');
  let totalVol = 0, trainDays = 0, kcalSum = 0, kcalDays = 0, pSum = 0;
  for (let i = 6; i >= 0; i--) {
    const d = addDays(todayStr(), -i);
    const parts = [];
    const vol = workoutVolume(d);
    const sets = workoutDoneSets(d);
    const cMin = cardioMinutes(d);
    if (sets > 0) {
      trainDays++;
      totalVol += vol;
      parts.push(`筋トレ${sets}セット${vol ? `(${Math.round(vol)}kg)` : ''}${cMin ? ` 有酸素${cMin}分` : ''} [${workoutMuscles(d).map(k => MUSCLES[k].label).join('・')}]`);
    }
    const t = mealTotals(d);
    if (mealsOf(d).length) {
      kcalDays++;
      kcalSum += t.kcal; pSum += t.p;
      parts.push(`食事${Math.round(t.kcal)}kcal P${Math.round(t.p)}`);
    }
    if (parts.length) L.push(`${fmtDateJa(d)}: ${parts.join(' / ')}`);
  }
  L.push('', `週合計: トレ${trainDays}日 総ボリューム${Math.round(totalVol).toLocaleString()}kg / 食事記録${kcalDays}日 平均${kcalDays ? Math.round(kcalSum / kcalDays) : 0}kcal 平均P${kcalDays ? Math.round(pSum / kcalDays) : 0}g`);
  return L.join('\n');
}

/* AIコーチ用のサマリー文字列を作る */
function buildCoachSummary() {
  const lines = [];
  const g = state.settings.targets;
  const pf = state.settings.profile;
  const goalJa = { cut: '減量', keep: '維持', gain: '増量' }[pf.goal] || '維持';
  lines.push(`目的: ${goalJa} / 体重: ${pf.weight}kg / 目標: ${g.kcal}kcal P${g.p} F${g.f} C${g.c}`);
  lines.push('');
  lines.push('■直近7日のトレーニング');
  let any = false;
  for (let i = 6; i >= 0; i--) {
    const d = addDays(todayStr(), -i);
    const w = workoutOf(d);
    if (!w || w.entries.length === 0) continue;
    any = true;
    const parts = w.entries.map(e => {
      const ex = exById(e.exId);
      const done = e.sets.filter(s => s.done);
      if (!ex || done.length === 0) return null;
      return `${ex.name} ${fmtSets(done, ex.unit, ex)}`;
    }).filter(Boolean);
    if (parts.length) lines.push(`${fmtDateJa(d)}: ${parts.join(' / ')}`);
  }
  if (!any) lines.push('（記録なし）');
  lines.push('');
  lines.push('■直近3日の食事');
  for (let i = 2; i >= 0; i--) {
    const d = addDays(todayStr(), -i);
    const t = mealTotals(d);
    const names = mealsOf(d).map(m => m.name).join('、');
    if (mealsOf(d).length) lines.push(`${fmtDateJa(d)}: ${Math.round(t.kcal)}kcal P${Math.round(t.p)} F${Math.round(t.f)} C${Math.round(t.c)}（${names}）`);
  }
  return lines.join('\n');
}
