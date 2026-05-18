// ─── 遊戲引擎 ─────────────────────────────────────────────────────────────
// 所有遊戲邏輯與繪製。
//
// 此檔案包含：
//   - BGM 載入與播放
//   - 視覺工具函式
//   - 主要遊戲邏輯（打牌、超車、防守、對手 AI、QTE）
//   - 所有繪製函式（賽道、HUD、卡牌、modal）
//
// 入口為 start(root)，由 main.js 呼叫。

import {
  RHYTHM_DURATIONS,
  RHYTHM_BEAT_ERROR_PERFECT,
  RHYTHM_BEAT_ERROR_GOOD,
  RHYTHM_FORMAL_EASY_PERFECT,
  RHYTHM_FORMAL_EASY_GOOD,
  RHYTHM_SCATTER_MIN_CENTER_DIST,
  RHYTHM_OUTER_R,
  RHYTHM_UI_AVOID_PAD,
  STAGES,
  STAGE5_OPPONENTS,
  STAGE5_CIRCUITS,
  STAGE5_NORMAL_CIRCUITS_POOL,
  STAGE5_COMMAND_CARDS,
  STAGE5_TEAM_CARDS,
  STAGE5_ALL_CARDS,
} from './config.js';
import { app } from './state.js';

// ─── 設計稿座標系統 ────────────────────────────────────────────────────
// 固定設計稿 1920×1080、letterbox（contain）置中
// 使用 window.StoryCanvasViewport library（canvas-viewport.js）
// app.w / app.h 永遠 = DESIGN_W / DESIGN_H
const DESIGN_W = 1920;
const DESIGN_H = 1080;

// ─── 全局 UI 倍率 ────────────────────────────────────────────────────────
// 一次調整所有文字大小與 modal 框框尺寸
const FONT_SCALE = 1.2;
const UI_SCALE = FONT_SCALE;

// ─── 音樂 ────────────────────────────────────────────────────────────────
const NORMAL_STAGE_BGM_SRC = "../assets/BGM/001.mp3";
const normalBgm = new Audio(NORMAL_STAGE_BGM_SRC);
normalBgm.loop = true; normalBgm.preload = "auto"; normalBgm.volume = 0.58;
normalBgm.addEventListener("ended", () => {
  if (normalBgm.loop) { normalBgm.currentTime = 0; normalBgm.play().catch(()=>{}); }
});
function playNormalBgm() { const p = normalBgm.play(); if (p) p.catch(()=>{ app.normalBgmPending = true; }); }
function stopNormalBgm() { normalBgm.pause(); normalBgm.currentTime = 0; }

// ─── 共用視覺工具 ────────────────────────────────────────────────────────
function smooth01(v) {
  const t = Math.max(0, Math.min(1, v));
  return t * t * (3 - 2 * t);
}


// ─── 道初始化 ──────────────────────────────────────────────────────────────
function initLanes(count) {
  app.laneCount = count;
}

// ─── 輪胎系統 ─────────────────────────────────────────────────────────────
function spendTire(n) {
  app.tires = Math.max(0, app.tires - (n || 1));
  if (app.tires === 0 && isStage5()) stage5OnTireOut();
}

// 換道扣速公式：1 道 10、2 道 15、3 道 20...（10 + 5 × (lanes - 1)）
// 只用於玩家換道；對手不適用
function laneChangeCost(lanes) {
  if (lanes <= 0) return 0;
  return 10 + 5 * (lanes - 1);
}
// 守門：在「會切 mode 的結算流程」開始前，先確認輪胎沒爆
// 若已爆 → 強制進 tire-out 並回傳 true（呼叫端應 return）
function enforceTireOutIfDead() {
  if (isStage5() && app.tires === 0) {
    app.mode = "stage5-tire-out";
    return true;
  }
  return false;
}

function canAfford(card) { return true; }   // 主關卡：無 cost 限制
function canAffordAny()  { return app.hand.length > 0; }
function cardCost(card)  { return 0; }

// ─── 賽道加成計算 ──────────────────────────────────────────────────────────
// 取得指定道的加成資料
// target: "player" (預設) | "opponent" — 用於判斷光環影響
//   清道夫(B)被動：他所在的道，對「player」跟「opponent」都失去加成
//   例外：對手是 B 自己 + bypassAura=true（強招豁免，僅當下一行動使用）
// 取得指定道的加成資料
//
// target = "player"  → 直接回傳 lane bonus
// target = "opponent"→ 對手版加成：
//                       - 若 bonus.forOpponent 有定義 → 用它覆寫 add/mult/speedLimit
//                       - 若未定義（多數情況）→ 預設「對對手無加成」（add=0, mult=1, 無速限）
//
// 設計意圖：每條賽道對玩家、對對手是兩組獨立效果。預設對手不吃任何賽道加成、
//          讓賽道機制成為玩家的工具；之後若想讓特定賽道也影響對手，
//          在 lane bonus 上加 forOpponent: { add: N, mult: M, speedLimit: L } 即可。
function getLaneBonusFor(laneIdx, target = "player", bypassAura = false) {
  let bonus = null;
  if (app.laneBonuses) {
    bonus = app.laneBonuses.find(b => b.lane === laneIdx) ?? null;
  } else if (app.laneBonus && app.laneBonus.lane === laneIdx) {
    bonus = app.laneBonus;
  }
  if (!bonus) return null;

  // 對手版加成
  if (target === "opponent") {
    // 沒有顯式定義 forOpponent → 對手不吃加成
    // 保留 label/qteDiff 等顯示用欄位，但 add/mult/speedLimit 歸零
    const opp = bonus.forOpponent ?? null;
    bonus = {
      ...bonus,
      add: opp?.add ?? 0,
      mult: opp?.mult ?? 1,
      speedLimit: opp?.speedLimit ?? null,
    };
  }

  // 套用光環：B 清道夫在場、查詢的道 = 對手所在道、且不豁免 → 加成清空
  if (!bypassAura && isOpponentAuraActive() && app.opponentLane === laneIdx) {
    // 保留 speedLimit、qteDiff、label 等非加成欄位；只把 add / mult 抹除
    return { ...bonus, add: 0, mult: 1, _auraSuppressed: true };
  }
  return bonus;
}

// 當前對手是否有「所在道光環」（清道夫被動）
function isOpponentAuraActive() {
  if (!isStage5()) return false;
  const opp = currentOpponent();
  return opp?.id === "B";
}

// ─── 速度結算飛字 (speed pop) 系統 ───────────────────────────────────────
// 每處速度變動呼叫一次 pushSpeedPop()、每個來源一個 pop。
// pop 進 queue、每 SPEED_POP_INTERVAL ms 從同 target 的 queue 取出一個進 active；
// active 的 pop 在繪製時往上飄 + 淡出，drawSpeedPops() 從車頂位置算座標。
//
// 顏色語意：
//   - 正值（加速）：黃 (#ffd86a)
//   - 負值（扣速）：紅 (#ff7066)
//   - 乘法（彎道 ×N）：藍綠 (#6fe0d0)
//   - 尾流：橘 (#ff9b54)
//   - 災害（坑洞、油污）：紫紅 (#ff5fa0)
const SPEED_POP_INTERVAL = 280;   // 同台車兩個 pop 之間至少間隔 280ms
const SPEED_POP_DURATION = 1200;  // 一個 pop 從生到完全消失 1200ms

// 推一筆速度變動到飛字 queue
//   target: "player" | "opponent"
//   text:   要顯示的文字，例：「+20 加速」「+10 順風」「×1.25 彎道 +25」
//   color:  CSS 顏色字串（不傳則自動依正負判斷）
function pushSpeedPop(target, text, color = null) {
  if (!text) return;
  if (color == null) {
    // 從文字第一個字元自動判斷顏色
    if (text.startsWith("×")) color = "#6fe0d0";
    else if (text.startsWith("-")) color = "#ff7066";
    else color = "#ffd86a";
  }
  app.speedPopsQueue.push({ target, text, color });
}

// 便利包裝：推「+N 標籤」or「-N 標籤」格式的數值 pop
function pushSpeedDeltaPop(target, delta, label, colorOverride = null) {
  if (!delta) return;  // 0 不顯示
  const sign = delta > 0 ? "+" : "";
  const txt  = `${sign}${delta} ${label}`;
  pushSpeedPop(target, txt, colorOverride);
}

// 推「×mult 標籤 +diff」格式（賽道結算 mult 用）
function pushSpeedMultPop(target, mult, label, diff) {
  const diffPart = diff > 0 ? ` +${diff}` : diff < 0 ? ` ${diff}` : "";
  const txt = `×${mult} ${label}${diffPart}`;
  pushSpeedPop(target, txt, "#6fe0d0");
}

// 每幀呼叫：從 queue 取出可發射的 pop 進 active、淘汰過期的 active
function updateSpeedPops(now) {
  // 1) queue → active：每個 target 都看
  for (const target of ["player", "opponent"]) {
    if ((app.speedPopsNextSpawnAt[target] || 0) > now) continue;
    // 找出 queue 中第一個 target 相符的 pop
    const idx = app.speedPopsQueue.findIndex(p => p.target === target);
    if (idx < 0) continue;
    const p = app.speedPopsQueue.splice(idx, 1)[0];
    app.speedPopsActive.push({
      target: p.target,
      text: p.text,
      color: p.color,
      bornAt: now,
      duration: p.durationOverride || SPEED_POP_DURATION,
    });
    app.speedPopsNextSpawnAt[target] = now + SPEED_POP_INTERVAL;
  }
  // 2) 淘汰過期
  app.speedPopsActive = app.speedPopsActive.filter(p => now - p.bornAt < p.duration);
}

// 繪製 active 中的飛字
//   anchors: { player:{x,y}, opponent:{x,y} } — 兩台車的頂部基準座標
function drawSpeedPops(time, anchors) {
  if (!app.speedPopsActive.length) return;
  // 同 target 多個 active 時、按 bornAt 順序往上堆疊（每個再往上 28px）
  const byTarget = { player: [], opponent: [] };
  for (const p of app.speedPopsActive) byTarget[p.target].push(p);
  for (const target of ["player", "opponent"]) {
    const anchor = anchors[target];
    if (!anchor) continue;
    const list = byTarget[target].sort((a, b) => a.bornAt - b.bornAt);
    list.forEach((p, idx) => {
      const t = (time - p.bornAt) / p.duration;     // 0..1
      if (t < 0 || t > 1) return;
      // 動畫：前段往上飄、整段淡出
      const easeOut = 1 - Math.pow(1 - t, 2);
      const baseDy  = -60 - idx * 28;               // 同 target 多筆堆疊
      const dy      = baseDy - easeOut * 30;        // 再往上飄 30px
      // alpha：前 70% 全顯、後 30% 線性淡出
      const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      // 顏色帶 alpha
      const rgb = hexToRgb(p.color);
      const fillColor = rgb
        ? `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`
        : p.color;
      // 加陰影描邊看清楚
      const ctx = app.ctx;
      ctx.save();
      ctx.font = `800 22px system-ui,"Microsoft JhengHei",sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // 深色描邊（提升對比）
      ctx.lineWidth = 4;
      ctx.strokeStyle = `rgba(0,0,0,${0.7 * alpha})`;
      ctx.strokeText(p.text, anchor.x, anchor.y + dy);
      // 主體填色
      ctx.fillStyle = fillColor;
      ctx.fillText(p.text, anchor.x, anchor.y + dy);
      ctx.restore();
    });
  }
}

// 取道路名稱（依車道數量決定用左/中/右、內/外彎、或自訂名稱）
// laneIdx: 0-based 道編號
// 優先級：賽段自訂 laneNames > 標準命名（laneCount 2/3）> fallback「道 N」
function laneDisplayName(laneIdx) {
  const circ = currentCircuit();
  if (circ?.laneNames && circ.laneNames[laneIdx]) return circ.laneNames[laneIdx];
  const laneCount = app.laneCount;
  if (laneCount === 2) return ["內彎", "外彎"][laneIdx] ?? `道 ${laneIdx + 1}`;
  if (laneCount === 3) return ["左道", "中道", "右道"][laneIdx] ?? `道 ${laneIdx + 1}`;
  return `道 ${laneIdx + 1}`;
}

// hex → rgb 輔助
function hexToRgb(hex) {
  if (!hex || hex[0] !== "#") return null;
  const m = hex.slice(1);
  if (m.length !== 6) return null;
  return {
    r: parseInt(m.slice(0, 2), 16),
    g: parseInt(m.slice(2, 4), 16),
    b: parseInt(m.slice(4, 6), 16),
  };
}

// 飛字是否還在跑（queue 有東西、或 active 有東西）
function isSpeedPopsActive() {
  return app.speedPopsQueue.length > 0 || app.speedPopsActive.length > 0;
}

// 待飛字播完後執行的回呼佇列
// 每幀檢查：若飛字都跑完 → 取出第一個回呼執行
// 用陣列是因為閘門 callback 內可能再呼叫 deferUntilSpeedPopsClear
// （例如：打牌閘門 callback 觸發對手回合、對手回合結束又有後半結算閘門）
// 進入時自動鎖 inputLocked、所有閘門都跑完才解鎖
function deferUntilSpeedPopsClear(fn) {
  if (!app._speedPopGates) app._speedPopGates = [];
  app._speedPopGates.push(fn);
  app.inputLocked = true;
}

// 每幀呼叫：若飛字播完 → 觸發第一個 pending 閘門
// 跑完所有閘門且飛字也都播完 → 解鎖 inputLocked
function tickSpeedPopGates() {
  if (!app._speedPopGates) return;
  // 飛字還在播 → 等
  if (isSpeedPopsActive()) return;
  // 有 pending 閘門 → 取一個執行（執行後可能 push 新飛字、設新閘門）
  if (app._speedPopGates.length > 0) {
    const fn = app._speedPopGates.shift();
    try { fn(); } catch (e) { console.error("speed pop gate error:", e); }
    return;
  }
  // 沒 pending 閘門 + 飛字也都播完 → 解鎖
  if (app.inputLocked) app.inputLocked = false;
}

// ─── 玩家速度結算（兩階段）──────────────────────────────────────────────
// 步驟 1「玩家行動」：純加減速到 playerSpeed，不套賽道加成
//   - 換道 delta = -laneCost
//   - 打牌 delta = +cardValue
//   - 步驟 3「檢查尾流」也用這函式（同道則 +30）
function applyPlayerActionDelta(delta) {
  app.playerSpeed = app.playerSpeed + delta;
  if (app.playerSpeed < 0) app.playerSpeed = 0;
}

// 從 lane bonus 的 label 取車道名稱（去掉數值跟符號部分）
//   "順風道 +10"           → "順風道"
//   "內彎 ×1.25 | 限速 75" → "內彎"
//   "標準道"                → "標準道"
//   "外緣 -10（安全）"       → "外緣"
//   null / undefined        → "車道加成"
function extractLaneLabelName(label) {
  if (!label) return "車道加成";
  // 取第一個空白前的部分（避免帶上 +10 / ×1.25 / 限速 等數值）
  const first = String(label).split(/\s+/)[0];
  return first || "車道加成";
}

// 階段 5「賽道結算」：套當前道加成（add → mult → speedLimit）
//   - 玩家賽道結算
//   - 在 advanceCircuitOnCard 末尾呼叫（切到新賽段後）
//   - 也可被超車/PASS 流程之前呼叫（未來擴展）
function resolvePlayerCircuit() {
  if (!isStage5()) return;
  const b = getLaneBonusFor(app.playerLane);
  const add  = b?.add  ?? 0;
  const mult = b?.mult ?? 1;
  const laneName = extractLaneLabelName(b?.label);
  const before = app.playerSpeed;
  // add 階段：先 +add（飛字只顯示車道名、不重複數值）
  if (add) {
    pushSpeedDeltaPop("player", add, laneName);
  }
  const afterAdd = before + add;
  // mult 階段：算出 ×mult 後的差值、用 `×N 車道名 +diff` 顯示
  if (mult !== 1) {
    const afterMult = Math.floor(afterAdd * mult);
    const diff = afterMult - afterAdd;
    pushSpeedMultPop("player", mult, laneName, diff);
  }
  app.playerSpeed = Math.floor(afterAdd * mult);
  if (app.playerSpeed < 0) app.playerSpeed = 0;
}
// 公式：playerSpeed = floor((playerSpeed + delta + add) × mult)
function applyLaneBonusToSpeed(delta, laneIdx) {
  const b    = getLaneBonusFor(laneIdx);
  const add  = b?.add  ?? 0;
  const mult = b?.mult ?? 1;
  app.playerSpeed = Math.floor((app.playerSpeed + delta + add) * mult);
  if (app.playerSpeed < 0) app.playerSpeed = 0;
}

// 玩家當前速度（playerSpeed 已是行動結算後的值，直接讀取）
function currentLaneSpeed() {
  return app.playerSpeed;
}

// ─── 對手速度結算 ──────────────────────────────────────────────────────────
// 規則（incremental，每動結算當前 speed）：
//   一般段：opponentSpeed = opponentSpeed + add
//   彎道段：對手不吃 add、不吃 mult；只在 speed > speedLimit 時被壓回 speedLimit
//          （彎道 mult 是「玩家做 QTE 的反應獎勵」，對手沒做就不該吃）
// B 清道夫被動：他在自己道上吃不到 add/mult，除非 bypassAura=true（強招那一動）
function applyOpponentBonus(currentSpeed, laneIdx, bypassAura = false) {
  if (!isStage5()) return currentSpeed;
  const b = getLaneBonusFor(laneIdx, "opponent", bypassAura);
  if (!b) return currentSpeed;
  const seg = currentCircuit();
  // 彎道段：只受速限壓制、不吃 add/mult
  if (seg?.type === "bend" && b.speedLimit != null) {
    if (currentSpeed > b.speedLimit) return b.speedLimit;
    return currentSpeed;
  }
  // 一般段：加 add
  const add = b.add ?? 0;
  let s = currentSpeed + add;
  if (s < 0) s = 0;
  return s;
}

// 對手顯示速度：opponentSpeed 已是結算後值，直接讀
function opponentDisplaySpeed() {
  return app.opponentSpeed;
}
// 預覽對手若在某道的「結算後速度」（AI 選道用）
// 從當前 speed 出發、套那道的加成
//   c6 油污 lane 1：forceCornerQte 道，AI 用期望值（50% +add / 50% 滑到鄰道吃 -10）
function calcOpponentSpeedAtLane(laneIdx, bypassAura = false) {
  const b = getLaneBonusFor(laneIdx, "opponent", bypassAura);
  if (b && b.forceCornerQte && b.slipOnQteFail === "adjacent") {
    // 成功：吃這道加成
    const successSpeed = applyOpponentBonus(app.opponentSpeed, laneIdx, bypassAura);
    // 失敗：滑到鄰道、吃鄰道平均加成
    const neighbors = [];
    for (let i = 0; i < app.laneCount; i++) {
      if (i !== laneIdx) neighbors.push(i);
    }
    let failAvg = 0;
    if (neighbors.length > 0) {
      let failSum = 0;
      for (const ni of neighbors) failSum += applyOpponentBonus(app.opponentSpeed, ni, bypassAura);
      failAvg = failSum / neighbors.length;
    }
    // 期望值（取整、避免 0.5 等小數）
    return Math.floor(0.5 * successSpeed + 0.5 * failAvg);
  }
  return applyOpponentBonus(app.opponentSpeed, laneIdx, bypassAura);
}

// 賽道結算：incremental 更新 opponentSpeed
// 每個玩家動作完成、advanceCircuitOnCard 中段呼叫
function resolveOpponentCircuit() {
  if (!isStage5()) return;
  // c6 油污：對手在 lane 1（forceCornerQte）時、50% 失敗 → 先位移到鄰道、再用該道加成
  handleOpponentForceQte();
  const before = app.opponentSpeed;
  const after = applyOpponentBonus(before, app.opponentLane, app.opponentAuraBypassed);
  if (app.opponentAbsBonusActive) {
    // 清道夫強招：取 abs(差) 當加成、永遠拿正加成
    const absBonus = Math.abs(after - before);
    app.opponentSpeed = before + absBonus;
    if (absBonus) pushSpeedDeltaPop("opponent", absBonus, "清道夫強招");
    // 用完旗標 → 重置（一次性、強招發動那動有效）
    app.opponentAbsBonusActive = false;
  } else {
    // 一般情況：對手免疫賽道加成（多數時候 after === before）
    // 若有差值（極少數有 forOpponent 設定的賽道）→ push pop
    const diff = after - before;
    if (diff) {
      const b = getLaneBonusFor(app.opponentLane, "opponent");
      pushSpeedDeltaPop("opponent", diff, extractLaneLabelName(b?.label));
    }
    app.opponentSpeed = after;
  }
}
// c6 油污：對手在 forceCornerQte 道時、50% 失敗判定
//   - 成功（50%）：留在當前道、正常吃 +10（之後 resolveOpponentCircuit 自動結算）
//   - 失敗（50%）：滑到隨機鄰道、之後結算用該鄰道加成（自然會吃 -10）
//   - B 清道夫被動：他被自己的光環保護、不會在油污失控（跟坑洞抵消同源）
function handleOpponentForceQte() {
  // 清道夫免疫災害：他的光環保護自己
  if (isOpponentAuraActive()) return;
  const b = getLaneBonusFor(app.opponentLane, "opponent");
  if (!b || !b.forceCornerQte) return;
  if (b.slipOnQteFail !== "adjacent") return;
  // 50% 機率失敗
  if (Math.random() < 0.5) {
    const safeLanes = [];
    for (let i = 0; i < app.laneCount; i++) {
      if (i !== app.opponentLane) safeLanes.push(i);
    }
    if (safeLanes.length > 0) {
      const prevLane = app.opponentLane;
      const newLane = safeLanes[Math.floor(Math.random() * safeLanes.length)];
      app.opponentLane = newLane;
      app.opponentActionFx = {
        label: `對手在油污失控！滑到${laneDisplayName(newLane)}`,
        until: performance.now() + 3500,
      };
      pushSpeedPop("opponent", "油污失控", "#ff5fa0");
    }
  }
  // 成功：靜默通過、不顯示訊息（避免反饋疲勞）
}

// 預覽某道打 delta 速的牌會得到多少速度（拖牌 UI 用，不修改狀態）
function calcDisplaySpeed(baseSpeed, delta, laneIdx) {
  const b    = getLaneBonusFor(laneIdx);
  const add  = b?.add  ?? 0;
  const mult = b?.mult ?? 1;
  return Math.floor((baseSpeed + delta + add) * mult);
}
function canDirectOvertake() {
  return app.playerLane !== app.opponentLane && currentLaneSpeed() > opponentDisplaySpeed();
}

// 玩家當前道的 QTE 難度修正
function currentLaneQteDiff() {
  const b = getLaneBonusFor(app.playerLane);
  return b ? (b.qteDiff ?? "normal") : "normal";
}

// 彎道限速（playerSpeed 已結算，直接比較）
function currentLaneSpeedLimit() {
  const b = getLaneBonusFor(app.playerLane);
  return b?.speedLimit ?? null;
}

function rhythmBeatWindowSec() {
  // 判定窗口固定，不隨道路難度改變（難度只影響圓圈收縮速度）
  if (app.mode === "rhythm-formal")
    return { perfect: RHYTHM_FORMAL_EASY_PERFECT, good: RHYTHM_FORMAL_EASY_GOOD };
  return { perfect: RHYTHM_BEAT_ERROR_PERFECT, good: RHYTHM_BEAT_ERROR_GOOD };
}

function getRhythmDuration(circleIndex) {
  let dur = RHYTHM_DURATIONS[Math.min(circleIndex, RHYTHM_DURATIONS.length - 1)];
  // 賽道難度
  const diff = currentLaneQteDiff();
  if (diff === "easy") dur *= 1.4;
  if (diff === "hard") dur *= 0.7;
  // 速度每 2 速 -10%，上限 30%
  const step = speedTierStep(app.playerSpeed);
  const speedFactor = Math.max(0.30, Math.pow(0.93, step));
  dur *= speedFactor;
  return Math.round(dur);
}

// ─── 防守難度 ──────────────────────────────────────────────────────────────
function defenseDifficulty() {
  return {
    safeWidth:    28,
    perfectWidth: 8,
    shiftMin:     400,
    shiftMax:     550,
    lerp:         0.07,
    missPenalty:  0.05,
  };
}

// ─── 發牌 ──────────────────────────────────────────────────────────────────
function makeCard(type, suffix) {
  const def = STAGE5_ALL_CARDS[type];
  if (!def) {
    console.warn(`[makeCard] unknown card type: ${type}`);
    return { type, name: `[?] ${type}`, speedValue: 0, cardClass: "action", id: `${type}-${suffix}` };
  }
  return { ...def, id: `${type}-${suffix}` };
}

// ─── 主關卡支援函式 ────────────────────────────────────────────────────────
// 建立第五關的卡（從 STAGE5_ALL_CARDS 取定義）
let _stage5CardSeq = 0;
function makeStage5Card(type) {
  const def = STAGE5_ALL_CARDS[type];
  if (!def) return null;
  _stage5CardSeq += 1;
  // 用 spread 自動帶所有欄位（trigger / costOnEquip / tireCost / qteForgive / smoothOperator
  //  / driftQte / requireBend / drawNextHand 等都會自動跟著、不會再漏）
  return { ...def, id: `s5-${type}-${_stage5CardSeq}` };
}

// 算「車隊牌全域修飾後的指令牌速度」+ 是否被修飾
//   只算「對所有指令牌都有影響」的修飾、不算「連擊型」（rhythmCoach 連擊不顯示在牌面）
//   也不算 smoothOperator（這是牌自己的條件、不是車隊牌修飾）
// 回傳：{ value: 結算後的速度, modified: 是否被車隊牌動過, delta: 變化量 }
function getCardEffectiveSpeed(card) {
  const base = card.speedValue || 0;
  if (!isStage5() || card.cardClass !== "action") return { value: base, modified: false, delta: 0 };
  const s5 = app.stage5;
  if (!s5 || !s5.teamCardsActive) return { value: base, modified: false, delta: 0 };
  let delta = 0;
  for (const c of s5.teamCardsActive) {
    // fuelMaster：所有指令牌 +5
    if (c.effect === "cardBonusThisRound") delta += (c.value || 0);
    // tirePreservation：所有指令牌 -10
    if (c.effect === "tirePreserve") delta -= 10;
  }
  return { value: base + delta, modified: delta !== 0, delta };
}
// 起始牌庫：加速 + 再加速（無失誤牌；失誤牌只從 QTE 懲罰取得）
function makeStage5InitialDeck() {
  const deck = [];
  // v0.9：2 渦輪 + 3 加速 + 2 風阻減免 + 1 換道節奏 = 8 張基礎牌庫
  for (let i=0;i<2;i++) deck.push(makeCard("turbo", `s5-init-tb-${i}`));
  for (let i=0;i<3;i++) deck.push(makeCard("tailwind", `s5-init-tw-${i}`));
  for (let i=0;i<2;i++) deck.push(makeCard("drag", `s5-init-dr-${i}`));
  for (let i=0;i<1;i++) deck.push(makeCard("laneRhythm", `s5-init-lr-${i}`));
  return deck;
}
// 發初始手牌（4 張，留 4 張在牌庫；每回合重發）
function dealStage5Initial() {
  if (!app.stage5) return;
  dealStage5Hand();
}
// 從 stage5 牌庫（base + permanent）發 N 張
function dealStage5Hand() {
  const s5 = app.stage5;
  if (!s5) return;
  // 計算要補幾張（保留現有手牌，補到 5 張）
  let handSize = 5;
  if (s5.penaltyNextHand) {
    handSize += s5.penaltyNextHand;
    s5.penaltyNextHand = 0;
  }
  handSize = Math.max(2, handSize);
  const toDraw = Math.max(0, handSize - (app.hand ? app.hand.length : 0));
  // 從 drawPile 抽，不夠時把 discardPile 洗進 drawPile
  for (let i = 0; i < toDraw; i++) {
    if (s5.drawPile.length === 0) {
      if (s5.discardPile.length === 0) break;
      s5.drawPile = [...s5.discardPile];
      s5.discardPile = [];
      shuffleArrayInPlace(s5.drawPile);
    }
    app.hand.push(s5.drawPile.shift());
  }
}
// 取得當前賽道設定
function currentCircuit() {
  if (!app.stage5) return null;
  return STAGE5_CIRCUITS[app.stage5.circuitIndex];
}
// 取得下一賽道設定（用於右上預告）
function nextCircuit() {
  if (!app.stage5) return null;
  const s5 = app.stage5;
  const order = s5.circuitOrder && s5.circuitOrder.length ? s5.circuitOrder : STAGE5_NORMAL_CIRCUITS_POOL;
  const curIdx = order.indexOf(s5.circuitIndex);
  const nextIdx = curIdx >= 0 ? (curIdx + 1) % order.length : 0;
  return STAGE5_CIRCUITS[order[nextIdx]];
}
// 套用賽道到 app 狀態
// 從加權分布抽一個值（weight 不需要歸一）
function pickFromWeightedDistribution(distribution) {
  if (!distribution || !distribution.length) return 0;
  const totalWeight = distribution.reduce((s, d) => s + (d.weight || 0), 0);
  if (totalWeight <= 0) return 0;
  let r = Math.random() * totalWeight;
  for (const d of distribution) {
    r -= (d.weight || 0);
    if (r <= 0) return d.value;
  }
  return distribution[distribution.length - 1].value;
}
// 依 circ.laneBonusDistribution 為每條道獨立抽 add，生成 laneBonuses。
// 抽出來會放回 circ.laneBonuses（供 UI 即時讀取），也回傳一份新陣列。
function generateLaneBonusesFromDistribution(circ) {
  const bonuses = [];
  for (let i = 0; i < circ.lanes; i++) {
    const add = pickFromWeightedDistribution(circ.laneBonusDistribution);
    const sign = add >= 0 ? "+" : "";
    let laneName;
    if (circ.laneNames && circ.laneNames[i]) laneName = circ.laneNames[i];
    else if (circ.lanes === 2) laneName = ["內彎", "外彎"][i] ?? `道 ${i + 1}`;
    else if (circ.lanes === 3) laneName = ["左道", "中道", "右道"][i] ?? `道 ${i + 1}`;
    else laneName = `道 ${i + 1}`;
    bonuses.push({
      lane: i,
      add,
      mult: 1,
      label: `${laneName} ${sign}${add}`,
    });
  }
  return bonuses;
}
function applyCircuit(circ) {
  initLanes(circ.lanes);
  // 夾住玩家 / 對手的 lane 到新賽段範圍內、避免「賽段 3 道 → 2 道」時對手在 lane 2 跑到賽道外
  const maxLane = circ.lanes - 1;
  if (app.playerLane > maxLane) app.playerLane = maxLane;
  if (app.opponentLane > maxLane) app.opponentLane = maxLane;
  // visual lane 也夾、避免動畫滑出去
  if (app.playerLaneVisual > maxLane) app.playerLaneVisual = maxLane;
  if (app.opponentLaneVisual > maxLane) app.opponentLaneVisual = maxLane;
  app.bendCurve = circ.bendCurve;
  app.roadWidthScale = circ.roadWidthScale;
  // 動態 laneBonuses：若有 laneBonusDistribution 則每進此段都重抽
  if (circ.laneBonusDistribution) {
    circ.laneBonuses = generateLaneBonusesFromDistribution(circ);
  }
  app.laneBonuses = circ.laneBonuses;
  app.laneBonus = null;
  // c7 坑洞：每次進此段都重抽一道為坑洞道
  if (app.stage5) {
    if (circ.randomPothole) {
      // 抽 2 道有坑、留 1 道安全（從 0..lanes-1 隨機去掉一道、剩下的全是坑）
      const safeLane = Math.floor(Math.random() * circ.lanes);
      const pits = [];
      for (let i = 0; i < circ.lanes; i++) {
        if (i !== safeLane) pits.push(i);
      }
      app.stage5.potholeLanes = pits;
    } else {
      app.stage5.potholeLanes = null;
    }
    // c8 紅綠燈干擾：清空揭曉集合（要等玩家動作結算後才會揭曉所在道）
    // 進 c8 那一刻不算「走過」，三道全部顯示 ?
    app.stage5.revealedC8Lanes = new Set();
    // c6/c7 sprite 在賽道路面上的 y 進度（progress 0=遠方 horizon、1=靠近玩家車）
    //   範圍 0.15~0.45：避免太遠看不清楚（< 0.15）、避免太近撞到對手車（> 0.45、對手車在 0.62-0.72）
    //   進關時隨機一個值、整段不變
    const hasHazard = circ.randomPothole || (circ.laneBonuses && circ.laneBonuses.some(b => b.forceCornerQte));
    if (hasHazard) {
      app.stage5.hazardSpriteProgress = 0.15 + Math.random() * 0.30;  // 0.15..0.45
    } else {
      app.stage5.hazardSpriteProgress = null;
    }
  }
  // 玩家若在新賽道沒有的道上 → 移到 0
  if (app.playerLane >= circ.lanes) {
    app.playerLane = Math.max(0, circ.lanes - 1);
    app.playerLaneVisual = app.playerLane;
  }
}
// 推進到下一段賽道（每回合結束時叫）
function advanceCircuit() {
  if (!app.stage5) return;
  const s5 = app.stage5;
  const order = s5.circuitOrder && s5.circuitOrder.length ? s5.circuitOrder : STAGE5_NORMAL_CIRCUITS_POOL;
  const curIdx = order.indexOf(s5.circuitIndex);
  const nextIdx = curIdx >= 0 ? (curIdx + 1) % order.length : 0;
  s5.circuitIndex = order[nextIdx];
  applyCircuit(STAGE5_CIRCUITS[s5.circuitIndex]);
  s5.circuitJustChanged = true;
}
// 每打一張牌切換賽段（核心機制）
// 順序：
//   1. 賽道結算（用「當前」賽段加成）
//   2. 切到下一賽段（影響下個動作）
function advanceCircuitOnCard() {
  if (!app.stage5) return;
  // 階段 5「賽道結算」：用當前賽段加成
  //   順序:玩家賽道 → 對手賽道
  resolvePlayerCircuit();
  resolveOpponentCircuit();
  // 套完 mult 才能正確判斷是否超速
  checkBendSpeedLimit();
  // c7 坑洞:結算後人在坑洞道 → 玩家 -1 胎、對手降速一半
  checkPotholeDamage();
  // c8 紅綠燈干擾:結算後玩家所在道立刻揭曉
  revealC8CurrentLane();
  // ── 切到下一賽段 ──
  // 若 checkBendSpeedLimit 觸發了 QTE → 延後切段
  // 等 QTE 結束（endBendQte 1.5 秒後）才切下一段
  // 這保證 endBendQte 內 getLaneBonusFor(playerLane) 拿到的是當前段（c6 中道）、不是下一段
  // 注意：splash-bend 也算「QTE 已觸發」狀態（玩家還沒按確認鍵）
  //       _pendingBendQteTrigger 也算（飛字還在播、splash-bend 尚未切入）
  if (app.mode === "bend-qte" || app.mode === "splash-bend" || app._pendingBendQteTrigger) {
    app.stage5.pendingCircuitAdvance = true;
    return;
  }
  // 閘門：等步驟 4 賽道結算的飛字（順風 +10、彎道 ×1.25 等）播完，才實際切到下一段
  // 飛字跟玩家身處的賽段在視覺上對齊：先看完當前段的結算、再進新段
  deferUntilSpeedPopsClear(() => {
    advanceCircuitToNextSegment();
  });
}
// 切到下一賽段（從 advanceCircuitOnCard 或 QTE 結束後叫）
function advanceCircuitToNextSegment() {
  const s5 = app.stage5;
  if (!s5) return;
  const order = s5.circuitOrder && s5.circuitOrder.length ? s5.circuitOrder : STAGE5_NORMAL_CIRCUITS_POOL;
  const curIdx = order.indexOf(s5.circuitIndex);
  const nextIdx = curIdx >= 0 ? (curIdx + 1) % order.length : 0;
  s5.circuitIndex = order[nextIdx];
  applyCircuit(STAGE5_CIRCUITS[s5.circuitIndex]);
}
// c7 坑洞段：結算後檢查玩家／對手是否踩到坑洞道
//   玩家：-1 輪胎
//   對手：速度 / 2（對手目前沒有胎系統，用降速代替）
//   清道夫(B)光環互動：光環道 = 對手所在道；在光環道踩坑 → 不扣胎/不降速
function checkPotholeDamage() {
  const s5 = app.stage5;
  if (!s5 || !s5.potholeLanes || !s5.potholeLanes.length) return;
  const pits = s5.potholeLanes;
  const auraActive = isOpponentAuraActive();
  const auraLane = auraActive ? app.opponentLane : -1;

  const playerHit  = pits.includes(app.playerLane);
  const playerSafeAura = playerHit && auraActive && app.playerLane === auraLane;
  // 補丁車隊牌：玩家踩坑時、消耗一張「patch」抵消
  let playerSafePatch = false;
  if (playerHit && !playerSafeAura) {
    const patchIdx = s5.teamCardsActive.findIndex(c => c.effect === "savePothole");
    if (patchIdx >= 0) {
      s5.teamCardsActive.splice(patchIdx, 1);  // 消耗
      playerSafePatch = true;
    }
  }
  const playerSafe = playerSafeAura || playerSafePatch;
  const oppHit  = pits.includes(app.opponentLane);
  const oppSafe = oppHit && auraActive;  // 對手是清道夫 → 站光環道踩坑必抵消

  // 玩家判定
  if (playerHit && !playerSafe) {
    app.message = "💥 撞到坑洞！-1 輪胎";
    spendTire(1);
    pushSpeedPop("player", "-1 胎 坑洞", "#ff5fa0");
  } else if (playerHit && playerSafePatch) {
    pushSpeedPop("player", "🩹 補丁抵消", "#ffd86a");
  } else if (playerHit && playerSafeAura) {
    pushSpeedPop("player", "🛡️ 光環抵消", "#6fe0d0");
  }
  // 對手判定（速度 / 2）
  let oppBefore = null, oppAfter = null;
  if (oppHit && !oppSafe) {
    oppBefore = app.opponentSpeed;
    app.opponentSpeed = Math.floor(oppBefore / 2);
    oppAfter = app.opponentSpeed;
    pushSpeedPop("opponent", `${oppAfter - oppBefore} 坑洞`, "#ff5fa0");
  } else if (oppHit && oppSafe) {
    pushSpeedPop("opponent", "🛡️ 光環抵消", "#6fe0d0");
  }
  // 合併訊息：考慮光環抵消的不同組合
  if (playerSafePatch) {
    app.message = "🩹 補丁觸發！抵消坑洞傷害（補丁已用完）";
  } else if (playerSafe && oppSafe) {
    app.message = "🛡️ 清道夫光環抵消坑洞！你跟對手都安然通過";
  } else if (playerSafe) {
    app.message = "🛡️ 清道夫光環抵消坑洞！你安然通過";
  } else if (oppSafe && playerHit) {
    app.message = "🛡️ 對手清道夫光環抵消坑洞，但你 -1 輪胎";
  } else if (oppSafe) {
    app.message = "🛡️ 清道夫光環抵消坑洞！對手安然通過";
  } else if (playerHit && oppHit) {
    app.message = `💥 你跟對手都撞到坑洞！你 -1 輪胎，對手降速 ${oppBefore} → ${oppAfter}`;
  } else if (oppHit) {
    app.message = `💥 對手撞到坑洞！速度 ${oppBefore} → ${oppAfter}`;
  }
  // 玩家單獨踩坑的訊息已在上面 spendTire 那段設好
}
// c8 紅綠燈干擾：揭曉玩家當前所在道（這圈 c8 內永久顯示真實 add）
function revealC8CurrentLane() {
  const s5 = app.stage5;
  if (!s5 || !s5.revealedC8Lanes) return;
  const circ = currentCircuit();
  if (!circ || !circ.hideLaneBonusUntilVisited) return;
  s5.revealedC8Lanes.add(app.playerLane);
}
// 彎道限速檢查：速度結算完後才呼叫
//   - 一般彎道：速度 > limit 才觸發
//   - c6 油污 lane 1：forceCornerQte 旗標 → 不看速度、踏入就觸發
function checkBendSpeedLimit() {
  if (!app.stage5 || app.mode !== "playing") return;
  const b = getLaneBonusFor(app.playerLane);
  // c6 油污：強制彎道 QTE（不看速度）
  if (b && b.forceCornerQte) {
    pushSpeedPop("player", "油污！", "#ff5fa0");
    triggerBendQTE();
    return;
  }
  const limit = currentLaneSpeedLimit();
  if (limit === null) return;
  if (currentLaneSpeed() > limit) {
    pushSpeedPop("player", "超速！", "#ff5fa0");
    triggerBendQTE();
  }
}
// 彎道 QTE 觸發（速度越快箭頭越多越快）
//   兩階段：
//     A. 立即：準備好 arrows / secs、設旗標 _pendingBendQteTrigger
//     B. 飛字播完後：實際切 mode = "splash-bend"、確認按鈕才會出現
//   設計意圖：避免賽道結算飛字（中道 +10、×1.25 等）跟「油污！」警告飛字
//             還在播時、QTE 確認按鈕就跑出來、視覺亂且在小視窗會被擋。
function triggerBendQTE() {
  const step = speedTierStep(app.playerSpeed);
  const baseSecs = 6;
  const secs = Math.max(2, baseSecs * Math.pow(0.90, step));
  // 預先生成箭頭與參數（按確認鍵時不需重算）
  app._pendingBendQte = {
    arrows: generateBendArrows(step),
    secs,
  };
  // 設旗標：advanceCircuitOnCard 末端會看這個、不去排切段閘門
  // 飛字閘門解開後才真正進 splash-bend
  app._pendingBendQteTrigger = true;
  deferUntilSpeedPopsClear(() => {
    if (!app._pendingBendQteTrigger) return;  // 被取消（保險）
    app._pendingBendQteTrigger = false;
    app.mode = "splash-bend";
    app.message = "緊急過彎！";
    app.qteStart = performance.now();
  });
}
function generateBendArrows(step) {
  const dirs  = ["↑","↓","←","→"];
  const count = Math.min(12, 2 + step * 2);
  return Array.from({ length: count }, () => dirs[Math.floor(Math.random() * 4)]);
}
// 尾流：返回應加的 delta（+30），不直接改 playerSpeed
// 呼叫者把這個 delta 加入行動結算
function consumeSlipstreamDelta() {
  if (!app.stage5) return 0;
  const s5 = app.stage5;
  if (s5.slipstreamUsed) return 0;
  if (app.playerLane !== app.opponentLane) return 0;
  // 清道夫光環：B 所在道、玩家吃不到尾流
  // 同道 = 玩家跟 B 在同一道、所以這條也適用
  // bypassAura 是「B 自己豁免」、玩家仍受光環影響、仍吃不到尾流
  if (isOpponentAuraActive()) {
    // 不消費 slipstreamUsed、不顯示提示（玩家看到光環標籤就知道）
    return 0;
  }
  s5.slipstreamUsed = true;
  app.opponentActionFx = { label: "尾流！速度 +30", until: performance.now() + 1800, positive: true };
  return 30;
}
// 尾流視覺檢查（不改速度，只用於 UI 顯示同道提示）
function checkSlipstream() {
  consumeSlipstreamDelta();  // 若同道且未用過就觸發，delta 直接丟棄（純副作用：標記 slipstreamUsed 和顯示 fx）
}
// 預覽用：玩家「如果在 lane 道、現在能否吃尾流」（不修改狀態）
// 條件：同道 + 未用過 + 不在 B 光環抵消下
function canGetSlipstreamAtLane(lane) {
  if (!app.stage5) return false;
  if (app.stage5.slipstreamUsed) return false;
  if (lane !== app.opponentLane) return false;
  if (isOpponentAuraActive()) return false;  // B 光環抵消尾流
  return true;
}
// 輪胎歸零：輸
function stage5OnTireOut() {
  app.mode = "stage5-tire-out";
}
// 取得當前對手（從 stage5.currentOpponentId 拿配置）
function currentOpponent() {
  if (!app.stage5 || !app.stage5.currentOpponentId) return null;
  return STAGE5_OPPONENTS[app.stage5.currentOpponentId];
}
// 隨機從「前方對手陣容（排除 boss）」抽一個當當前對手
function pickNextOpponent() {
  const s5 = app.stage5;
  if (!s5) return null;
  // 如果有指定（被反超後），直接用
  if (s5.pinnedNextOpponentId) {
    const id = s5.pinnedNextOpponentId;
    s5.pinnedNextOpponentId = null;
    return id;
  }
  const candidates = s5.ahead.filter(id => id !== "BOSS");
  if (candidates.length === 0) return null;  // 全部超過 = 通關
  // v0.9：固定取「玩家前一個名次」的對手 = ahead 列表的最後一個
  //   ahead 的排列是「第 1 名、第 2 名、...、玩家前一名」
  //   所以最後一個 = 離玩家最近的對手 = 應該面對的對手
  return candidates[candidates.length - 1];
}
// 取得當前後車（追車）
function currentChaser() {
  if (!app.stage5 || !app.stage5.chaserId) return null;
  return STAGE5_OPPONENTS[app.stage5.chaserId];
}
// 套用當前對手到 app（speed + actions/behaviors）
function applyOpponentToApp(oppId) {
  const opp = STAGE5_OPPONENTS[oppId];
  if (!opp) return;
  // 對手初始速度（直接用 STAGE5_OPPONENTS 定義的 speed、不立即套加成）
  // 第一個玩家動作末尾才會「賽道結算」更新 speed
  app.opponentSpeed = opp.speed;
  app.opponentLane = (app.laneCount >= 2) ? (app.playerLane === 0 ? 1 : 0) : 0;
  app.opponentLaneVisual = app.opponentLane;
  app.opponentActionsThisStage = (opp.actions || []).map(a => ({...a}));
  // 拷貝 behaviors，並初始化每個 behavior 的「上次觸發」標記
  if (opp.behaviors) {
    app.opponentBehaviors = opp.behaviors.map(b => ({...b}));
    // lastTriggeredAt[behaviorId] = 上次觸發時的 actionClock 值
    // 初始化策略：
    //   - weak/medium：設成 -cooldown → 第 1 動就可以觸發
    //   - strong：設成 0 → 要等滿一整個 cooldown 才會第一次觸發
    // 用意：每回合一開始就有弱招壓力，但強招需要醞釀
    app.opponentBehaviorLastTriggered = {};
    for (const b of opp.behaviors) {
      app.opponentBehaviorLastTriggered[b.id] =
        (b.weight === "strong") ? 0 : -b.cooldown;
    }
  } else {
    app.opponentBehaviors = null;
    app.opponentBehaviorLastTriggered = null;
  }
}
// 套用當前追車到 app（chaserSpeed）
function applyChaserToApp(chaserId) {
  if (!chaserId) {
    app.chaserSpeed = null;
    app.chaserTargetLane = null;
    app.chaserVisualLane = null;
    return;
  }
  const opp = STAGE5_OPPONENTS[chaserId];
  if (!opp) return;
  app.chaserSpeed = opp.chaserSpeed;
  app.chaserTargetLane = app.playerLane;
  app.chaserVisualLane = app.playerLane;
  app.chaserLastActCount = -1;
}
// 初始化主關卡狀態
function initStage5State() {
  app.stage5 = {
    ahead: ["A","B","C"],
    passed: [],
    currentOpponentId: null,
    pinnedNextOpponentId: null,
    chaserId: null,
    circuitIndex: 0,
    circuitOrder: [],  // 本局洗牌後的賽段順序（在下方填入）
    circuitJustChanged: false,
    potholeLanes: null,  // c7 坑洞段：本次抽到的坑洞道陣列（applyCircuit 動態設定）
    revealedC8Lanes: new Set(),  // c8 紅綠燈干擾：本圈 c8 已揭曉的道集合（applyCircuit 進 c8 時清空）
    hazardSpriteProgress: null,  // c6/c7 sprite 在賽道路面上的 y 進度（0=horizon 1=玩家車）
    pendingCircuitAdvance: false,  // c6 油污：QTE 觸發時暫停切段、等 QTE 結束才切
    deckBase: makeStage5InitialDeck(),
    deckPermanent: [],
    drawPile: [],     // 抽牌堆（真實 deck，會逐張消耗）
    discardPile: [],  // 棄牌堆（打出的牌進這）
    teamCardsActive: [],
    rewardOptions: [],
    rewardPickAnim: null,
    rewardSlotHover: -1,
    penaltyNextHand: 0,
    slipstreamUsed: false,
    opponentFocusMap: {},   // { "A": 1, "B": 2, ... } 各對手剩餘專注度
    seenIntro: false,
    lastMistakeCount: 0,
    // 回合計時：跑滿 MAX_ROUNDS 回合 = 越過終點線、強制結束
    roundsPlayed: 0,                       // 已進入的新回合次數（stage5StartNewRound 每次 +1）
    maxRounds: 10,                         // 終點線回合數
  };
  // 第一回合抽當前對手
  app.stage5.currentOpponentId = pickNextOpponent();
  // 隨機洗牌一次，得到本局的賽段循環順序；之後整局都沿這個順序循環
  app.stage5.circuitOrder = [...STAGE5_NORMAL_CIRCUITS_POOL];
  shuffleArrayInPlace(app.stage5.circuitOrder);
  app.stage5.circuitIndex = app.stage5.circuitOrder[0];
  applyCircuit(STAGE5_CIRCUITS[app.stage5.circuitIndex]);
  // 初始化各對手專注度
  for (const [id, opp] of Object.entries(STAGE5_OPPONENTS)) {
    app.stage5.opponentFocusMap[id] = opp.focus ?? 0;
  }
  // 把起始牌庫灌入抽牌堆並洗牌
  refillAndShuffleDrawPile();
}
// 把（deckBase + deckPermanent）全部丟進 drawPile + discardPile 重新洗
function refillAndShuffleDrawPile() {
  const s5 = app.stage5;
  if (!s5) return;
  s5.drawPile = [...s5.deckBase, ...s5.deckPermanent];
  s5.discardPile = [];
  shuffleArrayInPlace(s5.drawPile);
}
function shuffleArrayInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ─── 關卡初始化 ────────────────────────────────────────────────────────────
function loadStage(idx) {
  const stage = STAGES[idx];
  if (!stage) return;
  app.stageIndex = idx;
  initStage5State();
  // 清空飛字系統殘留（前一關沒播完的 pop、閘門、輸入鎖）
  app.speedPopsQueue = [];
  app.speedPopsActive = [];
  app.speedPopsNextSpawnAt = { player: 0, opponent: 0 };
  app._speedPopGates = [];
  app.inputLocked = false;
  app._pendingBendQteTrigger = false;
  app.rank = 4;
  app.rankTotal = 4;
  app.playerLane = 1;
  app.playerLaneVisual = 1;
  app.tires = 5;
  app.tiresMax = 5;
  app.playerSpeed = 0;
  app.cardsPlayedThisRound = 0;
  app.actionsThisRound = 0;
  app.noDefense = false;
  app.bendCurve = 0;
  app.chaserSpeed = null;
  app.chaserTargetLane = null;
  app.chaserVisualLane = null;
  app.chaserLastActCount = -1;
  app.drag = null;
  app.message = "";
  applyOpponentToApp(app.stage5.currentOpponentId);
  // 開場 intro modal
  app.mode = "stage-5-intro";
  // 還沒發手牌 — 等玩家按下「開始」才發
  app.hand = [];
}

// ─── Reset ─────────────────────────────────────────────────────────────────
function reset() {
  stopNormalBgm();
  app.mode = "start-ready";
  app.rank = 4;
  app.rankTotal = 4;
  app.stageIndex = 0;
  app.playerSpeed = 0;
  app.tires = app.tiresMax;
  app.playerLane = 1;
  app.playerLaneVisual = 1;
  app.opponentLane = 0;
  app.opponentLaneVisual = 0;
  app.hand = [];
  app.drag = null;
  app.zones = {};
  app.qteClicked = new Set();
  app.qteResults = {};
  app.qteDismissAt = {};
  app.qteTapPending = {};
  app.qteFinalized = {};
  app.qteResolveAt = 0;
  app.qteScatterPos = null;
  app.qteKeys = [];
  app.defenseSucceeded = false;
  app.opponentActionFx = null;
  app.overtakeAnim = null;
  app.laneBonus = null;
  app.laneBonuses = null;
  app.chaserSpeed = null;
  app.chaserTargetLane = null;
  app.chaserVisualLane = null;
  app.chaserLastActCount = -1;
  app.noDefense = false;
  app.bendCurve = 0;
  app.roadWidthScale = 1.0;
  initLanes(3);
  hideGameWinOverlay();
}

// ─── 主要遊戲動作 ──────────────────────────────────────────────────────────
function playCardToLane(cardIdx, targetLane) {
  if (cardIdx < 0 || cardIdx >= app.hand.length) return;
  const card = app.hand[cardIdx];

  const isCurrentLane = targetLane === app.playerLane;

  // 記錄「玩家動作前所在道」 — 對手 AI 用這個當目標、不追真實位置
  // 玩家在動作中可能換道、但對手仍以「動作前的道」為基準（給玩家閃避空間）
  if (isStage5()) {
    app.playerLaneBeforeAction = app.playerLane;
  }

  // drift（甩尾過彎）：只能在彎道段使用、且必須拖到自己道
  // TODO v0.10：接上「強制觸發彎道 QTE + 依結果調整加成」的完整機制
  //   現階段：在非彎道段被拖出 → 拒絕；在彎道段 → 當成普通 +0 牌處理（後續實作）
  if (isStage5() && card.requireBend) {
    const seg = currentCircuit();
    if (seg?.type !== "bend") {
      // 非彎道段、拒絕（卡留在手牌）
      return;
    }
  }

  // 車隊牌特殊規則（v0.8）：
  //   - 拖到任何道都生效（不區分位置、即時結算）
  //   - 不換道
  //   - 不算行動（不 +actionsThisRound、不 +cardsPlayedThisRound）
  //   - 立即套用效果、立即結算（不延後到對手過場）
  //   - 不觸發對手回合、不切換賽段
  //   - 打完繼續等玩家動作
  // 在「換道」邏輯之前先處理，避免被當成換道
  if (isStage5() && card.cardClass === "team") {
    app.hand.splice(cardIdx, 1);
    const s5 = app.stage5;
    s5.teamCardsActive.push(card);
    // 即時套用效果（permanent 效果由查詢點自然生效）
    // 不算行動、不觸發對手、不切換賽段
    checkAutoPrompt();
    return;
  }

  // v0.9：所有指令牌拖到別道都走標準棄牌換道機制（棄該牌、扣 10 速、換道）
  // 沒有「canChangeLane = 拖別道直接 +15 加速」這種特殊機制——太強

  // 換道：棄一張手牌 + 依跨道數扣速；速度 0 時不能換道
  if (!isCurrentLane) {
    if (app.playerSpeed <= 0) return;
    app.hand.splice(cardIdx, 1);
    if (isStage5() && app.stage5) app.stage5.discardPile.push(card);
    app.actionsThisRound = (app.actionsThisRound ?? 0) + 1;
    // 計算扣速量（跨道數 = abs(target - 當前)）
    const lanesCrossed = Math.abs(targetLane - app.playerLane);
    const laneCost = laneChangeCost(lanesCrossed);
    app.playerLane = targetLane;  // 移到新道（純動作）
    if (isStage5()) {
      // 步驟 1：自身代價立即生效（扣 laneCost）
      applyPlayerActionDelta(-laneCost);
      pushSpeedDeltaPop("player", -laneCost, "跨道");
      // 換道打斷「連續指令牌」連擊鏈
      const s5 = app.stage5;
      s5.lastActionWasCard = false;
      s5.lastCardType = null;
      s5.lastCardSameStreak = 0;
      // 記錄玩家動作後是否跟對手同道（用於步驟 3 嘲諷檢測）
      const wasSameLane = (app.playerLane === app.opponentLane);
      // 標記待結算動作 → 對手過場結束後執行步驟 3+4
      app.pendingAction = { kind: "lane", card, wasSameLane };
    } else {
      app.playerSpeed = Math.max(0, app.playerSpeed - 1);
    }
    // 閘門 A：等步驟 1 的玩家飛字（-跨道）播完，再開啟對手回合
    deferUntilSpeedPopsClear(() => {
      triggerOpponentActions();
      checkAutoPrompt();
    });
    return;
  }

  // 第五關車隊牌處理已在函式開頭攔截、此處不會再執行到

  // 打牌到當前道：速度累積到玩家身上
  app.hand.splice(cardIdx, 1);
  if (isStage5() && app.stage5) app.stage5.discardPile.push(card);
  app.cardsPlayedThisRound += 1;
  app.actionsThisRound = (app.actionsThisRound ?? 0) + 1;

  if (isStage5()) {
    const s5 = app.stage5;
    // 處理輪胎消耗（含「保胎策略」的免疫第 1 次扣胎）
    if (card.tireCost) {
      const hasTirePreserve = s5.teamCardsActive.some(c => c.effect === "tirePreserve");
      if (hasTirePreserve && !s5.tirePreserveUsedThisRound) {
        s5.tirePreserveUsedThisRound = true;
        // 免疫這次扣胎（不呼叫 spendTire）
        pushSpeedPop("player", "🩹 保胎抵消", "#6fe0d0");
      } else {
        spendTire(card.tireCost);
        pushSpeedPop("player", `-${card.tireCost} 胎`, "#ff5fa0");
      }
    }
    if (card.penaltyNextHand) {
      s5.penaltyNextHand = (s5.penaltyNextHand || 0) + card.penaltyNextHand;
    }
    if (card.drawNextHand) {
      // 反 allIn：下回合多抽 1 張
      s5.penaltyNextHand = (s5.penaltyNextHand || 0) + card.drawNextHand;
    }
    // ─ 算「實際打牌速度」= base + 車隊牌加成 ─
    let cardSpd = card.speedValue || 0;
    // 卡牌主效果（先 push、後面車隊牌加成依次 push）
    if (cardSpd) {
      pushSpeedDeltaPop("player", cardSpd, card.name || "加速");
    }
    // fuelMaster：本回合內所有指令牌 +5
    const hasFuelMaster = s5.teamCardsActive.some(c => c.effect === "cardBonusThisRound");
    if (hasFuelMaster) {
      cardSpd += 5;
      pushSpeedDeltaPop("player", 5, "燃料策士");
    }
    // rhythmCoach：連續同名指令牌 +10 / +20
    const hasRhythmCoach = s5.teamCardsActive.some(c => c.effect === "comboBonusThisRound");
    if (hasRhythmCoach) {
      // 計算「本回合連續同名打的張數」（含當前這張）
      const lastSameNameStreak = (s5.lastCardType === card.type)
        ? (s5.lastCardSameStreak || 1) + 1
        : 1;
      s5.lastCardType = card.type;
      s5.lastCardSameStreak = lastSameNameStreak;
      if (lastSameNameStreak === 2) {
        cardSpd += 10;
        pushSpeedDeltaPop("player", 10, "連擊");
      } else if (lastSameNameStreak >= 3) {
        cardSpd += 20;
        pushSpeedDeltaPop("player", 20, "連擊×3");
      }
    } else {
      // 沒裝 rhythmCoach 也要記錄、玩家可能後續再裝
      s5.lastCardType = card.type;
      s5.lastCardSameStreak = (s5.lastCardType === card.type) ? (s5.lastCardSameStreak || 1) + 1 : 1;
    }
    // tirePreserve：所有指令牌 -10 速度
    const hasTirePreserveActive = s5.teamCardsActive.some(c => c.effect === "tirePreserve");
    if (hasTirePreserveActive) {
      cardSpd -= 10;
      pushSpeedDeltaPop("player", -10, "保胎");
    }
    // smoothOperator（賽車節奏）：若前一動作也是指令牌（不論種類） → 額外 +20（總共 +40）
    if (card.smoothOperator && s5.lastActionWasCard) {
      cardSpd += 20;
      pushSpeedDeltaPop("player", 20, "賽車節奏");
    }
    // chill（冷靜應對）：本動 QTE 容錯 +qteForgive（用 flag 傳到 QTE 結算處）
    if (card.qteForgive) {
      s5.chillForgiveActive = card.qteForgive;
    }
    // 步驟 1：卡牌效果立即生效（加修正後 cardSpd）
    applyPlayerActionDelta(cardSpd);
    // 標記「上一動作是指令牌」給下次 smoothOperator 用
    s5.lastActionWasCard = true;
    // 記錄玩家動作後是否跟對手同道（用於步驟 3 嘲諷檢測）
    const wasSameLane = (app.playerLane === app.opponentLane);
    // 標記待結算動作 → 對手過場結束後執行步驟 3+4
    app.pendingAction = { kind: "card", card, wasSameLane };
  } else {
    app.playerSpeed += card.speedValue;
  }

  // v0.9 canChangeLane（換道節奏 laneRhythm）：
  //   - 拖本道  → 加 speedValue、扣胎、然後進選道 modal 讓玩家選要換去哪
  //   - 拖別道  → 在前面已被當成標準棄牌換道處理過、根本進不到這裡
  if (card.canChangeLane && app.laneCount > 1) {
    checkAutoPrompt();
    if (app.mode === "playing") {
      app.cornerPickFromLane = app.playerLane;  // 紀錄選道前位置（取消用）
      app.mode = "stage5-corner-pick-lane";
    }
    // 對手回合在玩家選完道後才觸發（見選道完成處）
    return;
  }

  // 閘門 A：等步驟 1 的玩家飛字（卡牌主效果、車隊牌加成等）播完，再開啟對手回合
  deferUntilSpeedPopsClear(() => {
    triggerOpponentActions();
    checkAutoPrompt();
  });
}

// 動作後半：對手過場結束後執行
// Patch A：保留現有「一次性結算」邏輯，僅搬位置
//   順序：
//     1. 玩家換道扣速 / 卡牌加速 + 尾流檢查（這時對手已動完）
//     2. 賽道結算（玩家+對手）由 advanceCircuitOnCard 處理
// 對手過場結束後執行：步驟 3 + 步驟 4
// 步驟 1（玩家動作效果）已在 playCardToLane 立即執行了
function finishPlayerAction() {
  if (!app.pendingAction) return;
  if (!isStage5()) {
    app.pendingAction = null;
    return;
  }
  const pa = app.pendingAction;
  // 步驟 3：檢查尾流（這時對手已動完）
  const slipDelta = consumeSlipstreamDelta();
  if (slipDelta) {
    applyPlayerActionDelta(slipDelta);
    pushSpeedPop("player", `+${slipDelta} 尾流`, "#ff9b54");
  } else if (pa.wasSameLane && app.playerLane !== app.opponentLane) {
    // 玩家步驟 1 結束時同道、但對手切走 → 嘲諷
    showOpponentTaunt();
  }
  // 閘門：等步驟 3 尾流飛字播完，才執行步驟 4（賽道結算 → push 賽道飛字 + 可能觸發 QTE）
  // 設計意圖：卡牌加成跟尾流的飛字先看完、再開始看賽道的結算
  //   - 避免飛字疊在一起、看不清楚
  //   - 也避免「油污！」這種觸發 QTE 的飛字跟尾流同時冒、QTE 確認按鈕被擋
  app.pendingAction = null;
  deferUntilSpeedPopsClear(() => {
    // 步驟 4：賽道結算 + 限速 + 切段
    advanceCircuitOnCard();
  });
}

// 對手嘲諷文字（玩家想吃尾流、對手躲開時觸發）
function showOpponentTaunt() {
  const opp = currentOpponent();
  const oppId = opp?.id ?? "";
  // 各對手不同風格的嘲諷文字
  const tauntsByOpponent = {
    A: [  // 禿鷹：得意奸詐
      "禿鷹：「呵呵呵～」",
      "禿鷹得意地躲開",
      "禿鷹：「自己玩去吧」",
    ],
    B: [  // 清道夫:陰沈嘲諷
      "清道夫：「天真」",
      "清道夫冷笑著切到另一道",
      "清道夫：「想跟我屁股後面？」",
    ],
    C: [  // 破風者：戰術解說、冷靜技術派
      "破風者讀出你的尾流意圖",
      "破風者主動讓道",
      "破風者：「你的路線太明顯了」",
    ],
  };
  const taunts = tauntsByOpponent[oppId] || ["對手躲開了你的尾流"];
  const label = taunts[Math.floor(Math.random() * taunts.length)];
  app.opponentActionFx = {
    label,
    until: performance.now() + 2400,
    taunt: true,  // 用於 UI 顯示不同樣式
  };
}

function triggerOpponentActions() {
  // 守門：如果 mode 已經被切到結束/結算狀態（如 stage5-tire-out、result），
  // 不應該再進對手回合過場（避免遮蓋輸/勝畫面）
  if (app.mode !== "playing" && app.mode !== "stage5-corner-pick-lane") {
    return;
  }
  // B 強招「豁免」只到下次玩家動作觸發對手回合為止 → 進入時重置
  app.opponentAuraBypassed = false;
  // ─── 冷卻系統 ──────────────────────────────────────────────────
  if (app.opponentBehaviors && app.opponentBehaviorLastTriggered) {
    const actN = app.actionsThisRound ?? 0;
    // 找出所有「冷卻已滿」的 behavior
    const ready = [];
    for (const b of app.opponentBehaviors) {
      const lastAt = app.opponentBehaviorLastTriggered[b.id] ?? -Infinity;
      if (actN - lastAt >= b.cooldown) {
        ready.push(b);
      }
    }
    if (ready.length > 0) {
      // 挑 weight 最強的一個（strong > medium > weak）
      const weightRank = { strong: 3, medium: 2, weak: 1 };
      ready.sort((a, b) => (weightRank[b.weight] || 0) - (weightRank[a.weight] || 0));
      const picked = ready[0];
      app.opponentBehaviorLastTriggered[picked.id] = actN;
      // 不立即執行，改進入「對手回合」過場
      beginOpponentTurn(picked);
      return;
    }
    // 沒有可出的招 → 仍進對手回合過場，顯示「對手保持原道 + 加成結果」
    // 這讓玩家看到「對手在順風道吃 +10」這類狀態，不會「啞掉一回合」
    beginOpponentTurnIdle();
    return;
  }
  // 支援兩種觸發鍵：
  //   onCardN  — 玩家打到自己道的牌數（舊；不計換道）
  //   onActionN — 玩家總動作數（換道 + 打牌都算）
  const cardN = app.cardsPlayedThisRound;
  const actN  = app.actionsThisRound ?? 0;
  const remaining = [];
  for (const act of app.opponentActionsThisStage) {
    const triggered = (act.onCardN != null && act.onCardN <= cardN)
                   || (act.onActionN != null && act.onActionN <= actN);
    if (triggered) {
      executeOpponentAction(act);
    } else {
      remaining.push(act);
    }
  }
  app.opponentActionsThisStage = remaining;
}

// ─── 對手回合過場 ─────────────────────────────────────────────────────
// 流程：beginOpponentTurn(act)
//   → 立即執行 act（更新 lane/speed）
//   → 設定 opponentTurnAnim 計時（含動畫起終時間）
//   → 切 app.mode = "opponent-turn" 期間鎖玩家輸入
//   → update() 每幀檢查計時，到時自動切回 "playing"
function beginOpponentTurn(act) {
  if (!act) return;
  // 1. 立即執行行為（lane / speed 狀態馬上更新；視覺由 lerp 平滑追上）
  executeOpponentAction(act);
  // 2. 排程過場結束（lerp 已開始追趕、訊息 opponentActionFx 已設好）
  const now = performance.now();
  const turnDurMs = 1000;  // 約 1 秒
  app.opponentTurnAnim = {
    startTime: now,
    endTime: now + turnDurMs,
    behavior: act,
  };
  // 3. 鎖玩家操作（從 "playing" 切到 "opponent-turn"）
  app.mode = "opponent-turn";
}

// 對手回合「沒招」版本：cooldown 都還沒滿、但仍要走過場並提示狀態
// 顯示對手當前道的速度（讓玩家看到「對手吃加成 / 被限速」）
function beginOpponentTurnIdle() {
  const opp = currentOpponent();
  const oppLaneName = laneDisplayName(app.opponentLane);
  // display 顯示「本動結算後」速度（從當前 speed 預算）
  const display = applyOpponentBonus(app.opponentSpeed, app.opponentLane, app.opponentAuraBypassed);
  const cur = app.opponentSpeed;
  // 訊息因「有加成 vs 被限速 vs 無變化」而不同
  let label;
  const b = getLaneBonusFor(app.opponentLane, "opponent");
  const add = b?.add ?? 0;
  const speedLimit = b?.speedLimit ?? null;
  const seg = currentCircuit();
  const isBend = seg?.type === "bend";
  if (b?._auraSuppressed) {
    label = `對手駐守${oppLaneName}（光環抵消）→ 速度 ${display}`;
  } else if (isBend && speedLimit != null && cur > speedLimit) {
    label = `對手駐守${oppLaneName}（彎道速限 ${speedLimit}）→ 速度 ${display}`;
  } else if (isBend) {
    label = `對手駐守${oppLaneName}（彎道）→ 速度 ${display}`;
  } else if (add !== 0) {
    const sign = add > 0 ? "+" : "";
    label = `對手駐守${oppLaneName} ${sign}${add} → 速度 ${display}`;
  } else {
    label = `對手駐守${oppLaneName} → 速度 ${display}`;
  }
  app.opponentActionFx = {
    label,
    until: performance.now() + 4000,
  };
  const now = performance.now();
  app.opponentTurnAnim = {
    startTime: now,
    endTime: now + 500,  // 沒招過場縮短一半（一般 1000ms，沒招 500ms）
    behavior: null,        // 表示「沒招」— 視覺也應該柔和
  };
  app.mode = "opponent-turn";
}

// 每幀更新對手回合過場狀態（從 update() 呼叫）
function tickOpponentTurn(time) {
  if (app.mode !== "opponent-turn") return;
  if (!app.opponentTurnAnim) {
    // 異常情況：mode 是 opponent-turn 但沒 anim → 直接退出
    app.mode = "playing";
    return;
  }
  if (time >= app.opponentTurnAnim.endTime) {
    // 過場結束 → 切回 playing、但用閘門等對手飛字（步驟 2 boost / abs 等）播完
    // 再執行玩家動作後半（步驟 3 尾流 + 步驟 4 賽道結算，會 push 更多飛字）
    app.opponentTurnAnim = null;
    app.mode = "playing";
    // 閘門 B：等對手步驟 2 的飛字播完
    deferUntilSpeedPopsClear(() => {
      finishPlayerAction();
      // 閘門 C：等步驟 3、4 的飛字（尾流 / 賽道結算）也播完，才檢查自動 prompt
      deferUntilSpeedPopsClear(() => {
        checkAutoPrompt();
      });
    });
  }
}

function executeOpponentAction(act) {
  if (act.action === "moveTo") {
    const prevLane = app.opponentLane;
    // bypassAura：B 強招用（這一動 B 豁免自己光環）
    const bypass = act.bypassAura === true;
    app.opponentAuraBypassed = bypass;
    // absBonus：B 強招用（取 abs 當加成、永遠拿正加成）
    if (act.absBonus) {
      app.opponentAbsBonusActive = true;
    }
    if (act.target === "playerLane") {
      let targetLane = (isStage5() && app.playerLaneBeforeAction != null)
        ? app.playerLaneBeforeAction
        : app.playerLane;
      // c7 避坑：若目標道是坑、找最近的安全道（對手「能動就會避」）
      //   例外：清道夫（B）光環免疫坑洞、不需要避、直接撞過去
      const potholes = app.stage5?.potholeLanes || [];
      const oppImmuneToHazards = isOpponentAuraActive();
      if (!oppImmuneToHazards && potholes.includes(targetLane)) {
        const safeLanes = [];
        for (let i = 0; i < app.laneCount; i++) {
          if (!potholes.includes(i)) safeLanes.push(i);
        }
        if (safeLanes.length > 0) {
          // 選離原 target 最近的安全道
          safeLanes.sort((a, b) => Math.abs(a - targetLane) - Math.abs(b - targetLane) || a - b);
          targetLane = safeLanes[0];
        }
      }
      app.opponentLane = Math.max(0, Math.min(app.laneCount - 1, targetLane));
    } else if (typeof act.target === "number") {
      // 數字 target：若是坑、退回原道（不換）；對手 action 設計者應該避免設坑道為目標
      const potholes = app.stage5?.potholeLanes || [];
      if (potholes.includes(act.target)) {
        // 保持原道（不執行這次 moveTo）
      } else {
        app.opponentLane = act.target;
      }
    }
    // boostAfter：moveTo 之後附帶加速
    if (act.boostAfter) {
      app.opponentSpeed += act.boostAfter;
      pushSpeedDeltaPop("opponent", act.boostAfter, "加速");
      // 阻擋 / 遠離標籤
      let intentTag = "";
      if (isStage5() && app.playerLaneBeforeAction != null) {
        if (app.opponentLane === app.playerLaneBeforeAction) {
          intentTag = "（⛔阻擋你）";
        } else {
          intentTag = "（💨閃開你）";
        }
      }
      if (app.opponentLane !== prevLane) {
        app.opponentActionFx = {
          label: `對手切到${laneDisplayName(app.opponentLane)}${intentTag}，並加速！速度 ${app.opponentSpeed}`,
          until: performance.now() + 4800,
        };
      } else {
        // 已在玩家道上 → 只加速
        app.opponentActionFx = {
          label: `對手加速！速度 ${app.opponentSpeed}`,
          until: performance.now() + 4400,
        };
      }
      // 設定頻閃旗標
      app.opponentBoostFlash = {
        startTime: performance.now(),
        until: performance.now() + 900,
      };
    } else {
      announceOpponentMove(prevLane, app.opponentLane);
    }
  } else if (act.action === "moveSmart") {
    // 後手最佳化：依策略選最佳目標道
    const prevLane = app.opponentLane;
    const bypass = act.bypassAura === true;
    // 強招（B 豁免）：先設旗標，AI 評估與顯示都會用「豁免後的速度」
    app.opponentAuraBypassed = bypass;
    const target = pickSmartLaneForOpponent(act.strategy, bypass);
    if (target !== null && target !== prevLane) {
      app.opponentLane = target;
    }
    // boostAfter：moveSmart 之後附帶加速（A 強招用）
    if (act.boostAfter) {
      app.opponentSpeed += act.boostAfter;
      pushSpeedDeltaPop("opponent", act.boostAfter, "加速");
      // 阻擋 / 遠離標籤
      let intentTag = "";
      if (isStage5() && app.playerLaneBeforeAction != null) {
        if (app.opponentLane === app.playerLaneBeforeAction) {
          intentTag = "（⛔阻擋你）";
        } else {
          intentTag = "（💨閃開你）";
        }
      }
      const auraTag = bypass ? "（豁免光環）" : "";
      if (app.opponentLane !== prevLane) {
        app.opponentActionFx = {
          label: `對手切到${laneDisplayName(app.opponentLane)}${intentTag}${auraTag}，並加速！速度 ${app.opponentSpeed}`,
          until: performance.now() + 4800,
        };
      } else {
        app.opponentActionFx = {
          label: `對手加速！速度 ${app.opponentSpeed}`,
          until: performance.now() + 4400,
        };
      }
      app.opponentBoostFlash = {
        startTime: performance.now(),
        until: performance.now() + 900,
      };
    } else if (target !== null && target !== prevLane) {
      announceOpponentMove(prevLane, app.opponentLane);
    } else {
      // 目前已是最佳道 → 不動，但仍給玩家「對手評估」的訊息
      const newDisplay = applyOpponentBonus(app.opponentSpeed, app.opponentLane, bypass);
      const auraTag = bypass ? "（豁免光環）" : "";
      // 阻擋 / 遠離標籤
      let intentTag = "";
      if (isStage5() && app.playerLaneBeforeAction != null) {
        if (app.opponentLane === app.playerLaneBeforeAction) {
          intentTag = "（⛔阻擋你）";
        } else {
          intentTag = "（💨閃開你）";
        }
      }
      app.opponentActionFx = {
        label: `對手保持原道${intentTag}${auraTag} → 速度 ${newDisplay}`,
        until: performance.now() + 4000,
      };
    }
    // cooldown 仍重新起算
  } else if (act.action === "moveAdjacent") {
    // 隨機切到相鄰道（c7 避坑：排除坑洞道）
    const prevLane = app.opponentLane;
    const potholes = app.stage5?.potholeLanes || [];
    const candidates = [];
    if (prevLane > 0 && !potholes.includes(prevLane - 1)) candidates.push(prevLane - 1);
    if (prevLane < app.laneCount - 1 && !potholes.includes(prevLane + 1)) candidates.push(prevLane + 1);
    if (candidates.length > 0) {
      app.opponentLane = candidates[Math.floor(Math.random() * candidates.length)];
      announceOpponentMove(prevLane, app.opponentLane);
    }
    // 若沒有安全的鄰道：保持原道（如果原道也是坑、那就吃坑）
  } else if (act.action === "boost") {
    // 對手反擊：speedBoost — 直接加 opponentSpeed
    const amt = act.amount ?? 1;
    app.opponentSpeed += amt;
    pushSpeedDeltaPop("opponent", amt, "加速");
    app.opponentActionFx = {
      label: `對手加速！速度 ${app.opponentSpeed}`,
      until: performance.now() + 4000,
    };
    // 設定頻閃旗標（畫對手車時讀取）
    app.opponentBoostFlash = {
      startTime: performance.now(),
      until: performance.now() + 900,
    };
  }
}

// ─── 對手 AI：後手最佳化 ───────────────────────────────────────────
// strategy:
//   "bestForSelf" — 挑顯示速度最高的道（自己跑最快）
//   "avoidPlayer" — 挑顯示速度最高、且不是「玩家動作前所在道」的道（破壞尾流）
//   "dynamicAvoidOrBlock" — 玩家沒吃尾流 → 等同 avoidPlayer；吃了尾流 → 切到玩家道（block）
// bypassAura: 評估時對手是否豁免自己光環（用於 B 強招）
// 注意：AI 用 playerLaneBeforeAction 而不是 playerLane → 玩家換道後對手追原道
function pickSmartLaneForOpponent(strategy, bypassAura = false) {
  const N = app.laneCount;
  if (N <= 1) return 0;
  // 對手目標基準：玩家動作前所在道（fallback 用當前 playerLane）
  const playerRef = (isStage5() && app.playerLaneBeforeAction != null)
    ? app.playerLaneBeforeAction
    : app.playerLane;
  // dynamic 策略：依玩家是否吃過尾流轉換
  let effectiveStrategy = strategy;
  if (strategy === "dynamicAvoidOrBlock") {
    const slipstreamConsumed = app.stage5?.slipstreamUsed === true;
    if (slipstreamConsumed) {
      // 玩家已吃尾流 → 直接切到玩家動作前道（block）
      // 但 c7 坑洞：若玩家道是坑、改用 avoidPlayer 策略避坑
      const potholes = app.stage5?.potholeLanes || [];
      if (potholes.includes(playerRef)) {
        effectiveStrategy = "avoidPlayer";
      } else {
        return playerRef;
      }
    } else {
      // 玩家還沒吃尾流 → 等同 avoidPlayer
      effectiveStrategy = "avoidPlayer";
    }
  }
  // 計算每條道對手的顯示速度
  const s5 = app.stage5;
  const potholes = (s5 && s5.potholeLanes) ? s5.potholeLanes : [];
  // 油污 forceCornerQte 道（c6）：對手 50% 滑開、視為災害一併排除
  const hazardLanes = new Set(potholes);
  if (app.laneBonuses) {
    for (const b of app.laneBonuses) {
      if (b.forceCornerQte) hazardLanes.add(b.lane);
    }
  }
  const scores = [];
  for (let i = 0; i < N; i++) {
    const isPlayerLane = (i === playerRef);
    // 災害道：直接排除（對手 AI 不會踩坑、不會自找油污）
    if (hazardLanes.has(i)) continue;
    // avoidPlayer 策略：玩家基準道直接排除
    if (effectiveStrategy === "avoidPlayer" && isPlayerLane) continue;
    scores.push({ lane: i, speed: calcOpponentSpeedAtLane(i, bypassAura) });
  }
  if (scores.length === 0) {
    // avoidPlayer 但所有道都是玩家道（不該發生）→ 退回 bestForSelf
    for (let i = 0; i < N; i++) {
      if (hazardLanes.has(i)) continue;  // 仍排除災害
      scores.push({ lane: i, speed: calcOpponentSpeedAtLane(i, bypassAura) });
    }
  }
  // bestForSelf（破風者）：在可選的非災害道之間隨機（v0.9 改動：不再挑最快、加上隨機性）
  if (effectiveStrategy === "bestForSelf") {
    return scores[Math.floor(Math.random() * scores.length)].lane;
  }
  // avoidPlayer：仍挑最快道（同分時優先選跟當前道近的）
  scores.sort((a, b) => {
    if (b.speed !== a.speed) return b.speed - a.speed;
    return Math.abs(a.lane - app.opponentLane) - Math.abs(b.lane - app.opponentLane);
  });
  return scores[0].lane;
}

// 對手切道時的公告（玩家看得到「切到 X 道、阻擋/遠離、顯示速度變 Y」）
function announceOpponentMove(prevLane, newLane) {
  if (prevLane === newLane) return;
  // 預算結算後速度（過場結束才會真的寫入 opponentSpeed）
  const newDisplay = applyOpponentBonus(app.opponentSpeed, newLane, app.opponentAuraBypassed);
  const auraTag = app.opponentAuraBypassed ? "（豁免光環）" : "";
  // 阻擋 / 遠離標籤（基準：玩家動作前所在道）
  let intentTag = "";
  if (isStage5() && app.playerLaneBeforeAction != null) {
    if (newLane === app.playerLaneBeforeAction) {
      intentTag = "（⛔阻擋你）";
    } else {
      intentTag = "（💨閃開你）";
    }
  }
  app.opponentActionFx = {
    label: `對手切到${laneDisplayName(newLane)}${intentTag}${auraTag} → 速度 ${newDisplay}`,
    until: performance.now() + 4000,
  };
}

function checkAutoPrompt() {
  if (app.mode !== "playing") return;
  if (app.stageIndex === 1) return;
  if (app.stageIndex === 2) return;
  if (app.stageIndex === 3) return;
  if (app.hand.length === 0) {
    app.mode = "prompt-overtake-or-pass";
    app.promptShownAt = performance.now();  // 記錄顯示時間，3秒後自動淡出
  }
}

function doOvertake() {
  if (isStage5()) {
    if (app.stage5) app.stage5.lastMistakeCount = 0;
    doOvertakeQTE();
    return;
  }
  app.rank = Math.max(1, app.rank - 1);
  clearLaneAfterOvertake();
  app.qteScore = null; app.qteScoreMax = null; app.qteScorePass = null;
  if (app.stage5) app.stage5.lastMistakeCount = 0;
  app.mode = "result";
  app.message = "超車成功！";
}

function doOvertakeQTE() {
  app.mode = "splash-overtake";
  app.message = "極限超車 QTE";
  app.qteStart = performance.now();
  carMotion = createCarMotion();  // 每次 QTE 都重生擺動參數、不可預測
  // 等玩家按「開始 QTE」確認鍵才進 rhythm-formal（按鈕在 drawSplash 顯示）
}

function doPass() {
  // 第五關走自己的流程
  if (isStage5()) {
    // 注意：必須在 clearLaneAfterOvertake 之前判斷後車條件
    stage5OnPass();
    return;
  }
  // Pass = 不超車、結束回合
  // 若速度低於後車就被追上 → 進防守 QTE
  // 注意：必須在 clearLaneAfterOvertake 之前判斷，否則速度已歸零
  const needDefense = shouldDefend();
  clearLaneAfterOvertake();
  if (needDefense) {
    startDefense();
  } else {
    app.message = "未超車";
    app.mode = "result";
  }
}

function pressOvertake() {
  // shouldForceQTE 已不存在（同道強制 QTE 已廢棄）
  if (canDirectOvertake()) {
    doOvertake();
  }
  // 否則按鈕應該已 disabled、不做任何事
}

function pressPass() {
  doPass();
}

function clearLaneAfterOvertake() {
  app.playerSpeed = 0;
  app.cardsPlayedThisRound = 0;
  app.actionsThisRound = 0;
}

// ─── 第五關流程 ────────────────────────────────────────────────────────────
// 判斷現在是否在第五關
function isStage5() {
  return STAGES[app.stageIndex] && STAGES[app.stageIndex].isStage5;
}
// 觸發三選一
function stage5BeginRewardPick() {
  const s5 = app.stage5;
  if (!s5) return;
  // 牌池：1 指令 + 1 車隊 + 1 隨機（三張之間互不重複）
  const cmdKeys = Object.keys(STAGE5_COMMAND_CARDS);
  const teamKeys = Object.keys(STAGE5_TEAM_CARDS);
  const cmdPick = cmdKeys[Math.floor(Math.random() * cmdKeys.length)];
  // teamPick：跟 cmdPick 不會重複（不同池）、所以直接抽
  const teamPick = teamKeys[Math.floor(Math.random() * teamKeys.length)];
  // randomPick：從所有牌中排除已選的兩張、再隨機抽
  const allKeys = [...cmdKeys, ...teamKeys];
  const remaining = allKeys.filter(k => k !== cmdPick && k !== teamPick);
  const randomPick = remaining[Math.floor(Math.random() * remaining.length)];
  const picks = [cmdPick, teamPick, randomPick];
  s5.rewardOptions = picks.map(t => makeStage5Card(t));
  s5.rewardSlotHover = -1;
  app.mode = "stage5-reward";
}
// 玩家選了一張獎勵
function stage5OnRewardPicked(slot) {
  const s5 = app.stage5;
  if (!s5 || !s5.rewardOptions || !s5.rewardOptions[slot]) return;
  const picked = s5.rewardOptions[slot];
  // v0.9 新分類（用 trigger 而非 persistence 判斷）：
  //   - trigger === "equip" → 進 teamCardsActive、不入牌庫、立即生效
  //   - trigger === "play"（或指令牌）→ 進牌庫、需要打出才生效
  const isEquipTeam = picked.cardClass === "team" && picked.trigger === "equip";
  if (isEquipTeam) {
    s5.teamCardsActive.push(picked);
    // 裝備時的代價（如：暖胎電熱絲啟動 -1 胎）
    if (picked.costOnEquip) {
      if (picked.costOnEquip.tire) {
        spendTire(picked.costOnEquip.tire);
      }
    }
  } else {
    // v0.9：獎勵牌直接放牌庫頂（drawPile 頂端 = unshift）、下次抽牌一定先抽到它
    // 同時加進 deckPermanent 紀錄、之後重洗時也會回到牌庫
    s5.deckPermanent.push(picked);
    s5.drawPile.unshift(picked);
  }
  s5.rewardOptions = [];
  s5.rewardSlotHover = -1;
  stage5StartNewRound();
}
// 玩家略過獎勵
function stage5OnRewardSkip() {
  const s5 = app.stage5;
  if (!s5) return;
  s5.rewardOptions = [];
  s5.rewardSlotHover = -1;
  stage5StartNewRound();
}
// 套用車隊牌持續效果到本回合 app 狀態
function applyTeamCardEffects() {
  const s5 = app.stage5;
  if (!s5) return;
}
// 開始一個新回合（換對手、發牌、清狀態）
function stage5StartNewRound() {
  const s5 = app.stage5;
  if (!s5) return;
  // 清掉上回合可能殘留的超車動畫（避免新回合對手車卡在畫面外）
  app.overtakePassAnim = null;
  if (s5.ahead.length === 0) {
    stage5OnGameWin();
    return;
  }
  // 回合計數：本次「即將開始」的是第幾個新回合
  s5.roundsPlayed = (s5.roundsPlayed || 0) + 1;
  // 已跑完上限回合 → 越過終點線、依當前名次結束
  if (s5.roundsPlayed > (s5.maxRounds || 20)) {
    stage5OnFinishLineReached();
    return;
  }
  // 每一輪都切下一段賽道（Pass / 超車 / 防守失敗，都會走到這裡）
  advanceCircuit();
  // 進新賽段時隨機放玩家到任一道（QTE / Pass 結束後不延續上段位置）
  // 注意：要在 applyOpponentToApp() 之前做，因為對手位置會依玩家位置決定
  if (app.laneCount > 0) {
    app.playerLane = Math.floor(Math.random() * app.laneCount);
    app.playerLaneVisual = app.playerLane;
  }
  // 一般回合
  // 1. 抽當前對手
  s5.currentOpponentId = pickNextOpponent();
  if (!s5.currentOpponentId) {
    stage5OnGameWin();
    return;
  }
  applyOpponentToApp(s5.currentOpponentId);
  // 2. 套用車隊牌持續效果
  applyTeamCardEffects();
  // 3. 後車邏輯：最後一名（共 4 名 → rank 4）無後車；否則從 passed 抽
  if (app.rank === app.rankTotal) {
    s5.chaserId = null;
  } else {
    // 但若 chaserId 已被指定（剛超過你的人）就保留
    if (!s5.chaserId) {
      // v0.9：後車可以隨機抽（玩家後方的名次順序不重要、混亂感反而合理）
      const behindCandidates = s5.passed.slice();
      if (behindCandidates.length > 0) {
        s5.chaserId = behindCandidates[Math.floor(Math.random() * behindCandidates.length)];
      }
    }
  }
  applyChaserToApp(s5.chaserId);
  // 4. 清回合狀態（套用車隊牌「維持胎溫」keepSpeed 效果）
  let keepSpeedBonus = 0;
  for (const c of s5.teamCardsActive) {
    if (c.effect === "keepSpeed") keepSpeedBonus += (c.value || 0);
  }
  // 速度從 10 起，keepSpeed 保留；加成在第一個行動時才結算
  app.playerSpeed = 10 + keepSpeedBonus;
  app.cardsPlayedThisRound = 0;
  app.actionsThisRound = 0;
  s5.slipstreamUsed = false;
  // v0.9：清掉 thisRound 車隊牌、reset 每回合一次性狀態
  s5.teamCardsActive = s5.teamCardsActive.filter(c => c.persistence !== "thisRound");
  s5.tirePreserveUsedThisRound = false;
  s5.lastCardType = null;
  s5.lastCardSameStreak = 0;
  s5.lastActionWasCard = false;
  // 5. 發手牌
  dealStage5Hand();
  // 6. circuitJustChanged 在這回合 reset
  s5.circuitJustChanged = false;
  // 7. 進 playing
  app.mode = "playing";
  // 8. 回合開始就和對手同道 → 立刻給尾流
  checkSlipstream();
}
// 玩家超車成功
function stage5OnOvertakeSuccess() {
  const s5 = app.stage5;
  if (!s5) return;
  const oppId = s5.currentOpponentId;

  if (oppId) {
    // 扣對手專注度
    const curFocus = s5.opponentFocusMap[oppId] ?? 0;
    if (curFocus > 0) {
      // 專注度還有 → 扣 1，尚未超過
      s5.opponentFocusMap[oppId] = curFocus - 1;
      app.message = `打破防守！（專注度剩 ${curFocus - 1}）`;
      app.mode = "stage5-overtake-result";
      // 不移動排名、不移除對手，下回合繼續面對同一對手
      return;
    }
    // 專注度 = 0 → 真正超過
    s5.ahead = s5.ahead.filter(id => id !== oppId);
    s5.passed.push(oppId);
    app.rank = Math.max(1, app.rank - 1);
    // v0.9：觸發「對手被超」動畫——從 QTE 結束的「當下位置」滑出畫面
    //   起始位置 = QTE 期間最後一幀對手車真實渲染位置（cache 在 drawLanes 每 frame 更新）
    //   這樣不會跳到某個 base 位置才開始動畫
    app.overtakePassAnim = {
      startTime: performance.now(),
      duration: 1400,
      oppId: oppId,
      startX: app._lastOpponentRenderX ?? null,
      startY: app._lastOpponentRenderY ?? null,
      startW: app._lastOpponentRenderW ?? 82,
    };
  }
  s5.currentOpponentId = null;
  app.opponentSpeed = 0;
  app.message = "超車成功！";
  app.mode = "stage5-overtake-result";
}
// 玩家超車失敗（QTE 失敗）
function stage5OnOvertakeFail() {
  const s5 = app.stage5;
  if (!s5) return;
  // v0.9：玩家沒掉名次、面對的對手不變（ahead 最後一個保留）
  //   但其他前方對手 + 所有後方對手的名次可以重新洗
  shuffleStage5Ranks();
  app.message = "超車失敗";
  app.mode = "stage5-overtake-result";  // 統一用 overtake-result 顯示分數
}
// 玩家 Pass — 非最後一名才進防守 QTE；最後一名直接進下一回合
function stage5OnPass() {
  stage5DoPassActual();
}
function stage5DoPassActual() {
  const s5 = app.stage5;
  if (!s5) return;
  // 清除上次 QTE 分數，避免防守結算畫面顯示舊資料
  app.qteScore = null; app.qteScoreMax = null; app.qteScorePass = null;
  if (s5) s5.lastMistakeCount = 0;
  // v0.9：玩家沒掉名次、面對的對手不變、但其他名次可以重新洗
  shuffleStage5Ranks();
  // 最後一名：無後車、不防守、直接下一回合
  if (app.rank === app.rankTotal) {
    app.message = "未超車";
    app.mode = "stage5-no-overtake";
    return;
  }
  app.message = "防守！";
  app._stage5DefenseInProgress = true;
  beginDefenseSequence();
}
// 排名洗牌：前方對手洗（玩家「前一名」固定不動）+ 後方對手洗
function shuffleStage5Ranks() {
  const s5 = app.stage5;
  if (!s5) return;
  // 前方：最後一個（玩家前一名）固定不動、其他洗牌
  //   ahead 結構：[..., 玩家前一名]
  if (s5.ahead.length >= 2) {
    const fixedFront = s5.ahead[s5.ahead.length - 1];
    const shufflePool = s5.ahead.slice(0, s5.ahead.length - 1);
    // 洗中間（遠方的名次可以亂跳）
    for (let i = shufflePool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shufflePool[i], shufflePool[j]] = [shufflePool[j], shufflePool[i]];
    }
    s5.ahead = [...shufflePool, fixedFront];
  }
  // 後方對手洗牌（後方名次混亂可接受）
  for (let i = s5.passed.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [s5.passed[i], s5.passed[j]] = [s5.passed[j], s5.passed[i]];
  }
  // chaserId 也重抽（從新後方陣容隨機）
  // 但若已被 pinnedNextOpponentId 鎖定就不動（這保留「剛超過你必追」的規則）
  if (!s5.pinnedNextOpponentId && s5.passed.length > 0) {
    s5.chaserId = s5.passed[Math.floor(Math.random() * s5.passed.length)];
  }
}
// 防守結束（第五關專用，接 updateDefense 之後）
function stage5OnDefenseEnd(success) {
  const s5 = app.stage5;
  if (!s5) return;
  app._stage5DefenseInProgress = false;
  if (success) {
    // 守住，進新回合
    app.message = "防守成功！";
    app.mode = "stage5-defense-result";
    return;
  }
  // 防守失敗
  // 檢查「後援車隊」一次性救命
  const backupIdx = s5.teamCardsActive.findIndex(c => c.effect === "saveOnDefeat");
  if (backupIdx >= 0) {
    s5.teamCardsActive.splice(backupIdx, 1);
    app.message = "後援車隊保住名次！";
    app.mode = "stage5-defense-result";
    return;
  }
  // 真的掉名次（不會超過 rankTotal-1，因為最後一名不會進防守）
  // v0.9 規則：chaser（顯示）可以隨機、但實際超車的必須是 passed 最後一個（玩家後一名）
  //   passed 最後 = 最近被超過 = 真正排玩家後一名的對手
  //   不用 s5.chaserId（那是顯示用、可能是更後面的對手）
  const realChaserId = s5.passed[s5.passed.length - 1];
  if (realChaserId) {
    if (!s5.ahead.includes(realChaserId)) s5.ahead.push(realChaserId);
    s5.passed = s5.passed.filter(id => id !== realChaserId);
    s5.pinnedNextOpponentId = realChaserId;
    s5.chaserId = null;  // 清空顯示用 chaser、下回合會在 startNewRound 重抽
  }
  app.rank = Math.min(app.rankTotal, app.rank + 1);
  app.message = "防守失敗 — 掉 1 名次";
  app.mode = "stage5-defense-result";
}
// 通關 = 整個遊戲勝利
function stage5OnGameWin() {
  app.mode = "all-clear";
}
// 跑完設定的最大回合數 = 越過終點線、依當前名次結束
function stage5OnFinishLineReached() {
  app.mode = "stage5-finish-line";
}
// 棄掉「名次上升時棄」的車隊牌
function discardOnRankUp() {
  const s5 = app.stage5;
  if (!s5) return;
  s5.teamCardsActive = s5.teamCardsActive.filter(c => c.persistence !== "untilRankUp");
}

// ─── 防守 ──────────────────────────────────────────────────────────────────
function startDefense() {
  beginDefenseSequence();
}

function beginDefenseSequence() {
  app.mode = "splash-defense";
  app.message = "防守！";
  app.qteStart = performance.now();
  carMotion = createCarMotion();  // 每次 QTE 都重生擺動參數、不可預測
  // 防守時間：基準 10 秒，每速度檔位 -10%，最低 3 秒
  const step = speedTierStep(app.playerSpeed);
  app.defenseTotalMs = Math.max(3000, 10000 * Math.pow(0.90, step));
  // 等玩家按「開始 QTE」確認鍵才進 defense（按鈕在 drawSplash 顯示）
}

function updateDefense(time) {
  const diff = defenseDifficulty();
  if (time >= app.nextSafeShift) {
    app.safeTarget = 10 + Math.random() * 80;
    app.nextSafeShift = time + diff.shiftMin + Math.random() * (diff.shiftMax - diff.shiftMin);
  }
  app.safeCenter += (app.safeTarget - app.safeCenter) * diff.lerp;
  const bar = app.zones.defenseBar;
  if (!bar) return;
  const pos = ((app.mouse.x - bar.x) / bar.w) * 100;
  const hw = diff.safeWidth / 2;
  const ph = diff.perfectWidth / 2;
  const sc = app.safeCenter;
  if (pos >= sc - ph && pos <= sc + ph) app.defenseProgress += 0.62;
  else if (pos >= sc - hw && pos <= sc + hw) app.defenseProgress += 0.38;
  else app.defenseProgress = Math.max(0, app.defenseProgress - diff.missPenalty);
  if (time - app.defenseStart >= (app.defenseTotalMs || 10000) || app.defenseProgress >= 100) {
    app.defenseSucceeded = app.defenseProgress >= 100;
    // 第五關走自己的流程
    if (isStage5() && app._stage5DefenseInProgress) {
      stage5OnDefenseEnd(app.defenseSucceeded);
      return;
    }
    if (!app.defenseSucceeded) app.rank = Math.min(app.rankTotal, app.rank + 1);
    app.mode = "defense-result";
  }
}

// ─── QTE 邏輯（沿用 Sam）──────────────────────────────────────────────────
// 速度檔位（每 30 速一檔，基準速度 10）
// 回傳 step = 0,1,2,3,4,5... 表示超出基準幾檔
// 速度檔位：每 30 速度 +1 檔（影響 QTE 難度）
// 玩家當前所在道若有 qteDifficultyOffset（如 c6 油污中央 +1）→ 該道 QTE 檔位 +offset
// （只有踏到該道才生效；其他道走超車 / 防守 QTE 不受影響）
function speedTierStep(speed) {
  const base = Math.max(0, Math.floor((speed - 10) / 30));
  const b = getLaneBonusFor(app.playerLane);
  const offset = (b && typeof b.qteDifficultyOffset === "number") ? b.qteDifficultyOffset : 0;
  return Math.max(0, base + offset);
}

function resetRhythmState() {
  app.qteStart = performance.now();
  // 圓圈數：基準 5，每檔 +10%，無條件捨去，最多 10 個
  const step = speedTierStep(app.playerSpeed);
  const circleCount = Math.min(10, Math.round(5 * Math.pow(1.10, step)));
  app.qteCircleStarts = rhythmStarts(app.qteStart, circleCount);
  app.qteClicked = new Set();
  app.qteResults = {};
  app.qteDismissAt = {};
  app.qteTapPending = {};
  app.qteFinalized = {};
  app.qteResolveAt = 0;
  app.qteScore = null;
  app.qteScoreMax = null;
  app.qteScorePass = null;
  app.qteScatterPos = generateRowScatterPositions();
  // 按鍵分配（QWER，避免連續重複）
  const keys = ['q','w','e','r'];
  const assigned = [];
  for (let i = 0; i < circleCount; i++) {
    let pick;
    do { pick = keys[Math.floor(Math.random() * keys.length)]; }
    while (assigned.length > 0 && pick === assigned[assigned.length - 1]);
    assigned.push(pick);
  }
  app.qteKeys = assigned;
  app.qteCircleCount = circleCount;  // 儲存供繪製和結算用
}

function rhythmStarts(start, circleCount) {
  circleCount = circleCount || 5;
  // 基礎間隔 620ms，依圓圈數生成
  const baseInterval = 620;
  const diff = currentLaneQteDiff();
  let scale = 1;
  if (diff === "easy") scale = 1.25;
  if (diff === "hard") scale = 0.75;
  const jitter = diff === "hard" ? 110 : 0;
  const result = [];
  let last = start;
  for (let i = 0; i < circleCount; i++) {
    const target = start + i * baseInterval * scale;
    const wobble = i === 0 ? 0 : (Math.random() - 0.5) * 2 * jitter;
    const t = Math.max(last + 200, target + wobble);
    result.push(t);
    last = t;
  }
  return result;
}

function isRhythmMode() { return app.mode === "rhythm-formal"; }

function rhythmOutcomeFromTap(tap, startMs, durationMs, judgeT) {
  if (!tap || tap.t > judgeT) return "miss";
  if (tap.wrong) return "miss"; // 按錯鍵
  const beatT = startMs + durationMs;
  const errSec = Math.abs(tap.t - beatT) / 1000;
  const win = rhythmBeatWindowSec();
  if (errSec < win.perfect) return "perfect";
  if (errSec < win.good) return "good";
  return "miss";
}

function tryFinishRhythmFormal() {
  if (!isRhythmMode()) return;
  if (app.qteClicked.size < (app.qteCircleCount || 5)) return;
  if (!app.qteResolveAt) {
    const times = Object.values(app.qteDismissAt);
    const last = times.length ? Math.max(...times) : performance.now() + 1200;
    app.qteResolveAt = last;
  }
}

function finalizeRhythmFormal() {
  if (!isRhythmMode()) return;
  const circleCount = app.qteCircleCount || 5;
  // 固定分值：perfect=2、good=1、miss=0；滿分 = 圓圈數 × 2
  const perfectVal = 2;
  const goodVal    = 1;
  const maxScore   = circleCount * 2;
  // 過關門檻：60% 滿分
  let PASS_THRESHOLD = maxScore * 0.6;
  if (isStage5() && app.stage5) {
    const s5 = app.stage5;
    // chill（冷靜應對）：本動 QTE 容錯（用後即清）
    if (s5.chillForgiveActive) {
      PASS_THRESHOLD = maxScore * (0.6 - s5.chillForgiveActive);
      s5.chillForgiveActive = 0;
    }
  }
  let score = 0;
  for (const r of Object.values(app.qteResults)) {
    if (r === "perfect") score += perfectVal;
    else if (r === "good") score += goodVal;
  }
  app.qteScore     = score;
  app.qteScoreMax  = maxScore;
  app.qteScorePass = PASS_THRESHOLD;
  const success = score >= PASS_THRESHOLD;
  // 第五關分流
  if (isStage5()) {
    clearLaneAfterOvertake();
    // 失誤牌規則（依分數比例，與成功失敗分開計算）：
    // 滿分（100%）  → 移除 1 張失誤牌
    // ≥ 70%        → 0 張
    // ≥ 50% < 70%  → 1 張
    // < 50%        → 2 張
    // 過關門檻 60%：低於此為失敗，扣 1 胎
    let mistakeCount = 0;
    if (score >= maxScore) {
      mistakeCount = -1;
    } else if (score >= maxScore * 0.7) {
      mistakeCount = 0;
    } else if (score >= maxScore * 0.5) {
      mistakeCount = 1;
    } else {
      mistakeCount = 2;
    }
    if (app.stage5) {
      if (mistakeCount > 0) {
        for (let i = mistakeCount - 1; i >= 0; i--) {
          const uid = `qte-mis-${Date.now()}-${i}`;
          app.stage5.drawPile.unshift(makeCard("mistake", uid));
        }
      } else if (mistakeCount < 0) {
        const idx = app.stage5.drawPile.findIndex(c => c.type === "mistake");
        if (idx >= 0) app.stage5.drawPile.splice(idx, 1);
        else {
          const di = app.stage5.discardPile.findIndex(c => c.type === "mistake");
          if (di >= 0) app.stage5.discardPile.splice(di, 1);
        }
      }
      app.stage5.lastMistakeCount = mistakeCount;
    }
    // 失敗（< 60% 滿分）：扣 1 胎
    if (!success) spendTire(1);
    if (success) {
      stage5OnOvertakeSuccess();
    } else {
      stage5OnOvertakeFail();
    }
    // 守門：若這次 spendTire 已經把輪胎扣到 0，輸的畫面優先於結算
    enforceTireOutIfDead();
    app.qteResolveAt = 0;
    return;
  }
  if (success) {
    app.rank = Math.max(1, app.rank - 1);
    clearLaneAfterOvertake();
    app.mode = "result";
    app.message = "超車成功！";
  } else if (app.noDefense) {
    clearLaneAfterOvertake();
    app.mode = "result";
    app.message = "超車失敗";
  } else {
    // QTE 失敗 → 若速度甩開後車就不防守，否則進防守
    // 注意：必須在 clearLaneAfterOvertake 之前判斷
    const needDefense = shouldDefend();
    clearLaneAfterOvertake();
    if (needDefense) {
      startDefense();
    } else {
      app.message = "未超車（已甩開後車）";
      app.mode = "result";
    }
  }
  app.qteResolveAt = 0;
}

function hitCircle(p) {
  const list = app.zones.circles || [];
  let best = null, bestD = Infinity;
  for (const c of list) {
    const d = dist(p.x, p.y, c.x, c.y);
    if (d <= c.r && d < bestD) { best = c; bestD = d; }
  }
  if (!best) return;
  if (isRhythmMode() && !app.qteFinalized[best.i]) {
    const now = performance.now();
    const start = app.qteCircleStarts[best.i] || app.qteStart;
    const dur = best.duration;
    const judgeT = start + dur;
    if (now > judgeT) return;
    if (!app.qteTapPending[best.i]) app.qteTapPending[best.i] = { t: now };
  }
}

// ─── 散佈位置生成（沿用 Sam）──────────────────────────────────────────────
// 一排亂序：圓圈水平等距排成一排，但「時間順序」到「空間位置」是隨機洗牌。
// 例如時間上第 1、2、3、4 個出現的圓，可能空間上是第 3、1、4、2 個 slot。
// y 軸再加上輕微的上下抖動，讓玩家視線必須跳動、不能光靠肌肉記憶往右滑。
function generateRowScatterPositions() {
  const n = app.qteCircleCount || 5;
  // x slot：跟舊 fallback 一樣的等距排法
  const gap = Math.min(110, app.w * 0.075);
  const startX = app.w / 2 - gap * Math.floor(n / 2);
  const slots = Array.from({ length: n }, (_, k) => ({
    x: startX + k * gap,
    y: app.h * 0.44,
  }));
  // y 抖動：±60px 內隨機（不可離原線太遠、避免被 HUD 或鍵盤提示遮到）
  const Y_JITTER = 60;
  for (const s of slots) {
    s.y += (Math.random() * 2 - 1) * Y_JITTER;
  }
  // 隨機排列：第 i 個時間順序的圓圈分配到 perm[i] 號空間 slot
  const perm = Array.from({ length: n }, (_, i) => i);
  for (let i = perm.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  // 輸出：pts[i] = 第 i 個時間順序的圓圈位置
  return perm.map(slotIdx => slots[slotIdx]);
}

function generateScatterPositions() {
  const n = app.qteCircleCount || 5;
  const r = RHYTHM_OUTER_R;
  const marginX = [r + RHYTHM_UI_AVOID_PAD, app.w - r - RHYTHM_UI_AVOID_PAD];
  const marginY = [r + RHYTHM_UI_AVOID_PAD, Math.min(app.h * 0.66, app.h - r - RHYTHM_UI_AVOID_PAD)];
  for (let attempt = 0; attempt < 90; attempt++) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      let point = null;
      for (let tries = 0; tries < 24; tries++) {
        const x = marginX[0] + Math.random() * (marginX[1] - marginX[0]);
        const y = marginY[0] + Math.random() * (marginY[1] - marginY[0]);
        if (qtePointSafe(x, y, r)) { point = { x, y }; break; }
      }
      if (!point) break;
      pts.push(point);
    }
    if (pts.length < n) continue;
    let ok = true;
    for (let i = 0; i < n && ok; i++)
      for (let j = i + 1; j < n; j++)
        if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < RHYTHM_SCATTER_MIN_CENTER_DIST) ok = false;
    if (ok) return pts;
  }
  const gap = Math.min(130, app.w * 0.085);
  const startX = app.w / 2 - gap * Math.floor(n / 2);
  return Array.from({ length: n }, (_, i) => ({ x: startX + i * gap, y: app.h * 0.44 }));
}

function qtePointSafe(x, y, r) {
  const edge = RHYTHM_UI_AVOID_PAD;
  if (x < r + edge || x > app.w - r - edge || y < r + edge || y > app.h - r - edge) return false;
  const hud = statusHudRect();
  if (x > hud.x - edge && x < hud.x + hud.w + edge && y > hud.y - edge && y < hud.y + hud.h + edge) return false;
  return true;
}


// ─── Input ─────────────────────────────────────────────────────────────────
function setupInput() {
  app.canvas.addEventListener("mousemove", e => {
    const p = point(e);
    app.mouse = p;
    if (app.drag) { app.drag.x = p.x - app.drag.dx; app.drag.y = p.y - app.drag.dy; }
  });

  function onDown(e) {
    if (e.button != null && e.button !== 0) return;
    const p = point(e);
    app.mouse = p;
    const hit = hitButton(p);
    if (hit) { handleButton(hit); return; }
    // corner-pick mode：檢查是否點到某道
    if (app.mode === "stage5-corner-pick-lane" && app.cornerLaneRects) {
      for (const lr of app.cornerLaneRects) {
        if (inRect(p, lr)) {
          // 選到某道
          app.playerLane = lr.lane;
          app.mode = "playing";
          app.cornerLaneRects = null;
          // 完美過彎選道也算一個玩家「子動作」→ 觸發對手回合
          triggerOpponentActions();
          checkAutoPrompt();
          return;
        }
      }
      return;
    }
    if (isRhythmMode()) { hitCircle(p); return; }
    if (!canDragCards()) return;
    const cardHit = [...(app.zones.cards || [])].reverse().find(item => inRect(p, item.rect));
    if (!cardHit) return;
    app.drag = {
      card: cardHit.card, from: cardHit.index,
      x: cardHit.rect.x, y: cardHit.rect.y,
      w: cardHit.rect.w, h: cardHit.rect.h,
      dx: p.x - cardHit.rect.x, dy: p.y - cardHit.rect.y,
    };
  }

  app.canvas.addEventListener("mousedown", onDown);
  app.canvas.addEventListener("touchstart", e => {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    onDown(e);
  }, { passive: false });

  app.canvas.addEventListener("mouseup", e => {
    if (!app.drag) return;
    const p = point(e);
    // 取消區優先：拖回手牌列附近不算打出
    const handTop = app.h - 190 - 60;
    const handBottom = app.h - 190 + 164 + 30;
    if (p.y >= handTop && p.y <= handBottom) {
      app.drag = null;
      return;
    }
    const laneIdx = laneAtPoint(p);
    if (laneIdx >= 0) {
      const zone = app.zones.lanes && app.zones.lanes[laneIdx];
      if (zone && zone.droppable) {
        playCardToLane(app.drag.from, laneIdx);
      }
    }
    app.drag = null;
  });

  app.canvas.addEventListener("touchend", e => {
    if (!app.drag) return;
    const t = e.changedTouches[0];
    const SCV = window.StoryCanvasViewport;
    const cssPoint = SCV.getCanvasPoint(app.canvas, t.clientX, t.clientY);
    const p = SCV.screenToWorld(cssPoint, app.viewport);
    const handTop = app.h - 190 - 60;
    const handBottom = app.h - 190 + 164 + 30;
    if (p.y >= handTop && p.y <= handBottom) {
      app.drag = null;
      return;
    }
    const laneIdx = laneAtPoint(p);
    if (laneIdx >= 0) {
      const zone = app.zones.lanes && app.zones.lanes[laneIdx];
      if (zone && zone.droppable) {
        playCardToLane(app.drag.from, laneIdx);
      }
    }
    app.drag = null;
  });

  // QWER 按鍵 QTE
  document.addEventListener("keydown", e => {
    // 彎道 QTE 鍵盤輸入（WASD）
    if (app.mode === "bend-qte") {
      const dirMap = { w:"↑", s:"↓", a:"←", d:"→",
                       arrowup:"↑", arrowdown:"↓", arrowleft:"←", arrowright:"→" };
      const dir = dirMap[e.key.toLowerCase()];
      if (!dir) return;
      e.preventDefault();
      handleBendQteInput(dir);
      return;
    }
    if (!isRhythmMode()) return;
    const key = e.key.toLowerCase();
    if (!['q','w','e','r'].includes(key)) return;
    const now = performance.now();
    const circleCount = app.qteCircleCount || 5;
    for (let i = 0; i < circleCount; i++) {
      if (app.qteFinalized[i]) continue;
      const start = app.qteCircleStarts[i] ?? app.qteStart;
      if (now < start) continue;
      const dur = getRhythmDuration(i);
      const judgeT = start + dur;
      if (now > judgeT) continue;
      const expectedKey = app.qteKeys[i];
      if (key === expectedKey) {
        if (!app.qteTapPending[i]) app.qteTapPending[i] = { t: now };
      } else {
        if (!app.qteTapPending[i]) app.qteTapPending[i] = { t: now, wrong: true };
      }
      break;
    }
  });
}

function point(e) {
  const SCV = window.StoryCanvasViewport;
  if (!SCV || !app.viewport) {
    // fallback：直接回 CSS 像素
    const rect = app.canvas.getBoundingClientRect();
    const cx = e.touches?.[0]?.clientX ?? e.clientX;
    const cy = e.touches?.[0]?.clientY ?? e.clientY;
    return { x: cx - rect.left, y: cy - rect.top };
  }
  const clientX = e.touches?.[0]?.clientX ?? e.clientX;
  const clientY = e.touches?.[0]?.clientY ?? e.clientY;
  const cssPoint = SCV.getCanvasPoint(app.canvas, clientX, clientY);
  return SCV.screenToWorld(cssPoint, app.viewport);
}

function canDragCards() {
  if (app.inputLocked) return false;
  return app.mode === "playing";
}

// ─── 按鈕處理 ──────────────────────────────────────────────────────────────
function handleButton(id) {
  // 開始遊戲
  if (id === "start-game") {
    playNormalBgm();
    loadStage(0);
    return;
  }
  // 主選單：規則
  if (id === "open-rules") {
    app._rulesPrevMode = app.mode;
    app.mode = "rules";
    return;
  }
  if (id === "close-rules") {
    app.mode = app._rulesPrevMode || "start-ready";
    return;
  }
  // 開場 intro 確認
  if ((id === "stage5-intro-next" || id === "stage5-intro-ok") && app.mode === "stage-5-intro") {
    stage5StartNewRound();
    return;
  }
  if (id === "stage5-corner-cancel-pick" && app.mode === "stage5-corner-pick-lane") {
    // 不換道：回 playing
    app.mode = "playing";
    app.cornerLaneRects = null;
    checkAutoPrompt();
    return;
  }
  // 超車成功結算 → 進三選一
  if (id === "stage5-to-reward" && app.mode === "stage5-overtake-result") {
    // 棄掉「名次上升時棄」的車隊牌
    discardOnRankUp();
    stage5BeginRewardPick();
    return;
  }
  // 沒超車（一般 result） → 進新回合
  if (id === "stage5-next-round" && (app.mode === "stage5-no-overtake" || app.mode === "stage5-defense-result" || app.mode === "stage5-overtake-result")) {
    stage5StartNewRound();
    return;
  }
  // 三選一：選擇 / 略過
  if (id && id.startsWith("stage5-reward-pick-") && app.mode === "stage5-reward") {
    const slot = parseInt(id.replace("stage5-reward-pick-", ""), 10);
    stage5OnRewardPicked(slot);
    return;
  }
  if (id === "stage5-reward-skip" && app.mode === "stage5-reward") {
    stage5OnRewardSkip();
    return;
  }
  // 打牌階段
  if (id === "btn-overtake" && app.mode === "playing" && !app.inputLocked) {
    if (canDirectOvertake()) pressOvertake();
    return;
  }
  if (id === "btn-pass" && app.mode === "playing" && !app.inputLocked) {
    pressPass();
    return;
  }
  // 詢問超車或 Pass
  if (id === "prompt-overtake" && app.mode === "prompt-overtake-or-pass") {
    app.mode = "playing";
    pressOvertake();
    return;
  }
  if (id === "prompt-pass" && app.mode === "prompt-overtake-or-pass") {
    app.mode = "playing";
    pressPass();
    return;
  }
  // QTE 確認鍵：玩家看完難度面板按下、開始 QTE
  if (id === "qte-confirm-overtake" && app.mode === "splash-overtake") {
    app.mode = "rhythm-formal";
    resetRhythmState();
    return;
  }
  if (id === "qte-confirm-defense" && app.mode === "splash-defense") {
    app.mode = "defense";
    app.defenseStart = performance.now();
    app.defenseProgress = 0;
    app.defenseSucceeded = false;
    app.safeCenter = 50;
    app.safeTarget = 50;
    app.nextSafeShift = performance.now() + 300;
    return;
  }
  if (id === "qte-confirm-bend" && app.mode === "splash-bend") {
    const pending = app._pendingBendQte || { arrows: [], secs: 6 };
    app.mode = "bend-qte";
    app.bendQteArrows   = pending.arrows;
    app.bendQteInput    = [];
    app.bendQteFailed   = false;
    app.bendQteDeadline = performance.now() + pending.secs * 1000;
    app.bendQteTotalSecs = pending.secs;
    app._pendingBendQte = null;
    return;
  }
  // 重新來過
  if (id === "replay") { reset(); return; }
}

// ─── Update ────────────────────────────────────────────────────────────────
function update(time) {
  // 車道絲滑移動 lerp
  // 對手回合期間用較慢的 lerp，讓玩家看清楚切道動作
  const playerLerp = 0.14;
  const opponentLerp = (app.mode === "opponent-turn") ? 0.08 : 0.14;
  app.playerLaneVisual   += (app.playerLane   - app.playerLaneVisual)   * playerLerp;
  app.opponentLaneVisual += (app.opponentLane - app.opponentLaneVisual) * opponentLerp;

  // 對手回合過場 tick（鎖玩家輸入、計時結束自動解鎖）
  tickOpponentTurn(time);

  // 對手行動視覺提示計時
  if (app.opponentActionFx && time > app.opponentActionFx.until) {
    app.opponentActionFx = null;
  }

  // 對手加速頻閃計時
  if (app.opponentBoostFlash && time > app.opponentBoostFlash.until) {
    app.opponentBoostFlash = null;
  }

  // QTE 更新
  if (isRhythmMode()) {
    const circleCount = app.qteCircleCount || 5;
    for (let i = 0; i < circleCount; i++) {
      if (app.qteFinalized[i]) continue;
      const start = app.qteCircleStarts[i] ?? app.qteStart;
      const elapsed = time - start;
      if (elapsed <= 0) continue;
      const dur = getRhythmDuration(i);
      const judgeT = start + dur;
      const tap = app.qteTapPending[i];

      if (tap) {
        app.qteFinalized[i] = true;
        app.qteResults[i] = rhythmOutcomeFromTap(tap, start, dur, judgeT);
        app.qteDismissAt[i] = time + 1000;
        app.qteClicked.add(i);
        delete app.qteTapPending[i];
        tryFinishRhythmFormal();
        continue;
      }

      if (time >= judgeT) {
        app.qteFinalized[i] = true;
        app.qteResults[i] = rhythmOutcomeFromTap(undefined, start, dur, judgeT);
        app.qteDismissAt[i] = time + 1000;
        app.qteClicked.add(i);
        tryFinishRhythmFormal();
      }
    }
    // 超時強制結算（依最後一個圓圈時間 + 緩衝）
    const lastStart = app.qteCircleStarts[circleCount - 1] ?? app.qteStart;
    const lastDur   = getRhythmDuration(circleCount - 1);
    if (time - (lastStart + lastDur) > 1200 && app.qteClicked.size < circleCount) {
      for (let i = 0; i < circleCount; i++) {
        if (app.qteFinalized[i]) continue;
        const start = app.qteCircleStarts[i] ?? app.qteStart;
        const dur = getRhythmDuration(i);
        const judgeT = start + dur;
        app.qteFinalized[i] = true;
        app.qteResults[i] = rhythmOutcomeFromTap(app.qteTapPending[i], start, dur, judgeT);
        app.qteDismissAt[i] = time + 1000;
        app.qteClicked.add(i);
        delete app.qteTapPending[i];
      }
      tryFinishRhythmFormal();
    }
    if (app.qteResolveAt && time >= app.qteResolveAt) finalizeRhythmFormal();
  }

  checkBendQteTimeout();
  // 手牌出完提示：3 秒後自動切回 playing（按鈕仍在右側）
  if (app.mode === "prompt-overtake-or-pass" && app.promptShownAt) {
    if (performance.now() - app.promptShownAt >= 3000) {
      app.mode = "playing";
      app.promptShownAt = 0;
    }
  }
  if (app.mode === "defense") updateDefense(time);
}


// ─── 繪製系統 ──────────────────────────────────────────────────────────────
function draw(time) {
  app.zones.buttons = [];
  if (!isRhythmMode()) app.zones.circles = [];

  // 每幀更新速度結算飛字（從 queue 取出 active、淘汰過期）
  updateSpeedPops(time);
  // 飛字播完才放行的閘門（打牌→對手回合、過場結束→後半結算等）
  tickSpeedPopGates();

  const SCV = window.StoryCanvasViewport;
  // 1. 先用 setTransform(dpr) 把整個 canvas 填滿黑（letterbox 黑邊）
  if (SCV && app.viewport) {
    SCV.fillLetterbox(app.ctx, app.viewport, "#05090d");
    // 2. 套 design transform：scale + offset、進入設計座標 1920×1080
    SCV.applyDesignTransform(app.ctx, app.viewport);
  }

  try {
    drawInner(time);
  } finally {
    // 確保結束前 restore（不論前面是 return 或 throw）
    if (SCV && app.viewport) {
      SCV.restoreDesignTransform(app.ctx);
    }
  }
}

function drawInner(time) {
  // 背景：永遠畫賽道
  drawRace(time);

  const m = app.mode;
  // 模糊背景 modal 層
  if (m === "start-ready" || m === "rules" || m.includes("intro") || m === "stage5-reward") {
    drawModalBackdrop(time);
  }

  if (m === "start-ready")              { drawStartModal(); drawExpressionDock(time); return; }
  if (m === "rules")                    { drawRulesModal(time); drawExpressionDock(time); return; }
  if (m === "stage-5-intro")            { drawStage5IntroModal(time); drawExpressionDock(time); return; }
  if (m === "stage5-corner-pick-lane")  { drawStage5CornerLanePick(time); drawExpressionDock(time); return; }

  // HUD 常駐
  drawHud(time);
  // 主關卡常駐：右上角下一賽段預告 + 賽況面板
  if (m === "playing" || m === "prompt-overtake-or-pass" || m === "stage5-overtake-result"
      || m === "stage5-no-overtake" || m === "stage5-defense-result" || m === "stage5-reward"
      || m === "bend-qte" || m === "bend-qte-result" || m.startsWith("splash") || isRhythmMode() || m === "defense") {
    drawSpeedLimitAR(time);
    drawStage5SidePanel(time);
    drawStage5NextCircuit(time);
  }

  if (m === "playing" || m === "prompt-overtake-or-pass") {
    drawLanes(time);
    // 飛字播放期間（閘門等待中）隱藏手牌，讓玩家專注看結算
    if (!app.inputLocked) drawHand(time);
    if (m === "prompt-overtake-or-pass") drawPromptModal();
  }

  if (m === "bend-qte") { drawLanes(time); drawBendQte(time); }
  if (m === "bend-qte-result") { drawLanes(time); drawBendQteResult(); }

  if (m.startsWith("splash")) drawSplash();
  // 超車 QTE / 防守 QTE：賽道當背景、QTE UI 疊上去
  // 賽道本身在 QTE 模式下會「整體左右擺動」（見 drawLanes 內 cameraShakeX）
  if (isRhythmMode()) { drawLanes(time); drawRhythm(time); }
  if (m === "defense") { drawLanes(time); drawDefense(); }

  if (m === "all-clear") drawAllClear();
  if (m === "stage5-tire-out") drawStage5TireOutModal();
  if (m === "stage5-finish-line") drawStage5FinishLineModal();
  // 主關卡專屬結算
  if (m === "stage5-overtake-result") drawStage5OvertakeResultModal();
  if (m === "stage5-no-overtake")     drawStage5NoOvertakeModal();
  if (m === "stage5-defense-result")  drawStage5DefenseResultModal();
  if (m === "stage5-reward")          drawStage5RewardModal(time);

  // 拖曳中的牌
  if (app.drag) {
    drawCard(app.drag.card, app.drag.x, app.drag.y, app.drag.w, app.drag.h, true);
    // 拖到非當前道：在牌正上方顯示「換道（棄此牌）」
    if (isStage5() && app.mode === "playing") {
      const dragCx = app.drag.x + app.drag.w/2;
      const dragCy = app.drag.y + app.drag.h/2;
      const laneCount2 = app.laneCount;
      const laneW2 = Math.min(240, (app.w - 320) / laneCount2 - 12);
      const laneH2 = 170;
      const gap2 = 14;
      const totalW2 = laneCount2 * laneW2 + (laneCount2-1) * gap2;
      const baseX2 = (app.w - totalW2) / 2;
      const handY2 = app.h - 190;
      const baseY3 = handY2 - laneH2 - 30;

      // 收集懸停道的 previewLines（依牌位置決定哪一道）
      // 車隊牌不參與預覽（直接結算、不影響速度）
      // 拖回手牌列（取消區）時也不顯示算式
      const isDragTeamCard = app.drag.card?.cardClass === "team";
      const handTop3 = app.h - 190 - 60;
      const handBottom3 = app.h - 190 + 164 + 30;
      const isOverCancelZone = dragCy >= handTop3 && dragCy <= handBottom3;
      let hoverLines = [];
      let hoverLane = -1;
      if (!isDragTeamCard && !isOverCancelZone) {
        // 用整條賽道判定（laneAtPoint）、不再依舊道格 rect
        hoverLane = laneAtPoint({ x: dragCx, y: dragCy });
        if (hoverLane >= 0) {
          const li = hoverLane;
          // c8 紅綠燈未揭曉的道：不顯示加成算式（會洩漏）
          const circ4 = currentCircuit();
          const isC8HiddenLane = circ4?.hideLaneBonusUntilVisited
            && !(app.stage5?.revealedC8Lanes?.has(li));
          if (isC8HiddenLane) {
            hoverLines.push({ left: "? 未揭曉的道", color: "rgba(200,200,210,0.85)" });
            hoverLines.push({ left: "進入後才知道效果", color: "rgba(160,170,185,0.7)" });
          } else {
          const b = getLaneBonusFor(li);
          const add = b?.add ?? 0; const mult = b?.mult ?? 1;
          if (li === app.playerLane) {
            const cardSpd = app.drag.card.speedValue ?? 0;
            const previewSpd = Math.floor((app.playerSpeed + cardSpd + add) * mult);
            // 順序：行動 → 道路加法 → 道路乘法
            if (cardSpd !== 0) hoverLines.push({ left: `+${cardSpd} 行動（${app.drag.card.name}）`, color: "rgba(140,255,160,0.95)" });
            if (add !== 0) hoverLines.push({ left: `${add > 0 ? "+" : ""}${add} 道路（${b?.label?.replace(/ [+-]?\d.*$/, "") ?? "道路加成"}）`, color: add > 0 ? "rgba(255,210,60,0.95)" : "rgba(140,200,220,0.95)" });
            if (mult !== 1) hoverLines.push({ left: `×${mult} 道路（${b?.label?.split(" ")[0] ?? "彎道"}）`, color: "rgba(255,180,80,0.95)" });
            if (b?._auraSuppressed) {
              hoverLines.push({ left: "⚠ 清道夫光環：加成失效", color: "rgba(255,140,200,0.95)" });
            }
            if (b?.speedLimit != null && previewSpd > b.speedLimit) {
              hoverLines.push({ left: `⚠ 超速！限速 ${b.speedLimit}`, color: "rgba(255,80,80,0.98)" });
            }
            if (app.stage5?.potholeLanes?.includes(li)) {
              const auraSafe = isOpponentAuraActive() && app.opponentLane === li;
              if (auraSafe) {
                hoverLines.push({ left: "🛡️ 坑洞：光環抵消", color: "rgba(180,255,200,0.95)" });
              } else {
                hoverLines.push({ left: "⚠ 撞坑！-1 輪胎", color: "rgba(255,80,80,0.98)" });
              }
            }
            if (b?.forceCornerQte) {
              hoverLines.push({ left: "⚠ 油污：強制 QTE", color: "rgba(255,180,100,0.95)" });
              hoverLines.push({ left: "（失敗 -1 胎、滑開）", color: "rgba(220,160,80,0.85)" });
            }
          } else if (app.playerSpeed > 0) {
            const slipBonus = canGetSlipstreamAtLane(li) ? 30 : 0;
            const lanesCrossed = Math.abs(li - app.playerLane);
            const laneCost = laneChangeCost(lanesCrossed);
            const changeSpd = Math.floor((app.playerSpeed - laneCost + slipBonus + add) * mult);
            // 順序：行動（換道）→ 尾流 → 道路加法 → 道路乘法
            hoverLines.push({ left: `-${laneCost} 行動（跨 ${lanesCrossed} 道）`, color: "rgba(255,180,100,0.95)" });
            if (slipBonus) hoverLines.push({ left: "+30 尾流", color: "rgba(100,255,200,0.98)" });
            if (add !== 0) hoverLines.push({ left: `${add > 0 ? "+" : ""}${add} 道路（${b?.label?.replace(/ [+-]?\d.*$/, "") ?? "道路加成"}）`, color: add > 0 ? "rgba(255,210,60,0.95)" : "rgba(140,200,220,0.95)" });
            if (mult !== 1) hoverLines.push({ left: `×${mult} 道路（${b?.label?.split(" ")[0] ?? "彎道"}）`, color: "rgba(255,180,80,0.95)" });
            if (b?._auraSuppressed) {
              hoverLines.push({ left: "⚠ 清道夫光環：加成失效", color: "rgba(255,140,200,0.95)" });
            }
            if (b?.speedLimit != null && changeSpd > b.speedLimit) {
              hoverLines.push({ left: `⚠ 超速！限速 ${b.speedLimit}`, color: "rgba(255,80,80,0.98)" });
            }
            // c7 坑洞警告
            if (app.stage5?.potholeLanes?.includes(li)) {
              const auraSafe = isOpponentAuraActive() && app.opponentLane === li;
              if (auraSafe) {
                hoverLines.push({ left: "🛡️ 坑洞：光環抵消", color: "rgba(180,255,200,0.95)" });
              } else {
                hoverLines.push({ left: "⚠ 撞坑！-1 輪胎", color: "rgba(255,80,80,0.98)" });
              }
            }
            // c6 油污警告
            if (b?.forceCornerQte) {
              hoverLines.push({ left: "⚠ 油污：強制 QTE", color: "rgba(255,180,100,0.95)" });
              hoverLines.push({ left: "（失敗 -1 胎、滑開）", color: "rgba(220,160,80,0.85)" });
            }
          }
          }  // end else (非 c8 隱藏)
        }  // end if (hoverLane >= 0)
      }  // end if (!isDragTeamCard)

      if (hoverLines.length > 0) {
        const tipCx = app.drag.x + app.drag.w/2;
        const lineH  = 20;
        const tipPadY = 12;  // 上下內距
        const tipH   = hoverLines.length * lineH + tipPadY * 2 - (lineH - 14);  // 視覺更平衡
        const tipW   = 210;
        const tipX   = tipCx - tipW/2;
        const tipY   = app.drag.y - tipH - 8;
        const ctx = app.ctx;
        ctx.save();
        ctx.fillStyle = "rgba(6,14,28,0.93)";
        ctx.strokeStyle = "rgba(255,210,60,0.7)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(tipX, tipY, tipW, tipH, 8);
        ctx.fill(); ctx.stroke();
        ctx.restore();
        // 文字以 box 中心為基準對稱排列
        const totalTextH = hoverLines.length * lineH;
        const startY = tipY + (tipH - totalTextH) / 2 + lineH / 2 + 4;
        hoverLines.forEach((line, idx) => {
          const y2 = startY + idx * lineH;
          const label = line.left ?? line.label ?? "";
          text(label, tipCx, y2, 12, line.color, "800", "center");
        });
      }
    }
  }

  // 第五關場上車隊牌 hover tooltip（最上層）
  if (isStage5()) drawStage5TeamCardTooltip(time);

  // 對手回合螢幕邊框光暈（環境提示，輕量但可見）
  // 沒招的對手回合 → 不顯示紅光暈（柔和處理）
  const isOppTurnWithAction = app.mode === "opponent-turn"
    && app.opponentTurnAnim
    && app.opponentTurnAnim.behavior;
  if (isOppTurnWithAction) {
    const ctx = app.ctx;
    const pulse = 0.6 + 0.4 * Math.abs(Math.sin(time * 0.005));
    const edge = 28;
    ctx.save();
    // 上下左右四道紅光漸層邊
    const grad = ctx.createLinearGradient(0, 0, 0, edge);
    grad.addColorStop(0, `rgba(255, 60, 60, ${0.55 * pulse})`);
    grad.addColorStop(1, "rgba(255, 60, 60, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, app.w, edge);  // 上
    // 下邊
    const grad2 = ctx.createLinearGradient(0, app.h - edge, 0, app.h);
    grad2.addColorStop(0, "rgba(255, 60, 60, 0)");
    grad2.addColorStop(1, `rgba(255, 60, 60, ${0.55 * pulse})`);
    ctx.fillStyle = grad2;
    ctx.fillRect(0, app.h - edge, app.w, edge);
    // 左
    const grad3 = ctx.createLinearGradient(0, 0, edge, 0);
    grad3.addColorStop(0, `rgba(255, 60, 60, ${0.55 * pulse})`);
    grad3.addColorStop(1, "rgba(255, 60, 60, 0)");
    ctx.fillStyle = grad3;
    ctx.fillRect(0, 0, edge, app.h);
    // 右
    const grad4 = ctx.createLinearGradient(app.w - edge, 0, app.w, 0);
    grad4.addColorStop(0, "rgba(255, 60, 60, 0)");
    grad4.addColorStop(1, `rgba(255, 60, 60, ${0.55 * pulse})`);
    ctx.fillStyle = grad4;
    ctx.fillRect(app.w - edge, 0, edge, app.h);
    ctx.restore();
  }

  drawExpressionDock(time);
}

// ─── 賽道背景（沿用 Sam）──────────────────────────────────────────────────
function createCarMotion() {
  // 兩台車的 base speed 範圍故意錯開、避免同步擺動
  //   red 紅車（對手）速度範圍寬、平均比白快
  //   white 白車（玩家）速度範圍稍窄、偏慢
  // 調變參數做加減速：
  //   modAmp 0.9-1.6 → 瞬時速度從 -0.6× 到 2.6× base、能出現「反向擺」「突然衝刺」
  //   modSpeed 範圍寬：0.0005-0.0028 → 調變週期 2.2-13 秒、有快抽搐也有慢呼吸
  //   modAmp2/modSpeed2：第二層調變、跟主調變相位疊加、節奏更不可預測
  const makeMotion = (minS, maxS) => ({
    speed: minS + Math.random() * (maxS - minS),
    phase: Math.random() * Math.PI * 2,
    // 主調變
    modAmp: 0.9 + Math.random() * 0.7,
    modSpeed: 0.0005 + Math.random() * 0.0023,
    modPhase: Math.random() * Math.PI * 2,
    // 次調變（疊加用、振幅小但頻率不同、製造不可預測感）
    modAmp2: 0.3 + Math.random() * 0.5,
    modSpeed2: 0.0012 + Math.random() * 0.0030,
    modPhase2: Math.random() * Math.PI * 2,
  });
  // 兩台車速度範圍故意不同但有重疊：
  //   紅 0.0006-0.0016（偏快）、白 0.0005-0.0014（中間）
  //   重疊區間 0.0006-0.0014 → 抽到接近值機率不高、但白車不會永遠慢
  return {
    red:   makeMotion(0.0006, 0.0016),
    white: makeMotion(0.0005, 0.0014),
  };
}
let carMotion = createCarMotion();

// 算「會變速的擺動」的當前相位
//   瞬時擺動速度 = speed × (1 + modAmp×sin(modSpeed×t+modPhase) + modAmp2×sin(modSpeed2×t+modPhase2))
//   累積相位 = ∫ 瞬時速度 dt（閉式解、保證位置連續、不閃動）
function carSwingPhase(motion, time) {
  const linearPart = motion.speed * time;
  const modPart1 = motion.speed * motion.modAmp / motion.modSpeed
                 * (Math.cos(motion.modPhase) - Math.cos(motion.modSpeed * time + motion.modPhase));
  const modPart2 = motion.speed * motion.modAmp2 / motion.modSpeed2
                 * (Math.cos(motion.modPhase2) - Math.cos(motion.modSpeed2 * time + motion.modPhase2));
  return motion.phase + linearPart + modPart1 + modPart2;
}

/**
 * 判定一個點屬於哪一道（用賽道梯形範圍）
 * 從 horizon（地平線）到 canvas 底部都算「賽道區」。
 * 落在賽道左/右邊界外（路邊）→ 回 -1
 * 落在 horizon 上方（天空）→ 回 -1
 * 否則回該點 y 那條水平線上、x 落入哪一道的索引（0-base）
 */
function laneAtPoint(p) {
  const horizon = app.h * 0.38;
  if (p.y < horizon) return -1;
  const bounds = roadLaneBoundsAt(p.y);
  if (p.x < bounds.left || p.x > bounds.right) return -1;
  const laneCount = app.laneCount || 1;
  const laneW = (bounds.right - bounds.left) / laneCount;
  const idx = Math.floor((p.x - bounds.left) / laneW);
  return Math.max(0, Math.min(laneCount - 1, idx));
}

function roadLaneBoundsAt(y) {
  const horizon = app.h * 0.38;
  const t = Math.max(0, Math.min(1, (y - horizon) / (app.h - horizon)));
  // 預設邊界：地平線 0.45~0.55，底部 0.08~0.92
  let leftFrac  = 0.45 + (0.08 - 0.45) * t;
  let rightFrac = 0.55 + (0.92 - 0.55) * t;
  // 套用賽道窄化（以中心 0.5 為支點縮放）
  const scale = app.roadWidthScale ?? 1.0;
  if (scale !== 1.0) {
    leftFrac  = 0.5 + (leftFrac  - 0.5) * scale;
    rightFrac = 0.5 + (rightFrac - 0.5) * scale;
  }
  // 套用彎道偏移：t=0（地平線）偏移最大、t=1（底部）偏移為 0
  // 用 (1-t)^2 讓彎度集中在遠方，近處幾乎是直的
  const bend = app.bendCurve ?? 0;
  if (bend !== 0) {
    const bendOffset = -bend * Math.pow(1 - t, 2);
    leftFrac  += bendOffset;
    rightFrac += bendOffset;
  }
  return { left: app.w * leftFrac, right: app.w * rightFrac };
}

/**
 * 根據道 index 算出車子在賽道透視中的 X 座標。
 * 賽道左邊界 0.08w ~ 右邊界 0.92w（底部），平均分成 laneCount 道。
 */
function laneCarX(laneIdx, laneCount, y) {
  const bounds = roadLaneBoundsAt(y);
  const laneW = (bounds.right - bounds.left) / laneCount;
  return bounds.left + laneW * (laneIdx + 0.5);
}

function drawCar(x, y, w, h, color, opts={}) {
  const ctx = app.ctx;
  const shadowAlpha = opts.shadowAlpha ?? 0.48;
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`;
  ctx.fillRect(-w*0.5, h*0.36, w, h*0.22);
  ctx.fillStyle = color;
  ctx.fillRect(-w*0.42,-h*0.25,w*0.84,h*0.52);
  ctx.fillRect(-w*0.28,-h*0.5,w*0.56,h*0.3);
  ctx.fillStyle = "#121922";
  ctx.fillRect(-w*0.2,-h*0.42,w*0.4,h*0.18);
  ctx.fillStyle = "#ff3030";
  ctx.fillRect(-w*0.36,h*0.04,w*0.22,h*0.12);
  ctx.fillRect(w*0.14,h*0.04,w*0.22,h*0.12);
  ctx.restore();
}

function skylineHash01(n) { const x = Math.sin(n*12.9898)*43758.5453; return x-Math.floor(x); }

function drawCitySkyline(ctx, w, h, horizon, time) {
  const twinkle = 0.08 + 0.06*Math.sin(time*0.0022);
  const drawLayer = (layer, count) => {
    const far = layer===0;
    const alphaM = far?0.62:1, hMul = far?0.78:1, xShift = far?w*0.03:0;
    for (let i = 0; i < count; i++) {
      const seed=i*2.17+layer*19.1, sa=skylineHash01(seed), sb=skylineHash01(seed*1.9+1), sc2=skylineHash01(seed*3.3+2);
      const bw=(far?28:34)+sa*(far?22:34), bh=(horizon*(0.26+sb*0.34))*hMul;
      const topY=horizon-bh, baseX=(i/count)*(w+bw*0.5)-bw*0.35+xShift+(sc2-0.5)*16-layer*6;
      ctx.save(); ctx.globalAlpha=alphaM;
      const g=ctx.createLinearGradient(baseX,topY,baseX+bw,topY+bh);
      if(far){g.addColorStop(0,"rgba(52,72,98,0.55)");g.addColorStop(0.5,"rgba(36,52,74,0.62)");g.addColorStop(1,"rgba(20,30,48,0.68)");}
      else{g.addColorStop(0,"rgba(42,58,82,0.96)");g.addColorStop(0.45,"rgba(26,38,58,0.98)");g.addColorStop(1,"rgba(10,16,28,1)");}
      ctx.fillStyle=g; ctx.fillRect(baseX,topY,bw,bh);
      const crownH=far?2:3+(sa>0.55?3:0);
      ctx.fillStyle=far?"rgba(30,44,64,0.75)":"rgba(18,28,44,0.95)";
      ctx.fillRect(baseX+bw*0.08,topY-crownH,bw*0.84,crownH);
      const padT=12+sb*10, winW=far?4:5, winH=far?6:8, gapX=far?5:7, gapY=far?9:11;
      let row=0;
      for(let py=topY+padT;py+winH<horizon-7;py+=gapY,row++){
        let col=0;
        for(let px=baseX+5;px+winW<baseX+bw-5;px+=gapX,col++){
          const lit=skylineHash01(seed*11+row*5.3+col*2.1)>(far?0.88:0.74);
          const warm=0.35+twinkle*(lit?1:0);
          ctx.fillStyle=lit?`rgba(255,224,170,${0.28+warm*0.35})`:`rgba(110,140,180,${far?0.12:0.2})`;
          ctx.fillRect(px,py,winW,winH);
        }
      }
      ctx.strokeStyle="rgba(255,255,255,0.06)"; ctx.lineWidth=1;
      ctx.strokeRect(baseX+0.5,topY+0.5,bw-1,bh-1);
      ctx.restore();
    }
  };
  drawLayer(0,16); drawLayer(1,14);
}

function drawRace(time) {
  const ctx=app.ctx, w=app.w, h=app.h;
  ctx.clearRect(0,0,w,h);
  {
    const bg=ctx.createLinearGradient(0,0,0,h);
    bg.addColorStop(0,"#06101d"); bg.addColorStop(0.45,"#122033"); bg.addColorStop(1,"#05090d");
    ctx.fillStyle=bg; ctx.fillRect(0,0,w,h);
    const horizon=h*0.38;
    drawCitySkyline(ctx,w,h,horizon,time);
  }

  const horizon=h*0.38;

  // 賽道形狀：沿 y 軸分多段取邊界，這樣彎道（bendCurve）會自動呈現曲線
  const SEGMENTS = 24;
  const ys = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    ys.push(horizon + (h - horizon) * (i / SEGMENTS));
  }
  const bounds = ys.map(yy => roadLaneBoundsAt(yy));
  const shoulder = (bounds[bounds.length-1].right - bounds[bounds.length-1].left) * 0.04;

  // 路面：左側下行 + 右側上行，最遠端與最近端用左/右邊界閉合
  ctx.fillStyle = "#202934";
  ctx.beginPath();
  // 左邊界（地平線 → 底部）
  ctx.moveTo(bounds[0].left, ys[0]);
  for (let i = 1; i < bounds.length; i++) {
    const isLast = i === bounds.length - 1;
    ctx.lineTo(bounds[i].left - (isLast ? shoulder : 0), ys[i]);
  }
  // 底部往右
  ctx.lineTo(bounds[bounds.length-1].right + shoulder, ys[ys.length-1]);
  // 右邊界（底部 → 地平線）
  for (let i = bounds.length - 2; i >= 0; i--) {
    ctx.lineTo(bounds[i].right, ys[i]);
  }
  ctx.closePath();
  ctx.fill();

  // 兩側黃色邊線（沿邊界曲線描繪）
  ctx.strokeStyle = "rgba(255,217,79,0.7)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(bounds[0].left, ys[0]);
  for (let i = 1; i < bounds.length; i++) ctx.lineTo(bounds[i].left, ys[i]);
  ctx.moveTo(bounds[0].right, ys[0]);
  for (let i = 1; i < bounds.length; i++) ctx.lineTo(bounds[i].right, ys[i]);
  ctx.stroke();

  // 道路分道虛線（透視動感，從遠往近衝，近粗遠細）
  {
    const laneDiv = app.laneCount || 2;
    const dashSpeed = 0.0026;  // 更快
    const N = 60;
    for (let lane = 1; lane < laneDiv; lane++) {
      const frac = lane / laneDiv;
      const offset = (time * dashSpeed) % 1;
      for (let si = 1; si <= N; si++) {
        const t     = si / N;
        const tPrev = (si - 1) / N;
        const yy    = horizon + (h - horizon) * t;
        const yyPrev= horizon + (h - horizon) * tPrev;
        const bds   = roadLaneBoundsAt(yy);
        const bdsP  = roadLaneBoundsAt(yyPrev);
        const lx    = bds.left  + (bds.right  - bds.left)  * frac;
        const lxP   = bdsP.left + (bdsP.right - bdsP.left) * frac;
        // 透視縮放：dash 週期隨 t 縮放（遠處短密，近處長寬）
        const perspScale = 0.05 + t * 0.95;
        const dashTotal  = 18 * perspScale;  // 更短週期 = 更密
        const dashOn     = 5  * perspScale;  // dash 佔比更短
        // offset 反向：1-t 讓線從遠端往近端流
        const phase  = ((1 - t + offset) % 1) * dashTotal;
        const inDash = phase < dashOn;
        if (inDash) {
          const alpha = 0.12 + t * 0.62;
          ctx.strokeStyle = `rgba(220,235,255,${alpha})`;
          ctx.lineWidth   = 1.5 + t * 7;  // 遠 1.5px → 近 8.5px
          ctx.beginPath();
          ctx.moveTo(lxP, yyPrev);
          ctx.lineTo(lx,  yy);
          ctx.stroke();
        }
      }
    }
  }

  // ─── c6/c7 hazard sprite：畫在賽道路面上（透視座標）─────────────────────
  //   位置 y = horizon + (h - horizon) × hazardSpriteProgress
  //   即從 horizon (遠) 到底部 (近) 之間的位置、每段進關隨機
  //   sprite 大小依透視縮放（遠處小、近處大）
  if (isStage5() && app.stage5 && app.stage5.hazardSpriteProgress != null) {
    const prog = app.stage5.hazardSpriteProgress;
    const spriteY = horizon + (h - horizon) * prog;
    const laneCount = app.laneCount || 2;
    // 透視縮放：遠（prog 小）= 小、近（prog 大）= 大
    const persp = 0.25 + prog * 1.0;  // 0.25 ~ 1.25
    const SPRITE_SCALE = 2.5;  // 整體放大倍率
    const rx = 32 * persp * SPRITE_SCALE;
    const ry = 9 * persp * SPRITE_SCALE;
    const fontSize = Math.round(14 * persp * SPRITE_SCALE);
    const outlineW = 3 * persp * SPRITE_SCALE;
    // c7 坑洞：每條 potholeLanes 各畫一個坑
    if (app.stage5.potholeLanes && app.stage5.potholeLanes.length) {
      for (const lane of app.stage5.potholeLanes) {
        const cx = laneCarX(lane, laneCount, spriteY);
        // 紅色外框
        ctx.beginPath();
        ctx.ellipse(cx, spriteY, rx + outlineW, ry + outlineW, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,80,60,0.75)";
        ctx.fill();
        // 黑色內坑
        ctx.beginPath();
        ctx.ellipse(cx, spriteY, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.88)";
        ctx.fill();
        text("坑", cx, spriteY + fontSize * 0.35, fontSize, "rgba(255,180,160,0.95)", "900", "center");
      }
    }
    // c6 油污：找有 forceCornerQte 的道
    if (app.laneBonuses) {
      for (const b of app.laneBonuses) {
        if (!b.forceCornerQte) continue;
        const cx = laneCarX(b.lane, laneCount, spriteY);
        // 紫色油污外圈
        ctx.beginPath();
        ctx.ellipse(cx, spriteY, rx + outlineW, ry + outlineW, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(180,80,200,0.65)";
        ctx.fill();
        // 深紫內部
        ctx.beginPath();
        ctx.ellipse(cx, spriteY, rx, ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(40,15,55,0.88)";
        ctx.fill();
        text("油", cx, spriteY + fontSize * 0.35, fontSize, "rgba(240,180,255,0.95)", "900", "center");
      }
    }
  }

  // 對手車（紅）：速度越靠近門檻，對手車越靠近玩家車
  const opponentProgress = Math.min(1, app.playerSpeed / Math.max(1, app.opponentSpeed));
  // progress 0 → 對手在 0.62h（遠處）；progress 1 → 對手在 0.72h（快追到了）
  let opponentY = h * (0.62 + opponentProgress * 0.10);
  let redW = 82, redH = 40;
  let redX = laneCarX(app.opponentLaneVisual, app.laneCount, opponentY);
  // 超車 / 防守 QTE：對手車覆蓋為全賽道擺動（無視 lane）、像在搶位
  //   彎道 QTE 維持 lane 位置 + 小幅 sway（在後面玩家車那段一起處理）
  const _isFullSwayQte = (app.mode === "rhythm-formal" || app.mode === "defense");
  if (_isFullSwayQte && carMotion) {
    const _bounds = roadLaneBoundsAt(opponentY);
    const _sidePad = redW * 0.5 + 6;
    const _minX = _bounds.left + _sidePad;
    const _maxX = _bounds.right - _sidePad;
    if (_maxX > _minX) {
      const _center = (_minX + _maxX) / 2;
      const _half = (_maxX - _minX) / 2;
      redX = _center + Math.sin(carSwingPhase(carMotion.red, time)) * _half;
    }
  }
  // 每 frame 記下當下對手車的真實位置（給超車成功動畫當起點用）
  app._lastOpponentRenderX = redX;
  app._lastOpponentRenderY = opponentY;
  app._lastOpponentRenderW = redW;
  // v0.9：超車成功動畫 — 對手車從「QTE 結束當下位置」滑出畫面、放大、指數加速
  //   - startX/Y/W 在 stage5OnOvertakeSuccess 觸發時就用 cache 填好了
  //   - 指數加速（t²）：起初慢、最後爆衝
  //   - X 保持在起始位置（不拉回 lane 中心、避免「順移」感）
  if (app.overtakePassAnim && app.overtakePassAnim.startX != null) {
    const anim = app.overtakePassAnim;
    const elapsed = performance.now() - anim.startTime;
    const t = Math.min(1, elapsed / anim.duration);
    // 指數加速（先慢後快）
    const ease = t * t;
    // Y：從當下位置 → 畫面外
    const endY = h + 120;
    opponentY = anim.startY + (endY - anim.startY) * ease;
    // X：保持在起始位置（QTE 擺動的最後一幀位置）
    redX = anim.startX;
    // 放大：起點 → 終點 480px（更劇烈、更明顯）
    const endW = 480;
    redW = anim.startW + (endW - anim.startW) * ease;
    redH = redW * 40 / 82;
  }
  // ─── 加速頻閃光暈 ──────────────────────────────────────────────────
  if (app.opponentBoostFlash) {
    const flashCtx = app.ctx;
    const flashElapsed = performance.now() - app.opponentBoostFlash.startTime;
    const flashPhase = (flashElapsed / 100) | 0;  // 每 100ms 切換
    const flashOn = (flashPhase % 2 === 0);
    if (flashOn) {
      flashCtx.save();
      flashCtx.shadowColor = "rgba(255, 200, 80, 0.95)";
      flashCtx.shadowBlur = 24;
      flashCtx.fillStyle = "rgba(255, 220, 120, 0.55)";
      flashCtx.beginPath();
      flashCtx.roundRect(redX - redW/2 - 6, opponentY - redH/2 - 6, redW + 12, redH + 12, 8);
      flashCtx.fill();
      flashCtx.restore();
    }
  }
  drawCar(redX, opponentY, redW, redH, "#e94d48");

  // 對手整合資訊面板（名條 + 預告，合而為一，車子正上方）
  if (isStage5() && app.stage5) {
    drawOpponentInfoPanel(redX, opponentY, redW, redH, time);
  }

  // 玩家車（白）：使用 lerp 視覺道位置
  const whiteY = h * 0.80, whiteW = 176;
  const whiteBaseX = laneCarX(app.playerLaneVisual, app.laneCount, whiteY);
  let whiteX = whiteBaseX;
  // 超車 / 防守 QTE：覆蓋為全賽道擺動（無視 lane）、像在搶位
  if (_isFullSwayQte && carMotion) {
    const _bounds = roadLaneBoundsAt(whiteY);
    const _sidePad = whiteW * 0.5 + 6;
    const _minX = _bounds.left + _sidePad;
    const _maxX = _bounds.right - _sidePad;
    if (_maxX > _minX) {
      const _center = (_minX + _maxX) / 2;
      const _half = (_maxX - _minX) / 2;
      whiteX = _center + Math.sin(carSwingPhase(carMotion.white, time)) * _half;
    }
  }
  // 彎道 QTE 維持原本「在道內小幅 sway」效果（你說彎道感覺對）
  else if (app.mode === "bend-qte") {
    const redBaseX = laneCarX(app.opponentLaneVisual, app.laneCount, opponentY);
    const sameLane = Math.abs(redBaseX - whiteBaseX) < 1;
    const playerToOppDir = sameLane ? -1 : (Math.sign(redBaseX - whiteBaseX) || 1);
    const playerSway = Math.sin(time * 0.012) * 14 * playerToOppDir;
    whiteX += playerSway;
  }
  drawCar(whiteX, whiteY, whiteW, 82, "#dceaff");

  // 速度結算飛字：以兩台車車頂為錨點，每個來源一個 pop 往上飄 + 淡出
  drawSpeedPops(time, {
    player:   { x: whiteX,  y: whiteY - 50 },
    opponent: { x: redX,    y: opponentY - 30 },
  });

  // 雨線
  ctx.strokeStyle="rgba(129,180,255,0.22)"; ctx.lineWidth=1;
  for(let i=0;i<60;i++){
    const x=((i*71+time*0.08)%(w+160))-80, y=(i*43+time*0.25)%h;
    ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x-18,y+42); ctx.stroke();
  }

  // 對手行動視覺提示：對手回合期間用大字 banner，回合結束後快速淡出成小字
  if (app.opponentActionFx && time < app.opponentActionFx.until) {
    const inOpponentTurn = (app.mode === "opponent-turn");
    // 區分：有招（紅色警告 banner）vs 沒招（柔和藍色 banner）
    const isIdleTurn = inOpponentTurn && app.opponentTurnAnim && !app.opponentTurnAnim.behavior;
    const alpha = Math.min(1, (app.opponentActionFx.until - time) / 400);
    const isTaunt = app.opponentActionFx.taunt === true;
    const fxColor = isTaunt
      ? `rgba(220,140,255,${alpha})`  // 嘲諷：紫色（戲謔感）
      : app.opponentActionFx.positive
      ? `rgba(100,255,160,${alpha})`
      : `rgba(255,140,140,${alpha})`;

    if (inOpponentTurn) {
      // 對手回合：依「有招/沒招」用不同調性
      const ctx = app.ctx;
      const bannerY = app.h * 0.16;
      const bannerH = isIdleTurn ? 44 : 64;  // 沒招 banner 較矮
      const bannerW = Math.min(app.w * 0.7, isIdleTurn ? 580 : 720);
      const bannerX = (app.w - bannerW) / 2;
      const pulse = 0.5 + 0.5 * Math.abs(Math.sin(time * 0.006));

      // 底板：有招紅、沒招藍
      ctx.save();
      if (isIdleTurn) {
        ctx.shadowColor = `rgba(80, 120, 180, ${0.4 * alpha})`;
        ctx.shadowBlur = 14;
        ctx.fillStyle = `rgba(12, 22, 38, ${0.88 * alpha})`;
      } else {
        ctx.shadowColor = `rgba(255, 60, 60, ${0.5 * alpha})`;
        ctx.shadowBlur = 24;
        ctx.fillStyle = `rgba(40, 8, 8, ${0.92 * alpha})`;
      }
      ctx.beginPath();
      ctx.roundRect(bannerX, bannerY, bannerW, bannerH, 10);
      ctx.fill();
      ctx.strokeStyle = isIdleTurn
        ? `rgba(140, 180, 220, ${0.7 * alpha})`
        : `rgba(255, 100, 100, ${(0.85 + pulse * 0.15) * alpha})`;
      ctx.lineWidth = isIdleTurn ? 1.5 : 2;
      ctx.stroke();
      ctx.restore();

      if (isIdleTurn) {
        // 沒招版本：單行訊息，置中
        text(app.opponentActionFx.label, app.w / 2, bannerY + bannerH/2 + 6, 16,
          `rgba(200, 220, 255, ${alpha})`, "800", "center");
      } else {
        // 有招版本：標題 + 主訊息
        text("⚠ 對手行動", app.w / 2, bannerY + 22, 13,
          `rgba(255, 180, 180, ${0.85 * alpha})`, "800", "center");
        text(app.opponentActionFx.label, app.w / 2, bannerY + 48, 18,
          `rgba(255, 240, 230, ${alpha})`, "900", "center");
      }
    } else {
      // 對手回合結束後：小字淡出（玩家可以繼續看到剛才發生什麼）
      text(app.opponentActionFx.label, app.w / 2, app.h * 0.22, 18,
        fxColor, "800", "center");
    }
  }

  // 後車警示：玩家車後方賽道末端隨機道顯示閃爍驚嘆號
  // 玩家每做一個動作，驚嘆號就 hop 到一條新隨機道，像後車一直找超車空間
  if (app.chaserSpeed != null) {
    const playerSpd = currentLaneSpeed();
    const isThreat = playerSpd < app.chaserSpeed;
    const pulseFx = 0.55 + 0.45 * Math.abs(Math.sin(time * 0.005));

    // 動作改變時 → 重抽目標道（不和上次相同，做出「跳道找空間」的感覺）
    const actCount = app.actionsThisRound ?? 0;
    if (app.chaserLastActCount !== actCount) {
      app.chaserLastActCount = actCount;
      let pick = Math.floor(Math.random() * app.laneCount);
      if (app.laneCount > 1 && pick === app.chaserTargetLane) {
        pick = (pick + 1) % app.laneCount;
      }
      app.chaserTargetLane = pick;
    }
    if (app.chaserTargetLane == null) app.chaserTargetLane = 0;
    if (app.chaserVisualLane == null) app.chaserVisualLane = app.chaserTargetLane;
    // 視覺道用 lerp 平滑跳過去
    app.chaserVisualLane += (app.chaserTargetLane - app.chaserVisualLane) * 0.18;

    // 後車 y 在玩家車正後方（約 0.92h），用 laneCarX 對齊賽道透視
    const chaserY = h * 0.92;
    const cx = laneCarX(app.chaserVisualLane, app.laneCount, chaserY);
    const cy = chaserY;

    const baseAlpha = isThreat ? pulseFx : 0.55;
    const color = isThreat ? `rgba(255,80,80,${baseAlpha})` : `rgba(255,180,80,${baseAlpha*0.85})`;
    // 圓底
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI*2);
    ctx.fillStyle = isThreat ? "rgba(40,8,8,0.9)" : "rgba(28,18,4,0.82)";
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = isThreat ? 2.5 : 2;
    ctx.stroke();
    ctx.restore();
    // 驚嘆號
    text("!", cx, cy + 9, 28, color, "1000", "center");
    // 上方標籤：後車 X
    const labelColor = isThreat
      ? `rgba(255,140,140,${0.85+pulseFx*0.15})`
      : "rgba(220,200,160,0.85)";
    text(`後車 ${app.chaserSpeed}`, cx, cy - 32, 12, labelColor, "900", "center");
  }

  // ─── 拖曳中：整條賽道閃亮邊框 + 提示文字 ─────────────────────────────
  if (app.drag && app.mode === "playing") {
    drawDragHighlight(time, h, horizon);
  }
}

// 拖曳中沿賽道梯形邊框打上閃亮效果 + 在路面中央打提示文字
function drawDragHighlight(time, h, horizon) {
  const ctx = app.ctx;
  // 重建賽道邊界 (drawRace 內 const 變數無法跨函式共用、所以重算)
  const SEGMENTS = 24;
  const ys = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    ys.push(horizon + (h - horizon) * (i / SEGMENTS));
  }
  const bounds = ys.map(yy => roadLaneBoundsAt(yy));

  // 牌懸停在哪一道？
  const dragCx = app.drag.x + app.drag.w/2;
  const dragCy = app.drag.y + app.drag.h/2;
  const hoverLane = laneAtPoint({ x: dragCx, y: dragCy });
  const isHoveringRoad = hoverLane >= 0;

  // 取消區：手牌列 y 範圍附近（牌拖回就取消）
  // 手牌頂端 y = app.h - 190、底端 = h - 190 + 164 = app.h - 26
  // 給 ±60px 緩衝
  const handTop = app.h - 190 - 60;
  const handBottom = app.h - 190 + 164 + 30;
  const isOverCancelZone = dragCy >= handTop && dragCy <= handBottom;

  // 脈動：拖曳時的呼吸效果
  const pulse = 0.55 + Math.sin(time * 0.005) * 0.25;

  // 取消區優先：拖回手牌列、整個賽道淡掉、顯示取消提示
  if (isOverCancelZone) {
    // 淡紅邊框 + 取消提示在牌附近
    ctx.save();
    ctx.shadowColor = `rgba(255, 120, 120, ${pulse})`;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = `rgba(255, 120, 120, ${pulse * 0.8})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(bounds[0].left, ys[0]);
    for (let i = 1; i < bounds.length; i++) ctx.lineTo(bounds[i].left, ys[i]);
    ctx.lineTo(bounds[bounds.length-1].right, ys[ys.length-1]);
    for (let i = bounds.length - 2; i >= 0; i--) ctx.lineTo(bounds[i].right, ys[i]);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();

    // 取消提示 — 在牌的上方
    text("✕ 放回手牌 ‧ 取消打出",
      dragCx, app.drag.y - 18, 18, `rgba(255, 180, 180, ${pulse})`, "900", "center");
    return;
  }

  // 每道分別描邊：當前 hover 那條道亮綠、其他道淡黃（提示也可放）
  const laneCount = app.laneCount || 2;
  ctx.save();
  for (let li = 0; li < laneCount; li++) {
    const isHover = (li === hoverLane);
    const color = isHover
      ? `rgba(120, 255, 160, ${pulse})`
      : `rgba(255, 200, 80, ${pulse * 0.45})`;
    ctx.shadowColor = color;
    ctx.shadowBlur = isHover ? 20 : 8;
    ctx.strokeStyle = color;
    ctx.lineWidth = isHover ? 4 : 2;
    ctx.beginPath();
    for (let i = 0; i < bounds.length; i++) {
      const bd = bounds[i];
      const laneWide = (bd.right - bd.left) / laneCount;
      const lx = bd.left + laneWide * li;
      if (i === 0) ctx.moveTo(lx, ys[i]);
      else ctx.lineTo(lx, ys[i]);
    }
    {
      const bd = bounds[bounds.length - 1];
      const laneWide = (bd.right - bd.left) / laneCount;
      ctx.lineTo(bd.left + laneWide * (li + 1), ys[ys.length - 1]);
    }
    for (let i = bounds.length - 2; i >= 0; i--) {
      const bd = bounds[i];
      const laneWide = (bd.right - bd.left) / laneCount;
      const rx = bd.left + laneWide * (li + 1);
      ctx.lineTo(rx, ys[i]);
    }
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();

  // 車隊牌：只顯示「裝備」單行提示在中央
  const isDragTeamCard = app.drag.card?.cardClass === "team";
  if (isDragTeamCard) {
    const cy = horizon + (h - horizon) * 0.55;
    text("拖到任意處 ‧ 裝備車隊牌",
      app.w / 2, cy, 18, `rgba(140, 255, 200, ${pulse})`, "900", "center");
    return;
  }

  // 每道路面常駐文字提示：道名 + 動作（hover 那道高亮白色、其他道灰色）
  //
  // 配置：
  //   所有道的提示文字統一在同一個 y（玩家車前方）
  //   速度大字（drawCurrentSpeedSign）放在更前面（y 更靠近 horizon）
  const circ = currentCircuit();
  const ty = horizon + (h - horizon) * 0.30;  // 接在速度數字 (t≈0.12~0.26) 下方
  const tBounds = roadLaneBoundsAt(ty);
  const laneWide = (tBounds.right - tBounds.left) / laneCount;

  for (let li = 0; li < laneCount; li++) {
    const isOwnLane = li === app.playerLane;
    const isHover = (li === hoverLane);
    const tx = tBounds.left + laneWide * (li + 0.5);

    // 道名：優先用 circuit 自訂的 laneNames（c8 紅黃綠道），否則用通用名
    let laneName = laneDisplayName(li);

    const actionLabel = isOwnLane ? "打牌" : "換道";
    const fullLabel = `${laneName} ‧ ${actionLabel}`;

    // hover 那道 → 白色 + pulse；其他 → 淡灰常駐
    const labelColor = isHover
      ? `rgba(255, 255, 255, ${pulse})`
      : "rgba(160, 170, 185, 0.5)";
    const labelSize = isHover ? 18 : 14;
    text(fullLabel, tx, ty, labelSize, labelColor, "900", "center");

    // 只有 hover 道顯示詳細資訊（賽道加成 / 強制 QTE / 撞坑）
    // 但 c8 紅綠燈未揭曉的道不要洩漏 label（揭曉後才顯示）
    if (isHover) {
      const subTips = [];
      const isC8Hidden = circ?.hideLaneBonusUntilVisited
        && !(app.stage5?.revealedC8Lanes?.has(li));
      if (!isC8Hidden) {
        const b = getLaneBonusFor(li);
        if (b?.label) subTips.push(b.label);
        if (b?.forceCornerQte) subTips.push("⚡ 強制彎道 QTE");
      } else {
        subTips.push("? 未揭曉");
      }
      if (app.stage5?.potholeLanes?.includes(li)) subTips.push("⚠ 此道有坑");
      subTips.forEach((tip, idx) => {
        text(tip, tx, ty + 24 + idx * 18, 12,
          `rgba(220, 230, 240, ${pulse * 0.85})`, "700", "center");
      });
    }
  }
}


// ─── HUD ───────────────────────────────────────────────────────────────────
function statusHudRect() {
  // 高度從 196 → 250、給每行更多呼吸空間
  return { x: app.w - 300, y: app.h - 250 - 24, w: 276, h: 250 };
}

function drawHud(time) {
  const s = statusHudRect();
  panel(s.x, s.y, s.w, s.h, "rgba(8,18,32,0.88)", "rgba(105,164,224,0.50)");
  const ctx = app.ctx;
  const hr = y => {
    ctx.save(); ctx.strokeStyle="rgba(105,164,224,0.18)"; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(s.x+16,y); ctx.lineTo(s.x+s.w-16,y); ctx.stroke(); ctx.restore();
  };

  // ── 名次 ── (y 30-58)
  text("名次", s.x+20, s.y+34, 13, "rgba(160,190,230,0.65)", "700");
  text(`${app.rank} / ${app.rankTotal}`, s.x+s.w-20, s.y+34, 15, "rgba(214,228,255,0.95)", "900", "right");
  hr(s.y+54);

  // ── 輪胎 ── (y 64-100)
  text("輪胎", s.x+20, s.y+82, 13, "rgba(200,230,255,0.65)", "700");
  for (let i=0; i<app.tiresMax; i++) {
    const alive = i < app.tires;
    roundPanel(s.x+76+i*26, s.y+67, 22, 22, 4,
      alive ? "rgba(255,100,80,0.85)" : "rgba(30,40,60,0.5)",
      alive ? "rgba(255,150,120,0.6)" : "rgba(80,100,130,0.25)", 1.5);
    if (alive) text("●", s.x+76+i*26+11, s.y+82, 12, "rgba(255,220,210,0.95)", "900", "center");
  }
  hr(s.y+110);

  // ── 玩家速度 ── (y 122-160)
  const laneSpd = currentLaneSpeed();
  const laneBonus = getLaneBonusFor(app.playerLane);
  text("速度", s.x+20, s.y+138, 13, "rgba(100,200,255,0.7)", "700");
  if (laneBonus) {
    text(laneBonus.label || "", s.x+20, s.y+152, 9, "rgba(100,200,255,0.55)", "600");
  }
  text(`${laneSpd}`, s.x+s.w-20, s.y+144, 28, "rgba(120,220,255,0.95)", "900", "right");
  hr(s.y+170);

  // ── 對手區 ── (y 182-238)
  const oppSpd = opponentDisplaySpeed();
  const opp = isStage5() ? currentOpponent() : null;
  const s5 = app.stage5;
  const focusMax = opp ? (opp.focus ?? 0) : 0;
  const focusCur = (opp && s5) ? (s5.opponentFocusMap?.[opp.id] ?? 0) : 0;
  const focusBroken = opp && (focusMax === 0 || focusCur === 0);
  const speedEnough = opp && (laneSpd > oppSpd);
  const differentLane = opp && (app.playerLane !== app.opponentLane);
  const canOvertakeNow = focusBroken && speedEnough && differentLane;
  const nameStr = opp?.name || "對手速度";
  const nameColor = canOvertakeNow ? "rgba(120,255,160,0.95)" : "rgba(255,160,160,0.85)";
  text(nameStr, s.x+20, s.y+192, 13, nameColor, "800");
  if (opp) {
    ctx.save();
    ctx.font = `800 ${13 * FONT_SCALE}px system-ui, sans-serif`;
    const nameW = ctx.measureText(nameStr).width;
    ctx.restore();
    if (focusMax > 0) {
      for (let i = 0; i < focusMax; i++) {
        const alive = i < focusCur;
        const dotX = s.x+20 + nameW + 8 + i * 12;
        ctx.fillStyle = alive ? "rgba(255,170,70,0.95)" : "rgba(80,60,40,0.5)";
        ctx.beginPath();
        ctx.arc(dotX, s.y+188, 4, 0, Math.PI*2);
        ctx.fill();
      }
    }
    if (canOvertakeNow) {
      text("!", s.x+20 + nameW + 8, s.y+192, 14, "rgba(120,255,160,0.95)", "900");
    }
  }
  const spdColor = canOvertakeNow ? "rgba(140,255,180,0.95)" : "rgba(255,150,150,0.95)";
  text(`${oppSpd}`, s.x+s.w-20, s.y+200, 26, spdColor, "900", "right");
  if (opp) {
    const hint = computeOpponentNextActionHint("compact");
    const willBoost = hint && hint.boostAmount > 0 && hint.remaining === 1;
    const boost = willBoost ? hint.boostAmount : 0;

    const laneResolved = applyOpponentBonus(oppSpd, app.opponentLane, app.opponentAuraBypassed);
    const nextOppSpd = laneResolved + boost;
    const delta = nextOppSpd - oppSpd;

    const arrowColor = delta > 0 ? "rgba(255,150,140,0.95)"
                     : delta < 0 ? "rgba(140,230,170,0.95)"
                     :             "rgba(180,200,220,0.6)";
    const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
    const predictStr = delta === 0 ? `下動 → ${nextOppSpd}`
                                   : `下動 → ${nextOppSpd}（${deltaStr}）`;
    text(predictStr, s.x+s.w-20, s.y+228, 11, arrowColor, "800", "right");
  }
}

// ─── 多道格子繪製 ──────────────────────────────────────────────────────────
function drawLanes(time) {
  const laneCount = app.laneCount;
  const laneW = Math.min(240, (app.w - 320) / laneCount - 12);
  const laneH = 170;
  const gap = 14;
  const totalW = laneCount * laneW + (laneCount-1) * gap;
  const baseX = (app.w - totalW) / 2;
  const handY = app.h - 190;
  const baseY = handY - laneH - 30;

  const canDropToLane = (i) => true;
  app.zones.lanes = [];

  for (let i=0; i<laneCount; i++) {
    const x = baseX + i*(laneW+gap);
    const y = baseY;
    const droppable = canDropToLane(i);
    // zone 永遠存在（供 overlay spotlight + 拖曳預覽用）
    app.zones.lanes[i] = { x, y, w: laneW, h: laneH, droppable };

    // 道格視覺完全拿掉。判定區改成「整條賽道」（用 laneAtPoint 在 mouseup 處理）。
    // 只保留：
    //   - 拖曳中、牌懸停在這道的「速度預覽 + 警告」（地面 AR 顯示已包含、但若有彎道警告也補在這裡）
    //   - 道格邊框與背景全不畫
    if (!app.drag) continue;

    // 預覽計算（為地面 AR 速度標誌服務 + 彎道警告）
    const isDragTeamCard = app.drag.card?.cardClass === "team";
    if (isDragTeamCard) continue;

    const curCirc2 = currentCircuit();
    const c8HideMode2 = !!(curCirc2 && curCirc2.hideLaneBonusUntilVisited);
    const c8Hidden2 = c8HideMode2 && app.stage5 && app.stage5.revealedC8Lanes && !app.stage5.revealedC8Lanes.has(i);

    const bonusData2 = getLaneBonusFor(i);
    const speedLimit = bonusData2?.speedLimit ?? null;

    // 牌在這道上方？
    const dragCx = app.drag.x + app.drag.w/2;
    const dragCy = app.drag.y + app.drag.h/2;
    // 用整個賽道判定（laneAtPoint）而不是道格 rect
    const hoverLane = laneAtPoint({ x: dragCx, y: dragCy });
    const hovering = (hoverLane === i);

    if (!hovering) continue;

    // 計算 preview speed（跟原邏輯一致、供彎道警告判斷）
    const b = getLaneBonusFor(i);
    const add = c8Hidden2 ? 0 : (b?.add ?? 0);
    const mult = c8Hidden2 ? 1 : (b?.mult ?? 1);
    let previewSpeed = app.playerSpeed;
    if (i === app.playerLane) {
      const cardSpd = app.drag.card.speedValue ?? 0;
      const slipBonus = canGetSlipstreamAtLane(i) ? 30 : 0;
      previewSpeed = Math.floor((app.playerSpeed + cardSpd + slipBonus + add) * mult);
    } else if (droppable && app.playerSpeed > 0) {
      const slipBonus = canGetSlipstreamAtLane(i) ? 30 : 0;
      const lanesCrossed = Math.abs(i - app.playerLane);
      const laneCost = laneChangeCost(lanesCrossed);
      previewSpeed = Math.floor((app.playerSpeed - laneCost + slipBonus + add) * mult);
    }
    const overLimit = speedLimit !== null && previewSpeed > speedLimit;

    // 彎道警告（用 AR 風格、印在牌上方）
    if (overLimit) {
      text(`⚠ 彎道 QTE！限 ${speedLimit}`,
        app.drag.x + app.drag.w/2, app.drag.y - 14, 13,
        "rgba(255,140,100,0.98)", "800", "center");
    }
  }

  // 超車按鈕 + Pass 按鈕：放在玩家車右側（畫面中下、HUD 之前）
  // 玩家車大約在 app.w/2、右下 HUD 起點約 app.w - 300
  // 兩個按鈕排在這段間距、貼著畫面下緣稍高一點
  const overtakeW = 180;   // 超車鈕加大（原 130）
  const passW     = 110;
  const btnH      = 52;    // 高度也加大（原 40）
  const btnGap    = 10;
  const totalBtnW = overtakeW + btnGap + passW;
  const btnX0     = app.w/2 + 140;  // 玩家車右側起算（車寬 ~120，車右緣約 +60、再外推 80）
  const btnY      = app.h - 260;  // 比手牌頂端 (app.h - 190) 高 70px
  // 若按鈕區會撞到右下 HUD，整體往左收
  const maxRight  = app.w - 320;  // HUD 起點再留 20px 邊距
  const actualBtnX0 = Math.min(btnX0, maxRight - totalBtnW);

  // 自由打牌階段：超車按鈕跟 Pass 按鈕都永遠顯示
  // 飛字播放期間（閘門等待中）也要隱藏，跟手牌一起讓玩家專注看結算
  const isFreePlayPhase = (app.mode === "playing" || app.mode === "prompt-overtake-or-pass") && !app.inputLocked;

  if (isFreePlayPhase) {
    const laneSpd = currentLaneSpeed();
    const sameLane = app.playerLane === app.opponentLane;
    const lbl = sameLane ? "先換道才能超車"
              : canDirectOvertake() ? "✓ 超車 QTE"
              : `超車（差 ${app.opponentSpeed - laneSpd}）`;
    button("btn-overtake", lbl, actualBtnX0, btnY, overtakeW, btnH,
      !canDirectOvertake(),
      canDirectOvertake() ? "start" : "primary");

    button("btn-pass", "Pass →", actualBtnX0 + overtakeW + btnGap, btnY, passW, btnH, false, "gray");
  }

  // 對手行動倒數圖示
  drawOpponentActionCounter(baseX + totalW + 16, baseY, time);
}

// ─── 對手整合資訊面板（名條 + 預告，車子正上方） ───────────────────────
// 結構（上到下）：
//   [可超車！文字（專注度=0 時）]
//   ┌──────────────────────────┐
//   │ ⚠ 技能 (3 動後)          │  ← 預告區（強招 / 全部）
//   │ 切到你道+加速             │
//   ├──────────────────────────┤
//   │ 名字              ●●●●    │  ← 名條 + 專注度
//   └──────────────────────────┘
function drawOpponentInfoPanel(redX, opponentY, redW, redH, time) {
  const opp = currentOpponent();
  if (!opp) return;
  const s5 = app.stage5;
  const ctx = app.ctx;
  const focusMax = opp.focus ?? 0;
  const focusCur = s5.opponentFocusMap[opp.id] ?? 0;
  const hasBigData = s5.teamCardsActive.some(c => c.effect === "showOpponent");

  // 查預告資訊（取自 drawOpponentNextActionHint 的邏輯）
  const hint = computeOpponentNextActionHint(hasBigData ? "full" : "compact");

  // 面板尺寸（大數據預測啟動時加寬給 label 用）
  const plateW = hasBigData ? 240 : 180;
  const nameRowH = 28;            // 名字 + 專注度的高度
  const hintRowH = hint ? 36 : 0; // 預告區高度（有招才顯示）
  const plateH = nameRowH + hintRowH;
  const plateX = redX - plateW / 2;
  const plateY = opponentY - redH / 2 - plateH - 10;

  // 整體底板（兩區共用）
  const isStrong = hint?.weight === "strong";
  const borderColor = focusCur === 0
    ? "rgba(100,255,160,0.75)"
    : isStrong
      ? "rgba(255,120,120,0.85)"
      : "rgba(220,80,60,0.75)";

  ctx.save();
  // 強招時整面板加紅光暈
  if (isStrong) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.008);
    ctx.shadowColor = `rgba(255, 80, 80, ${0.6 * pulse})`;
    ctx.shadowBlur = 18;
  }
  ctx.fillStyle = "rgba(6,12,24,0.92)";
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(plateX, plateY, plateW, plateH, 8);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();

  // 預告區（上半）
  if (hint) {
    const hintY = plateY;
    const isStrong2 = hint.weight === "strong";

    const icons = hint.icons || [];
    const intentColor = hint.intent === "block"     ? "rgba(255,150,150,0.95)"
                      : hint.intent === "flee"      ? "rgba(150,220,255,0.95)"
                      : hint.intent === "disrupted" ? "rgba(255,180,100,0.95)"
                      :                               "rgba(220,220,220,0.85)";

    // ─── 左半：剩餘動數 + 「動後」+ icons + (label if bigData) ───
    let cursorX = plateX + 12;
    const iconW = 24;

    // 剩餘動數
    text(`${hint.remaining}`, cursorX, hintY + 20, 18,
      isStrong2 ? "rgba(255,200,200,0.95)" : "rgba(255,220,140,0.95)", "900", "left");
    ctx.save();
    ctx.font = `900 ${18 * FONT_SCALE}px system-ui, sans-serif`;
    cursorX += ctx.measureText(`${hint.remaining}`).width + 4;
    ctx.restore();

    // 「動後」
    text("動後", cursorX, hintY + 22, 10,
      "rgba(220,240,255,0.7)", "700", "left");
    ctx.save();
    ctx.font = `700 ${10 * FONT_SCALE}px system-ui, sans-serif`;
    cursorX += ctx.measureText("動後").width + 4;
    ctx.restore();

    // icons + 記錄 rect 用於 tooltip hit-test
    const iconRects = [];
    for (const ic of icons) {
      const isIntentIcon = (ic === "⛔" || ic === "💨" || ic === "❓" || ic === "❗");
      const col = isIntentIcon ? intentColor : "#ffffff";
      text(ic, cursorX, hintY + 24, 20, col, "900", "left");
      iconRects.push({
        x: cursorX - 2, y: hintY + 6,
        w: iconW, h: 24,
        icon: ic,
        intent: hint.intent,
      });
      cursorX += iconW;
    }
    app._opponentHintIconRects = iconRects;

    // bigData label
    if (hint.label) {
      text(hint.label, cursorX + 4, hintY + 22, 10, "rgba(180,230,255,0.95)", "700", "left");
    }

    // ─── 最右：+加速量（只在 boostAmount > 0 時顯示）───
    if (hint.boostAmount > 0) {
      const boostStr = `+${hint.boostAmount}`;
      const boostColor = isStrong2 ? "rgba(255,180,100,0.98)" : "rgba(255,210,120,0.95)";
      const rightX = plateX + plateW - 10;
      text(boostStr, rightX, hintY + 22, 14, boostColor, "900", "right");
    }

    // 兩區之間的分隔線
    ctx.save();
    ctx.strokeStyle = "rgba(150,170,200,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plateX + 8, plateY + hintRowH);
    ctx.lineTo(plateX + plateW - 8, plateY + hintRowH);
    ctx.stroke();
    ctx.restore();
  }

  // 名條區（下半）
  const nameY = plateY + hintRowH;
  text(opp.name, plateX + 14, nameY + 18, 14, "rgba(255,220,200,0.95)", "900", "left");
  // 光環狀態指示（B 清道夫專用）
  if (isOpponentAuraActive()) {
    // 名字後面加一個 ✦ 光環標籤
    const auraText = app.opponentAuraBypassed ? "✦光環(豁免)" : "✦光環";
    const auraColor = app.opponentAuraBypassed
      ? "rgba(255,200,100,0.95)"
      : "rgba(255,140,200,0.95)";
    const nameWidth = opp.name.length * 14 + 4;
    text(auraText, plateX + 14 + nameWidth, nameY + 18, 10, auraColor, "800", "left");
  }

  // 專注度圓點列（右側）
  if (focusMax > 0) {
    const dotR = 5, dotGap = 5;
    const totalDotsW = focusMax * dotR * 2 + (focusMax - 1) * dotGap;
    const dotStartX = plateX + plateW - 12 - totalDotsW + dotR;
    const dotY = nameY + 14;
    for (let di = 0; di < focusMax; di++) {
      const alive = di < focusCur;
      const dx = dotStartX + di * (dotR * 2 + dotGap);
      ctx.save();
      ctx.fillStyle   = alive ? "rgba(255,150,50,0.95)" : "rgba(50,35,15,0.8)";
      ctx.strokeStyle = alive ? "rgba(255,200,100,0.85)" : "rgba(90,65,30,0.4)";
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.arc(dx, dotY, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  // 專注度歸零：「可超車！」（在面板上方）
  if (focusCur === 0 && canDirectOvertake()) {
    const pulse = 0.65 + Math.sin(time * 0.007) * 0.35;
    ctx.save();
    ctx.strokeStyle = `rgba(100,255,160,${pulse * 0.6})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.roundRect(plateX - 2, plateY - 2, plateW + 4, plateH + 4, 9);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    text("可超車！", redX, plateY - 10, 12, `rgba(100,255,160,${pulse})`, "900", "center");
  }

  // 滑鼠 hover icon → 繪製 tooltip
  if (app.mouse && app._opponentHintIconRects) {
    for (const r of app._opponentHintIconRects) {
      if (inRect(app.mouse, r)) {
        drawOpponentIconTooltip(r, plateX, plateY);
        break;
      }
    }
  }
}

// 對手意圖 icon tooltip
function drawOpponentIconTooltip(rect, plateX, plateY) {
  const ctx = app.ctx;
  let title = "";
  let desc = "";
  if (rect.icon === "⛔") {
    title = "阻擋";
    desc = "對手會移動到你當前的道";
  } else if (rect.icon === "💨") {
    title = "遠離";
    desc = "對手會避開你當前的道";
  } else if (rect.icon === "❓") {
    title = "未知";
    desc = "對手選自己最快路線、或隨機切道，無法預測";
  } else if (rect.icon === "❗") {
    title = "賽道干擾";
    desc = "賽道有坑洞或油污，對手原意圖可能被打亂、結果不確定";
  } else if (rect.icon === "⚡") {
    title = "特殊行動";
    desc = "對手會加速、豁免光環、或取 abs 加成";
  } else {
    return;
  }
  // tooltip 尺寸：依文字寬度自動縮放
  const padX = 12;  // 左右內距
  ctx.save();
  ctx.font = `900 ${13 * FONT_SCALE}px system-ui, sans-serif`;
  const titleW = ctx.measureText(title).width;
  ctx.font = `600 ${11 * FONT_SCALE}px system-ui, sans-serif`;
  const descW = ctx.measureText(desc).width;
  ctx.restore();
  const tipW = Math.max(titleW, descW) + padX * 2;
  const tipH = 52;
  // 位置：icon 上方、置中
  let tx = rect.x + rect.w / 2 - tipW / 2;
  let ty = rect.y - tipH - 6;
  // 邊界保護
  if (tx < 8) tx = 8;
  if (tx + tipW > app.w - 8) tx = app.w - tipW - 8;
  if (ty < 8) ty = rect.y + rect.h + 6;  // 上方放不下、改放下方
  // 背景
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 8;
  ctx.fillStyle = "rgba(20,28,44,0.96)";
  ctx.strokeStyle = "rgba(180,200,230,0.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(tx, ty, tipW, tipH, 6);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // 文字
  text(title, tx + padX, ty + 18, 13, "rgba(255,220,180,0.98)", "900", "left");
  text(desc, tx + padX, ty + 38, 11, "rgba(220,230,250,0.88)", "600", "left");
}

// 計算對手下一招的預告資訊（資料邏輯，純函式，無繪製）
// 回傳：{ remaining, weight, action, icons[], label, hasMove, hasSpecial } | null
//   icons: 顯示用 icon 陣列，移動類在前、特殊類在後
//   mode:
//     "compact" — 預設：只顯示 icon 跟倒數，不顯示細節
//     "full"    — 大數據預測車隊牌：顯示細節描述
function computeOpponentNextActionHint(mode = "compact") {
  let nextAct = null;
  let remaining = null;
  let nextWeight = null;
  // 新格式：冷卻系統 — 永遠看所有招（不再過濾強招）
  if (app.opponentBehaviors && app.opponentBehaviorLastTriggered) {
    const actN = app.actionsThisRound ?? 0;
    let minRem = Infinity;
    for (const b of app.opponentBehaviors) {
      const lastAt = app.opponentBehaviorLastTriggered[b.id] ?? -Infinity;
      // 至少 1：「0 動後」會讓玩家困惑（明明剛剛才出招）
      // 實際語意是「下一動就會觸發」→ 顯示 1
      const rem = Math.max(1, b.cooldown - (actN - lastAt));
      if (rem < minRem) {
        minRem = rem;
        nextAct = b;
      } else if (rem === minRem && nextAct) {
        // 同 CD 比較：跟 triggerOpponentActions 一致，挑 weight 強的
        const weightRank = { strong: 3, medium: 2, weak: 1 };
        if ((weightRank[b.weight] || 0) > (weightRank[nextAct.weight] || 0)) {
          nextAct = b;
        }
      }
    }
    if (!nextAct || minRem === Infinity) return null;
    remaining = minRem;
    nextWeight = nextAct.weight;
  } else {
    if (!app.opponentActionsThisStage) return null;
    const actions = app.opponentActionsThisStage;
    const curN = app.actionsThisRound || 0;
    for (const a of actions) {
      if (a.onActionN > curN) {
        if (!nextAct || a.onActionN < nextAct.onActionN) nextAct = a;
      }
    }
    if (!nextAct) return null;
    remaining = nextAct.onActionN - curN;
  }
  // 分類：是否含移動 / 是否含特殊效果
  let hasMove = false;
  let hasSpecial = false;
  if (nextAct.action === "moveTo" || nextAct.action === "moveSmart" || nextAct.action === "moveAdjacent") {
    hasMove = true;
  }
  if (nextAct.action === "boost") {
    hasSpecial = true;  // 純加速 = 特殊
  }
  if (nextAct.boostAfter) {
    hasSpecial = true;  // moveTo + boostAfter = 混合
  }
  if (nextAct.bypassAura) {
    hasSpecial = true;  // moveSmart bypassAura = 混合（豁免=特殊）
  }
  if (nextAct.absBonus) {
    hasSpecial = true;  // stay + absBonus = 特殊（清道夫強招）
  }
  // 計算「意圖」：對玩家是阻擋 / 遠離 / 不確定
  //   參考基準：玩家動作前所在道（對手 AI 用這個當目標）
  let intent = null;  // "block" | "flee" | "unknown"
  const playerRef = (isStage5() && app.playerLaneBeforeAction != null)
    ? app.playerLaneBeforeAction
    : app.playerLane;
  if (nextAct.action === "moveTo") {
    if (nextAct.target === "playerLane") {
      intent = "block";  // 必切到玩家動作前道
    } else if (typeof nextAct.target === "number") {
      intent = (nextAct.target === playerRef) ? "block" : "flee";
    }
  } else if (nextAct.action === "moveSmart") {
    if (nextAct.strategy === "avoidPlayer") {
      intent = "flee";  // 必避開玩家動作前道
    } else if (nextAct.strategy === "dynamicAvoidOrBlock") {
      // 玩家已吃尾流 → block；否則 flee
      const slipstreamConsumed = app.stage5?.slipstreamUsed === true;
      intent = slipstreamConsumed ? "block" : "flee";
    } else {
      intent = "unknown";  // bestForSelf：看當下道路、不確定
    }
  } else if (nextAct.action === "moveAdjacent") {
    intent = "unknown";  // 隨機相鄰
  }
  // ─ 賽道特殊機制干擾意圖：若對手「會去的道」受賽道機制影響、AI 會繞開，
  //   原本的 block/flee 標籤就可能是錯的 → 降級為 disrupted（與 unknown 區分）。
  //   disrupted 顯示為 ❗（賽道干擾）、unknown 顯示為 ❓（策略本身不可預測）
  //   例外：清道夫（B）的光環免疫所有賽道災害、預告維持原意圖、不降級 ─
  const s5 = isStage5() ? app.stage5 : null;
  const potholes = s5?.potholeLanes || [];
  const hasPotholes = potholes.length > 0;
  // 是否有 forceCornerQte 道（油污 c6）
  const hasForceQte = app.laneBonuses && app.laneBonuses.some(b => b.forceCornerQte);
  // 清道夫光環免疫災害 → 預告不降級
  const oppImmuneToHazards = isOpponentAuraActive();
  if (!oppImmuneToHazards && (hasPotholes || hasForceQte) && (intent === "block" || intent === "flee" || intent === "unknown")) {
    // 預測對手會落在哪一道
    let targetLane = null;
    if (nextAct.action === "moveTo") {
      if (nextAct.target === "playerLane") targetLane = playerRef;
      else if (typeof nextAct.target === "number") targetLane = nextAct.target;
    } else if (nextAct.action === "moveSmart") {
      // moveSmart 在「有災害的賽段」全面降級：AI 選道空間被災害道影響、不再純粹照 strategy 走
      //   - bestForSelf（破風者）：可能選到坑洞道或避開、結果不確定
      //   - 其他 strategy：同樣會被災害排擠、結果不純粹
      intent = "disrupted";
    }
    // moveTo 鎖定目標道 → 若目標道是坑洞 → AI 不一定真的會撞坑
    if (targetLane != null && potholes.includes(targetLane)) {
      intent = "disrupted";
    }
  }
  // 油污 forceCornerQte 道：對手 50% 機率觸發 QTE 後滑開
  // → 若目標道有 forceCornerQte、結果不可預測（含落在哪、含速度差）
  // 例外：清道夫光環免疫災害、不降級
  if (!oppImmuneToHazards && (intent === "block" || intent === "flee")) {
    let targetLane = null;
    if (nextAct.action === "moveTo") {
      if (nextAct.target === "playerLane") targetLane = playerRef;
      else if (typeof nextAct.target === "number") targetLane = nextAct.target;
    }
    if (targetLane != null && app.laneBonuses) {
      const lb = app.laneBonuses.find(b => b.lane === targetLane);
      if (lb?.forceCornerQte) intent = "disrupted";
    }
  }
  // icon 並排：移動意圖在前（取代 →）、特殊在後
  const icons = [];
  if (hasMove) {
    icons.push(intent === "block"     ? "⛔"
             : intent === "flee"      ? "💨"
             : intent === "disrupted" ? "❗"
             :                          "❓");
  }
  if (hasSpecial) icons.push("⚡");
  // 細節描述（full mode 才用）
  let label = "";
  if (mode === "full") {
    if (nextAct.action === "moveTo") {
      let base;
      if (nextAct.target === "playerLane") {
        base = nextAct.boostAfter ? "切到你道+加速" : "切到你道";
      } else {
        base = nextAct.boostAfter ? "切道+加速" : "切道";
      }
      if (nextAct.absBonus) base += "+abs";
      else if (nextAct.bypassAura) base += "+豁免";
      label = base;
    } else if (nextAct.action === "moveSmart") {
      let baseLabel;
      if (nextAct.strategy === "avoidPlayer") baseLabel = "躲開你";
      else if (nextAct.strategy === "dynamicAvoidOrBlock") {
        const slipstreamConsumed = app.stage5?.slipstreamUsed === true;
        baseLabel = slipstreamConsumed ? "切到你道" : "躲開你";
      }
      else baseLabel = "搶最快道";
      label = nextAct.bypassAura ? `${baseLabel}+豁免` : baseLabel;
      if (nextAct.boostAfter) label += `+加速${nextAct.boostAfter}`;
    } else if (nextAct.action === "moveAdjacent") {
      label = "隨機切道";
    } else if (nextAct.action === "boost") {
      label = `加速 +${nextAct.amount || 1}`;
    }
  }
  return {
    remaining,
    weight: nextWeight,
    action: nextAct.action,
    icons,
    label,
    hasMove,
    hasSpecial,
    intent,
    // 對手下一招會加多少速度（boostAfter 或 boost.amount）；0 = 不加速
    boostAmount: nextAct.boostAfter ?? (nextAct.action === "boost" ? (nextAct.amount || 0) : 0),
  };
}

// ─── 對手行動倒數圖示 ──────────────────────────────────────────────────────
// 大數據預測：對手車頭飄圖示，預告下一個未觸發的對手行動
// mode:
//   "strongOnly" — 預設：只顯示「強招」的倒數，弱招不告訴（保留意外）
//   "full"       — 大數據預測車隊牌：顯示所有招的下一個（含弱招、含詳細參數）
function drawOpponentNextActionHint(cx, carTopY, time, mode = "strongOnly") {
  let nextAct = null;
  let remaining = null;
  let nextWeight = null;
  // ─── 新格式：冷卻系統 ──────────────────────────────────────────────
  if (app.opponentBehaviors && app.opponentBehaviorLastTriggered) {
    const actN = app.actionsThisRound ?? 0;
    let minRem = Infinity;
    for (const b of app.opponentBehaviors) {
      // strongOnly 模式：只看強招
      if (mode === "strongOnly" && b.weight !== "strong") continue;
      const lastAt = app.opponentBehaviorLastTriggered[b.id] ?? -Infinity;
      const rem = Math.max(0, b.cooldown - (actN - lastAt));
      if (rem < minRem) {
        minRem = rem;
        nextAct = b;
      } else if (rem === minRem && nextAct) {
        const weightRank = { strong: 3, medium: 2, weak: 1 };
        if ((weightRank[b.weight] || 0) > (weightRank[nextAct.weight] || 0)) {
          nextAct = b;
        }
      }
    }
    if (!nextAct || minRem === Infinity) return;
    remaining = minRem;
    nextWeight = nextAct.weight;
  } else {
    if (!app.opponentActionsThisStage) return;
    const actions = app.opponentActionsThisStage;
    const curN = app.actionsThisRound || 0;
    for (const a of actions) {
      if (a.onActionN > curN) {
        if (!nextAct || a.onActionN < nextAct.onActionN) nextAct = a;
      }
    }
    if (!nextAct) return;
    remaining = nextAct.onActionN - curN;
  }
  // 圖示文字
  let icon = "?";
  let label = "";
  if (mode === "strongOnly") {
    // 預設模式：只報強招、不報詳情
    icon = "⚠";
    label = "強招！";
  } else {
    // full 模式：完整資訊
    if (nextAct.action === "moveTo") {
      icon = "→";
      if (nextAct.target === "playerLane") {
        label = nextAct.boostAfter ? "切到你道+加速" : "切到你道";
      } else {
        label = nextAct.boostAfter ? "切道+加速" : "切道";
      }
    } else if (nextAct.action === "moveSmart") {
      icon = "⇄";
      label = nextAct.strategy === "avoidPlayer" ? "躲開你" : "搶最快道";
    } else if (nextAct.action === "moveAdjacent") {
      icon = "↔";
      label = "隨機切道";
    } else if (nextAct.action === "boost") {
      icon = "⚡";
      label = `加速 +${nextAct.amount || 1}`;
    }
  }
  // 飄浮動畫
  const t = time * 0.003;
  const floatY = Math.sin(t * 2) * 3;
  const hintY = carTopY - 50 + floatY;
  // 背景泡泡（強招用紅色，否則用藍色）
  const ctx = app.ctx;
  const hintW = 120, hintH = 34;
  const hintX = cx - hintW/2;
  const isStrong = nextWeight === "strong";
  const bubbleColor = isStrong ? "rgba(220, 60, 60, 0.94)" : "rgba(80, 180, 230, 0.92)";
  const borderColor = isStrong ? "rgba(255, 160, 160, 0.95)" : "rgba(160, 220, 255, 0.95)";
  ctx.save();
  // 強招時加紅光暈
  if (isStrong) {
    const pulse = 0.6 + 0.4 * Math.sin(time * 0.008);
    ctx.shadowColor = `rgba(255, 80, 80, ${pulse})`;
    ctx.shadowBlur = 14;
  }
  // 泡泡底
  ctx.fillStyle = bubbleColor;
  roundedRectPath(ctx, hintX, hintY, hintW, hintH, 8);
  ctx.fill();
  ctx.shadowBlur = 0;
  // 邊框
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1.5;
  roundedRectPath(ctx, hintX, hintY, hintW, hintH, 8);
  ctx.stroke();
  // 圖示
  text(icon, hintX + 14, hintY + 24, 20, "#ffffff", "900", "left");
  // 預告文字
  text(`${remaining} 動後`, hintX + 38, hintY + 14, 10, "rgba(220,240,255,0.85)", "700", "left");
  text(label, hintX + 38, hintY + 28, 12, "#ffffff", "900", "left");
  // 指向車的小三角
  ctx.fillStyle = bubbleColor;
  ctx.beginPath();
  ctx.moveTo(cx - 6, hintY + hintH);
  ctx.lineTo(cx + 6, hintY + hintH);
  ctx.lineTo(cx, hintY + hintH + 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawOpponentActionCounter(x, y, time) {
  // 對手車頭已有預告 UI（drawOpponentNextActionHint），HUD 不重複
  if (app.opponentBehaviors && app.opponentBehaviorLastTriggered) return;
  return;
}

// ─── 手牌 ──────────────────────────────────────────────────────────────────
function drawHand(time) {
  // 手牌縮疊配置：
  //   平時：縮疊重疊在一起（玩家看得到輪廓）
  //   滑鼠掠過：依距離放大（Apple Dock 風格）
  //   拖曳中：完全展開、不縮疊（避免抖動）
  const cardW = 122;
  const cardH = 164;
  const collapseGap = 88;        // 平時兩張中心距 88（縮小牌 ~80 寬 + 8 空隙）
  const expandGap = 18;          // 全展開時的基礎間距（鄰張之間都有空隙）
  const hoverPushExtra = 36;     // 滑鼠掠過那張左右鄰居會被多推開的距離
  const isDragging = !!app.drag;
  const handLen = app.hand.length;
  if (handLen === 0) { app.zones.cards = []; return; }

  const mouseY = app.mouse?.y ?? -9999;
  const y = app.h - 190;
  const cardBottom = y + cardH;
  // 滑鼠在手牌區附近（包含拖曳時、牌掠過手牌列也算）
  const draggedCardX = app.drag ? (app.drag.x + app.drag.w / 2) : null;
  const draggedCardY = app.drag ? (app.drag.y + app.drag.h / 2) : null;
  const hoverX = isDragging ? draggedCardX : (app.mouse?.x ?? null);
  const hoverY = isDragging ? draggedCardY : (app.mouse?.y ?? -9999);
  const isInHandArea = hoverY > y - 30 && hoverY < cardBottom + 30;

  // 算每張牌的「目標展開程度」(0=完全縮疊、1=完全展開)
  //   滑鼠 / 拖曳牌 在手牌區附近 → dock 效果（依距離擴張）
  //   其他情況 → 全縮攏
  const handCenterX = app.w / 2;
  const targetE = new Array(handLen).fill(0);

  if (isInHandArea && hoverX != null) {
    // 用 collapse 排版算每張的中心 x、依距離計算 expand
    const collapsedTotalW = (handLen - 1) * collapseGap + cardW;
    const collapsedLeft = handCenterX - collapsedTotalW / 2;
    const FALLOFF = 140;
    for (let i = 0; i < handLen; i++) {
      const cardCenterCollapsed = collapsedLeft + collapseGap * i + cardW / 2;
      const dist = Math.abs(hoverX - cardCenterCollapsed);
      const e = Math.max(0, 1 - dist / FALLOFF);
      targetE[i] = e * e * (3 - 2 * e);
    }
  }

  // 平滑過渡：app.handExpandness 持久存、用 lerp 漸近目標
  if (!app.handExpandness) app.handExpandness = [];
  // 長度變化（抽牌 / 打牌）時調整陣列長度、保留現有狀態
  while (app.handExpandness.length < handLen) app.handExpandness.push(0);
  while (app.handExpandness.length > handLen) app.handExpandness.pop();
  const lerpRate = 0.22;  // 越大越快、越小越緩
  const expandness = app.handExpandness;
  for (let i = 0; i < handLen; i++) {
    expandness[i] += (targetE[i] - expandness[i]) * lerpRate;
    if (Math.abs(expandness[i] - targetE[i]) < 0.001) expandness[i] = targetE[i];
  }

  // 計算每張牌的位置
  // 排除被拖那張、其他牌索引重新編號（讓剩下的牌真的「併攏填補」）
  const visibleIdxs = [];
  for (let i = 0; i < handLen; i++) {
    if (app.drag && app.drag.card.id === app.hand[i].id) continue;
    visibleIdxs.push(i);
  }
  const visibleLen = visibleIdxs.length;

  function spacingBetween(vi, vj) {
    const ai = visibleIdxs[vi];
    const aj = visibleIdxs[vj];
    const neighborE = Math.max(expandness[ai], expandness[aj]);
    const baseSpacing = collapseGap + (cardW + expandGap - collapseGap) * neighborE;
    const pushExtra = neighborE * hoverPushExtra;
    return baseSpacing + pushExtra;
  }

  const positions = new Array(handLen);  // 對應原 hand 索引
  if (visibleLen > 0) {
    // 算總寬度先（用於置中）
    let totalW = cardW;
    for (let i = 1; i < visibleLen; i++) {
      totalW += spacingBetween(i - 1, i);
    }
    let cur = handCenterX - totalW / 2;
    for (let i = 0; i < visibleLen; i++) {
      positions[visibleIdxs[i]] = cur;
      if (i < visibleLen - 1) {
        cur += spacingBetween(i, i + 1);
      }
    }
  }

  // 牌大小也依 expandness 變化（平時 95%、最大 110%）
  app.zones.cards = [];
  app.hand.forEach((card, i) => {
    if (app.drag && app.drag.card.id === card.id) return;
    const e = expandness[i];
    const scale = 0.95 + e * 0.15;  // 0.95 ~ 1.10
    const w = cardW * scale;
    const h = cardH * scale;
    // 牌往上抬一點點當 hover 視覺
    const liftY = e * 12;
    const rect = { x: positions[i] + (cardW - w) / 2, y: y - liftY, w, h };
    app.zones.cards.push({ card, index: i, rect });
    drawCard(card, rect.x, rect.y, rect.w, rect.h, false);
  });
}

// 圓角矩形 path（給 clip 跟手動描邊用）
function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);
  ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}

// ─── 卡牌繪製（簡化版，保留 Sam 的圖示風格）──────────────────────────────
function drawCard(card, x, y, w, h, dragging) {
  const ctx = app.ctx;
  const isTactic = card.cardClass === "tactic";
  const isTeam = card.cardClass === "team";

  const bg    = dragging   ? "rgba(14,28,50,0.98)"
              : isTactic   ? "rgba(28,18,8,0.96)"
              : isTeam     ? "rgba(14,32,22,0.96)"
              :              "rgba(14,28,50,0.96)";
  const border = isTactic   ? "rgba(255,180,60,0.75)"
              : isTeam     ? "rgba(120,220,160,0.75)"
              :               "rgba(105,164,224,0.55)";
  roundPanel(x, y, w, h, 10, bg, border, dragging ? 2.5 : 2);

  // 卡牌類型標籤
  const typeLabel = isTactic ? "戰術" : isTeam ? "車隊" : "動作";
  const typeColor = isTactic ? "rgba(255,180,60,0.8)"
                  : isTeam   ? "rgba(120,220,160,0.85)"
                  :            "rgba(100,180,255,0.7)";
  textRaw(typeLabel, x+w/2, y+16, 10, typeColor, "700", "center");

  // 車隊牌：持續性標籤放右上角（避免跟 note 打架）
  if (isTeam && card.persistenceLabel) {
    const tagText = card.persistenceLabel;
    const tagFs = 9;
    const ctx2 = app.ctx;
    ctx2.save();
    ctx2.font = `800 ${tagFs}px system-ui`;
    const tagW = ctx2.measureText(tagText).width + 10;
    ctx2.restore();
    roundPanel(x + w - tagW - 4, y + 4, tagW, 16, 4,
      "rgba(60,120,90,0.65)", "rgba(140,220,180,0.6)", 1);
    textRaw(tagText, x + w - tagW/2 - 4, y + 15, tagFs, "rgba(220,255,235,0.95)", "800", "center");
  }

  // 卡名
  textRaw(card.name, x+w/2, y+42, 15, "#e8f0ff", "900", "center");

  // 輪胎消耗標記（只有超加速有 tireCost）
  if (card.tireCost) {
    roundPanel(x+w-26, y+4, 22, 22, 5, "rgba(60,10,10,0.9)", "rgba(255,80,60,0.7)", 1.5);
    textRaw("🔴", x+w-15, y+19, 11, "#ff8060", "900", "center");
  }

  // 中央大字：速度數值（v0.9 UI 改動 — 取代圖示）
  //   - 指令牌：顯示車隊牌結算後的有效速度（被修飾時顏色變、字旁畫小箭頭）
  //   - speedValue=0 或車隊牌：顯示圖示（空間讓給 note）
  const _eff = getCardEffectiveSpeed(card);
  const hasNonZeroSpeed = (typeof card.speedValue === "number" && _eff.value !== 0);
  if (hasNonZeroSpeed && card.cardClass === "action") {
    const sv = _eff.value;
    const speedStr = sv > 0 ? `+${sv}` : `${sv}`;
    // 顏色規則（簡化版）：
    //   沒修飾（原本）→ 黃
    //   被 buff 提升  → 綠
    //   被 debuff 降低 → 淡紅
    let speedColor;
    if (!_eff.modified) {
      speedColor = "rgba(255,220,90,0.98)";   // 黃（原本）
    } else if (_eff.delta > 0) {
      speedColor = "rgba(140,255,160,0.95)";  // 綠（提升）
    } else {
      speedColor = "rgba(255,170,170,0.95)";  // 淡紅（降低）
    }
    textRaw(speedStr, x+w/2, y+h*0.58, 44, speedColor, "1000", "center");
    // 被修飾時、在數字右側畫小三角當「被動過」的提示
    if (_eff.modified) {
      const arrow = _eff.delta > 0 ? "▲" : "▼";
      const arrowCol = _eff.delta > 0 ? "rgba(140,255,160,0.85)" : "rgba(255,170,170,0.85)";
      textRaw(arrow, x+w*0.86, y+h*0.46, 12, arrowCol, "900", "center");
    }
  } else if (typeof card.speedValue === "number" && card.cardClass === "action") {
    // speedValue=0（如 drift）：用較小的圖示、留空間給長 note
    drawCardCenterIcon(card, x+w/2, y+h*0.42, 32);
  } else {
    // 車隊牌：用圖示
    drawCardCenterIcon(card, x+w/2, y+h*0.42, 32);
  }

  // 效果描述（v0.9：只寫速度以外的效果、若 note 為空就略過、文字太多自動換行+縮字）
  // note 是「敘述」、使用者要求字體放大、所以這裡用較大的基礎大小（13/11）並走 text() 套 FONT_SCALE
  if (card.note) {
    let noteFontSize = 13;
    let lineH = 16;
    // 先用 13px 試排，行數多就縮到 11px、確保不會撞到中央大字
    let noteLines = wrapTextLines(card.note, w - 16, noteFontSize);
    if (noteLines.length >= 3) {
      noteFontSize = 11;
      lineH = 14;
      noteLines = wrapTextLines(card.note, w - 14, noteFontSize);
    }
    // 從底部往上排
    const bottomY = y + h - 10;
    const startY = bottomY - (noteLines.length - 1) * lineH;
    noteLines.forEach((ln, i) => {
      text(ln, x+w/2, startY + i * lineH, noteFontSize, "rgba(200,220,255,0.75)", "700", "center");
    });
  }

  // 車隊牌：底部不再顯示棄牌條件（已搬到右上角標籤）
}

// 簡易字串 hash → 0~1
function hashStr(s) {
  let h = 0;
  for (let i=0; i<s.length; i++) h = ((h<<5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 1000 / 1000;
}
function drawCardCenterIcon(card, cx, cy, iconSize) {
  const ctx = app.ctx;
  ctx.save();
  ctx.translate(cx, cy);
  const sc = iconSize/24;
  ctx.scale(sc, sc);
  ctx.translate(-12, -12);
  if (card.type === "accel" || card.type === "hyper_accel") {
    const hyper = card.type === "hyper_accel";
    const g = ctx.createLinearGradient(3,2,20,22);
    if(hyper){g.addColorStop(0,"#fed7aa");g.addColorStop(0.45,"#fb923c");g.addColorStop(1,"#c2410c");}
    else{g.addColorStop(0,"#fdba74");g.addColorStop(0.5,"#ea580c");g.addColorStop(1,"#9a3412");}
    ctx.beginPath();
    ctx.moveTo(13.2,2.2);ctx.lineTo(3.8,15.2);ctx.lineTo(10.4,15.2);
    ctx.lineTo(6.6,22.6);ctx.lineTo(21.2,8.4);ctx.lineTo(13.6,8.4);
    ctx.closePath(); ctx.fillStyle=g; ctx.fill();
  } else if (card.type === "mistake") {
    ctx.fillStyle="#9ca3af";
    ctx.beginPath();
    ctx.moveTo(4.8,17.8); ctx.quadraticCurveTo(5.5,10.8,10.2,8.4);
    ctx.quadraticCurveTo(12.4,4.6,16.2,7.6); ctx.quadraticCurveTo(20.1,8.8,20.6,15.8);
    ctx.quadraticCurveTo(17.2,20.6,10.6,20.2); ctx.quadraticCurveTo(6.5,20.1,4.8,17.8);
    ctx.closePath(); ctx.fill();
  } else if (card.type === "throttle") {
    const tg=ctx.createLinearGradient(6,3,18,21);
    tg.addColorStop(0,"#fdba74");tg.addColorStop(0.55,"#f97316");tg.addColorStop(1,"#c2410c");
    ctx.beginPath();
    ctx.moveTo(12,2.4); ctx.quadraticCurveTo(17.2,8.5,16.2,12.8);
    ctx.quadraticCurveTo(18.8,14.8,12,22.6); ctx.quadraticCurveTo(5.2,14.8,7.8,12.8);
    ctx.quadraticCurveTo(6.8,8.5,12,2.4); ctx.closePath(); ctx.fillStyle=tg; ctx.fill();
  } else if (card.type === "qte_calm") {
    ctx.fillStyle="rgba(100,200,255,0.9)";
    ctx.beginPath(); ctx.arc(12,12,8,0,Math.PI*2); ctx.fill();
    ctx.fillStyle="rgba(255,255,255,0.8)";
    ctx.fillRect(10,8,4,5); ctx.fillRect(10,14,4,4);
  }
  ctx.restore();
}


function drawModalBackdrop(time) {
  if (!app.backdropCanvas) app.backdropCanvas = document.createElement("canvas");
  app.backdropCanvas.width  = app.canvas.width;
  app.backdropCanvas.height = app.canvas.height;
  const bctx = app.backdropCanvas.getContext("2d");
  bctx.setTransform(app.dpr,0,0,app.dpr,0,0);
  const prev = app.ctx; app.ctx = bctx;
  drawRace(time);
  app.ctx = prev;
  const ctx = app.ctx;
  ctx.save(); ctx.setTransform(app.dpr,0,0,app.dpr,0,0);
  ctx.clearRect(0,0,app.w,app.h);
  ctx.filter = "blur(6px)"; ctx.globalAlpha = 0.96;
  ctx.drawImage(app.backdropCanvas,0,0,app.w,app.h);
  ctx.filter = "none"; ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(0,0,0,0.52)"; ctx.fillRect(0,0,app.w,app.h);
  ctx.restore();
}

function getCenteredModalBox(w, h) {
  const sw = w * UI_SCALE;
  const sh = h * UI_SCALE;
  return { x: app.w/2-sw/2, y: app.h/2-sh/2, w: sw, h: sh };
}

function drawModalPanel(box, accent) {
  roundPanel(box.x, box.y, box.w, box.h, 14,
    "rgba(6,14,26,0.97)", accent ?? "rgba(105,164,224,0.55)", 2.5);
}

function drawStartModal() {
  const box = getCenteredModalBox(460, 388);
  drawModalPanel(box);
  const cx = box.x+box.w/2;
  text("最後車手", cx, box.y+62*UI_SCALE, 36, "#dfeeff", "900", "center");
  text("Final Driver — 機制驗證場", cx, box.y+88*UI_SCALE, 12, "rgba(150,180,220,0.55)", "700", "center");
  const ctx = app.ctx;
  ctx.save(); ctx.strokeStyle="rgba(120,170,220,0.3)"; ctx.lineWidth=1; ctx.setLineDash([5,5]);
  ctx.beginPath(); ctx.moveTo(box.x+40*UI_SCALE,box.y+102*UI_SCALE); ctx.lineTo(box.x+box.w-40*UI_SCALE,box.y+102*UI_SCALE); ctx.stroke();
  ctx.setLineDash([]); ctx.restore();
  text("你是車隊領隊，透過打牌以指揮車手", cx, box.y+140*UI_SCALE, 16, "#e8f0ff", "700", "center");
  text("駕駛賽車超過前車。", cx, box.y+164*UI_SCALE, 16, "#e8f0ff", "700", "center");
  button("start-game", "開始遊戲", cx-110, box.y+202*UI_SCALE, 220, 48, false, "start");
  button("open-rules", "遊戲規則", cx-110, box.y+260*UI_SCALE, 220, 38, false, "primary");
}

function drawPromptModal() {
  const elapsed = performance.now() - (app.promptShownAt || 0);
  const fadeStart = 2000;  // 2 秒後開始淡出
  const alpha = elapsed < fadeStart ? 1 : Math.max(0, 1 - (elapsed - fadeStart) / 1000);
  if (alpha <= 0) return;
  const ctx = app.ctx;
  ctx.save();
  ctx.globalAlpha = alpha;
  const box = getCenteredModalBox(380, 120);
  drawModalPanel(box);
  const cx = box.x + box.w/2;
  text("沒有手牌了！", cx, box.y+46*UI_SCALE, 20, "#dfeeff", "900", "center");
  const spd = currentLaneSpeed();
  text(`速度 ${spd}　對手 ${opponentDisplaySpeed()}`, cx, box.y+78*UI_SCALE, 14, "rgba(200,220,255,0.75)", "700", "center");
  ctx.restore();
}

function drawResultModal() {
  const boxY = app.h*0.26;
  // 三種結果狀態：超車成功 / 未超車（甩開後車）/ 超車失敗（第二關）
  const isSuccess = app.message === "超車成功！";
  const isFail    = app.message === "超車失敗";
  const accent    = isSuccess ? "#57e585" : isFail ? "#ff6b7a" : "#ffd94f";
  const titleColor= accent;
  const titleText = isSuccess ? "超車成功！" : isFail ? "超車失敗" : "未超車";
  const subText   = isSuccess ? null
                  : isFail    ? "QTE 沒過，這次沒能超過去"
                  :             "已甩開後車，名次保持";
  const boxH = 300;
  panel(app.w/2-310, boxY, 620, boxH, "rgba(4,8,8,0.58)", accent);
  text(titleText, app.w/2, boxY+70, 48, titleColor, "1000", "center");
  if (subText) {
    text(subText, app.w/2, boxY+104, 15, "rgba(220,220,220,0.75)", "700", "center");
  }
  // 若是 QTE 超車（有分數），顯示分數
  if (typeof app.qteScore === "number" && app.qteScoreMax) {
    const scoreY = subText ? boxY+134 : boxY+112;
    text(`QTE ${app.qteScore} / ${app.qteScoreMax}　（過關門檻 ${app.qteScorePass}）`,
      app.w/2, scoreY, 16, "rgba(255,217,79,0.9)", "800", "center");
    text(`名次 ${app.rank} / ${app.rankTotal}`, app.w/2, scoreY+34, 20, "#f4f8ff", "900", "center");
  } else {
    const rankY = subText ? boxY+146 : boxY+130;
    text(`名次 ${app.rank} / ${app.rankTotal}`, app.w/2, rankY, 22, "#f4f8ff", "900", "center");
  }
  // 按鈕區：所有結果狀態都提供「重玩本關」+「下一關」
  const hasNext = app.stageIndex+1 < STAGES.length;
  const nextLabel = hasNext ? "下一關 →" : "完成";
  if (isSuccess) {
    // 超車成功：下一關優先（綠/start 樣式），重玩次要（灰）
    button("retry-stage", "重玩本關", app.w/2-220, boxY+boxH-60, 200, 48, false, "gray");
    button("next-stage",  nextLabel,   app.w/2+20,  boxY+boxH-60, 200, 48, false, "start");
  } else if (isFail) {
    // 超車失敗：重玩優先（橘/primary），下一關次要（灰）
    button("retry-stage", "重玩本關", app.w/2-220, boxY+boxH-60, 200, 48, false, "primary");
    button("next-stage",  nextLabel,   app.w/2+20,  boxY+boxH-60, 200, 48, false, "gray");
  } else {
    // 未超車（甩開後車）：兩個都中性
    button("retry-stage", "重玩本關", app.w/2-220, boxY+boxH-60, 200, 48, false, "gray");
    button("next-stage",  nextLabel,   app.w/2+20,  boxY+boxH-60, 200, 48, false, "primary");
  }
}

function drawDefenseResultModal() {
  const ctx = app.ctx;
  ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0,0,app.w,app.h);
  const boxY = app.h*0.3;
  const success = app.defenseSucceeded;
  panel(app.w/2-280, boxY, 560, 220, "rgba(6,14,24,0.92)", "#69a4e0");
  text(success?"防守成功！":"防守失敗…", app.w/2, boxY+80, 40, success?"#57e585":"#ff6b7a", "1000", "center");
  text(success?"守住名次！":"名次下滑一位", app.w/2, boxY+132, 18, "#d7e6f8", "700", "center");
  button("defense-result-ok", "繼續", app.w/2-100, boxY+162, 200, 48);
}

function drawAllClear() {
  const ctx = app.ctx;
  ctx.fillStyle = "rgba(0,0,0,0.72)"; ctx.fillRect(0,0,app.w,app.h);
  text("通關！", app.w/2, app.h*0.38, 56, "#ffd94f", "1000", "center");
  text("Final Driver — 機制驗證場", app.w/2, app.h*0.52, 20, "rgba(200,220,255,0.8)", "700", "center");
  button("replay", "再玩一次", app.w/2-110, app.h*0.62, 220, 52, false, "start");
}

// ─── 第五關繪製 ────────────────────────────────────────────────────────────
// AR 地面速限標線：只在彎道賽段、有速限的道顯示
function drawSpeedLimitAR(time) {
  const ctx = app.ctx;
  const h = app.h;
  const horizon = h * 0.38;

  // ─── 1. 速限標誌：紅圈圈、白底、數字（只有彎道才顯示）─────────────
  const circ = currentCircuit();
  if (circ && circ.type === "bend") {
    const laneCount = app.laneCount || 2;
    for (let li = 0; li < laneCount; li++) {
      const b = getLaneBonusFor(li);
      if (!b || b.speedLimit == null) continue;
      drawSpeedLimitSign(li, laneCount, b.speedLimit, time);
    }
  }

  // ─── 2. 路面 AR 加成標籤（每道顯示 add / mult / 強制 QTE / ?）─────
  drawLaneBonusLabels(time);

  // ─── 3. 玩家當前速度（地面上、像速限同款投影風格）─────────────
  // 跟拖曳區一樣會顯示預覽數值
  const previewSpeed = computePlayerSpeedPreview();
  drawCurrentSpeedSign(previewSpeed.value, previewSpeed.isPreview, previewSpeed.overLimit, time);
}

// 路面 AR 加成標籤：每道在道路上方（天空區）顯示 add / mult / 強制 QTE / 隱藏 ?
// 跟速度同一視覺語言（投影、有 glow），但放在 horizon 上方、像空中告示牌
function drawLaneBonusLabels(time) {
  const ctx = app.ctx;
  const h = app.h;
  const horizon = h * 0.38;
  const laneCount = app.laneCount || 2;
  const circ = currentCircuit();
  const isC8Hidden = circ && circ.hideLaneBonusUntilVisited;
  const s5 = app.stage5;

  // 道路頂端的 x 範圍（用 horizon 那條線的路寬均分給各道）
  const bounds = roadLaneBoundsAt(horizon);
  const laneW = (bounds.right - bounds.left) / laneCount;

  // 在 horizon 上方一點（天空區、原本速限的位置）
  const cy = horizon - 40 * UI_SCALE;

  // 第一步：算出每個 lane 要顯示什麼、量出 panel 寬度
  const items = [];
  for (let li = 0; li < laneCount; li++) {
    const b = getLaneBonusFor(li);
    const isHiddenLane = isC8Hidden && s5 && !s5.revealedC8Lanes?.has(li);
    if (!b && !isHiddenLane) { items.push(null); continue; }

    let mainText = "";
    let subText = "";
    let color = "rgba(255,255,255,0.85)";
    let glow = "rgba(255,255,255,0.4)";

    if (isHiddenLane) {
      mainText = "?";
      color = "rgba(200,200,210,0.75)";
      glow = "rgba(200,200,210,0.3)";
    } else {
      const add = b.add ?? 0;
      const mult = b.mult ?? 1;
      const hasMult = mult !== 1;
      if (hasMult) {
        mainText = `×${mult}`;
        color = mult > 1 ? "rgba(255,200,100,0.95)" : "rgba(150,220,255,0.95)";
        glow = mult > 1 ? "rgba(255,180,80,0.5)" : "rgba(120,200,255,0.5)";
      } else if (add > 0) {
        mainText = `+${add}`;
        color = "rgba(120,255,160,0.95)";
        glow = "rgba(80,255,140,0.5)";
      } else if (add < 0) {
        mainText = `${add}`;
        color = "rgba(255,150,150,0.9)";
        glow = "rgba(255,120,120,0.5)";
      } else {
        mainText = "0";
        color = "rgba(200,210,225,0.85)";
        glow = "rgba(180,200,220,0.3)";
      }
      if (b.forceCornerQte) {
        subText = "⚡ 強制 QTE";
        color = "rgba(255,180,80,0.98)";
        glow = "rgba(255,160,60,0.55)";
      }
    }
    if (!mainText) { items.push(null); continue; }

    // 量字寬
    const fontSize = 28 * UI_SCALE;
    ctx.save();
    ctx.font = `900 ${fontSize}px system-ui, "Microsoft JhengHei", sans-serif`;
    const mainW = ctx.measureText(mainText).width;
    let subW = 0;
    if (subText) {
      ctx.font = `800 ${fontSize * 0.5}px system-ui, "Microsoft JhengHei", sans-serif`;
      subW = ctx.measureText(subText).width;
    }
    ctx.restore();

    const panelW = Math.max(mainW, subW) + 24 * UI_SCALE;
    const panelH = subText ? fontSize * 1.6 : fontSize * 1.1;
    const targetCx = bounds.left + laneW * (li + 0.5);

    items.push({
      li, mainText, subText, color, glow, isHiddenLane,
      panelW, panelH, fontSize,
      targetCx,
    });
  }

  // 第二步：水平推開以避免重疊
  // 策略：先按 lane 順序排，從中間往外擴張、把外側的 panel 往外推
  // 所有 panel 都在 row 0、永遠保持水平
  const validItems = items.filter(x => x);
  if (validItems.length >= 2) {
    const minGap = 8;  // 兩個 panel 之間最小間距
    // 從左到右掃，若 i 跟 i-1 重疊或太近、把 i 往右推
    for (let i = 1; i < validItems.length; i++) {
      const prev = validItems[i - 1];
      const cur  = validItems[i];
      const prevRight = prev.targetCx + prev.panelW / 2;
      const curLeft   = cur.targetCx - cur.panelW / 2;
      const need = prevRight + minGap - curLeft;
      if (need > 0) {
        cur.targetCx += need;  // 把當前的往右推、留出間距
      }
    }
    // 反向掃一次：若最右邊推得太遠、整體再往左偏
    // 用「以原始幾何中心置中」做整體 shift
    const targetCenterX = bounds.left + (bounds.right - bounds.left) / 2;
    const actualCenterX = (validItems[0].targetCx + validItems[validItems.length - 1].targetCx) / 2;
    const shift = targetCenterX - actualCenterX;
    for (const it of validItems) it.targetCx += shift;
  }
  // 所有 item 都在同一個 row（不再使用 row 系統）
  for (const it of items) {
    if (!it) continue;
    it.row = 0;
  }

  // 繪製：全部在同一個 y（cy）
  for (const it of items) {
    if (!it) continue;
    const itemCy = cy;
    const panelX = it.targetCx - it.panelW / 2;
    const panelY = itemCy - it.panelH * (it.subText ? 0.35 : 0.5);

    const bgFill = it.isHiddenLane ? "rgba(40, 40, 50, 0.72)"
                 : it.subText      ? "rgba(60, 40, 20, 0.80)"
                 : it.color.includes("120,255,160") ? "rgba(20, 50, 30, 0.72)"
                 : it.color.includes("255,150,150") ? "rgba(60, 25, 25, 0.72)"
                 : it.color.includes("255,200,100") ? "rgba(60, 45, 20, 0.72)"
                 : it.color.includes("150,220,255") ? "rgba(20, 35, 55, 0.72)"
                 : it.color.includes("200,210,225") ? "rgba(30, 35, 45, 0.72)"
                 :                                    "rgba(35, 35, 45, 0.72)";

    roundPanel(panelX, panelY, it.panelW, it.panelH, 8 * UI_SCALE, bgFill, it.color, 1.5);

    ctx.save();
    ctx.shadowColor = it.glow;
    ctx.shadowBlur = 12;
    ctx.fillStyle = it.color;
    ctx.font = `900 ${it.fontSize}px system-ui, "Microsoft JhengHei", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(it.mainText, it.targetCx, itemCy);
    ctx.restore();

    if (it.subText) {
      ctx.save();
      ctx.shadowColor = it.glow;
      ctx.shadowBlur = 8;
      ctx.fillStyle = it.color;
      ctx.font = `800 ${it.fontSize * 0.5}px system-ui, "Microsoft JhengHei", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(it.subText, it.targetCx, itemCy + it.fontSize * 0.7);
      ctx.restore();
    }
  }
}

// 計算「玩家當前速度」（拖曳中時是預覽值、否則是 playerSpeed）
function computePlayerSpeedPreview() {
  const baseSpeed = app.playerSpeed;
  // 沒拖曳：直接回原值
  if (!app.drag) {
    const b = getLaneBonusFor(app.playerLane);
    const limit = b?.speedLimit ?? null;
    const overLimit = limit != null && baseSpeed > limit;
    return { value: baseSpeed, isPreview: false, overLimit };
  }
  // 車隊牌不影響速度
  const isDragTeamCard = app.drag.card?.cardClass === "team";
  if (isDragTeamCard) {
    const b = getLaneBonusFor(app.playerLane);
    const limit = b?.speedLimit ?? null;
    const overLimit = limit != null && baseSpeed > limit;
    return { value: baseSpeed, isPreview: false, overLimit };
  }
  // 看牌在哪一道上方（用整條賽道判定 laneAtPoint、不再依舊道格 rect）
  const dragCx = app.drag.x + app.drag.w/2;
  const dragCy = app.drag.y + app.drag.h/2;

  // 拖回手牌列（取消區）→ 不算預覽、顯示原速
  const handTop = app.h - 190 - 60;
  const handBottom = app.h - 190 + 164 + 30;
  if (dragCy >= handTop && dragCy <= handBottom) {
    const b = getLaneBonusFor(app.playerLane);
    const limit = b?.speedLimit ?? null;
    const overLimit = limit != null && baseSpeed > limit;
    return { value: baseSpeed, isPreview: false, overLimit };
  }

  const hoverLane = laneAtPoint({ x: dragCx, y: dragCy });
  if (hoverLane < 0) {
    const b = getLaneBonusFor(app.playerLane);
    const limit = b?.speedLimit ?? null;
    const overLimit = limit != null && baseSpeed > limit;
    return { value: baseSpeed, isPreview: false, overLimit };
  }
  // 套用 drawLanes 同款預覽公式
  const b = getLaneBonusFor(hoverLane);
  const add = b?.add ?? 0;
  const mult = b?.mult ?? 1;
  let preview;
  if (hoverLane === app.playerLane) {
    const cardSpd = app.drag.card.speedValue ?? 0;
    const slipBonus = canGetSlipstreamAtLane(hoverLane) ? 30 : 0;
    preview = Math.floor((baseSpeed + cardSpd + slipBonus + add) * mult);
  } else if (baseSpeed > 0) {
    const slipBonus = canGetSlipstreamAtLane(hoverLane) ? 30 : 0;
    const lanesCrossed = Math.abs(hoverLane - app.playerLane);
    const laneCost = laneChangeCost(lanesCrossed);
    preview = Math.floor((baseSpeed - laneCost + slipBonus + add) * mult);
  } else {
    preview = baseSpeed;
  }
  const limit = b?.speedLimit ?? null;
  const overLimit = limit != null && preview > limit;
  return { value: preview, isPreview: true, overLimit };
}

// 速限標誌：紅圈圈、白底、黑字（仿真實標誌）
// 配置：依道數放在路邊，桿子從路邊向上伸出、標誌掛在桿頂
//   2 道：左道速限掛左側、右道速限掛右側
//   3 道：左道掛左側、中道掛右側、右道掛右側下方一點（錯開避免擠）
function drawSpeedLimitSign(laneIdx, laneCount, limit, time) {
  const ctx = app.ctx;
  const h = app.h;
  const horizon = h * 0.38;

  // 路邊位置（路面跟天空的交界線、路寬的左 / 右邊緣）
  const yEdge = horizon + 30 * UI_SCALE;  // 在地平線下方一點才能看清「路邊」
  const bounds = roadLaneBoundsAt(yEdge);
  const roadW = bounds.right - bounds.left;
  const sidePad = 28 * UI_SCALE;  // 標誌離路邊的距離

  // 決定掛左還是右
  //   2 道時：lane 0 → 左、lane 1 → 右
  //   3 道時：lane 0 → 左、lane 1 → 左下、lane 2 → 右
  let signX, signY;
  if (laneCount === 2) {
    if (laneIdx === 0) {
      signX = bounds.left - sidePad;
      signY = yEdge - 40 * UI_SCALE;
    } else {
      signX = bounds.right + sidePad;
      signY = yEdge - 40 * UI_SCALE;
    }
  } else {
    // 3 道
    if (laneIdx === 0) {
      signX = bounds.left - sidePad;
      signY = yEdge - 40 * UI_SCALE;
    } else if (laneIdx === laneCount - 1) {
      signX = bounds.right + sidePad;
      signY = yEdge - 40 * UI_SCALE;
    } else {
      // 中間道：找一個空位（路邊下方一點、靠右）
      signX = bounds.right + sidePad;
      signY = yEdge + 30 * UI_SCALE;
    }
  }

  // 正圓、固定大小
  const r = 28 * UI_SCALE;

  // 超速判斷（玩家在本道）
  const overSpeed = app.playerSpeed > limit && laneIdx === app.playerLane;
  const pulseFreq = overSpeed ? 0.008 : 0.0025;
  const pulse = 0.75 + Math.sin(time * pulseFreq) * 0.25;

  // 1. 桿子（從路邊向標誌延伸）
  ctx.save();
  ctx.strokeStyle = "rgba(120, 120, 130, 0.7)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  // 桿底（在路邊地面）→ 桿頂（標誌中心略下方）
  const poleBottomX = laneCount === 2
    ? (laneIdx === 0 ? bounds.left : bounds.right)
    : (laneIdx === 0 ? bounds.left
      : laneIdx === laneCount - 1 ? bounds.right
      : bounds.right);
  ctx.moveTo(poleBottomX, yEdge + 10);
  ctx.lineTo(signX, signY + r * 0.5);
  ctx.stroke();
  ctx.restore();

  // 2. 標誌本體（紅圈 + 白底）
  ctx.save();
  ctx.translate(signX, signY);
  const ringWidth = r * 0.22;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.lineWidth = ringWidth;
  ctx.strokeStyle = overSpeed
    ? `rgba(255, 60, 60, ${pulse})`
    : `rgba(220, 30, 30, ${pulse * 0.95})`;
  ctx.shadowColor = overSpeed ? "rgba(255,60,60,0.6)" : "rgba(220,30,30,0.3)";
  ctx.shadowBlur = overSpeed ? 20 : 10;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r - ringWidth * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(248, 248, 245, 0.96)";
  ctx.shadowBlur = 0;
  ctx.fill();
  ctx.restore();

  // 3. 數字
  ctx.save();
  ctx.translate(signX, signY);
  const fontSize = r * 0.95;
  ctx.font = `900 ${fontSize}px system-ui, "Microsoft JhengHei", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#1a1a1a";
  ctx.fillText(`${limit}`, 0, 0);
  ctx.restore();
}

// 玩家當前速度標誌：AR 投影風格的地板大字（沿用速限原本的視覺）
// 跟拖曳預覽連動：拖曳中、且 hover 到道格上時顯示預覽值
function drawCurrentSpeedSign(speed, isPreview, overLimit, time) {
  const ctx = app.ctx;
  const h = app.h;
  const horizon = h * 0.38;
  const laneCount = app.laneCount || 2;

  // 拖曳預覽中：放在「牌懸停的道」；其他時候放在玩家當前道
  let targetLane = app.playerLane;
  if (isPreview && app.drag) {
    const dragCx = app.drag.x + app.drag.w/2;
    const dragCy = app.drag.y + app.drag.h/2;
    const hoverLane = laneAtPoint({ x: dragCx, y: dragCy });
    if (hoverLane >= 0) targetLane = hoverLane;
  }

  // 路面位置：往遠處推（在道名提示更前方、不跟道名重疊）
  const tNear = 0.26;
  const tFar  = 0.12;
  const yNear = horizon + (h - horizon) * tNear;
  const yFar  = horizon + (h - horizon) * tFar;
  const bNear = roadLaneBoundsAt(yNear);
  const bFar  = roadLaneBoundsAt(yFar);
  const laneWNear = (bNear.right - bNear.left) / laneCount;
  const laneWFar  = (bFar.right  - bFar.left)  / laneCount;
  const cxNear = bNear.left + laneWNear * (targetLane + 0.5);
  const cxFar  = bFar.left  + laneWFar  * (targetLane + 0.5);
  const cx = (cxNear + cxFar) / 2;
  const cy = (yNear + yFar) / 2;

  // 顏色（沿用原速限色票）
  //   一般 = 半透明白
  //   拖曳預覽（上下動） = 亮綠
  //   超速 = 紅
  const baseColor = overLimit
    ? "rgba(255,70,70,0.95)"
    : isPreview
      ? "rgba(120,255,160,0.98)"
      : "rgba(255,255,255,0.65)";
  const glowColor = overLimit
    ? "rgba(255,60,60,0.6)"
    : isPreview
      ? "rgba(80,255,140,0.7)"
      : "rgba(255,255,255,0.35)";
  const pulseFreq = overLimit ? 0.008 : isPreview ? 0.006 : 0.0025;
  const pulse = 0.75 + Math.sin(time * pulseFreq) * 0.25;

  // 投影感：用 setTransform 把字壓扁鋪在路面
  const xScale = (laneWFar / laneWNear) * 0.9;
  const yScale = 0.28;
  const fontSize = 180;
  const textStr = `${speed}`;

  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 28;
  ctx.fillStyle = baseColor;
  ctx.font = `900 ${fontSize}px system-ui, "Microsoft JhengHei", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // ⚠ 不用 setTransform(xScale, 0, 0, yScale, cx, cy) — 那是絕對覆寫、會清掉
  //   applyDesignTransform 已套好的 design transform，導致在非 1920×1080 視窗下跑位。
  //   改用 translate + scale 疊加在當前 transform 上。
  ctx.translate(cx, cy);
  ctx.scale(xScale, yScale);
  ctx.fillText(textStr, 0, 0);
  ctx.restore();
  // 5217 ctx.save() + 上面 ctx.restore() 已成對、transform 自動還原成 design transform
}
// 左側面板：當前對手 / 後車 / 車隊牌
function drawStage5SidePanel(time) {
  const s5 = app.stage5;
  if (!s5) return;
  const ctx = app.ctx;
  const x = 14;
  const y = 80;
  const w = 240;  // 字體放大後加寬讓標題跟回合計時不重疊
  let curY = y;
  // 估算面板高度：標題 34 + 名次標 22 + 4 列 × 30 + 後車警告 58 + 尾流 22 + 車隊牌
  const rankBlockH = 4 * 26 + 3 * 4;  // = 116
  const teamCardsH = s5.teamCardsActive.length > 0 ? 28 + s5.teamCardsActive.length * 26 : 0;
  const panelH = 16 + 34 + 22 + rankBlockH + 16 + teamCardsH + 80;
  roundPanel(x, y, w, panelH, 12, "rgba(10,18,28,0.88)", "rgba(120,170,220,0.35)", 1.5);
  curY = y + 16;
  text("機制驗證場", x + 14, curY + 14, 17, "rgba(255,220,120,0.85)", "900");
  // 回合計時：顯示「回合 X / MAX」，最後 3 回合時用警示色
  const maxR = s5.maxRounds || 20;
  const curR = Math.min(maxR, Math.max(1, s5.roundsPlayed || 1));
  const roundsLeft = maxR - curR;
  const roundColor = roundsLeft <= 2 ? "rgba(255,140,140,0.95)"
                   : roundsLeft <= 5 ? "rgba(255,210,120,0.9)"
                   :                   "rgba(180,200,230,0.8)";
  text(`回合 ${curR} / ${maxR}`, x + w - 14, curY + 14, 13, roundColor, "800", "right");
  curY += 34;
  // 名次陣容（垂直）
  text("名次", x + 14, curY + 14, 13, "rgba(180,200,230,0.7)", "700");
  curY += 22;
  const rankH = drawRankLineup(x + 14, curY, w - 28, s5);
  curY += rankH + 14;
  // 後車警告（非最後一名才顯示）
  const chaser = currentChaser();
  const isLast = app.rank === app.rankTotal;
  if (chaser && !isLast) {
    const pulse = 0.5 + Math.sin(performance.now() * 0.006) * 0.5;
    const warnAlpha = 0.7 + pulse * 0.3;
    roundPanel(x + 10, curY, w - 20, 48, 6,
      `rgba(255,60,60,${0.12 + pulse * 0.08})`,
      `rgba(255,80,80,${warnAlpha})`, 1.5);
    text(`⚠ 後車逼近 — Pass 將觸發防守`, x + 16, curY + 17, 12, `rgba(255,160,140,${warnAlpha})`, "800");
    text(`${chaser.name}`, x + 16, curY + 34, 13, `rgba(255,200,180,0.9)`, "700");
    curY += 54;
  }
  // 尾流提示（同道時）
  const opp = currentOpponent();
  if (s5.slipstreamUsed) {
    text("💨 尾流已取得（+30 本回合）", x + 14, curY + 14, 12, "rgba(100,220,255,0.85)", "800");
    curY += 22;
  } else if (opp && app.playerLane === app.opponentLane) {
    const slipPulse = 0.5 + Math.sin(performance.now() * 0.008) * 0.5;
    text("💨 同道！尾流 +30 可取得", x + 14, curY + 14, 12, `rgba(100,220,255,${0.6 + slipPulse * 0.4})`, "800");
    curY += 22;
  }
  // 車隊牌列表（每張可 hover）
  if (s5.teamCardsActive.length > 0) {
    curY += 8;
    text("✦ 場上車隊牌：", x + 14, curY + 12, 13, "rgba(150,220,180,0.85)", "800");
    curY += 20;
    // 重設 hover rects 然後逐張畫
    s5._teamCardRects = [];
    for (const c of s5.teamCardsActive) {
      const itemY = curY;
      const itemRect = { x: x + 14, y: itemY, w: w - 28, h: 22, card: c };
      s5._teamCardRects.push(itemRect);
      // hover 高亮
      const isHover = app.mouse && inRect(app.mouse, itemRect);
      if (isHover) {
        ctx.fillStyle = "rgba(120,220,160,0.18)";
        ctx.fillRect(itemRect.x - 2, itemRect.y - 1, itemRect.w + 4, itemRect.h);
      }
      text(`• ${c.name}`, x + 16, curY + 14, 13, isHover ? "#dcf7e2" : "#cfe3d4", "700");
      curY += 22;
    }
  } else {
    s5._teamCardRects = [];
  }
}


// ─── UI 尺寸選擇器（S / M / L）─────────────────────────────────────────
// 透過 ctx 全局 transform 套用倍率（resize 內處理）、UI 元素整體縮放
// 位置：右上角「下賽段預告框」正下方
// 場上車隊牌 hover tooltip（在最上層繪製）
function drawStage5TeamCardTooltip(time) {
  const s5 = app.stage5;
  if (!s5 || !s5._teamCardRects || s5._teamCardRects.length === 0) return;
  if (!app.mouse) return;
  const hovered = s5._teamCardRects.find(r => inRect(app.mouse, r));
  if (!hovered) return;
  const c = hovered.card;
  const ctx = app.ctx;
  // tooltip 內容：名稱 / cost / 效果 / 棄牌條件
  const tipW = 240;
  const tipH = 96;
  let tipX = hovered.x + hovered.w + 8;
  let tipY = hovered.y - 8;
  if (tipX + tipW > app.w) tipX = hovered.x - tipW - 8;
  if (tipY + tipH > app.h) tipY = app.h - tipH - 8;
  if (tipY < 8) tipY = 8;
  roundPanel(tipX, tipY, tipW, tipH, 10, "rgba(8,18,12,0.96)", "rgba(120,220,160,0.7)", 1.5);
  text(c.name, tipX + 14, tipY + 22, 14, "#dcf7e2", "900", "left");
  // 無 cost 系統
  // 分隔線
  ctx.save();
  ctx.strokeStyle = "rgba(120,220,160,0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(tipX + 14, tipY + 32); ctx.lineTo(tipX + tipW - 14, tipY + 32); ctx.stroke();
  ctx.restore();
  // 效果敘述（多行）
  const lines = wrapTextLines(c.note || "", tipW - 28, 11);
  let ly = tipY + 48;
  for (const line of lines.slice(0, 2)) {
    text(line, tipX + 14, ly, 11, "#e8f0ff", "700", "left");
    ly += 16;
  }
  if (c.persistenceLabel) {
    text(`⌛ ${c.persistenceLabel}`, tipX + 14, tipY + tipH - 12, 10, "rgba(140,200,170,0.85)", "700", "left");
  }
}

// 名次陣容圖（玩家在哪、前後分別誰）+ 每格上方數字
// 垂直名次：從第 1 名到第 N 名、由上到下
// 每列三欄：名次數字 | 名字 | 狀態（active=前方未超 / inactive=已被超過 / 自己=「你」）
// 回傳實際用掉的高度（供呼叫端推進 curY）
function drawRankLineup(x, y, w, s5) {
  const ctx = app.ctx;
  const total = app.rankTotal || 4;
  const playerRank = app.rank;
  const rowH = 22;
  const gap = 3;

  for (let pos = 1; pos <= total; pos++) {
    const rowY = y + (pos - 1) * (rowH + gap);
    const isPlayer = (pos === playerRank);

    // 取出該名次的車手資訊與狀態
    // 狀態暫時全部 active（之後接專注度/反超機制再分化）
    let fullName = "";
    let status = "active";
    let color = "rgba(80,100,130,0.7)";
    if (isPlayer) {
      fullName = "你";
      status = "self";
      color = "#7be0a0";
    } else if (pos < playerRank) {
      // 前方
      const idx = pos - 1;
      if (idx >= 0 && idx < s5.ahead.length) {
        fullName = STAGE5_OPPONENTS[s5.ahead[idx]]?.name || s5.ahead[idx];
        color = "#ffb070";
      } else {
        fullName = "?"; color = "rgba(180,140,80,0.5)";
      }
    } else { // pos > playerRank
      // 後方（仍然 active）
      const idx = pos - playerRank - 1;
      if (idx >= 0 && idx < s5.passed.length) {
        fullName = STAGE5_OPPONENTS[s5.passed[idx]]?.name || s5.passed[idx];
        color = "rgba(180,200,230,0.85)";
      } else {
        fullName = "-"; color = "rgba(80,100,130,0.4)";
      }
    }

    // 底色 + 邊框
    ctx.fillStyle = isPlayer ? "rgba(60,100,80,0.45)" : "rgba(40,55,80,0.45)";
    ctx.fillRect(x, rowY, w, rowH);
    ctx.strokeStyle = color;
    ctx.lineWidth = isPlayer ? 2 : 1;
    ctx.strokeRect(x + 0.5, rowY + 0.5, w - 1, rowH - 1);

    // 三欄佈局：名次數字 / 名字 / 狀態
    const ty = rowY + rowH/2 + 4;
    text(`${pos}`, x + 10, ty, 11, "rgba(180,200,230,0.65)", "800", "left");
    text(fullName, x + 28, ty, 12, color, "800", "left");
    // 右：狀態（暫時都 active，玩家自己顯示「你」）
    let statusStr, statusColor;
    if (status === "self") { statusStr = "● 你";    statusColor = "#7be0a0"; }
    else                   { statusStr = "● Active"; statusColor = "rgba(180,220,180,0.75)"; }
    text(statusStr, x + w - 10, ty, 10, statusColor, "800", "right");
  }

  return total * rowH + (total - 1) * gap;
}

// 右上角：下一賽段預告
function drawStage5NextCircuit(time) {
  const s5 = app.stage5;
  if (!s5) return;
  const cur  = currentCircuit();
  const next = nextCircuit();
  const lineH = 24;  // 每道資訊一行的高度
  const laneRows = next
    ? (next.laneBonuses ? next.laneBonuses.length : (next.lanes || 1))
    : 1;
  const w = 300;
  // 外框高度 = padding(8) + 內框高(60 + laneRows*lineH + 12) + 當前賽段區(60) + padding(8)
  const innerHCalc = 60 + laneRows * lineH + 12;
  const h = 8 + innerHCalc + 60 + 8;
  const x = app.w - w - 14;
  const y = 14;
  roundPanel(x, y, w, h, 14, "rgba(10,18,28,0.92)", "rgba(120,170,220,0.4)", 1.5);

  if (next) {
    const nextHideBonus = !!next.hideLaneBonusUntilVisited;
    const innerLaneRows = laneRows;  // 跟外框一致
    const innerH = 60 + innerLaneRows * lineH + 12;
    roundPanel(x + 8, y + 8, w - 16, innerH, 10, "rgba(255,200,80,0.08)", "rgba(255,200,80,0.4)", 1.5);
    text("→ 下一賽段", x + 20, y + 26, 11, "rgba(255,200,80,0.8)", "800");
    text(`${next.icon} ${next.name}`, x + 20, y + 52, 22, "rgba(255,225,130,0.98)", "900");
    let lby = y + 80;
    if (nextHideBonus) {
      const lanes = next.lanes || (next.laneBonuses?.length ?? 3);
      for (let li = 0; li < lanes; li++) {
        let laneName;
        if (next.laneNames && next.laneNames[li]) laneName = next.laneNames[li];
        else if (lanes === 2) laneName = ["內彎", "外彎"][li] ?? `道 ${li + 1}`;
        else if (lanes === 3) laneName = ["左道", "中道", "右道"][li] ?? `道 ${li + 1}`;
        else laneName = `道 ${li + 1}`;
        const color = (next.laneColors && next.laneColors[li]) || "rgba(220,230,255,0.85)";
        text(`${laneName}: ?`, x + 20, lby, 12, color, "700");
        lby += lineH;
      }
    } else if (next.laneBonuses) {
      const lanes = next.lanes || next.laneBonuses.length;
      for (const lb of next.laneBonuses) {
        let laneName;
        if (next.laneNames && next.laneNames[lb.lane]) laneName = next.laneNames[lb.lane];
        else if (lanes === 2) laneName = ["內彎", "外彎"][lb.lane] ?? `道 ${lb.lane + 1}`;
        else if (lanes === 3) laneName = ["左道", "中道", "右道"][lb.lane] ?? `道 ${lb.lane + 1}`;
        else laneName = `道 ${lb.lane + 1}`;
        const bonusLabel = lb.label.split(" ")[0];
        const limitStr = lb.speedLimit != null ? `  限速 ${lb.speedLimit}` : "";
        text(`${laneName}：${bonusLabel}${limitStr}`, x + 20, lby, 12, "rgba(220,230,255,0.85)", "700");
        lby += lineH;
      }
    } else {
      text("直線道", x + 20, lby, 12, "rgba(220,230,255,0.85)", "700");
      lby += lineH;
    }
    // 當前賽段：置中於「內框下方到外框底」之間的剩餘空間
    const innerBottom = y + 8 + innerH;   // 黃框底部
    const outerBottom = y + h;            // 整個框底部
    const cy = (innerBottom + outerBottom) / 2 + 4;  // +4 微調基線
    text("當前賽段", x + 20, cy, 10, "rgba(160,180,210,0.5)", "700");
    text(`${cur?.icon ?? ""} ${cur?.name ?? ""}`, x + 90, cy, 15, "rgba(180,200,230,0.75)", "800");
  } else if (cur) {
    text("當前賽段", x + 20, y + 30, 10, "rgba(160,180,210,0.5)", "700");
    text(`${cur.icon} ${cur.name}`, x + 90, y + 30, 15, "rgba(180,200,230,0.75)", "800");
  }
}

function drawStage5IntroModal(time) {
  const s5 = app.stage5;
  if (!s5) return;
  const ctx = app.ctx;
  drawRace(time);
  drawHud(time);
  drawStage5SidePanel(time);
  drawStage5NextCircuit(time);
  drawHand(time);

  // 半透明遮罩
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, app.w, app.h);

  const boxW = 400, boxH = 160;
  const boxX = app.w/2 - boxW/2;
  const boxY = app.h/2 - boxH/2;
  roundPanel(boxX, boxY, boxW, boxH, 14, "rgba(6,14,28,0.97)", "rgba(255,200,80,0.5)", 2);
  text("機制驗證場", boxX + boxW/2, boxY + 40, 22, "#ffd980", "1000", "center");
  text("第 4 名出發 — 超過全部 3 名對手即通關", boxX + boxW/2, boxY + 80, 13, "#e8f0ff", "700", "center");
  button("stage5-intro-ok", "出發", boxX + boxW/2 - 80, boxY + boxH - 50, 160, 38, false, "start");
}

function drawStage5OvertakeResultModal() {
  const pct = app.qteScoreMax > 0 ? app.qteScore / app.qteScoreMax : 0;
  const isPerfect = pct >= 1.0;
  const title = pct >= 1.0  ? "完美超車！"
              : pct >= 0.7  ? "順利超車！"
              : pct >= 0.6  ? "勉強過關"
              : pct >= 0.5  ? "輕度失敗"
              :               "嚴重失敗";
  const titleColor = pct >= 0.6 ? (pct >= 1.0 ? "#ffd94f" : "#7be0a0")
                   : pct >= 0.5 ? "#ffb060" : "#ff8a8a";
  const mistakeCount = app.stage5?.lastMistakeCount ?? 0;
  const boxH = 280;
  const box = getCenteredModalBox(440, boxH);
  const isSuccess = pct >= 0.6;
  drawModalPanel(box, isSuccess ? (isPerfect ? "rgba(255,220,80,0.4)" : "rgba(120,220,150,0.5)") : "rgba(255,100,100,0.35)");
  const cx = box.x + box.w/2;
  text(title, cx, box.y+56*UI_SCALE, 30, titleColor, "1000", "center");
  // QTE 分數
  const scoreStr = app.qteScore != null
    ? `QTE ${app.qteScore} / ${app.qteScoreMax}（${Math.round(app.qteScore / app.qteScoreMax * 100)}%）`
    : "";
  if (scoreStr) text(scoreStr, cx, box.y+88*UI_SCALE, 13, "rgba(200,220,255,0.8)", "700", "center");
  const opp = STAGE5_OPPONENTS[app.stage5?.passed[app.stage5.passed.length-1]];
  if (isSuccess) {
    if (opp) text(`超越了「${opp.name}」`, cx, box.y+114*UI_SCALE, 13, "rgba(220,240,225,0.85)", "700", "center");
    text(`名次：${app.rank} / ${app.rankTotal}`, cx, box.y+134*UI_SCALE, 13, "rgba(220,240,225,0.85)", "700", "center");
  } else {
    text(`名次：${app.rank} / ${app.rankTotal}`, cx, box.y+114*UI_SCALE, 13, "rgba(220,220,220,0.75)", "700", "center");
  }
  // 懲罰/獎勵
  if (isPerfect) {
    text("✦ 滿分！移除 1 張失誤牌", cx, box.y+162*UI_SCALE, 13, "rgba(255,220,100,0.95)", "800", "center");
  } else if (mistakeCount > 0) {
    const tireLine = !isSuccess ? "　扣 1 輪胎" : "";
    text(`⚠ 獲得 ${mistakeCount} 張失誤牌${tireLine}`, cx, box.y+162*UI_SCALE, 13, "rgba(255,180,80,0.95)", "800", "center");
  } else if (!isSuccess) {
    text("扣 1 輪胎", cx, box.y+162*UI_SCALE, 13, "rgba(255,150,130,0.9)", "800", "center");
  } else {
    text("無懲罰", cx, box.y+162*UI_SCALE, 13, "rgba(160,200,160,0.7)", "700", "center");
  }
  if (isSuccess) {
    button("stage5-to-reward", "選擇獎勵牌 →", cx - 110, box.y + boxH - 54, 220, 44, false, "start");
  } else {
    button("stage5-next-round", "下一回合 →", cx - 100, box.y + boxH - 54, 200, 42, false, "primary");
  }
}

// 最後一名 Pass：不防守、不扣胎
function drawStage5NoOvertakeModal() {
  const box = getCenteredModalBox(380, 160);
  drawModalPanel(box, "rgba(100,130,180,0.35)");
  const cx = box.x + box.w/2;
  text("Pass", cx, box.y+54*UI_SCALE, 28, "#a0b8e0", "900", "center");
  text("最後一名，無後車追擊", cx, box.y+90*UI_SCALE, 13, "rgba(180,200,230,0.75)", "700", "center");
  button("stage5-next-round", "下一回合 →", cx - 100, box.y+box.h-46*UI_SCALE, 200, 40, false, "primary");
}

// 防守結算
function drawStage5DefenseResultModal() {
  const success = app.message === "防守成功！" || app.message === "後援車隊保住名次！";
  const box = getCenteredModalBox(420, 200);
  drawModalPanel(box, success ? "rgba(120,220,150,0.5)" : "rgba(255,120,120,0.5)");
  const cx = box.x + box.w/2;
  text(app.message || "防守結束", cx, box.y+70*UI_SCALE, 26, success ? "#7be0a0" : "#ff8a8a", "900", "center");
  text(`名次：${app.rank} / ${app.rankTotal}`, cx, box.y+110*UI_SCALE, 14, "rgba(220,240,225,0.85)", "700", "center");
  button("stage5-next-round", "下一回合 →", cx - 100, box.y+box.h-56*UI_SCALE, 200, 42, false, success ? "start" : "primary");
}

// ─── 彎道 QTE（Helldivers 箭頭風格）──────────────────────────────────────
function endBendQte(success) {
  let mistakeCount = 0;
  let slippedTo = null;  // c6 油污：失敗時位移的目標道
  if (!success) {
    // 失敗：扣 1 胎 + 1 張失誤牌進牌庫頂
    spendTire(1);
    mistakeCount = 1;
    pushSpeedPop("player", "-1 胎 彎道失誤", "#ff5fa0");
    if (app.stage5) {
      const uid = `bend-mis-${Date.now()}`;
      app.stage5.drawPile.unshift(makeCard("mistake", uid));
    }
    // c6 油污：若當前道設定了 slipOnQteFail，做位移
    const b = getLaneBonusFor(app.playerLane);
    if (b && b.slipOnQteFail === "adjacent") {
      const safeLanes = [];
      for (let i = 0; i < app.laneCount; i++) {
        if (i !== app.playerLane) safeLanes.push(i);
      }
      if (safeLanes.length > 0) {
        slippedTo = safeLanes[Math.floor(Math.random() * safeLanes.length)];
        app.playerLane = slippedTo;
        app.playerLaneVisual = slippedTo;
      }
    }
  }
  app.bendQteResult = { success, mistakeCount, slippedTo };
  // 守門:若 spendTire 已把輪胎扣到 0，直接進輸的畫面
  if (enforceTireOutIfDead()) return;
  app.mode = "bend-qte-result";
  // 1.5 秒後自動繼續
  setTimeout(() => {
    if (app.mode === "bend-qte-result") {
      app.mode = "playing";
      // 處理延後的切段（QTE 觸發前 advanceCircuitOnCard 被擱置）
      if (app.stage5?.pendingCircuitAdvance) {
        app.stage5.pendingCircuitAdvance = false;
        advanceCircuitToNextSegment();
      }
      checkAutoPrompt();
    }
  }, 1500);
}

function handleBendQteInput(dir) {
  if (app.mode !== "bend-qte") return;
  if (performance.now() >= (app.bendQteDeadline ?? Infinity)) return;
  const expected = app.bendQteArrows[app.bendQteInput.length];
  if (dir === expected) {
    app.bendQteInput.push(dir);
    app.bendQteFailed = false;
    if (app.bendQteInput.length >= app.bendQteArrows.length) {
      endBendQte(true);
    }
  } else {
    app.bendQteFailed = true;
    app.bendQteInput  = [];
  }
}

// 彎道 QTE 超時
function checkBendQteTimeout() {
  if (app.mode !== "bend-qte") return;
  if (performance.now() < (app.bendQteDeadline ?? Infinity)) return;
  endBendQte(false);
}

function drawBendQteResult() {
  const r = app.bendQteResult || { success: false, mistakeCount: 0, slippedTo: null };
  const ctx = app.ctx;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(0, 0, app.w, app.h);
  const hasSlip = r.slippedTo != null;
  const extraRows = (r.mistakeCount > 0 ? 1 : 0) + (hasSlip ? 1 : 0);
  const boxW = 360, boxH = 130 + extraRows * 26;
  const boxX = app.w/2 - boxW/2;
  const boxY = app.h/2 - boxH/2;
  const border = r.success ? "rgba(100,255,160,0.6)" : "rgba(255,80,80,0.7)";
  roundPanel(boxX, boxY, boxW, boxH, 12, "rgba(6,14,28,0.97)", border, 2);
  const cx = boxX + boxW/2;
  if (r.success) {
    text("彎道通過！", cx, boxY + 48, 24, "#7be0a0", "1000", "center");
    text("安全過彎", cx, boxY + 82, 13, "rgba(180,230,200,0.8)", "700", "center");
  } else {
    text("彎道失控！", cx, boxY + 48, 24, "#ff8a8a", "1000", "center");
    let line = boxY + 80;
    text("扣 1 胎", cx, line, 13, "rgba(255,180,160,0.85)", "700", "center");
    if (r.mistakeCount > 0) {
      line += 26;
      text(`獲得 ${r.mistakeCount} 張失誤牌`, cx, line, 13, "rgba(255,200,100,0.85)", "700", "center");
    }
    if (hasSlip) {
      line += 26;
      text(`油污滑到${laneDisplayName(r.slippedTo)}！`, cx, line, 13, "rgba(255,160,200,0.95)", "800", "center");
    }
  }
}

function drawBendQte(time) {
  const ctx = app.ctx;
  const arrows   = app.bendQteArrows || [];
  const inputSoFar = app.bendQteInput || [];
  const failed   = app.bendQteFailed;
  const deadline = app.bendQteDeadline ?? (performance.now() + 6000);
  const totalMs  = (app.bendQteTotalSecs ?? 6) * 1000;
  const remaining = Math.max(0, (deadline - performance.now()) / totalMs);

  // 半透明遮罩
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(0, 0, app.w, app.h);

  // 依箭頭數動態計算框寬（每格 48 + 間距 10，兩側各留 24px）
  const aw = 48, gap = 10, sidePad = 24;
  const arrowsW = arrows.length * aw + (arrows.length - 1) * gap;
  const boxW = Math.max(400, arrowsW + sidePad * 2);
  const boxH = 240;
  const boxX = app.w/2 - boxW/2;
  const boxY = app.h/2 - boxH/2;
  const borderCol = failed ? "rgba(255,80,80,0.8)" : "rgba(255,200,80,0.6)";
  roundPanel(boxX, boxY, boxW, boxH, 14, "rgba(6,14,28,0.97)", borderCol, 2);

  const cx = boxX + boxW/2;
  text("彎道限速！", cx, boxY + 32, 18, failed ? "#ff8a8a" : "#ffd980", "1000", "center");
  text(failed ? "輸入錯誤，重新輸入↓（計時繼續）" : "依序按方向鍵通過彎道", cx, boxY + 56, 13,
       failed ? "rgba(255,160,140,0.9)" : "rgba(200,220,255,0.8)", "700", "center");

  // 倒數計時條
  const timerY = boxY + 70;
  roundPanel(boxX + 20, timerY, boxW - 40, 10, 4, "rgba(10,16,28,0.85)", "rgba(255,160,60,0.3)", 1);
  const timerColor = remaining > 0.5 ? "#57e585" : remaining > 0.25 ? "#ffd94f" : "#ff6060";
  ctx.fillStyle = timerColor;
  ctx.fillRect(boxX + 22, timerY + 2, (boxW - 44) * remaining, 6);
  const secsLeft = Math.ceil(remaining * (app.bendQteTotalSecs ?? 6));
  text(`${secsLeft}s`, boxX + boxW - 14, timerY + 8, 11, timerColor, "900", "right");

  // 箭頭格排列（置中）
  const startX = cx - arrowsW / 2;
  for (let i = 0; i < arrows.length; i++) {
    const ax = startX + i * (aw + gap);
    const ay = boxY + 100;
    const done    = i < inputSoFar.length;
    const isCur   = !failed && i === inputSoFar.length;
    const isWrong = failed && i === 0;
    const bg = done    ? "rgba(80,200,120,0.7)"
             : isWrong ? "rgba(200,50,50,0.6)"
             : isCur   ? "rgba(255,200,60,0.35)"
             :            "rgba(30,40,60,0.6)";
    const border = done    ? "rgba(120,230,150,0.8)"
                 : isWrong ? "rgba(255,80,80,0.9)"
                 : isCur   ? "rgba(255,220,100,0.9)"
                 :            "rgba(80,100,130,0.4)";
    roundPanel(ax, ay, aw, aw, 8, bg, border, isCur || isWrong ? 2.5 : 1);
    const arrowColor = done    ? "#a0f0b8"
                     : isWrong ? "#ff8080"
                     : isCur   ? "#ffd94f"
                     :            "#6070a0";
    text(arrows[i], ax + aw/2, ay + aw - 8, 26, arrowColor, "900", "center");
  }

  text("W↑  S↓  A←  D→　或方向鍵", cx, boxY + boxH - 18, 11, "rgba(140,160,200,0.6)", "700", "center");
}

// 輪胎歸零畫面
function drawStage5TireOutModal() {
  const ctx = app.ctx;
  ctx.fillStyle = "rgba(0,0,0,0.78)";
  ctx.fillRect(0, 0, app.w, app.h);
  const cx = app.w/2, cy = app.h/2;
  text("輪胎報銷", cx, cy - 40, 48, "#ff6060", "1000", "center");
  text("所有輪胎都用完了", cx, cy + 20, 18, "rgba(255,180,180,0.85)", "700", "center");
  button("replay", "再試一次", cx - 110, cy + 70, 220, 50, false, "primary");
}

// 終點線結束畫面（跑滿 maxRounds 回合觸發）
// 顯示玩家當前名次；第 1 名走勝利風，其餘走中性結算風
function drawStage5FinishLineModal() {
  const ctx = app.ctx;
  ctx.fillStyle = "rgba(0,0,0,0.78)";
  ctx.fillRect(0, 0, app.w, app.h);
  const cx = app.w/2, cy = app.h/2;
  const rank = app.rank || 1;
  const rankTotal = app.rankTotal || 4;
  const isWin = (rank === 1);
  // 標題
  const titleColor = isWin ? "#ffd94f" : "#9ecbff";
  text("衝過終點線！", cx, cy - 80, 48, titleColor, "1000", "center");
  // 副標
  text("比賽結束", cx, cy - 36, 16, "rgba(220,230,255,0.7)", "700", "center");
  // 名次（大字）
  const rankColor = isWin ? "#ffd94f"
                  : rank === 2 ? "#e0e8f5"
                  : rank === 3 ? "#e0b080"
                  :              "rgba(200,210,230,0.85)";
  text(`第 ${rank} 名`, cx, cy + 30, 56, rankColor, "1000", "center");
  text(`（共 ${rankTotal} 名車手）`, cx, cy + 64, 14, "rgba(180,200,230,0.7)", "700", "center");
  // 第 1 名加一句通關語、其他顯示中性結語
  const flavor = isWin ? "🏆 你拿下了冠軍！"
               : rank === 2 ? "差一步登頂——下次再來。"
               : rank === 3 ? "站上頒獎台，但還不夠。"
               :              "比賽結束，再來一場？";
  text(flavor, cx, cy + 96, 14, "rgba(220,230,255,0.85)", "800", "center");
  button("replay", "再試一次", cx - 110, cy + 130, 220, 50, false, isWin ? "start" : "primary");
}

// 三選一獎勵
function drawStage5RewardModal(time) {
  const s5 = app.stage5;
  if (!s5) return;
  const box = getCenteredModalBox(720, 540);
  drawModalPanel(box, "rgba(255,200,80,0.5)");
  const cx = box.x + box.w/2;
  text("✦ 三選一:成長與調整 ✦", cx, box.y+50*UI_SCALE, 22, "#ffd980", "1000", "center");
  text("這場比賽中，你...", cx, box.y+80*UI_SCALE, 13, "rgba(255,230,160,0.75)", "700", "center");
  // 三張卡
  const cardW = 200;
  const cardH = 340;
  const gap = 24;
  const totalW = cardW * 3 + gap * 2;
  const startX = cx - totalW/2;
  const cardY = box.y+110*UI_SCALE;
  for (let i = 0; i < 3; i++) {
    const c = s5.rewardOptions[i];
    if (!c) continue;
    const cx0 = startX + i * (cardW + gap);
    const hov = (s5.rewardSlotHover === i);
    // 卡牌底
    const cardBg = hov ? "rgba(255,220,140,0.95)" : "rgba(245,235,210,0.95)";
    const cardBorder = c.cardClass === "team" ? "rgba(80,160,120,0.9)" : "rgba(200,100,40,0.9)";
    roundPanel(cx0, cardY, cardW, cardH, 14, cardBg, cardBorder, 2);
    // 類別（放大 11→14）
    const typeLabel = c.cardClass === "team" ? "車隊牌" : "指令牌";
    const typeColor = c.cardClass === "team" ? "#3a7a5a" : "#a85020";
    text(typeLabel, cx0 + cardW/2, cardY + 26, 14, typeColor, "800", "center");
    // 名字
    text(c.name, cx0 + cardW/2, cardY + 66, 18, "#2a2418", "900", "center");
    // 中央大字速度（v0.9 UI；speedValue=0 或車隊牌不顯示）
    if (typeof c.speedValue === "number" && c.speedValue !== 0) {
      const sv = c.speedValue;
      const speedStr = sv > 0 ? `+${sv}` : `${sv}`;
      const speedColor = sv > 0 ? "#1a7a30" : "#a02030";
      text(speedStr, cx0 + cardW/2, cardY + 120, 38, speedColor, "1000", "center");
    }
    // 效果敘述（放大 11→14，行距 16→20）
    const lines = wrapTextLines(c.note || "", cardW - 24, 14);
    let ly = cardY + 168;
    for (const ln of lines) {
      text(ln, cx0 + cardW/2, ly, 14, "#3a3020", "700", "center");
      ly += 20;
    }
    // 持續時機 + 進場方式（車隊牌）— 放大 10→13
    if (c.cardClass === "team" && c.persistenceLabel) {
      const isInstant = c.persistence === "permanent";
      const instantLabel = isInstant ? "★ 選後直接進場" : "進牌庫，打出後生效";
      const lblColor = isInstant ? "rgba(180,120,60,0.95)" : "rgba(60,120,90,0.85)";
      text(`⌛ ${c.persistenceLabel}`, cx0 + cardW/2, cardY + cardH - 96, 13, "rgba(60,120,90,0.85)", "700", "center");
      text(instantLabel, cx0 + cardW/2, cardY + cardH - 76, 13, lblColor, "800", "center");
    }
    // 選擇按鈕 - 給足完整高度
    button(`stage5-reward-pick-${i}`, "選這張", cx0 + 14, cardY + cardH - 56, cardW - 28, 44, false, "start");
  }
  button("stage5-reward-skip", "略過（不拿）", cx - 90, box.y+box.h-58*UI_SCALE, 180, 42, false, "gray");
}

// 簡易文字斷行
function wrapTextLines(text, maxWidth, fontSize) {
  if (!text) return [];
  const ctx = app.ctx;
  ctx.save();
  ctx.font = `700 ${(fontSize) * FONT_SCALE}px system-ui`;
  const chars = text.split("");
  const lines = [];
  let cur = "";
  for (const ch of chars) {
    const trial = cur + ch;
    if (ctx.measureText(trial).width > maxWidth && cur.length > 0) {
      lines.push(cur);
      cur = ch;
    } else {
      cur = trial;
    }
  }
  if (cur) lines.push(cur);
  ctx.restore();
  return lines;
}

// 完美過彎：選道介面（其他道亮起、可點切換）
function drawStage5CornerLanePick(time) {
  const ctx = app.ctx;
  // 先畫底層場景
  drawRace(time);
  drawHud(time);
  drawStage5SidePanel(time);
  drawStage5NextCircuit(time);
  drawHand(time);

  // 半透明遮罩讓亮起的道更突出
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(0, 0, app.w, app.h);
  ctx.restore();

  // 計算每道熱區（賽道從 horizon 到底部，用兩個 y 算梯形）
  const h = app.h;
  const horizon = h * 0.38;
  const bottomY = h * 0.95;
  const laneCount = app.laneCount;
  const pulse = 0.5 + Math.sin(time * 0.005) * 0.5;
  const laneRects = [];

  for (let i = 0; i < laneCount; i++) {
    // 每道的近處 (bottomY) 和遠處 (horizon) 中心 X
    const xNear = laneCarX(i, laneCount, bottomY);
    const xFar = laneCarX(i, laneCount, horizon + 80);
    const wNear = (roadLaneBoundsAt(bottomY).right - roadLaneBoundsAt(bottomY).left) / laneCount * 0.85;
    const wFar = (roadLaneBoundsAt(horizon + 80).right - roadLaneBoundsAt(horizon + 80).left) / laneCount * 0.85;
    const isCur = (i === app.playerLane);

    // 畫亮起的梯形
    ctx.save();
    const baseAlpha = isCur ? 0.18 : 0.32 + pulse * 0.18;
    ctx.fillStyle = isCur ? "rgba(120,200,160," + baseAlpha + ")" : "rgba(255,220,90," + baseAlpha + ")";
    ctx.beginPath();
    ctx.moveTo(xFar - wFar/2, horizon + 80);
    ctx.lineTo(xFar + wFar/2, horizon + 80);
    ctx.lineTo(xNear + wNear/2, bottomY);
    ctx.lineTo(xNear - wNear/2, bottomY);
    ctx.closePath();
    ctx.fill();
    // 邊框
    ctx.strokeStyle = isCur ? "rgba(120,220,160,0.95)" : "rgba(255,230,120," + (0.85 + pulse * 0.15) + ")";
    ctx.lineWidth = 3;
    ctx.setLineDash(isCur ? [] : [8, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 道號標籤
    const labelY = (horizon + 80 + bottomY) / 2;
    const labelX = (xFar + xNear) / 2;
    const lbl = isCur ? "原道" : "切到這道";
    text(lbl, labelX, labelY, isCur ? 14 : 18, isCur ? "rgba(150,255,200,0.9)" : "#fff4d6", "900", "center");

    // 紀錄熱區（用底部寬一點的矩形當點擊區）
    laneRects.push({ lane: i, x: xNear - wNear/2, y: horizon + 80, w: wNear, h: bottomY - (horizon + 80) });
  }
  app.cornerLaneRects = laneRects;

  // 頂部提示 + 取消按鈕
  const boxW = 460, boxH = 92;
  const boxX = app.w/2 - boxW/2;
  const boxY = 30;
  roundPanel(boxX, boxY, boxW, boxH, 12, "rgba(6,14,28,0.95)", "rgba(255,220,90,0.6)", 2);
  text("完美過彎：選擇要切換到的道", boxX + boxW/2, boxY + 30, 18, "#ffd980", "1000", "center");
  text("點選任一道（含原道）以結束本次行動", boxX + boxW/2, boxY + 58, 12, "rgba(220,230,255,0.85)", "700", "center");
  button("stage5-corner-cancel-pick", "不換道", app.w - 130, 26, 110, 36, false, "gray");
}


// ─── 遊戲規則頁 ────────────────────────────────────────────────────────────
function drawRulesModal(time) {
  const box = getCenteredModalBox(720, 540);
  drawModalPanel(box, "rgba(255,200,60,0.45)");
  const cx = box.x + box.w/2;
  text("最後車手 / Final Driver", cx, box.y+38*UI_SCALE, 22, "#ffd94f", "1000", "center");
  text("遊戲規則", cx, box.y+68*UI_SCALE, 14, "rgba(220,220,200,0.8)", "700", "center");
  const ctx = app.ctx;
  ctx.save(); ctx.strokeStyle="rgba(255,200,60,0.3)"; ctx.lineWidth=1; ctx.setLineDash([5,5]);
  ctx.beginPath(); ctx.moveTo(box.x+40*UI_SCALE,box.y+90*UI_SCALE); ctx.lineTo(box.x+box.w-40*UI_SCALE,box.y+90*UI_SCALE); ctx.stroke();
  ctx.setLineDash([]); ctx.restore();
  const sections = [
    ["遊戲目標", "從第 5 名超越所有對手，奪得第 1 名。"],
    ["打牌", "拖牌到自己道：施加速度效果。拖到其他道：換道（棄此牌）。"],
    ["超車", "速度 ≥ 對手 → 直接超車；同道 → 強制 QTE 超車。"],
    ["防守 QTE", "Pass 時觸發，按住節奏圈圈拍中央。"],
    ["排名變動", "成功超車 +1 名次；防守失敗 -1（最低第 4 名）。"],
    ["賽段循環", "每次推進切換下一賽段：直線 / 彎道 / 急彎 / 坑洞 / 油污 / 紅綠燈。"],
    ["三選一", "每次超車成功可從三張牌中選 1 張永久加入牌庫。"],
    ["卡牌類別", "指令牌：立即效果，打出消失。 / 車隊牌：留場持續生效。"],
  ];
  let y = box.y+110*UI_SCALE;
  const padX = 40;
  for (const [k, v] of sections) {
    text(k, box.x + padX, y, 14, "#7be0a0", "900", "left");
    text(v, box.x + padX + 110, y, 12, "#e8f0ff", "700", "left");
    y += 32;
  }
  button("close-rules", "關閉", cx - 80, box.y+box.h-56*UI_SCALE, 160, 40, false, "primary");
}


// ─── QTE 相關繪製（沿用 Sam）─────────────────────────────────────────────
function drawSplash() {
  const ctx = app.ctx;
  ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(0,0,app.w,app.h);
  text(app.message, app.w/2, app.h*0.26, 38, "#ffd94f", "1000", "center");

  // 三種 QTE splash 都顯示難度面板 + 確認鍵
  const isOvertake = app.mode === "splash-overtake";
  const isDefense  = app.mode === "splash-defense";
  const isBend     = app.mode === "splash-bend";
  if (!isOvertake && !isDefense && !isBend) return;

  const qteType = isOvertake ? "overtake" : isDefense ? "defense" : "bend";
  drawQteDifficultyPanel(qteType);

  // 確認鍵
  const btnId = isOvertake ? "qte-confirm-overtake"
              : isDefense  ? "qte-confirm-defense"
              :              "qte-confirm-bend";
  const btnW = 200 * UI_SCALE;
  const btnH = 48 * UI_SCALE;
  const btnX = (app.w - btnW) / 2;
  const btnY = app.h * 0.42 + 240 * UI_SCALE;
  button(btnId, "開始 QTE", btnX, btnY, btnW, btnH, false, "start");
}

// 三種 QTE 共用的難度面板（splash 階段顯示）
//   - overtake: 圓圈數、間隔
//   - defense:  總時長、難度級別
//   - bend:     箭頭數、時限
function drawQteDifficultyPanel(qteType) {
  const ctx = app.ctx;
  const speed = app.playerSpeed;
  const speedComponent = Math.max(0, Math.floor((speed - 10) / 30));
  const laneBonus = getLaneBonusFor(app.playerLane);
  const offset = (laneBonus && typeof laneBonus.qteDifficultyOffset === "number")
    ? laneBonus.qteDifficultyOffset : 0;
  const step = Math.max(0, speedComponent + offset);

  // 各 QTE 的副標
  let subline = "";
  if (qteType === "overtake") {
    const circleCount = Math.min(10, Math.round(5 * Math.pow(1.10, step)));
    const qteDiff = currentLaneQteDiff();
    const intervalScale = qteDiff === "easy" ? 1.25 : qteDiff === "hard" ? 0.75 : 1.0;
    const interval = Math.round(620 * intervalScale);
    subline = `圓圈 ${circleCount} 顆　間隔 ${interval}ms`;
  } else if (qteType === "defense") {
    const totalSecs = Math.max(3, 10 * Math.pow(0.90, step));
    subline = `防守時長 ${totalSecs.toFixed(1)} 秒`;
  } else { // bend
    const totalSecs = Math.max(2, 6 * Math.pow(0.90, step));
    const arrowCount = Math.min(12, 2 + step * 2);
    subline = `箭頭 ${arrowCount} 個　時限 ${totalSecs.toFixed(1)} 秒`;
  }

  // 道路節奏只在超車 QTE 顯示（其他兩種不吃 qteDiff）
  const showQteDiff = (qteType === "overtake");
  const qteDiff = showQteDiff ? currentLaneQteDiff() : null;

  const panelW = 460 * UI_SCALE;
  const panelH = (showQteDiff ? 220 : 194) * UI_SCALE;
  const panelX = (app.w - panelW) / 2;
  const panelY = app.h * 0.42;
  roundPanel(panelX, panelY, panelW, panelH, 12,
    "rgba(12,18,30,0.92)", "rgba(255,217,79,0.5)", 2);

  // 標題
  text("QTE 難度", panelX + panelW / 2, panelY + 28 * UI_SCALE, 14,
    "rgba(255,217,79,0.7)", "700", "center");

  // 大數字
  text(`${step}`, panelX + panelW / 2, panelY + 78 * UI_SCALE, 44,
    "#ffd94f", "1000", "center");
  text(subline, panelX + panelW / 2, panelY + 102 * UI_SCALE, 12,
    "rgba(220,230,245,0.7)", "700", "center");

  // 分隔線
  ctx.save();
  ctx.strokeStyle = "rgba(255,217,79,0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(panelX + 30 * UI_SCALE, panelY + 122 * UI_SCALE);
  ctx.lineTo(panelX + panelW - 30 * UI_SCALE, panelY + 122 * UI_SCALE);
  ctx.stroke();
  ctx.restore();

  const rowY1 = panelY + 144 * UI_SCALE;
  const rowY2 = panelY + 168 * UI_SCALE;
  const rowY3 = panelY + 192 * UI_SCALE;
  const labelX = panelX + 40 * UI_SCALE;
  const valueX = panelX + panelW - 40 * UI_SCALE;

  // 第 1 列：速度
  text(`速度 ${speed}`, labelX, rowY1, 12,
    "rgba(200,215,235,0.85)", "700", "left");
  text(`${speedComponent}`, valueX, rowY1, 14,
    "#dfeeff", "900", "right");

  // 第 2 列：道路加成
  if (offset !== 0) {
    const offsetColor = offset > 0 ? "rgba(255,150,140,0.95)" : "rgba(140,230,170,0.95)";
    const offsetSign = offset > 0 ? "+" : "";
    text(`道路加成　${laneBonus.label || ""}`, labelX, rowY2, 12,
      "rgba(200,215,235,0.85)", "700", "left");
    text(`${offsetSign}${offset}`, valueX, rowY2, 14,
      offsetColor, "900", "right");
  } else {
    text(`道路加成　無`, labelX, rowY2, 12,
      "rgba(160,175,195,0.6)", "700", "left");
    text(`0`, valueX, rowY2, 14,
      "rgba(160,175,195,0.6)", "900", "right");
  }

  // 第 3 列：道路節奏（只有超車 QTE 顯示）
  if (showQteDiff) {
    const diffLabel = qteDiff === "easy" ? "易（圓圈間距 ×1.25）"
                    : qteDiff === "hard" ? "難（圓圈間距 ×0.75 + 抖動）"
                    : "一般";
    const diffColor = qteDiff === "easy" ? "rgba(140,230,170,0.95)"
                    : qteDiff === "hard" ? "rgba(255,150,140,0.95)"
                    : "rgba(200,215,235,0.85)";
    text(`道路節奏　${diffLabel}`, labelX, rowY3, 12,
      diffColor, "700", "left");
  }
}

function drawOvertakeAnim(time) {
  if (!app.overtakeAnim) return;
  const ctx = app.ctx;
  const elapsed = time - app.overtakeAnim.startTime;
  const t = Math.min(1, elapsed / 2000); // 0→1 over 2 seconds

  // Phase 1 (0~0.45)：我方車子往前衝，追上對手
  // Phase 2 (0.45~0.65)：超越對手瞬間（閃光）
  // Phase 3 (0.65~1)：對手車出現在遠方右側縮小

  const h = app.h, w = app.w;

  // 半透明暗幕
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, 0, w, h);

  // ── 我方車（白）──────────────────────────────────────────────
  // t=0：車在 0.80h；t=0.45：衝到 0.60h（超越位置）；t之後：慢慢前進到 0.55h
  let whiteY;
  if (t < 0.45) {
    const p = t / 0.45;
    whiteY = h * (0.80 - p * 0.20); // 0.80 → 0.60
  } else {
    const p = (t - 0.45) / 0.55;
    whiteY = h * (0.60 - p * 0.05); // 0.60 → 0.55
  }
  const whiteW = 176;
  const whiteX = w / 2;
  drawCar(whiteX, whiteY, whiteW, 82, "#dceaff");

  // ── 對手車（紅）──────────────────────────────────────────────
  // t=0→0.45：對手在 0.68h（我方追近）；t=0.45 超車瞬間
  // t=0.45→0.65：對手快速縮小後退到右側遠方出現
  // t=0.65→1：對手維持在右側遠方小小的
  if (t < 0.45) {
    // 對手靜止，我方靠近
    const redY = h * 0.65;
    drawCar(whiteX, redY, 82, 40, "#e94d48");
  } else if (t < 0.65) {
    // 超越瞬間：對手快速退到右側遠方
    const p = (t - 0.45) / 0.20;
    const ease = p * p; // ease in
    const redY = h * (0.65 + ease * 0.10); // 往後退
    const redW = Math.round(82 * (1 - ease * 0.5)); // 縮小
    const redX = whiteX + ease * w * 0.18; // 往右移
    if (redW > 4) drawCar(redX, redY, redW, Math.round(40 * (1 - ease * 0.5)), "#e94d48");

    // 超越閃光
    const flashAlpha = (1 - p) * 0.6;
    ctx.save();
    ctx.fillStyle = `rgba(255, 220, 100, ${flashAlpha})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  } else {
    // 對手縮小出現在右側遠方
    const p = (t - 0.65) / 0.35;
    const redY = h * (0.75 - p * 0.08); // 從 0.75 往前一點
    const redW = 34;
    const redX = whiteX + w * 0.22;
    drawCar(redX, redY, redW, 17, "#e94d48");
  }

  // 「超車成功！」文字淡入
  if (t > 0.65) {
    const alpha = (t - 0.65) / 0.35;
    text("超車成功！", w/2, h * 0.28, 48, `rgba(87,229,133,${alpha})`, "1000", "center");
  }
}

function drawRhythm(time) {
  const pos = app.qteScatterPos;
  app.zones.circles = [];

  // 底部按鍵提示列
  const keyLabels = ['Q','W','E','R'];
  const kbY = app.h - 42;
  text("按鍵：", app.w/2 - 160, kbY, 14, "rgba(180,180,180,0.7)", "700", "center");
  keyLabels.forEach((k, i) => {
    const kx = app.w/2 - 60 + i * 44;
    roundPanel(kx-16, kbY-18, 32, 28, 6, "rgba(20,30,50,0.9)", "rgba(255,217,79,0.55)", 1.5);
    text(k, kx, kbY, 16, "rgba(255,217,79,0.9)", "900", "center");
  });

  const circleCount = app.qteCircleCount || 5;
  for (let i = 0; i < circleCount; i++) {
    const start = app.qteCircleStarts[i] ?? app.qteStart;
    const elapsed = time - start;
    if (elapsed < 0) continue;
    const dur = getRhythmDuration(i);
    const progress = Math.min(1, elapsed / dur);
    const finalized = app.qteFinalized[i];
    const dismissAt = app.qteDismissAt[i];
    if (finalized && dismissAt && time > dismissAt) continue;
    const outerR = RHYTHM_OUTER_R;
    let x, y;
    if (pos && pos[i]) { x = pos[i].x; y = pos[i].y; }
    else {
      const gap2 = Math.min(110, app.w * 0.075);
      x = app.w/2 - gap2 * Math.floor(circleCount / 2) + i * gap2;
      y = app.h * 0.44;
    }
    app.zones.circles.push({ i, x, y, r: outerR, duration: dur });
    const ctx = app.ctx;
    const keyLabel = (app.qteKeys[i] ?? '?').toUpperCase();
    ctx.save();

    // 外圈
    ctx.beginPath(); ctx.arc(x, y, outerR, 0, Math.PI*2);
    ctx.strokeStyle="rgba(255,217,79,0.9)"; ctx.lineWidth=3; ctx.stroke();

    // 收縮內圈
    if (!finalized) {
      const innerR = outerR * (1 - progress);
      ctx.beginPath(); ctx.arc(x, y, Math.max(2, innerR), 0, Math.PI*2);
      ctx.strokeStyle="rgba(255,150,80,0.7)"; ctx.lineWidth=2; ctx.stroke();
      // 圓圈中央顯示按鍵字母
      text(keyLabel, x, y+8, 22, "rgba(255,217,79,0.95)", "900", "center");
      // 下方小鍵盤圖示
      roundPanel(x-14, y+outerR+6, 28, 22, 5, "rgba(20,30,50,0.9)", "rgba(255,217,79,0.5)", 1.5);
      text(keyLabel, x, y+outerR+20, 13, "rgba(255,217,79,0.9)", "900", "center");
    }

    // 判定結果
    if (finalized && dismissAt && time <= dismissAt) {
      const result = app.qteResults[i];
      const col = result==="perfect"?"#ffd94f":result==="good"?"#80ef70":"#ff6b7a";
      const label = result==="perfect"?"Perfect!":result==="good"?"Good":"Miss";
      text(label, x, y+6, 16, col, "900", "center");
    }
    ctx.restore();
  }
}

function drawDefense() {
  const ctx = app.ctx;
  const DEFENSE_TOTAL_MS = app.defenseTotalMs || 10000;
  const elapsed  = performance.now() - (app.defenseStart || 0);
  const remaining = Math.max(0, 1 - elapsed / DEFENSE_TOTAL_MS);

  const bar = { x:app.w/2-360, y:app.h*0.36, w:720, h:72 };
  app.zones.defenseBar = bar;
  const diff = defenseDifficulty();
  panel(bar.x-24, bar.y-34, bar.w+48, 172, "rgba(5,8,8,0.42)", "rgba(105,164,224,0.35)");
  roundPanel(bar.x, bar.y, bar.w, bar.h, 12, "rgba(229,70,74,0.9)", "rgba(247,250,247,0.35)", 2);
  const safeW = bar.w*(diff.safeWidth/100);
  const perfectW = bar.w*(diff.perfectWidth/100);
  const safeX = bar.x+(app.safeCenter/100)*bar.w - safeW/2;
  roundPanel(safeX, bar.y, safeW, bar.h, 10, "rgba(122,221,123,0.58)", "rgba(122,221,123,0.28)", 2);
  roundPanel(bar.x+(app.safeCenter/100)*bar.w-perfectW/2, bar.y, perfectW, bar.h, 8, "rgba(37,209,127,0.86)", "rgba(37,209,127,0.26)", 2);
  const cursorX = Math.max(bar.x, Math.min(bar.x+bar.w, app.mouse.x));
  roundPanel(cursorX-18, bar.y+bar.h/2-12, 36, 24, 6, "#ffd94f", "#ffe15b", 2);
  panel(bar.x, bar.y+104, bar.w, 18, "rgba(14,20,30,0.92)", "rgba(247,250,247,0.18)");
  ctx.fillStyle = "#57e585";
  ctx.fillRect(bar.x+3, bar.y+107, (bar.w-6)*Math.min(1,app.defenseProgress/100), 12);
  text("移動滑鼠，追住快速移動的綠色區域", app.w/2, bar.y+152, 20, "#ffd94f", "900", "center");

  // 倒數計時條（防守 QTE 剩餘時間）
  const timerY = bar.y - 28;
  const timerW = bar.w;
  roundPanel(bar.x, timerY, timerW, 12, 4, "rgba(10,16,28,0.85)", "rgba(255,160,60,0.3)", 1);
  const timerColor = remaining > 0.4 ? "#57e585" : remaining > 0.2 ? "#ffd94f" : "#ff6060";
  ctx.fillStyle = timerColor;
  ctx.fillRect(bar.x + 2, timerY + 2, (timerW - 4) * remaining, 8);
  const secsLeft = Math.ceil(remaining * DEFENSE_TOTAL_MS / 1000);
  text(`${secsLeft}s`, bar.x + timerW + 10, timerY + 10, 12, timerColor, "900");
}

// ─── 表情 Dock（沿用 Sam 的 dock，簡化情緒邏輯）────────────────────────
function getExpressionState(time) {
  const m = app.mode;
  if (m==="playing") {
    const spd = currentLaneSpeed();
    if (spd === 0) return { mood:"nervous", label:"等待指令" };
    if (canDirectOvertake()) return { mood:"relaxed", label:"可以超車！" };
    return { mood:"nervous", label:"累積中…" };
  }
  if (m==="rhythm-formal") {
    const misses = Object.values(app.qteResults).filter(r=>r==="miss").length;
    if (misses>=2) return { mood:"sweat", label:"QTE 危機" };
    return { mood:"nervous", label:"QTE 高壓" };
  }
  if (m==="defense") return app.defenseProgress>=70 ? { mood:"relaxed",label:"防守穩住" } : { mood:"sweat",label:"防守緊張" };
  if (m==="result") return { mood:"relaxed", label:"超車成功！" };
  if (m==="defense-result") return app.defenseSucceeded ? { mood:"relaxed",label:"防守成功" } : { mood:"sweat",label:"防守失敗" };
  return { mood:"nervous", label:"待命" };
}

function drawExpressionFace(ctx, mood, cx, cy, s) {
  const skin="#f2e8dc", line="#1a2838", blush="rgba(255,120,100,0.35)";
  ctx.lineCap="round"; ctx.lineJoin="round";
  ctx.fillStyle=skin; ctx.beginPath(); ctx.arc(cx,cy,s*0.42,0,Math.PI*2); ctx.fill();
  if (mood==="relaxed") {
    ctx.fillStyle=blush; ctx.beginPath();
    ctx.arc(cx-s*0.16,cy+s*0.02,s*0.06,0,Math.PI*2);
    ctx.arc(cx+s*0.16,cy+s*0.02,s*0.06,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle=line; ctx.lineWidth=Math.max(1.5,s*0.04);
    ctx.beginPath(); ctx.arc(cx,cy+s*0.04,s*0.14,0.15*Math.PI,0.85*Math.PI); ctx.stroke();
    ctx.fillStyle=line; ctx.beginPath();
    ctx.arc(cx-s*0.16,cy-s*0.06,s*0.045,0,Math.PI*2);
    ctx.arc(cx+s*0.16,cy-s*0.06,s*0.045,0,Math.PI*2); ctx.fill();
  } else if (mood==="nervous") {
    ctx.strokeStyle=line; ctx.lineWidth=Math.max(1.5,s*0.045);
    ctx.beginPath(); ctx.ellipse(cx-s*0.14,cy-s*0.05,s*0.07,s*0.1,0,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx+s*0.14,cy-s*0.05,s*0.07,s*0.1,0,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx-s*0.16,cy+s*0.14); ctx.lineTo(cx+s*0.16,cy+s*0.14); ctx.stroke();
  } else { // sweat
    drawExpressionFace(ctx,"nervous",cx,cy,s);
    const dcx=cx+s*0.32,dcy=cy-s*0.28;
    ctx.fillStyle="#5ec8eb";
    ctx.beginPath(); ctx.moveTo(dcx,dcy-s*0.02);
    ctx.bezierCurveTo(dcx+s*0.12,dcy-s*0.08,dcx+s*0.1,dcy+s*0.12,dcx,dcy+s*0.16);
    ctx.bezierCurveTo(dcx-s*0.08,dcy+s*0.1,dcx-s*0.1,dcy-s*0.02,dcx,dcy-s*0.02);
    ctx.fill();
  }
}

function drawExpressionDock(time) {
  const ctx = app.ctx;
  const { mood, label } = getExpressionState(time);
  const R=Math.min(56,app.w*0.072);
  const cx=18+R, cy=app.h-20-R-10;
  const COL={ fill:"rgba(8,22,42,0.88)", dash:"rgba(110,210,255,0.82)", glow:"rgba(80,200,255,0.25)", pillBg:"rgba(6,14,26,0.94)", pillBorder:"rgba(255,210,100,0.55)", pillText:"#ffe9b0" };
  ctx.save();
  ctx.shadowColor=COL.glow; ctx.shadowBlur=14;
  ctx.fillStyle=COL.fill; ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2); ctx.fill();
  ctx.shadowBlur=0;
  ctx.strokeStyle=COL.dash; ctx.lineWidth=2.5; ctx.setLineDash([7,5]);
  ctx.beginPath(); ctx.arc(cx,cy,R-1.5,0,Math.PI*2); ctx.stroke();
  ctx.setLineDash([]);
  drawExpressionFace(ctx,mood,cx,cy,R*2.1);
  const pillH=26, py=cy+R-18;
  ctx.font=`800 ${12 * FONT_SCALE}px system-ui,"Microsoft JhengHei",sans-serif`;
  ctx.textAlign="center";
  const pillW=Math.min(120,Math.max(88,ctx.measureText(label).width+30));
  roundPanel(cx-pillW/2,py,pillW,pillH,12,COL.pillBg,COL.pillBorder,2);
  ctx.textBaseline="middle"; ctx.fillStyle=COL.pillText;
  ctx.fillText(label,cx,py+pillH/2+0.5);
  ctx.restore();
}

// ─── 通用工具（沿用 Sam）─────────────────────────────────────────────────
// 設定 ctx 字體（自動套用 FONT_SCALE）
//   用法：setFont(ctx, 13, "800")
function setFont(ctx, size, weight = "700") {
  ctx.font = `${weight} ${size * FONT_SCALE}px system-ui,"Microsoft JhengHei",sans-serif`;
}
// 量字寬度（自動套用 FONT_SCALE）
//   用法：const w = measureScaled(ctx, "hello", 13, "800")
function measureScaled(ctx, str, size, weight = "700") {
  ctx.save();
  setFont(ctx, size, weight);
  const w = ctx.measureText(str).width;
  ctx.restore();
  return w;
}

function text(message, x, y, size, color, weight="700", align="left", noShadow=false) {
  const ctx=app.ctx; ctx.save();
  const scaledSize = size * FONT_SCALE;
  ctx.fillStyle=color; ctx.font=`${weight} ${scaledSize}px system-ui,"Microsoft JhengHei",sans-serif`;
  ctx.textAlign=align; ctx.textBaseline="alphabetic";
  if(!noShadow){ctx.shadowColor="rgba(0,0,0,0.55)";ctx.shadowBlur=6;}
  ctx.fillText(message,x,y); ctx.restore();
}

// 不套用 FONT_SCALE 的原始大小（給牌面數字等固定大小用）
function textRaw(message, x, y, size, color, weight="700", align="left", noShadow=false) {
  const ctx=app.ctx; ctx.save();
  ctx.fillStyle=color; ctx.font=`${weight} ${size}px system-ui,"Microsoft JhengHei",sans-serif`;
  ctx.textAlign=align; ctx.textBaseline="alphabetic";
  if(!noShadow){ctx.shadowColor="rgba(0,0,0,0.55)";ctx.shadowBlur=6;}
  ctx.fillText(message,x,y); ctx.restore();
}

function panel(x,y,w,h,fill,stroke="rgba(255,255,255,0.2)",dashed=false) {
  roundPanel(x,y,w,h,10,fill,stroke,3,dashed?[8,6]:[]);
}

function roundPanel(x,y,w,h,radius,fill,stroke="rgba(255,255,255,0.2)",line=3,dash=[]) {
  const ctx=app.ctx; ctx.save();
  ctx.beginPath();
  ctx.moveTo(x+radius,y); ctx.lineTo(x+w-radius,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+radius);
  ctx.lineTo(x+w,y+h-radius); ctx.quadraticCurveTo(x+w,y+h,x+w-radius,y+h);
  ctx.lineTo(x+radius,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-radius);
  ctx.lineTo(x,y+radius); ctx.quadraticCurveTo(x,y,x+radius,y);
  ctx.closePath();
  ctx.fillStyle=fill; ctx.strokeStyle=stroke; ctx.lineWidth=line; ctx.setLineDash(dash);
  ctx.fill(); ctx.stroke(); ctx.restore();
}

function button(id,label,x,y,w,h,disabled=false,variant="primary") {
  app.zones.buttons.push({id,rect:{x,y,w,h},disabled});
  const gray=variant==="gray", start=variant==="start";
  const fill=disabled
    ? (gray?"rgba(54,60,70,0.45)":start?"rgba(91,34,34,0.52)":"rgba(20,44,72,0.5)")
    : (gray?"rgba(70,76,88,0.88)":start?"rgba(169,39,42,0.94)":"rgba(20,44,72,0.9)");
  const stroke=gray?"rgba(190,198,210,0.46)":start?"rgba(255,188,108,0.88)":"rgba(105,164,224,0.55)";
  if (start&&!disabled) {
    const ctx=app.ctx; ctx.save(); ctx.shadowColor="rgba(255,74,54,0.42)"; ctx.shadowBlur=18;
    roundPanel(x-2,y-2,w+4,h+4,10,"rgba(255,78,54,0.16)","rgba(255,211,116,0.34)",2);
    ctx.restore();
  }
  roundPanel(x,y,w,h,10,fill,stroke);
  // 文字位置：用 h 的比例自適應、不寫死、避免 FONT_SCALE 變大時跑位
  text(label,x+w/2,y+h*0.66,16,disabled?"rgba(216,236,255,0.55)":start?"#fff4d6":"#d8ecff",start?"1000":"800","center");
}

function hitButton(p) {
  const hit=(app.zones.buttons||[]).find(item=>!item.disabled&&inRect(p,item.rect));
  return hit&&hit.id;
}

function inRect(p,r) { return r&&p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h; }
function dist(x1,y1,x2,y2) { return Math.hypot(x1-x2,y1-y2); }

// ─── Win Overlay ──────────────────────────────────────────────────────────
function hideGameWinOverlay() {
  if (!app.winOverlay) return;
  if (app.winReplayTimer) { clearTimeout(app.winReplayTimer); app.winReplayTimer=0; }
  app.winOverlay.classList.remove("qte-win-overlay--visible","qte-win-overlay--replay-ready");
  app.winOverlay.classList.add("hidden");
}

// ─── Main Loop ────────────────────────────────────────────────────────────
function loop(time) {
  // resize 改由 StoryCanvasViewport.bindCanvasResize 監聽（在 start() 內註冊）
  // 不再每幀 resize
  update(time);
  draw(time);
  requestAnimationFrame(loop);
}

function resize() {
  // 用 StoryCanvasViewport library 處理 letterbox + DPR + viewport state
  const SCV = window.StoryCanvasViewport;
  if (!SCV) {
    console.error("StoryCanvasViewport library 未載入");
    return;
  }
  if (!app.viewport) {
    app.viewport = SCV.createViewportState(DESIGN_W, DESIGN_H);
  }
  // resizeCanvasToDisplay：設定 canvas.width/height、setTransform(dpr,...)、更新 viewport state
  // 注意：library 內 setTransform 只套 DPR、不套 finalScale
  //      我們之後再套 design transform 給整個 frame
  SCV.resizeCanvasToDisplay(app.canvas, app.ctx, app.viewport, { useUiScale: true });

  // app.w / app.h 永遠是設計稿大小（給遊戲程式碼用）
  app.w = DESIGN_W;
  app.h = DESIGN_H;
  app.dpr = app.viewport.dpr;
}

function start(root) {
  app.root = root;
  document.body.classList.add("qte-active","qte-canvas-only");
  root.classList.remove("hidden");
  root.innerHTML = `<canvas class="qte-full-canvas" aria-label="Final Driver Prototype"></canvas>
<div id="qteWinOverlay" class="qte-win-overlay hidden" aria-hidden="true">
<div class="qte-win-ribbons" aria-hidden="true"></div>
<div class="qte-win-content">
  <p class="qte-win-sub"></p>
  <h1 class="qte-win-title">遊戲獲勝</h1>
  <button type="button" class="qte-win-replay" id="qteWinReplay">再玩一次</button>
</div>
</div>`;
  app.canvas = root.querySelector("canvas");
  app.ctx = app.canvas.getContext("2d");
  app.winOverlay = root.querySelector("#qteWinOverlay");
  if (app.winOverlay) {
    app.winOverlay.addEventListener("click", e => {
      if (e.target.closest("#qteWinReplay")) { hideGameWinOverlay(); reset(); }
    });
  }
  setupInput();
  // 註冊 viewport 自動 resize（RAF + ResizeObserver + IntersectionObserver）
  const SCV = window.StoryCanvasViewport;
  if (SCV) {
    if (!app.viewport) {
      app.viewport = SCV.createViewportState(DESIGN_W, DESIGN_H);
    }
    SCV.bindCanvasResize(app.canvas, app.ctx, app.viewport, () => {
      app.w = DESIGN_W;
      app.h = DESIGN_H;
      app.dpr = app.viewport.dpr;
    }, { useUiScale: true });
  } else {
    // fallback：原本的 resize
    resize();
    window.addEventListener("resize", resize);
  }
  reset();
  requestAnimationFrame(loop);
}

export { start };
