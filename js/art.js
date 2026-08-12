/* 筋メシ - 種目ピクトグラム（内蔵SVG・オフライン対応） */
'use strict';

(() => {
  const F = '#d6d5cb';   // 体
  const E = '#3987e5';   // 器具（アクセント）
  const S = '#71706a';   // ベンチ・フレーム
  const G = '#45443f';   // 床

  const P = (d, c = F, w = 3.4) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const HEAD = (x, y, r = 4.4) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${F}"/>`;
  const RING = (x, y, r, c = E, w = 3.4) => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${c}" stroke-width="${w}"/>`;
  const DOT = (x, y, r, c = E) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`;
  const FLOOR = (y = 56) => P(`M8 ${y} H56`, G, 2.4);
  /* ダンベル: 中心(x,y) 角度deg 長さlen */
  const DB = (x, y, ang = 0, len = 11) => {
    const r = ang * Math.PI / 180, dx = Math.cos(r) * len / 2, dy = Math.sin(r) * len / 2;
    const px = Math.cos(r + Math.PI / 2) * 2.6, py = Math.sin(r + Math.PI / 2) * 2.6;
    return P(`M${x - dx} ${y - dy} L${x + dx} ${y + dy}`, E, 3) +
      P(`M${x - dx - px} ${y - dy - py} L${x - dx + px} ${y - dy + py}`, E, 4.6) +
      P(`M${x + dx - px} ${y + dy - py} L${x + dx + px} ${y + dy + py}`, E, 4.6);
  };
  /* バーベル(正面): y高さ, x1-x2 */
  const BAR = (y, x1 = 12, x2 = 52) => P(`M${x1} ${y} H${x2}`, E, 3) +
    P(`M${x1 + 4} ${y - 5} V${y + 5}`, E, 5) + P(`M${x2 - 4} ${y - 5} V${y + 5}`, E, 5);

  const A = {};

  /* ===== 胸 ===== */
  // ベンチプレス（側面・バー正面ミックス）
  A.bench = [
    P('M14 44 H50', S, 4), P('M18 44 V54 M46 44 V54', S, 3),      // ベンチ
    HEAD(47, 38), P('M42 40 L24 41', F),                          // 頭・胴
    P('M24 41 L17 48 L22 55', F),                                 // 脚
    P('M40 40 L40 28', F),                                        // 腕
    BAR(26, 24, 56),
  ];
  A.dbpress = [
    P('M14 44 H50', S, 4), P('M18 44 V54 M46 44 V54', S, 3),
    HEAD(47, 38), P('M42 40 L24 41', F),
    P('M24 41 L17 48 L22 55', F),
    P('M36 40 L36 28', F), P('M46 40 L46 28', F),
    DB(36, 25), DB(46, 25),
  ];
  A.incline = [
    P('M16 50 L34 28', S, 4.4), P('M24 44 V54 M32 34 V54', S, 3), // 斜めパッド+脚
    HEAD(36, 26), P('M32 31 L22 43', F),                          // パッドに預けた背
    P('M22 43 L32 48 L30 56', F),                                 // 脚
    P('M31 33 L37 19', F),                                        // 押し上げる腕
    DB(38, 16, 0, 10),
  ];
  A.chestpress = [
    P('M20 24 V50', S, 4), P('M14 54 H34', S, 3),                 // 背もたれ・台
    HEAD(25, 22), P('M24 27 L24 44', F),
    P('M24 44 L34 48 L36 56', F),
    P('M25 30 L44 30', F),                                        // 押す腕
    P('M46 22 V38', E, 4),                                        // ハンドル
  ];
  A.fly = [
    P('M14 46 H50', S, 4), P('M18 46 V55 M46 46 V55', S, 3),
    HEAD(47, 40), P('M42 42 L24 43', F),
    P('M40 42 L30 28', F), P('M40 42 L52 30', F),                 // 弧を描く腕
    DB(28, 25, -35), DB(54, 27, 35),
  ];
  A.cable = [
    P('M10 10 L22 26', E, 2.2), P('M54 10 L42 26', E, 2.2),       // ケーブル
    DOT(10, 10, 2.6), DOT(54, 10, 2.6),
    HEAD(32, 14), P('M32 19 L32 36', F),
    P('M32 22 L22 27 M32 22 L42 27', F),                          // 腕
    P('M32 36 L25 55 M32 36 L39 55', F),
  ];
  A.pushup = [
    FLOOR(54), HEAD(49, 32),
    P('M14 44 L44 35', F),                                        // 体
    P('M40 36 L40 52', F),                                        // 腕
    P('M14 44 L12 52', F),                                        // つま先
  ];
  A.dips = [
    P('M16 26 H26 M38 26 H48', S, 3.6), P('M21 26 V46 M43 26 V46', S, 3.6), // 平行棒
    HEAD(32, 16), P('M32 21 L32 36', F),
    P('M32 23 L23 27 M32 23 L41 27', F),
    P('M32 36 L27 46 L31 52', F),
  ];

  /* ===== 背中 ===== */
  A.deadlift = [
    FLOOR(), HEAD(23, 19),
    P('M26 23 L35 38', F),                                        // 背中（前傾）
    P('M35 38 L33 55', F),                                        // 脚
    P('M28 26 L41 44', F),                                        // 腕
    RING(42, 46, 8), DOT(42, 46, 2, E),                           // プレート
  ];
  A.pullup = [
    P('M14 11 H50', E, 3),                                        // バー
    HEAD(32, 19), P('M32 24 L32 39', F),
    P('M24 11 L28 25 M40 11 L36 25', F),                          // 腕
    P('M32 39 L27 47 L33 51', F),                                 // 脚（曲げ）
  ];
  A.latpull = [
    P('M14 12 H50', E, 3), P('M32 4 L32 12', E, 2.2),             // ワイドバー+ケーブル
    HEAD(32, 22), P('M32 27 L32 41', F),
    P('M32 28 L19 14 M32 28 L45 14', F),
    P('M22 46 H42', S, 3.6),                                      // シート
    P('M32 41 L40 46 L38 55', F),
  ];
  A.row = [
    FLOOR(), HEAD(45, 21),
    P('M41 24 L27 35', F),                                        // 前傾の背
    P('M27 35 L25 46 L29 55', F),
    P('M37 26 L39 42', F),
    RING(40, 45, 6.5), DOT(40, 45, 1.8, E),
  ];
  A.seatedrow = [
    P('M12 50 H52', G, 2.4),
    HEAD(23, 22), P('M25 26 L28 43', F),                          // やや後傾
    P('M28 43 L42 44 L48 50', F),                                 // 前に伸ばした脚
    P('M26 30 L40 33', F),                                        // 引く腕
    P('M42 33 L54 33', E, 2.2), P('M52 26 V40', E, 4.6),          // ケーブル+ウェイト
  ];
  A.onehandrow = [
    P('M34 46 H54', S, 4), P('M38 46 V54 M50 46 V54', S, 3),      // ベンチ
    HEAD(15, 20), P('M19 23 L33 32', F),
    P('M26 26 L38 44', F),                                        // 支え腕→ベンチ
    P('M24 28 L22 40', F), DB(22, 44, 0, 10),                     // ダンベル腕
    P('M33 32 L33 55', F),
  ];

  /* ===== 脚 ===== */
  A.squat = [
    HEAD(32, 12), P('M32 17 L32 32', F),
    P('M32 25 L22 21 M32 25 L42 21', F),                          // バーを支える腕
    BAR(21, 14, 50),                                              // 肩の上のバー
    P('M32 32 L20 42 L24 55', F), P('M32 32 L44 42 L40 55', F),   // 深くしゃがむ脚
    FLOOR(),
  ];
  A.legpress = [
    P('M12 52 L28 36', S, 4),                                     // シート
    HEAD(17, 30), P('M20 34 L28 44', F),
    P('M28 44 L38 34 L46 26', F),                                 // 押し上げる脚
    P('M50 18 L42 34', E, 4.6),                                   // プレート
    P('M21 37 L28 32', F),
  ];
  A.bulgarian = [
    P('M8 42 H20', S, 4), P('M10 42 V52 M18 42 V52', S, 3),       // 後ろのベンチ
    HEAD(34, 13), P('M34 18 L32 33', F),
    P('M32 33 L24 40 L15 40', F),                                 // 後ろ脚→ベンチ上
    P('M32 33 L40 44 L40 55', F),                                 // 前脚
    P('M34 21 L30 33', F), DB(29, 36, 90, 9),
    FLOOR(),
  ];
  A.lunge = [
    HEAD(28, 11), P('M28 16 L28 33', F),
    P('M28 20 L26 31', F),
    P('M28 33 L41 36 L41 55', F),                                 // 前脚（腿が水平）
    P('M28 33 L20 48 L13 52', F),                                 // 後ろ脚（膝が床近く）
    FLOOR(),
  ];
  A.legext = [
    P('M20 24 V44', S, 4), P('M20 44 L34 44', S, 4),              // 背もたれ+シート
    HEAD(25, 20), P('M24 25 L24 41', F),
    P('M24 41 L35 41', F),                                        // 太もも
    P('M35 41 L48 34', F),                                        // 蹴り上げる脛
    DOT(49, 33, 3.4),
  ];
  A.legcurl = [
    P('M12 42 H40', S, 4), P('M16 42 V52 M36 42 V52', S, 3),      // ベンチ
    HEAD(13, 37), P('M17 39 L38 39', F),                          // うつ伏せ
    P('M38 39 L45 27', F),                                        // 巻き上げる脛
    DOT(46, 26, 3.4),
  ];
  A.calf = [
    P('M30 50 H52 V56 H30 Z', S, 3),                              // 台
    HEAD(33, 10), P('M33 15 L33 32', F),
    P('M33 18 L36 30', F),
    P('M33 32 L32 44', F),                                        // かかとが浮いた脚
    P('M32 44 L40 49', F),                                        // つま先だけ台の上
  ];
  A.hipthrust = [
    P('M8 32 H20', S, 4), P('M10 32 V42', S, 3),                  // ベンチ
    HEAD(13, 27), P('M18 32 L34 34', F),                          // 橋になる胴
    P('M34 34 L42 42 L42 55', F),                                 // 脚
    RING(33, 30, 6), DOT(33, 30, 1.8, E),                         // 腰の上のプレート
    FLOOR(),
  ];

  /* ===== 肩 ===== */
  A.shpress = [
    HEAD(32, 17), P('M32 22 L32 38', F),
    P('M32 24 L23 16 M32 24 L41 16', F),                          // 上げる腕
    DB(21, 12), DB(43, 12),
    P('M32 38 L26 55 M32 38 L38 55', F),
  ];
  A.sideraise = [
    HEAD(32, 13), P('M32 18 L32 37', F),
    P('M32 23 L17 23 M32 23 L47 23', F),                          // 真横に上げる
    DB(14, 23, 90, 9), DB(50, 23, 90, 9),
    P('M32 37 L27 55 M32 37 L37 55', F),
  ];
  A.rearraise = [
    HEAD(43, 17), P('M39 20 L28 32', F),                          // 前傾
    P('M35 23 L22 20 M36 24 L46 30', F),                          // 開く腕
    DB(19, 19, 90, 8), DB(49, 32, 90, 8),
    P('M28 32 L27 44 L30 55', F),
  ];
  A.frontraise = [
    HEAD(26, 12), P('M26 17 L26 38', F),
    P('M26 21 L46 19', F),                                        // 前に上げる腕
    DB(49, 19, 90, 9),
    P('M26 24 L29 36', F),
    P('M26 38 L23 55 M26 38 L31 55', F),
  ];
  A.upright = [
    HEAD(32, 11), P('M32 16 L32 36', F),
    P('M32 18 L22 20 L26 28 M32 18 L42 20 L38 28', F),            // 肘を張って引く
    BAR(29, 20, 44),
    P('M32 36 L27 55 M32 36 L37 55', F),
  ];

  /* ===== 腕 ===== */
  A.curl = [
    HEAD(28, 12), P('M28 17 L28 38', F),
    P('M28 22 L29 32', F),                                        // 上腕
    P('M29 32 L41 25', F),                                        // 巻き上げる前腕
    DB(44, 23, -28, 10),
    P('M28 38 L24 55 M28 38 L32 55', F),
  ];
  A.triext = [
    HEAD(29, 14), P('M29 19 L29 39', F),
    P('M29 22 L36 12', F),                                        // 頭上の上腕
    P('M36 12 L44 8', F),
    DB(46, 7, 45, 9),
    P('M29 39 L25 55 M29 39 L33 55', F),
  ];
  A.pressdown = [
    P('M45 6 L44 26', E, 2.2), DOT(45, 6, 2.4),                   // 上からのケーブル
    HEAD(27, 12), P('M27 17 L27 39', F),
    P('M27 21 L31 29', F),
    P('M31 29 L43 32', F),                                        // 押し下げる前腕
    P('M40 32 H48', E, 4),                                        // ハンドル
    P('M27 39 L23 55 M27 39 L31 55', F),
  ];

  /* ===== 腹・体幹 ===== */
  A.plank = [
    FLOOR(53), HEAD(50, 31),
    P('M15 42 L45 34', F),                                        // 一直線の体
    P('M40 36 L38 48 L48 48', F),                                 // 肘つき前腕
    P('M15 42 L12 50', F),
  ];
  A.crunch = [
    FLOOR(54), HEAD(20, 36),
    P('M24 39 L35 49', F),                                        // 起こした上体
    P('M35 49 L43 39 L46 52', F),                                 // 曲げた膝
    P('M25 40 L30 44', F),
  ];
  A.legraise = [
    FLOOR(54), HEAD(13, 47),
    P('M18 50 L34 50', F),                                        // 上体
    P('M34 50 L47 33', F),                                        // 上げた脚
    P('M22 50 L30 50', F, 3),
  ];
  A.abroller = [
    FLOOR(54), HEAD(45, 33),
    P('M25 45 L41 36', F),                                        // 伸ばした体
    P('M25 45 L23 53 L31 54', F),                                 // 膝立ち
    P('M38 38 L49 45', F),                                        // 腕
    RING(51, 48, 5.5), DOT(51, 48, 1.6, E),                       // ローラー
  ];
  A.sideplank = [
    FLOOR(53), HEAD(51, 31),
    P('M17 45 L46 33', F),
    P('M22 44 L22 52', F),                                        // 支え前腕
    P('M20 52 H29', F),
    P('M35 40 L34 24', F),                                        // 上げた腕
  ];

  /* ===== 有酸素 ===== */
  A.run = [
    HEAD(35, 10), P('M33 15 L30 31', F),
    P('M33 18 L41 24 M33 18 L24 25', F),                          // 振る腕
    P('M30 31 L40 39 L44 50', F),                                 // 前脚
    P('M30 31 L22 41 L13 45', F),                                 // 後ろ脚
  ];
  A.walk = [
    HEAD(32, 11), P('M32 16 L32 34', F),
    P('M32 20 L37 30 M32 20 L27 30', F),
    P('M32 34 L39 44 L40 54', F),
    P('M32 34 L25 45 L22 54', F),
    FLOOR(),
  ];
  A.bike = [
    RING(19, 45, 8.5, S, 3), RING(47, 45, 8.5, S, 3),             // 車輪
    P('M19 45 L30 45 L37 33 M30 45 L27 33 H37', E, 2.6),          // フレーム
    P('M45 30 L47 45', E, 2.6),
    HEAD(41, 15), P('M38 19 L30 30', F),
    P('M39 21 L46 28', F),                                        // ハンドルへ
    P('M30 30 L33 41 L29 46', F),                                 // ペダルの脚
  ];
  A.swim = [
    P('M10 50 Q16 46 22 50 T34 50 T46 50 T58 50', E, 2.4),        // 波
    HEAD(48, 36), P('M16 40 L43 37', F),                          // 伸びた体
    P('M38 38 L28 27', F),                                        // かく腕
    P('M16 40 L10 36', F),
  ];
  A.rope = [
    HEAD(32, 12), P('M32 17 L32 34', F),
    P('M32 22 L21 29 M32 22 L43 29', F),
    P('M21 29 Q32 70 43 29', E, 2.4),                             // 体の外を回る縄
    DOT(21, 29, 2, E), DOT(43, 29, 2, E),
    P('M32 34 L28 40 L30 46 M32 34 L36 40 L34 46', F),            // ジャンプ中の脚
    P('M22 56 H42', G, 2.4),
  ];

  /* ロータリートーソ（体幹ひねり） */
  A.torso = [
    P('M24 46 H40', S, 3.6),                                      // シート
    HEAD(32, 12), P('M32 17 L32 44', F),
    P('M32 22 L24 28 M32 22 L40 28', F),                          // 腕（胸の前）
    P('M14 30 A 18 18 0 0 1 24 16', E, 2.4),                      // 回転矢印（左）
    P('M24 16 L19 16 M24 16 L24 21', E, 2.4),
    P('M50 30 A 18 18 0 0 0 40 16', E, 2.4),                      // 回転矢印（右）
    P('M40 16 L45 16 M40 16 L40 21', E, 2.4),
  ];
  /* アブダクター/アダクター（脚の開閉） */
  A.abadd = [
    P('M22 30 H42', S, 3.6),                                      // シート
    HEAD(32, 10), P('M32 15 L32 30', F),
    P('M32 30 L23 42 L23 54', F), P('M32 30 L41 42 L41 54', F),   // 開いた脚
    P('M17 46 L11 46 M14 43 L11 46 L14 49', E, 2.4),              // 外向き矢印
    P('M47 46 L53 46 M50 43 L53 46 L50 49', E, 2.4),
  ];

  /* ===== 汎用（カスタム種目用） ===== */
  A.generic = [
    P('M14 32 H50', E, 3.4),
    P('M20 22 V42 M28 26 V38', E, 5),
    P('M44 22 V42 M36 26 V38', E, 5),
  ];

  /* 種目ID → 絵 */
  const MAP = {
    px01: 'bench', px02: 'dbpress', px03: 'incline', px04: 'chestpress', px05: 'fly',
    px06: 'cable', px07: 'pushup', px08: 'dips',
    px10: 'deadlift', px11: 'pullup', px12: 'latpull', px13: 'row', px14: 'seatedrow', px15: 'onehandrow',
    px20: 'squat', px21: 'legpress', px22: 'bulgarian', px23: 'lunge', px24: 'legext',
    px25: 'legcurl', px26: 'calf', px27: 'hipthrust',
    px30: 'shpress', px31: 'sideraise', px32: 'rearraise', px33: 'frontraise', px34: 'upright',
    px40: 'curl', px41: 'curl', px42: 'curl', px43: 'triext', px44: 'pressdown', px45: 'bench',
    px50: 'plank', px51: 'crunch', px52: 'legraise', px53: 'abroller', px54: 'sideplank',
    px60: 'run', px61: 'walk', px62: 'bike', px63: 'swim', px64: 'rope',
    px70: 'fly', px71: 'rearraise', px72: 'curl', px73: 'triext', px74: 'crunch',
    px75: 'torso', px76: 'crunch', px77: 'latpull', px78: 'seatedrow', px79: 'generic',
    px80: 'generic', px81: 'abadd', px82: 'abadd', px83: 'hipthrust', px84: 'calf',
    px85: 'squat', px87: 'run', px88: 'bike', px89: 'walk',
  };

  window.exArt = function (exId, cls = '') {
    let key = MAP[exId];
    if (!key) {
      const ex = typeof exById === 'function' ? exById(exId) : null;
      key = ex && ex.muscle === 'cardio' ? 'run' : 'generic';
    }
    return `<svg class="ex-art ${cls}" viewBox="0 0 64 64" aria-hidden="true">${A[key].join('')}</svg>`;
  };
  window.__ART_KEYS = Object.keys(A);
  window.__artByKey = (key) => `<svg class="ex-art" viewBox="0 0 64 64">${A[key].join('')}</svg>`;
})();
