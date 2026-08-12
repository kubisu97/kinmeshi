/* 筋メシ - ホーム画面 */
'use strict';

function renderHome(el) {
  const d = todayStr();
  const t = mealTotals(d);
  const g = state.settings.targets;
  const remain = g.kcal - t.kcal;
  const over = t.kcal > g.kcal * 1.05;
  const streak = streakDays();
  const muscles = workoutMuscles(d);
  const vol = workoutVolume(d);
  const doneSets = workoutDoneSets(d);
  const sugs = [...workoutSuggestions(d), ...mealSuggestions(d)].slice(0, 3);
  const noKey = !state.settings.apiKey;

  el.innerHTML = `
    <header class="screen-head">
      <div>
        <h1 class="app-title">筋メシ <span class="app-sub">${fmtDateJa(d)}</span></h1>
      </div>
      ${streak > 0 ? `<span class="streak-chip">🔥 ${streak}日連続</span>` : ''}
    </header>

    ${noKey ? `
    <div class="card setup-card" id="setup-ai">
      <div class="sug-icon">🔑</div>
      <div class="sug-text">
        <div class="sug-title">AI写真解析をはじめる</div>
        <div class="sug-body">無料のGemini APIキーを設定すると、食事の写真からカロリーを自動推定できます。タップして設定へ。</div>
      </div>
    </div>` : ''}

    <section class="card">
      <h2 class="card-title">今日のカロリー</h2>
      <div class="kcal-panel">
        ${donutMeter({ value: t.kcal, goal: g.kcal, over })}
        <div class="kcal-side">
          <div class="kcal-remain">${over
            ? `<span class="over-chip">⚠ ${Math.round(t.kcal - g.kcal)}kcal 超過</span>`
            : `残り <b>${Math.max(0, Math.round(remain))}</b> kcal`}</div>
          <div class="meters">
            ${pfcMeterRow('P', '--c-p', t.p, g.p, 'g')}
            ${pfcMeterRow('F', '--c-f', t.f, g.f, 'g')}
            ${pfcMeterRow('C', '--c-c', t.c, g.c, 'g')}
          </div>
        </div>
      </div>
    </section>

    <div class="quick-row">
      <button class="btn quick" id="q-photo">${ICONS.camera}<span>写真で食事記録</span></button>
      <button class="btn quick" id="q-workout">${ICONS.workout}<span>筋トレを記録</span></button>
    </div>

    <section class="card">
      <h2 class="card-title">今日の筋トレ</h2>
      ${doneSets > 0 ? `
        <div class="today-workout">
          <div class="tw-main">${muscles.map(m => `<span class="chip">${MUSCLES[m].label}</span>`).join('')}</div>
          <div class="tw-stats">${doneSets}セット${vol > 0 ? ` ・ 総ボリューム <b>${Math.round(vol).toLocaleString()}</b>kg` : ''}</div>
          <button class="btn ghost small" id="tw-open">記録を見る</button>
        </div>` : `
        <div class="today-workout empty">
          <div class="tw-stats muted">まだ記録がありません</div>
          <button class="btn primary small" id="tw-open">今日のトレーニングを始める</button>
        </div>`}
    </section>

    <h2 class="section-title">今日の提案</h2>
    ${suggestionCardsHtml(sugs)}
  `;

  el.querySelector('#q-photo').addEventListener('click', () => { switchTab('meals'); setTimeout(openMealPhoto, 250); });
  el.querySelector('#q-workout').addEventListener('click', () => switchTab('workout'));
  el.querySelector('#tw-open').addEventListener('click', () => switchTab('workout'));
  const setup = el.querySelector('#setup-ai');
  if (setup) setup.addEventListener('click', () => switchTab('settings'));
  wireSuggestionCards(el);
}
