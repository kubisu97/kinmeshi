/* 筋メシ - チャート（SVG/HTML、ダークテーマ検証済みパレット） */
'use strict';

/* カロリーリング（1指標のメーター） */
function donutMeter({ value, goal, over }) {
  const size = 132, sw = 11, r = (size - sw) / 2, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  const ratio = goal > 0 ? Math.min(value / goal, 1) : 0;
  const dash = circ * ratio;
  const color = over ? 'var(--warn)' : 'var(--c-p)';
  return `
  <svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="カロリー ${Math.round(value)} / ${goal} kcal">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--grid)" stroke-width="${sw}"/>
    ${value > 0 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}"
      stroke-linecap="round" stroke-dasharray="${dash} ${circ}" transform="rotate(-90 ${cx} ${cy})"
      style="transition: stroke-dasharray .5s ease"/>` : ''}
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="var(--ink)" font-size="26" font-weight="700">${Math.round(value)}</text>
    <text x="${cx}" y="${cy + 16}" text-anchor="middle" fill="var(--muted)" font-size="11">/ ${goal} kcal</text>
  </svg>`;
}

/* PFCメーター行（各行にラベル＝色は点で示し、文字はインク色） */
function pfcMeterRow(label, cssVar, value, goal, unit) {
  const ratio = goal > 0 ? value / goal : 0;
  const w = Math.min(ratio, 1) * 100;
  const over = ratio > 1.15;
  return `
  <div class="meter-row">
    <span class="meter-label"><i class="dot" style="background:var(${cssVar})"></i>${label}</span>
    <div class="meter-track"><div class="meter-fill" style="width:${w}%;background:var(${cssVar})"></div></div>
    <span class="meter-val">${Math.round(value)}<span class="meter-goal"> /${goal}${unit}</span>${over ? ' <span class="over-chip">⚠超過</span>' : ''}</span>
  </div>`;
}

/* 直近7日の棒グラフ（1系列・単色、タップで値表示） */
function weekBars({ data, unit, valueFmt }) {
  const W = 320, H = 130, padB = 22, padT = 18, padX = 8;
  const n = data.length;
  const max = Math.max(...data.map(d => d.value), 1);
  const bw = 20;
  const step = (W - padX * 2) / n;
  const fmt = valueFmt || (v => String(Math.round(v)));
  const maxIdx = data.reduce((mi, d, i) => d.value > data[mi].value ? i : mi, 0);
  let bars = '';
  data.forEach((d, i) => {
    const x = padX + step * i + (step - bw) / 2;
    const h = d.value > 0 ? Math.max((d.value / max) * (H - padB - padT), 3) : 0;
    const y = H - padB - h;
    const rx = Math.min(4, bw / 2);
    if (d.value > 0) {
      // 上だけ角丸のバー（データ端4px、ベースライン側は直角）
      const rr = Math.min(rx, h);
      bars += `<path d="M${x},${H - padB} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + bw - rr},${y} Q${x + bw},${y} ${x + bw},${y + rr} L${x + bw},${H - padB} Z" fill="${d.today ? 'var(--c-p)' : 'var(--c-p-dim)'}"/>`;
    }
    // 直接ラベルは最大値と今日だけ（選択的ラベル）
    if (d.value > 0 && (i === maxIdx || d.today)) {
      bars += `<text x="${x + bw / 2}" y="${y - 5}" text-anchor="middle" fill="var(--ink2)" font-size="10" style="font-variant-numeric:tabular-nums">${fmt(d.value)}</text>`;
    }
    bars += `<text x="${x + bw / 2}" y="${H - 7}" text-anchor="middle" fill="${d.today ? 'var(--ink2)' : 'var(--muted)'}" font-size="10">${d.label}</text>`;
    // タップ用ヒットエリア（マークより大きく）
    bars += `<rect class="bar-hit" x="${padX + step * i}" y="0" width="${step}" height="${H}" fill="transparent" data-tip="${d.tip || fmt(d.value) + (unit || '')}"/>`;
  });
  return `
  <svg class="weekbars" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="直近7日の推移">
    <line x1="${padX}" y1="${H - padB + .5}" x2="${W - padX}" y2="${H - padB + .5}" stroke="var(--baseline)" stroke-width="1"/>
    ${bars}
  </svg>`;
}

/* 部位バランス（横棒・単色。位置がカテゴリを示すので色は1色） */
function muscleBalanceBars(counts) {
  const keys = Object.keys(MUSCLES).filter(k => k !== 'cardio');
  const max = Math.max(...keys.map(k => counts[k] || 0), 1);
  let rows = '';
  for (const k of keys) {
    const v = counts[k] || 0;
    const w = (v / max) * 100;
    rows += `
    <div class="hbar-row">
      <span class="hbar-label">${MUSCLES[k].label}</span>
      <div class="hbar-track">${v > 0 ? `<div class="hbar-fill" style="width:${w}%"></div>` : ''}</div>
      <span class="hbar-val">${v ? v + 'セット' : '–'}</span>
    </div>`;
  }
  return `<div class="hbars">${rows}</div>`;
}

/* 折れ線チャート（1系列・単色。体組成・1RM推移用） */
function lineChart({ points, unit, fmt }) {
  if (!points || points.length < 2) return '<div class="empty-note small">2回以上のデータがたまるとグラフになります</div>';
  const W = 320, H = 110, padX = 10, padT = 16, padB = 18;
  const f = fmt || (v => String(Math.round(v * 10) / 10));
  const vals = points.map(p => p.v);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (max === min) { max += 1; min -= 1; }
  const range = max - min;
  min -= range * 0.15; max += range * 0.15;
  const X = i => padX + (W - padX * 2) * (i / (points.length - 1));
  const Y = v => padT + (H - padT - padB) * (1 - (v - min) / (max - min));
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ');
  const maxIdx = vals.indexOf(Math.max(...vals));
  const lastIdx = points.length - 1;
  let dots = '', labels = '';
  points.forEach((p, i) => {
    dots += `<circle cx="${X(i).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="${points.length > 15 ? 2 : 3}" fill="var(--c-p)"/>`;
    // 直接ラベルは最初・最後・最大のみ（選択的ラベル）
    if (i === 0 || i === lastIdx || i === maxIdx) {
      labels += `<text x="${X(i).toFixed(1)}" y="${(Y(p.v) - 7).toFixed(1)}" text-anchor="${i === 0 ? 'start' : i === lastIdx ? 'end' : 'middle'}" fill="var(--ink2)" font-size="10" style="font-variant-numeric:tabular-nums">${f(p.v)}${unit || ''}</text>`;
    }
    dots += `<rect class="bar-hit" x="${(X(i) - (W / points.length) / 2).toFixed(1)}" y="0" width="${(W / points.length).toFixed(1)}" height="${H}" fill="transparent" data-tip="${esc(p.label)} ${f(p.v)}${unit || ''}"/>`;
  });
  return `
  <svg class="weekbars" viewBox="0 0 ${W} ${H}" width="100%" role="img">
    <line x1="${padX}" y1="${H - padB + .5}" x2="${W - padX}" y2="${H - padB + .5}" stroke="var(--baseline)" stroke-width="1"/>
    <path d="${path}" fill="none" stroke="var(--c-p)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}${labels}
    <text x="${padX}" y="${H - 5}" fill="var(--muted)" font-size="9">${esc(points[0].label)}</text>
    <text x="${W - padX}" y="${H - 5}" text-anchor="end" fill="var(--muted)" font-size="9">${esc(points[lastIdx].label)}</text>
  </svg>`;
}

/* チャートのタップツールチップ（共有） */
function initChartTips(root) {
  root.querySelectorAll('.bar-hit').forEach(el => {
    el.addEventListener('click', (ev) => {
      const tip = document.getElementById('chart-tip');
      tip.textContent = el.dataset.tip;
      tip.style.display = 'block';
      const pad = 8;
      let x = ev.clientX - tip.offsetWidth / 2;
      x = Math.max(pad, Math.min(x, window.innerWidth - tip.offsetWidth - pad));
      tip.style.left = x + 'px';
      tip.style.top = (ev.clientY - tip.offsetHeight - 12) + 'px';
      clearTimeout(tip._t);
      tip._t = setTimeout(() => { tip.style.display = 'none'; }, 1800);
    });
  });
}
