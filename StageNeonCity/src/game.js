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
  STAGE2_OPPONENTS,
  STAGE2_CIRCUITS,
  STAGE2_NORMAL_CIRCUITS_POOL,
  STAGE2_COMMAND_CARDS,
  STAGE2_TEAM_CARDS,
  STAGE2_ALL_CARDS,
  BOSS_TASK_POOL,
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

// 換道扣速公式：1 道 10、2 道 15、3 道 20...（10 + 5 × (lanes - 1)）
// 只用於玩家換道；對手不適用
function laneChangeCost(lanes) {
  if (lanes <= 0) return 0;
  return 10 + 5 * (lanes - 1);
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
  if (!isStage2()) return false;
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
// 玩家速度變動（內部用）。Esp 結算另外處理、見 playerSpeedSource。
function applyPlayerActionDelta(delta) {
  app.playerSpeed = app.playerSpeed + delta;
  if (app.playerSpeed < 0) app.playerSpeed = 0;
}

// ─── 玩家速度來源（pop + apply + 企業間諜 per-source 抽成）─────────────
// 統一的「玩家速度變動 + 飛字 + Boss 抽成」入口
//   delta — 本來源的速度增減（含正負）
//   label — 飛字顯示的來源名（"加速"、"尾流"、"連擊"、"順風道" 等）
//   color — 飛字顏色（可選、不傳用預設色）
// 行為：
//   1. 推來源飛字
//   2. 套用到玩家速度
//   3. 若企業間諜本動 active → Boss 取走 50%（玩家損失、Boss 取得、累計顯示）
function playerSpeedSource(delta, label, color = null) {
  if (delta === 0) return;
  const before = app.playerSpeed;
  pushSpeedDeltaPop("player", delta, label, color);
  app.playerSpeed = app.playerSpeed + delta;
  if (app.playerSpeed < 0) app.playerSpeed = 0;
  // 企業間諜 per-source 結算（轉嫁 50%、玩家失去、Boss 取得）
  if (app.espionageActiveThisAction) {
    applyEspionageTransfer(delta);
  }
  // 績效考核「累積淨加速」用：發送 net delta event（含 espionage 抽走後）
  const netDelta = app.playerSpeed - before;
  if (netDelta !== 0) {
    updateBossTaskProgress("speedDelta", { delta: netDelta });
  }
}

// 企業間諜 per-source 結算
//   playerDelta — 本次來源的速度增減（玩家視角）
// 機制：50% 轉嫁、玩家失去 skim、Boss 取得 skim
//   正向 delta（玩家 +30）→ skim +15、玩家 -15、Boss +15
//   負向 delta（玩家 -10）→ skim -5、玩家 +5（少虧 5）、Boss -5

// 取得當前有效抽成 ratio（依 buff/debuff 層數）
//   基礎 50%、每層 buff +10%、每層 debuff -10%
//   範圍：Buff 3 → 80%、Debuff 3 → 20%
function getEffectiveEspionageRatio() {
  const boss = app.stage2?.boss;
  if (!boss) return 0.5;
  const buff = boss.buffStacks || 0;
  const debuff = boss.debuffStacks || 0;
  return Math.max(0, Math.min(1, 0.5 + buff * 0.10 - debuff * 0.10));
}

function applyEspionageTransfer(playerDelta) {
  // 抽成依 buff / debuff 層數：base 50% ± 10% per stack
  // Buff 1/2/3 → 60% / 70% / 80%；Debuff 1/2/3 → 40% / 30% / 20%
  const ratio = getEffectiveEspionageRatio();
  const skim = Math.trunc(playerDelta * ratio);
  if (skim === 0) return;
  // 玩家失去 skim
  app.playerSpeed = app.playerSpeed - skim;
  if (app.playerSpeed < 0) app.playerSpeed = 0;
  // Boss 取得 skim
  app.opponentSpeed = app.opponentSpeed + skim;
  if (app.opponentSpeed < 0) app.opponentSpeed = 0;
  // 累計顯示
  const boss = (app.stage2.boss = app.stage2.boss || {});
  boss.espionageCumulative = (boss.espionageCumulative || 0) + skim;
  // 飛字：玩家側「-N 被抽成」（負號跟 skim 反向）、Boss 側「+N 企業間諜（累計）」
  pushSpeedDeltaPop("player", -skim, "被抽成", "rgba(255,100,150,0.95)");
  pushSpeedDeltaPop("opponent", skim, `企業間諜（${boss.espionageCumulative}）`, "rgba(255,100,200,0.95)");
  // 視覺特效：玩家→Boss 紅紫資料光束（負 skim 反向）
  spawnEspionageBeam(skim);
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
  if (!isStage2()) return;
  const b = getLaneBonusFor(app.playerLane);
  const add  = b?.add  ?? 0;
  const mult = b?.mult ?? 1;
  const laneName = extractLaneLabelName(b?.label);
  // add 階段：用 playerSpeedSource（含 espionage 抽成）
  if (add) {
    playerSpeedSource(add, laneName);
  }
  // mult 階段：算出 ×mult 後的差值、用 `×N 車道名 +diff` 顯示 + 套用 + espionage 抽成
  if (mult !== 1) {
    const before = app.playerSpeed;
    const afterMult = Math.floor(before * mult);
    const diff = afterMult - before;
    if (diff !== 0) {
      pushSpeedMultPop("player", mult, laneName, diff);
      app.playerSpeed = afterMult;
      if (app.playerSpeed < 0) app.playerSpeed = 0;
      if (app.espionageActiveThisAction) {
        applyEspionageTransfer(diff);
      }
      // 績效考核 net delta event
      const netDelta = app.playerSpeed - before;
      if (netDelta !== 0) {
        updateBossTaskProgress("speedDelta", { delta: netDelta });
      }
    }
  }
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
  if (!isStage2()) return currentSpeed;
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
function calcOpponentSpeedAtLane(laneIdx, bypassAura = false) {
  return applyOpponentBonus(app.opponentSpeed, laneIdx, bypassAura);
}

// 賽道結算：incremental 更新 opponentSpeed
// 每個玩家動作完成、advanceCircuitOnCard 中段呼叫
function resolveOpponentCircuit() {
  if (!isStage2()) return;
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

// 空力區（穩定區）：每張牌讓「道路節奏」往易方向降一階
//   tier 數字： hard=1、normal=0、easy=-1
//   每張穩定牌 -1 tier、封頂 easy（-1）
function qteDiffToTier(diff) {
  if (diff === "hard") return 1;
  if (diff === "easy") return -1;
  return 0;
}
function tierToQteDiff(tier) {
  if (tier >= 1)  return "hard";
  if (tier <= -1) return "easy";
  return "normal";
}
// 把所在道的 qteDiff 扣掉穩定區張數後的最終 qteDiff
// 注意：空力區效果現在改由 speedTierStep 處理（直接降 tier）
// 這個函式現在只回傳本道天然的 qteDiff（hard/normal/easy）、不再被 stab 影響
function currentLaneQteDiffResolved() {
  return currentLaneQteDiff();
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
  // 賽道難度（吃穩定區修正後）
  const diff = currentLaneQteDiffResolved();
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
  const def = STAGE2_ALL_CARDS[type];
  if (!def) {
    console.warn(`[makeCard] unknown card type: ${type}`);
    return { type, name: `[?] ${type}`, speedValue: 0, cardClass: "action", id: `${type}-${suffix}` };
  }
  return { ...def, id: `${type}-${suffix}` };
}

// ─── 主關卡支援函式 ────────────────────────────────────────────────────────
// 建立第五關的卡（從 STAGE2_ALL_CARDS 取定義）
let _stage2CardSeq = 0;
function makeStage2Card(type) {
  const def = STAGE2_ALL_CARDS[type];
  if (!def) return null;
  _stage2CardSeq += 1;
  // 用 spread 自動帶所有欄位（trigger / qteForgive / smoothOperator
  //  / driftQte / requireBend / drawNextHand 等都會自動跟著、不會再漏）
  return { ...def, id: `s2-${type}-${_stage2CardSeq}` };
}

// 算「車隊牌全域修飾後的指令牌速度」+ 是否被修飾
//   只算「對所有指令牌都有影響」的修飾、不算「連擊型」（rhythmCoach 連擊不顯示在牌面）
//   也不算 smoothOperator（這是牌自己的條件、不是車隊牌修飾）
// 回傳：{ value: 結算後的速度, modified: 是否被車隊牌動過, delta: 變化量 }
function getCardEffectiveSpeed(card) {
  const base = card.speedValue || 0;
  if (!isStage2() || card.cardClass !== "action") return { value: base, modified: false, delta: 0 };
  const s2 = app.stage2;
  if (!s2 || !s2.teamCardsActive) return { value: base, modified: false, delta: 0 };
  let delta = 0;
  for (const c of s2.teamCardsActive) {
    // fuelMaster：所有指令牌 +5
    if (c.effect === "cardBonusThisRound") delta += (c.value || 0);
  }
  return { value: base + delta, modified: delta !== 0, delta };
}
// 起始牌庫（教學版）：寫死順序、initStage2State 不洗牌
// → 第一手 5 張固定：drag, tailwind, tailwind, turbo, turbo
// → 牌庫剩 3 張：tailwind, drag, mistake
function makeStage2InitialDeck() {
  const deck = [];
  deck.push(makeCard("drag",     "s2-init-dr-0"));
  deck.push(makeCard("tailwind", "s2-init-tw-0"));
  deck.push(makeCard("tailwind", "s2-init-tw-1"));
  deck.push(makeCard("turbo",    "s2-init-tb-0"));
  deck.push(makeCard("turbo",    "s2-init-tb-1"));
  deck.push(makeCard("tailwind", "s2-init-tw-2"));
  deck.push(makeCard("drag",     "s2-init-dr-1"));
  deck.push(makeCard("mistake",  "s2-init-mis-0"));
  return deck;
}
// 發初始手牌（4 張，留 4 張在牌庫；每回合重發）
function dealStage2Initial() {
  if (!app.stage2) return;
  dealStage2Hand();
}

// ─── 新手教學步驟定義 ─────────────────────────────────────────────────
// 12 步腳本：段 A 賽道 → 段 B 對手 → 段 C 核心循環 → 段 D 結束行動
//
// step 欄位：
//   id          字串識別（除錯用）
//   title       標題
//   body        說明（可含 \n 換行）
//   spotlight   () => {x,y,w,h} | null
//                  傳回要「亮起」的矩形（其餘暗化）；null = 整個畫面暗化
//   textPos     () => {x,y}
//                  教學卡的中心座標
//   advance     決定推進步驟的觸發條件：
//                 "continue"     — 玩家按「繼續」鈕推進
//                 "playCard"     — 玩家拖牌到自己道（事件）
//                 "laneChange"   — 玩家拖牌到不同道（事件）
//                 "slipstream"   — 玩家吃到尾流（事件）
//                 "bendEntry"    — 玩家進入彎道段（事件）
//                 "canOvertake"  — 超車/Pass 提示出現（事件）
//                 "auto"         — 時間到自動推進（autoDelay ms）
//   autoDelay    "auto" 用：延遲多久才推進（毫秒）

// ─── Spotlight 動態工具 ─────────────────────────────────────────────────
// 對手名條的實際位置（每 frame 變化、跟隨對手車）
// 名條畫在對手車頂上方、用 app._lastOpponentRenderX/Y/W 緩存值計算
function spotlightAroundOpponentPlate() {
  const x = app._lastOpponentRenderX;
  const y = app._lastOpponentRenderY;
  const w = app._lastOpponentRenderW;
  if (x == null || y == null) {
    // 還沒 render 過、用 fallback
    return { x: 0, y: app.h * 0.30, w: app.w, h: app.h * 0.18 };
  }
  // 對手車寬 ~82、高 ~40。名條畫在頂上方、約 100px 高
  // spotlight 從車頂上方 110px、寬約 250px、高約 130px（涵蓋名條+對手車）
  const padX = 120, plateH = 130;
  return {
    x: x - padX,
    y: y - 20 - plateH,
    w: padX * 2,
    h: plateH + 50,
  };
}

// 教學卡放在對手下方（離開對手 spotlight）
function textPosBelowOpponent() {
  const y = app._lastOpponentRenderY ?? app.h * 0.6;
  // 卡放在對手車下方一段距離（避免擋住對手）
  // 對手通常在 0.62~0.72h、所以卡放在 0.85h 附近
  return { x: app.w * 0.5, y: Math.min(app.h * 0.85, y + 160) };
}

const TUTORIAL_STEPS = [
  // 1: 賽段（概念介紹）
  {
    id: "segments",
    group: "賽段",
    title: "賽段",
    body: "比賽由多個賽段組成、每個賽段由多條賽道組成。",
    spotlight: null,
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.5 }),
    advance: "continue",
  },
  // 2: 賽段（右上角預告位置）
  {
    id: "segmentsPanel",
    group: "賽段",
    title: "賽段",
    body: "這裡會顯示當前賽段，以及預告下一個賽段。",
    spotlight: () => {
      const r = app._nextCircuitPanelRect;
      if (!r) return { x: app.w - 318, y: 8, w: 312, h: 200 };
      return { x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 };
    },
    textPos: () => {
      const r = app._nextCircuitPanelRect;
      const panelLeft = r ? r.x : (app.w - 314);
      const cardW = 440;
      return { x: panelLeft - 16 - cardW / 2, y: app.h * 0.25 };
    },
    advance: "continue",
  },
  // 3: 賽道
  {
    id: "lanes",
    group: "賽道",
    title: "賽道",
    body: "當前賽段有三條賽道。",
    spotlight: () => {
      const horizon = app.h * 0.38;
      return { x: 0, y: horizon, w: app.w, h: app.h * 0.38 };
    },
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.85 }),
    advance: "continue",
  },
  // 4: 賽道加成
  {
    id: "bonuses",
    group: "賽道",
    title: "賽道加成",
    body: "上方告示牌顯示各道的加成（+10 / -10 / 0）。",
    spotlight: () => {
      const horizon = app.h * 0.38;
      return { x: 0, y: horizon - 100, w: app.w, h: 110 };
    },
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.62 }),
    advance: "continue",
  },
  // 5: 打牌——概念
  {
    id: "playCardConcept",
    group: "打牌",
    title: "打牌",
    body: "將想要結算的手牌、移動到當前的道，\n指示車手做出行動。",
    spotlight: null,
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.5 }),
    advance: "continue",
  },
  // 6: 打牌——拖看看（互動：要丟到自己道）
  {
    id: "playCard",
    group: "打牌",
    title: "試試看",
    body: "拖牌時、上方會預估在此道行動後的最終速度。",
    spotlight: () => {
      if (app.drag) {
        const z = app.zones?.lanes?.[app.playerLane];
        if (z) {
          const horizon = app.h * 0.38;
          // 兩個獨立框：上方速度告示牌 + 路面玩家當前道
          // 速度告示在 horizon - 40 附近、高度約 36px
          const labelTop = horizon - 64;
          const labelH = 48;
          return [
            // 速度告示框（窄、只包此道告示牌）
            { x: z.x - 6, y: labelTop, w: z.w + 12, h: labelH },
            // 路面框
            { x: z.x - 10, y: horizon - 6, w: z.w + 20, h: (z.y + z.h) - horizon + 6 },
          ];
        }
      }
      return { x: 0, y: app.h - 220, w: app.w, h: 220 };
    },
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.22 }),
    advance: "playCard",
  },
  // 7: 打牌——結算順序（玩家剛打完、飛字結算給他看）
  //   waitForAnimation: true → 教學卡先隱藏、等飛字 + inputLocked 結束才出現
  //   noOverlay: true → 卡片出現時不暗化背景（讓玩家持續看到場上動畫）
  {
    id: "playCardOrder",
    group: "打牌",
    title: "結算順序",
    body: "有注意到嗎？卡牌效果先結算、再結算道路加成。",
    spotlight: null,
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.4 }),
    advance: "continue",
    waitForAnimation: true,
    noOverlay: true,
  },
  // 4: 換道（互動）
  {
    id: "changeLane",
    group: "換道",
    title: "換道",
    body: "拖到「不同道」就是換道——牌會棄掉、效果不結算。",
    spotlight: () => {
      // 拿牌中：高光「沒有對手、也不是玩家」的道（drop 也只接受這些道）
      if (app.drag) {
        const rects = [];
        const horizon = app.h * 0.38;
        const top = horizon - 90;
        for (let i = 0; i < app.laneCount; i++) {
          if (i === app.playerLane) continue;
          if (i === app.opponentLane) continue;
          const z = app.zones?.lanes?.[i];
          if (z) rects.push({ x: z.x - 10, y: top, w: z.w + 20, h: (z.y + z.h) - top });
        }
        if (rects.length > 0) return rects;
      }
      // 沒拿牌：高光手牌區
      return { x: 0, y: app.h - 220, w: app.w, h: 220 };
    },
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.22 }),
    advance: "laneChange",
  },
  // 5: 換道代價（先倒數、結束後顯示繼續鈕）
  {
    id: "laneCost",
    group: "換道",
    title: "換道扣速",
    body: "注意！跨道會扣速度。\n跨越多道扣越多速度。",
    spotlight: () => ({ x: app.w - 300, y: app.h - 220, w: 280, h: 100 }),
    textPos: () => ({ x: app.w * 0.4, y: app.h * 0.5 }),
    advance: "countdownThenContinue",
    autoDelay: 3500,
    noOverlay: true,
  },
  // 6: 行動——兩種類型
  {
    id: "actionsTypes",
    group: "行動",
    title: "兩種行動",
    body: "行動分打牌與換道：\n把牌打在自己賽道上（結算卡牌效果）\n把牌打在其他賽道上（棄牌不結算效果、但換到指定賽道）",
    spotlight: null,
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.5 }),
    advance: "continue",
  },
  // 7: 行動——推進賽段
  {
    id: "actionsAdvance",
    group: "行動",
    title: "每行動進一段",
    body: "每一個行動、車子都會往前一個賽段格。",
    spotlight: null,
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.5 }),
    advance: "continue",
  },
  // 8: 行動——賽段倒數（高光右上面板的當前賽段區）
  {
    id: "actionsSegmentCount",
    group: "行動",
    title: "賽段長度",
    body: "右上方倒數當前賽段剩幾格。\n跑完就進入下一賽段。",
    spotlight: () => {
      // 右上面板的「當前賽段」一行（從黃框底到面板底）
      const r = app._nextCircuitPanelRect;
      if (!r) return { x: app.w - 318, y: 174, w: 312, h: 70 };  // fallback
      return {
        x: r.x - 4,
        y: r.currentRowTop - 4,
        w: r.w + 8,
        h: (r.y + r.h) - r.currentRowTop + 8,
      };
    },
    textPos: () => {
      // 卡放在面板左側
      const r = app._nextCircuitPanelRect;
      const panelLeft = r ? r.x : (app.w - 314);
      const cardW = 440;
      // 卡的右緣貼面板左緣 - 16
      return { x: panelLeft - 16 - cardW / 2, y: app.h * 0.3 };
    },
    advance: "continue",
  },
  // 對手——目標
  {
    id: "opponentGoal",
    group: "超車",
    title: "超對手車",
    body: "接下來我們要想辦法超對手車。",
    spotlight: null,
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.5 }),
    advance: "continue",
  },
  // 對手——超車三條件
  {
    id: "overtakeConditions",
    group: "超車",
    title: "超車條件",
    body: "超車必須同時滿足以下兩點：\n・車速大於前車\n・與前車不同道",
    spotlight: null,
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.5 }),
    advance: "continue",
  },
  //   onEnter: 降對手速 + 強制玩家換到非對手道（保證條件達成）
  {
    id: "tryOvertakeReadyLane",
    group: "超車",
    title: "條件 1：不同道",
    body: "我們目前與前車不同道。",
    spotlight: () => {
      // 高光玩家車道 + 對手車道（兩個 rect）
      const rects = [];
      const horizon = app.h * 0.38;
      const top = horizon - 90;
      for (const li of [app.playerLane, app.opponentLane]) {
        if (li == null) continue;
        const z = app.zones?.lanes?.[li];
        if (z) rects.push({ x: z.x - 10, y: top, w: z.w + 20, h: (z.y + z.h) - top });
      }
      return rects.length > 0 ? rects : null;
    },
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.16 }),
    advance: "continue",
    onEnter: () => {
      // 降對手車速到玩家 -5、確保「車速大於前車」條件
      app.opponentSpeed = Math.max(10, (app.playerSpeed ?? 30) - 5);
    },
  },
  // 對手——試試超車 (條件 2: 速度)
  {
    id: "tryOvertakeReadySpeed",
    group: "超車",
    title: "條件 2：車速",
    body: "且速度快於前車。",
    spotlight: () => {
      // 高光右下角玩家速度區（statusHudRect y+60~y+114）
      const x = app.w - 300, y = app.h - 224;
      return { x, y: y + 56, w: 276, h: 60 };
    },
    textPos: () => ({ x: app.w - 480, y: app.h - 350 }),
    advance: "continue",
  },
  // 超車——丟牌到穩定區（降 QTE 難度）
  //   要丟 2 張才推進（requireCount: 2）
  //   dropToStabilityOnly: 玩家可拖牌、但只能丟到穩定區（其他地方都擋）
  {
    id: "tryOvertakeStability",
    group: "超車",
    title: "降低難度",
    body: "既然現在已經準備好超車了、\n那就額外增加車子的穩定度。\n把 2 張牌丟到左下穩定區、\n可以降低本回合 QTE 難度。",
    spotlight: () => {
      const rects = [];
      // 穩定區
      const z = app.zones?.stabilityZone;
      if (z) rects.push({ x: z.x - 6, y: z.y - 6, w: z.w + 12, h: z.h + 12 });
      // 手牌：計算實際手牌的 bbox（避免整條底部都亮）
      const cards = app.zones?.cards;
      if (cards && cards.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const c of cards) {
          minX = Math.min(minX, c.rect.x);
          minY = Math.min(minY, c.rect.y);
          maxX = Math.max(maxX, c.rect.x + c.rect.w);
          maxY = Math.max(maxY, c.rect.y + c.rect.h);
        }
        rects.push({ x: minX - 12, y: minY - 12, w: maxX - minX + 24, h: maxY - minY + 24 });
      }
      return rects;
    },
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.35 }),
    advance: "stabilityDrop",
    requireCount: 2,
    dropToStabilityOnly: true,
    strictGate: true,  // 擋超車鈕、Pass 鈕
  },
  {
    id: "tryOvertakePress",
    group: "超車",
    title: "嘗試超車",
    body: "請嘗試超車。",
    spotlight: () => {
      const r = app._overtakeBtnRect;
      if (!r) return { x: app.w * 0.5, y: app.h - 290, w: 200, h: 80 };
      return { x: r.x - 8, y: r.y - 8, w: r.w + 16, h: r.h + 16 };
    },
    // 卡片下移、貼到超車鈕上方
    textPos: () => {
      const r = app._overtakeBtnRect;
      const btnY = r ? r.y : (app.h - 260);
      return { x: app.w * 0.5, y: btnY - 100 };
    },
    advance: "overtakeButton",
    strictGate: true,
  },
  // 超車——QTE 難度說明（玩家看完按繼續）
  {
    id: "tryOvertakeQteWarn",
    group: "超車",
    title: "QTE 難度",
    body: "速度越快、車體越難控制、QTE 難度越高。\n所以速度不是越快越好。",
    spotlight: () => {
      const r = app._qteDifficultyPanelRect;
      if (!r) return null;
      return { x: r.x - 6, y: r.y - 6, w: r.w + 12, h: r.h + 12 };
    },
    // 卡片下移、貼難度面板上緣
    textPos: () => {
      const r = app._qteDifficultyPanelRect;
      const panelTop = r ? r.y : app.h * 0.42;
      return { x: app.w * 0.5, y: panelTop - 70 };
    },
    advance: "continue",
  },
  // 超車——穩定區降階回饋（呼應 tryOvertakeStability）
  {
    id: "tryOvertakeStabilityPaid",
    group: "超車",
    title: "穩定區生效",
    body: "我們剛剛把牌丟到穩定區、\n讓本回合 QTE 變得更容易、\n更容易超過對手。",
    spotlight: () => {
      // 高光難度面板「空力區」那一行
      const r = app._qteDifficultyPanelRect;
      if (!r) return null;
      // 空力區是面板倒數第 2 列、約 panel bottom - 50
      return { x: r.x + 16, y: r.y + r.h - 56, w: r.w - 32, h: 26 };
    },
    textPos: () => {
      const r = app._qteDifficultyPanelRect;
      const panelTop = r ? r.y : app.h * 0.42;
      return { x: app.w * 0.5, y: panelTop - 90 };
    },
    advance: "continue",
  },
  // 超車——按開始 QTE
  {
    id: "tryOvertakeQteStart",
    group: "超車",
    title: "開始挑戰",
    body: "準備好了就開始超車 QTE。",
    spotlight: () => {
      const r = app._qteStartBtnRect;
      if (!r) return null;
      return { x: r.x - 8, y: r.y - 8, w: r.w + 16, h: r.h + 16 };
    },
    // 卡片下移、貼難度面板上緣
    textPos: () => {
      const r = app._qteDifficultyPanelRect;
      const panelTop = r ? r.y : app.h * 0.42;
      return { x: app.w * 0.5, y: panelTop - 70 };
    },
    advance: "overtakeStart",
    noOverlayInQte: true,
  },
  // 超車——新回合補牌
  {
    id: "roundResetDealt",
    group: "超車",
    title: "回合結束",
    body: "新的回合開始、會補到 5 張手牌。",
    spotlight: () => ({ x: 0, y: app.h - 220, w: app.w, h: 220 }),
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.5 }),
    advance: "continue",
    showHand: true,
    waitForAnimation: true,
  },
  // 超車——保留手牌策略
  {
    id: "roundResetKeep",
    group: "超車",
    title: "保留手牌",
    body: "上回合沒打的牌會留在手上。\n好好思考要留什麼牌到下一手、\n是能持續穩定超車的關鍵！",
    spotlight: () => {
      // 高光 hand 中的舊牌（index < handOldSize）
      const oldSize = app.stage2?.handOldSize ?? 0;
      if (oldSize === 0) {
        // 沒舊牌（玩家上回合手牌全打光了）→ 高光整個 hand 區
        return { x: 0, y: app.h - 220, w: app.w, h: 220 };
      }
      const rects = [];
      for (const z of (app.zones.cards || [])) {
        if (z.index < oldSize) {
          rects.push({ x: z.rect.x - 4, y: z.rect.y - 4, w: z.rect.w + 8, h: z.rect.h + 8 });
        }
      }
      return rects.length > 0 ? rects : { x: 0, y: app.h - 220, w: app.w, h: 220 };
    },
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.4 }),
    advance: "continue",
    showHand: true,
  },
  // 對手——開始阻擋（陪跑員從這步開始每回合都動）
  //   onEnter：把陪跑員 behavior cooldown 從 3 改成 1、重置 lastTriggeredAt 讓下一動就 ready
  {
    id: "opponentBlocking",
    group: "對手",
    title: "對手開始阻擋",
    body: "對手開始要來阻擋我們了。",
    spotlight: null,
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.5 }),
    advance: "continue",
    onEnter: () => {
      // 改陪跑員 cooldown=1（每回合都動）
      if (app.opponentBehaviors) {
        for (const b of app.opponentBehaviors) {
          if (b.id === "p-block") {
            b.cooldown = 1;
          }
        }
      }
      // 重置 lastTriggeredAt 讓陪跑員下一個玩家動作就 ready 切道
      if (app.opponentBehaviorLastTriggered) {
        app.opponentBehaviorLastTriggered["p-block"] = -1;
      }
    },
  },
  // 對手——先判斷對手行動
  {
    id: "opponentJudge",
    group: "對手",
    title: "判斷對手",
    body: "在我們做出下一個決策前、\n先來判斷對手的行動。",
    spotlight: null,
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.5 }),
    advance: "continue",
  },
  // 對手——名條 spotlight
  {
    id: "opponentName",
    group: "對手",
    title: "對手名條",
    body: "我們可以看到對手車頂的名條。",
    spotlight: () => spotlightAroundOpponentPlate(),
    textPos: () => textPosBelowOpponent(),
    advance: "continue",
  },

  // 對手——專注度
  {
    id: "opponentFocus",
    group: "對手",
    title: "專注度",
    body: "對手名條上的圓點為專注度。\n每當車手成功超過對手時、\n對手便會磨滅掉一點專注阻擋超車。\n趁對手缺乏專注時超車、便能順利超過對手的車。",
    spotlight: () => spotlightAroundOpponentPlate(),
    textPos: () => textPosBelowOpponent(),
    advance: "continue",
  },

  // 對手——下一動意圖
  {
    id: "opponentIntent",
    group: "對手",
    title: "下一動意圖",
    body: "對手車頂預告下一動的意圖：\n⛔ 阻擋你　💨 遠離你　❓ 不確定\n\n可以隨時把滑鼠移到敵人名條上、\n查看詳細資訊。",
    spotlight: null,
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.5 }),
    advance: "continue",
  },

  // 對手——試做一動觀察反應（引導玩家「換道躲避」）
  //   拖牌時動態高光非玩家當前道（指示玩家可以換到哪）
  {
    id: "opponentTryAction",
    group: "對手",
    title: "切到別道",
    body: "對手要來阻擋你、\n我們切到別道躲避他。",
    spotlight: () => {
      if (app.drag) {
        const rects = [];
        const horizon = app.h * 0.38;
        const top = horizon - 90;
        for (let i = 0; i < app.laneCount; i++) {
          if (i === app.playerLane) continue;
          const z = app.zones?.lanes?.[i];
          if (z) rects.push({ x: z.x - 10, y: top, w: z.w + 20, h: (z.y + z.h) - top });
        }
        if (rects.length > 0) return rects;
      }
      // 沒拿牌時：高光手牌區
      return { x: 0, y: app.h - 220, w: app.w, h: 220 };
    },
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.4 }),
    advance: "laneChange",
  },

  // 對手——回應（等動畫播完、解釋博弈）
  {
    id: "opponentResponded",
    group: "對手",
    title: "博弈",
    body: "看！對手切到你剛剛的位置。\n對手如果意圖是要阻擋你、\n就會切到你行動前的位置。",
    spotlight: () => spotlightAroundOpponentPlate(),
    textPos: () => textPosBelowOpponent(),
    advance: "continue",
    waitForAnimation: true,
  },

  // 對手——尾流前置（事件：玩家在原道打牌就會跟對手同道）
  //   spotlight：玩家當前道 + 手牌（兩個 rect）
  {
    id: "slipstream",
    group: "對手",
    title: "尾流",
    body: "對手又想要切到我們面前阻擋我們！\n正好、我們可以等他過來吃他的尾流！",
    spotlight: () => {
      const rects = [];
      const z = app.zones?.lanes?.[app.playerLane];
      if (z) {
        const horizon = app.h * 0.38;
        const top = horizon - 90;
        rects.push({ x: z.x - 10, y: top, w: z.w + 20, h: (z.y + z.h) - top });
      }
      // 手牌實際 bbox
      const cards = app.zones?.cards;
      if (cards && cards.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const c of cards) {
          minX = Math.min(minX, c.rect.x);
          minY = Math.min(minY, c.rect.y);
          maxX = Math.max(maxX, c.rect.x + c.rect.w);
          maxY = Math.max(maxY, c.rect.y + c.rect.h);
        }
        rects.push({ x: minX - 12, y: minY - 12, w: maxX - minX + 24, h: maxY - minY + 24 });
      }
      return rects;
    },
    // 卡片放上方、不擋手牌
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.22 }),
    advance: "slipstream",
  },
  // 對手——尾流取得（事件後反饋、等動畫播完）
  {
    id: "slipstreamGained",
    group: "對手",
    title: "尾流 +30",
    body: "這時候我們就會跟對手同道、吃到尾流 +30。",
    spotlight: () => {
      const z = app.zones?.lanes?.[app.playerLane];
      if (z) {
        const horizon = app.h * 0.38;
        const top = horizon - 90;
        return { x: z.x - 10, y: top, w: z.w + 20, h: (z.y + z.h) - top };
      }
      return null;
    },
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.2 }),
    advance: "continue",
    waitForAnimation: true,
  },
  // 對手——策略思考
  {
    id: "slipstreamStrategy",
    group: "對手",
    title: "策略思考",
    body: "要思考目前的狀況、決定要留在此道、還是換道。\n要加速還是要吃尾流。",
    spotlight: null,
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.5 }),
    advance: "continue",
  },

  // 11: 彎道——介紹（onEnter 直接快轉到 c2 彎道賽段）
  {
    id: "bendIntro",
    group: "彎道",
    title: "彎道",
    body: "彎道通常會有內彎跟外彎。\n內彎加速快、但容易出彎。\n外彎降速、但容易過彎。",
    spotlight: null,
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.5 }),
    advance: "continue",
    onEnter: () => {
      // 直接快轉到 c2 彎道賽段、不等玩家走完當前直線段
      const s2 = app.stage2;
      if (!s2 || !s2.circuitOrder) return;
      const C2_IDX = STAGE2_CIRCUITS.findIndex(c => c.id === "c2");
      if (C2_IDX < 0) return;
      // 把 circuitIndex 跳到 c2、applyCircuit 套用彎道資料
      s2.circuitIndex = C2_IDX;
      applyCircuit(STAGE2_CIRCUITS[C2_IDX]);
    },
  },
  // 12: 彎道——速限說明（事件：bendEntry 觸發、玩家進入彎道）
  {
    id: "bendLimit",
    group: "彎道",
    title: "彎道速限",
    body: "彎道有速限。\n過彎時吃完彎道加成、若速度仍超過速限、\n就要進入過彎 QTE 檢定是否成功過彎。",
    spotlight: () => {
      // 高光左右限速圈（畫面上方天空區、橫跨路面寬度）
      const horizon = app.h * 0.38;
      const yEdge = horizon + 30 * UI_SCALE;
      const bounds = roadLaneBoundsAt(yEdge);
      return {
        x: bounds.left - 70,
        y: yEdge - 80,
        w: (bounds.right - bounds.left) + 140,
        h: 90,
      };
    },
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.7 }),
    advance: "continue",
  },
  // 13: 彎道——挑戰 QTE（引導玩家把牌打到內彎、保證觸發 QTE）
  //   onEnter：把玩家設到外彎、speed 設高、保證換道到內彎結算後超速
  //   拖牌 gate：只允許丟到內彎（lane 0）
  //   advance：等彎道 QTE 完成
  {
    id: "bendTry",
    group: "彎道",
    title: "挑戰過彎",
    body: "把任一張牌打到內彎、感受過彎 QTE。",
    spotlight: () => {
      if (app.drag) {
        // 拖牌中：兩個 rect
        //   1. 上方告示牌（彎道路面在 horizon 處的 lane 0 位置）
        //   2. 下方拖牌判定區 lane 0
        const rects = [];
        const horizon = app.h * 0.38;
        const bounds = roadLaneBoundsAt(horizon);
        const laneCount = app.laneCount || 2;
        const laneWAtHorizon = (bounds.right - bounds.left) / laneCount;
        const cxLabel = bounds.left + 0.5 * laneWAtHorizon;
        rects.push({ x: cxLabel - 70, y: horizon - 64, w: 140, h: 56 });
        const z = app.zones?.lanes?.[0];
        if (z) {
          rects.push({ x: z.x - 10, y: z.y - 10, w: z.w + 20, h: z.h + 20 });
        }
        return rects;
      }
      // 沒拿牌：高光手牌區
      const cards = app.zones?.cards;
      if (cards && cards.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const c of cards) {
          minX = Math.min(minX, c.rect.x);
          minY = Math.min(minY, c.rect.y);
          maxX = Math.max(maxX, c.rect.x + c.rect.w);
          maxY = Math.max(maxY, c.rect.y + c.rect.h);
        }
        return { x: minX - 12, y: minY - 12, w: maxX - minX + 24, h: maxY - minY + 24 };
      }
      return { x: 0, y: app.h - 220, w: app.w, h: 220 };
    },
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.22 }),
    advance: "bendAttempt",
    noOverlayInQte: true,
    onEnter: () => {
      app.playerLane = 1;
      app.playerSpeed = 80;
    },
  },
  // 14: 超車 / Pass（continue、按鈕顯示但鎖住）
  {
    id: "overtakePass",
    group: "結束回合",
    title: "超車 / Pass",
    body: "在做出任何行動前都可以 Pass。\n符合超車條件時、才能選擇超車。",
    spotlight: () => {
      const r = app._overtakeBtnRect;
      if (!r) return { x: app.w * 0.45, y: app.h - 290, w: 360, h: 80 };
      return { x: r.x - 8, y: r.y - 8, w: r.w + 125, h: r.h + 16 };
    },
    textPos: () => {
      const r = app._overtakeBtnRect;
      const btnY = r ? r.y : (app.h - 260);
      return { x: app.w - 240, y: btnY - 120 };
    },
    advance: "continue",
    strictGate: true,  // 顯示按鈕但鎖住（tryOvertakePress 例外、此步不會放行）
    waitForAnimation: true,
  },
  // 15a-pre1: 回顧——速度更快
  //   onEnter：把當前對手 focus 強制歸 0、敘述才符合「對手缺乏專注」
  {
    id: "recapSpeed",
    group: "完成超車",
    title: "速度更快",
    body: "你的速度比對手快、\n滿足超車條件之一。",
    spotlight: () => {
      const x = app.w - 300, y = app.h - 224;
      return { x, y: y + 56, w: 276, h: 60 };
    },
    textPos: () => ({ x: app.w - 480, y: app.h - 350 }),
    advance: "continue",
    strictGate: true,
    onEnter: () => {
      const s2 = app.stage2;
      if (!s2 || !s2.opponentFocusMap || !s2.ahead) return;
      const oppId = s2.ahead[s2.ahead.length - 1];
      if (oppId) s2.opponentFocusMap[oppId] = 0;
    },
  },
  // 15a-pre2: 回顧——不同道
  {
    id: "recapLane",
    group: "完成超車",
    title: "不同道",
    body: "你跟對手在不同道、\n滿足超車條件之二。",
    spotlight: () => {
      const rects = [];
      const horizon = app.h * 0.38;
      const top = horizon - 6;
      const z1 = app.zones?.lanes?.[app.playerLane];
      const z2 = app.zones?.lanes?.[app.opponentLane];
      if (z1) rects.push({ x: z1.x - 10, y: top, w: z1.w + 20, h: (z1.y + z1.h) - top });
      if (z2 && app.opponentLane !== app.playerLane) {
        rects.push({ x: z2.x - 10, y: top, w: z2.w + 20, h: (z2.y + z2.h) - top });
      }
      return rects;
    },
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.18 }),
    advance: "continue",
    strictGate: true,
  },
  // 15a-pre3: 回顧——對手缺乏專注
  {
    id: "recapFocus",
    group: "完成超車",
    title: "對手缺乏專注",
    body: "對手已經缺乏專注、\n是超過他的好機會！",
    spotlight: () => spotlightAroundOpponentPlate(),
    textPos: () => textPosBelowOpponent(),
    advance: "continue",
    strictGate: true,
  },
  // 15a-pre4: 按超車鈕、完成 QTE
  //   advance: overtakeAttempt（QTE 成功/失敗都推進）
  //   noOverlayInQte: QTE 期間不畫黑幕
  {
    id: "recapPress",
    group: "完成超車",
    title: "超過前車吧！",
    body: "按超車鈕、超過對手！",
    spotlight: () => {
      const r = app._overtakeBtnRect;
      if (!r) return null;
      return { x: r.x - 8, y: r.y - 8, w: r.w + 16, h: r.h + 16 };
    },
    textPos: () => {
      // splash-overtake / rhythm-formal 階段：卡片移到頂部偏右、不擋難度面板跟 QTE 按鈕
      if (app.mode === "splash-overtake" || app.mode === "rhythm-formal") {
        return { x: app.w - 240, y: 80 };
      }
      // playing 階段：卡片放超車鈕上方
      const r = app._overtakeBtnRect;
      const btnY = r ? r.y : (app.h - 260);
      return { x: app.w * 0.5, y: btnY - 100 };
    },
    advance: "overtakeAttempt",
    strictGate: true,
    noOverlayInQte: true,
  },
  // 15a: 對手介紹（高光左上名次面板的對手列表區）
  //   waitForAnimation: 等超車成功 + 獎勵牌挑選完成、回到 playing
  {
    id: "rivalsIntro",
    group: "目標",
    title: "前方對手",
    body: "這些車手的順序是目前賽道上的名次。\n我們的目標就是要一個一個超過他們。",
    spotlight: () => ({ x: 8, y: 130, w: 252, h: 130 }),
    textPos: () => ({ x: 480, y: 200 }),
    advance: "continue",
    waitForAnimation: true,
  },
  // 15b: 回合限制（高光標題列的「回合 X / 10」）
  {
    id: "rankingIntro",
    group: "目標",
    title: "10 回合內奪冠",
    body: "要在 10 個回合內、\n超過所有對手、奪得第一！",
    spotlight: () => ({ x: 8, y: 72, w: 252, h: 50 }),
    textPos: () => ({ x: 480, y: 130 }),
    advance: "continue",
  },
  // 16: 教學結束、儀式感（玩家正式開始的一刻）
  {
    id: "tutorialEnd",
    group: "出發",
    title: "教學結束",
    body: "看來你已經了解基本規則。\n現在開始請相信身為領隊的直覺跟判斷。\n指揮車手拿下此次比賽的第一吧！",
    spotlight: null,
    textPos: () => ({ x: app.w * 0.5, y: app.h * 0.5 }),
    advance: "continue",
  },
];

// 繪製教學遮罩（在所有 UI 之上、表情塢之下）
function drawTutorialOverlay(time) {
  if (!isStage2()) return;
  const t = app.stage2?.tutorial;
  if (!t || !t.active) return;
  const step = TUTORIAL_STEPS[t.stepIndex];
  if (!step) return;
  const ctx = app.ctx;

  // waitForAnimation：此步要等動畫播完才出現
  //   條件：(a) 沒有 pendingAction、(b) 沒有 input lock、(c) 速度飛字閘門清空
  //   playing 跟 prompt-overtake-or-pass 都算「玩家可操作」狀態、可以顯示教學
  if (step.waitForAnimation) {
    const anyGate = app._speedPopGates && app._speedPopGates.length > 0;
    const anyPop = (app.speedPopsActive && app.speedPopsActive.length > 0)
                || (app.speedPopsQueue && app.speedPopsQueue.length > 0);
    const modeOk = (app.mode === "playing" || app.mode === "prompt-overtake-or-pass");
    if (app.pendingAction || app.inputLocked || anyGate || anyPop || !modeOk) {
      return;  // 還沒等到、這 frame 不畫教學
    }
  }

  // 1. 暗化背景、用 evenodd 挖出 spotlight
  // step.spotlight 可回傳：null | 單一 rect | 多個 rect 陣列
  // noOverlay: true → 不暗化、只畫教學卡（讓玩家持續看到場上）
  // noOverlayInQte: 在 QTE 進行中（rhythm-formal）也不暗化
  const inQteMode = (app.mode === "rhythm-formal" || app.mode === "defense"
    || app.mode === "bend-qte" || app.mode === "splash-bend"
    || app.mode === "splash-overtake" || app.mode === "splash-defense"
    || !!app._pendingBendQteTrigger);
  const skipOverlay = step.noOverlay || (step.noOverlayInQte && inQteMode);
  if (!skipOverlay) {
    ctx.save();
    ctx.fillStyle = "rgba(2,8,16,0.72)";
    ctx.beginPath();
    ctx.rect(0, 0, app.w, app.h);
    const spotResult = step.spotlight ? step.spotlight() : null;
    const spotRects = spotResult
      ? (Array.isArray(spotResult) ? spotResult : [spotResult])
      : [];
    for (const r of spotRects) {
      if (r) ctx.rect(r.x, r.y, r.w, r.h);
    }
    ctx.fill("evenodd");
    // spotlight 邊框微光
    if (spotRects.length > 0) {
      const pulse = 0.55 + 0.45 * Math.sin(time * 0.005);
      ctx.strokeStyle = `rgba(255, 220, 80, ${0.45 * pulse})`;
      ctx.lineWidth = 2;
      for (const r of spotRects) {
        if (r) ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
    }
    ctx.restore();
  }

  // 2. 教學卡片（高度依內文行數動態、單行 140px、每多一行 +22px）
  const bodyLines = (step.body || "").split("\n");
  const cardW = 440;
  const cardH = 118 + bodyLines.length * 22;
  const pos = step.textPos ? step.textPos() : { x: app.w/2, y: app.h * 0.7 };
  const cardX = pos.x - cardW/2;
  const cardY = pos.y - cardH/2;
  roundPanel(cardX, cardY, cardW, cardH, 14, "rgba(8,16,30,0.98)", "rgba(255,220,80,0.65)", 2);
  // 進度（顯示當前分組 + 組內位置；若無 group 退回全域進度）
  let progressLabel;
  if (step.group) {
    const groupSteps = TUTORIAL_STEPS.filter(s => s.group === step.group);
    const groupIdx = groupSteps.findIndex(s => s.id === step.id);
    progressLabel = `${step.group}  ${groupIdx + 1} / ${groupSteps.length}`;
  } else {
    progressLabel = `新手教學  ${t.stepIndex + 1} / ${TUTORIAL_STEPS.length}`;
  }
  text(progressLabel,
    cardX + cardW/2, cardY + 22, 11, "rgba(255,220,80,0.8)", "800", "center");
  // 標題
  text(step.title, cardX + cardW/2, cardY + 52, 20, "#ffd980", "1000", "center");
  // 內文（從 cardY+84 開始、每行 22）
  bodyLines.forEach((line, idx) => {
    text(line, cardX + cardW/2, cardY + 84 + idx * 22, 13, "#e8f0ff", "700", "center");
  });

  // 3. 推進方式 + 提示
  const now = performance.now();
  const stepShownAt = t.stepShownAt ?? now;
  const elapsed = now - stepShownAt;

  // auto：時間到自動推進
  if (step.advance === "auto") {
    const delay = step.autoDelay ?? 3000;
    // 倒數小字
    const remain = Math.max(0, delay - elapsed);
    text(`... ${(remain/1000).toFixed(1)}s`,
      cardX + cardW/2, cardY + cardH - 18, 12, "rgba(180,200,230,0.65)", "700", "center");
    if (elapsed >= delay) {
      tutorialAdvance();
    }
  } else if (step.advance === "continue") {
    button("tutorial-continue", "繼續",
      cardX + cardW/2 - 60, cardY + cardH - 36, 120, 28, false, "start");
  } else if (step.advance === "countdownThenContinue") {
    // 先倒數、結束後變繼續鈕
    const delay = step.autoDelay ?? 3000;
    const remain = Math.max(0, delay - elapsed);
    if (remain > 0) {
      text(`... ${(remain/1000).toFixed(1)}s`,
        cardX + cardW/2, cardY + cardH - 18, 12, "rgba(180,200,230,0.65)", "700", "center");
    } else {
      button("tutorial-continue", "繼續",
        cardX + cardW/2 - 60, cardY + cardH - 36, 120, 28, false, "start");
    }
  } else {
    // 事件型：顯示對應提示文字
    const hintMap = {
      playCard:        "↓ 拖任一張牌到「自己現在的道」",
      laneChange:      "↓ 拖任一張牌到「不同道」",
      playerAction:    "↓ 打牌或換道、做任何一個行動",
      stabilityDrop:   "↓ 拖牌到左下車體面板（穩定區）",
      slipstream:      "↓ 打牌在此道",
      bendEntry:       "↓ 繼續打牌或換道、直到進入下個彎道段",
      bendAttempt:     "↓ 繼續行動、完成彎道 QTE",
      canOvertake:     "↓ 打完所有手牌、超車/Pass 提示就會出現",
      overtakeButton:  "↓ 按超車鈕",
      overtakeStart:   "↓ 按開始 QTE",
      overtakeAttempt: "↓ 按開始 QTE、按 WASD 完成挑戰",
    };
    // 條件「已滿足」檢查：玩家可能在進入這步前就已經滿足條件、避免卡住
    const circ = currentCircuit();
    const alreadyInBend = circ && (circ.type === "bend" || (circ.bendCurve != null && circ.bendCurve !== 0));
    const preSatisfied =
      (step.advance === "bendEntry" && alreadyInBend) ||
      (step.advance === "canOvertake" && app.mode === "prompt-overtake-or-pass");
    if (preSatisfied) {
      // 已滿足：顯示提示文字 + 倒數 3 秒自動推進（讓玩家看清教學）
      const presatDelay = 3000;
      const remain = Math.max(0, presatDelay - elapsed);
      text("（條件已滿足）",
        cardX + cardW/2, cardY + cardH - 38, 12, "rgba(140,255,160,0.85)", "800", "center");
      text(`${(remain/1000).toFixed(1)}s 後繼續`,
        cardX + cardW/2, cardY + cardH - 18, 12, "rgba(180,200,230,0.7)", "700", "center");
      if (elapsed >= presatDelay) tutorialAdvance();
    } else {
      const hint = hintMap[step.advance];
      if (hint) {
        text(hint, cardX + cardW/2, cardY + cardH - 18, 13, "rgba(140,255,160,0.95)", "900", "center");
      }
    }
  }
}

// 推進教學一步（按繼續鈕或事件觸發呼叫）
function tutorialAdvance() {
  const t = app.stage2?.tutorial;
  if (!t || !t.active) return;
  t.stepIndex += 1;
  t.stepShownAt = performance.now();
  t.eventCount = 0;  // 重置事件計數（給 requireCount 用）
  if (t.stepIndex >= TUTORIAL_STEPS.length) {
    t.active = false;
    // 教學結束：洗牌賽段順序、進入正式遊戲不再永遠直線
    reshuffleNormalCircuitOrder();
    return;
  }
  // 新 step 的 onEnter callback（用於降對手速、強制對手換道等 side effects）
  const newStep = TUTORIAL_STEPS[t.stepIndex];
  if (newStep && typeof newStep.onEnter === "function") {
    try { newStep.onEnter(); } catch (e) { console.warn("tutorial onEnter:", e); }
  }
}

// 事件式推進：在遊戲事件發生點呼叫、若當前步在等這個事件就自動推進
//   event: "playCard" | "laneChange" | "slipstream" | "bendEntry" | "canOvertake"
function tutorialNotify(event) {
  const t = app.stage2?.tutorial;
  if (!t || !t.active) return;
  const step = TUTORIAL_STEPS[t.stepIndex];
  if (!step) return;
  if (step.advance === event) {
    // 支援 step.requireCount：要這個 event 觸發 N 次才推進
    const need = step.requireCount || 1;
    if (need > 1) {
      t.eventCount = (t.eventCount || 0) + 1;
      if (t.eventCount >= need) {
        t.eventCount = 0;
        tutorialAdvance();
      }
    } else {
      tutorialAdvance();
    }
  }
}

// 當前教學步驟是否該擋住遊戲互動
// 「繼續」/「auto」步：純資訊、要擋拖牌/超車鈕/Pass 鈕（玩家只能按 continue 或等 auto）
// 「strictGate」步：擋拖牌跟 Pass，**但放行超車鈕**（用於 tryOvertakePress）
// 事件步（playCard/laneChange/slipstream 等）：要讓玩家做指定動作，不擋
function tutorialBlocksGameplay() {
  const t = app.stage2?.tutorial;
  if (!t || !t.active) return false;
  const step = TUTORIAL_STEPS[t.stepIndex];
  if (!step) return false;
  return step.advance === "continue" || step.advance === "auto" || !!step.strictGate;
}

// 嚴格 gate 步驟、超車鈕仍要可按（其他互動全擋）
// 只有 tryOvertakePress / recapPress 步允許超車鈕、其他 strictGate 步驟一律鎖
function tutorialAllowsOvertakeButton() {
  const t = app.stage2?.tutorial;
  if (!t || !t.active) return false;
  const step = TUTORIAL_STEPS[t.stepIndex];
  if (!step) return false;
  return step.id === "tryOvertakePress" || step.id === "recapPress";
}

// 當前步驟是否要「顯示手牌但不能拖」（用 step.showHand: true 標記）
// 範例：playCardOrder 步要讓玩家看到卡牌上的數字、但還不到拖牌時機
function tutorialShowsHandReadonly() {
  const t = app.stage2?.tutorial;
  if (!t || !t.active) return false;
  const step = TUTORIAL_STEPS[t.stepIndex];
  if (!step) return false;
  return !!step.showHand;
}

// 教學早期是否擋住對手實際行動
// 目前不擋（保留函式供未來需要時開啟）
// 陪跑員從第一動就照 cooldown 倒數、第 3 動才真的切過來阻擋
function tutorialBlocksOpponent() {
  return false;
}

// 從 stage2 牌庫（base + permanent）發 N 張
function dealStage2Hand() {
  const s2 = app.stage2;
  if (!s2) return;
  // 計算要補幾張（保留現有手牌，補到 5 張）
  let handSize = 5;
  if (s2.penaltyNextHand) {
    handSize += s2.penaltyNextHand;
    s2.penaltyNextHand = 0;
  }
  handSize = Math.max(2, handSize);
  // 記錄補牌前的 hand 大小（教學用：識別「上回合留下來的牌」）
  s2.handOldSize = app.hand ? app.hand.length : 0;
  const toDraw = Math.max(0, handSize - (app.hand ? app.hand.length : 0));
  // 從 drawPile 抽，不夠時把 discardPile 洗進 drawPile
  for (let i = 0; i < toDraw; i++) {
    if (s2.drawPile.length === 0) {
      if (s2.discardPile.length === 0) break;
      s2.drawPile = [...s2.discardPile];
      s2.discardPile = [];
      shuffleArrayInPlace(s2.drawPile);
    }
    app.hand.push(s2.drawPile.shift());
  }
}
// 取得當前賽道設定
function currentCircuit() {
  if (!app.stage2) return null;
  return STAGE2_CIRCUITS[app.stage2.circuitIndex];
}

// 取得下一賽道設定（用於右上預告）
function nextCircuit() {
  if (!app.stage2) return null;
  const s2 = app.stage2;
  const order = s2.circuitOrder && s2.circuitOrder.length ? s2.circuitOrder : STAGE2_NORMAL_CIRCUITS_POOL;
  const curIdx = order.indexOf(s2.circuitIndex);
  const nextIdx = curIdx >= 0 ? (curIdx + 1) % order.length : 0;
  return STAGE2_CIRCUITS[order[nextIdx]];
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
  // 後車（chaser）的 lane 也夾、否則 3 道→2 道時後車會卡在 lane 2、視覺跑到道外
  if (app.chaserTargetLane != null && app.chaserTargetLane > maxLane) {
    app.chaserTargetLane = maxLane;
  }
  if (app.chaserVisualLane != null && app.chaserVisualLane > maxLane) {
    app.chaserVisualLane = maxLane;
  }
  app.bendCurve = circ.bendCurve;
  app.roadWidthScale = circ.roadWidthScale;
  // 動態 laneBonuses：若有 laneBonusDistribution 則每進此段都重抽
  if (circ.laneBonusDistribution) {
    circ.laneBonuses = generateLaneBonusesFromDistribution(circ);
  }
  app.laneBonuses = circ.laneBonuses;
  app.laneBonus = null;
  // c8 揭曉清空
  if (app.stage2) {
    // c8 紅綠燈干擾：清空揭曉集合（要等玩家動作結算後才會揭曉所在道）
    // 進 c8 那一刻不算「走過」，三道全部顯示 ?
    app.stage2.revealedC8Lanes = new Set();
  }
  // 玩家若在新賽道沒有的道上 → 移到 0
  if (app.playerLane >= circ.lanes) {
    app.playerLane = Math.max(0, circ.lanes - 1);
    app.playerLaneVisual = app.playerLane;
  }
  // 設定當前賽段剩餘動作數：每個賽段持續 circ.length 個玩家動作後才切到下一段
  // 預設長度 = 2（沒設 length 的舊賽段）
  if (app.stage2) {
    app.stage2.circuitStepsLeft = circ.length ?? 2;
  }
  // 教學：進入彎道段時通知（type === "bend" 或 bendCurve 非 0）
  if (circ.type === "bend" || (circ.bendCurve != null && circ.bendCurve !== 0)) {
    tutorialNotify("bendEntry");
  }
}
// 推進到下一段賽道（每回合結束時叫）
function advanceCircuit() {
  if (!app.stage2) return;
  const s2 = app.stage2;
  const order = s2.circuitOrder && s2.circuitOrder.length ? s2.circuitOrder : STAGE2_NORMAL_CIRCUITS_POOL;
  const curIdx = order.indexOf(s2.circuitIndex);
  const nextIdx = curIdx >= 0 ? (curIdx + 1) % order.length : 0;
  s2.circuitIndex = order[nextIdx];
  applyCircuit(STAGE2_CIRCUITS[s2.circuitIndex]);
  s2.circuitJustChanged = true;
}
// 重洗賽段循環順序（教學結束 / 跳關 / 重打時呼叫）
// 教學期間 circuitOrder 被寫成 [c3,c3,...]、教學結束後需要洗成正常池
// 把 STAGE2_NORMAL_CIRCUITS_POOL（c1,c2,c3,c4,c8）打亂、複製兩遍當作循環隊列
function reshuffleNormalCircuitOrder() {
  const s2 = app.stage2;
  if (!s2) return;
  const pool = [...STAGE2_NORMAL_CIRCUITS_POOL];
  // Fisher-Yates 洗牌
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  // 複製兩遍當循環隊列、保證循環時不會撞回相同順序連兩次
  s2.circuitOrder = [...pool, ...pool];
}
// 每打一張牌切換賽段（核心機制）
// 順序：
//   1. 賽道結算（用「當前」賽段加成）
//   2. 切到下一賽段（影響下個動作）
function advanceCircuitOnCard() {
  if (!app.stage2) return;
  // 階段 5「賽道結算」：用當前賽段加成
  //   順序:玩家賽道 → 對手賽道
  resolvePlayerCircuit();
  resolveOpponentCircuit();
  // 企業間諜：結算完所有來源後、清掉本動旗標
  clearEspionageFlagsAtEndOfAction();
  // Boss 績效考核：在賽道結算後才評分、確保本動的路面加成算進當前任務
  maybeFirePerfReviewAtEndOfAction();
  // 套完 mult 才能正確判斷是否超速
  checkBendSpeedLimit();
  // c8 紅綠燈干擾:結算後玩家所在道立刻揭曉
  revealC8CurrentLane();
  // ── 賽段長度計數：每個玩家動作 -1，未歸零留在當前賽段、不切段 ──
  const s2 = app.stage2;
  if (s2.circuitStepsLeft == null) s2.circuitStepsLeft = currentCircuit()?.length ?? 2;
  s2.circuitStepsLeft -= 1;
  if (s2.circuitStepsLeft > 0) {
    // 還沒走完當前賽段、停留（無災害賽段、不需重抽位置）
    return;
  }
  // ── 切到下一賽段 ──
  // 若 checkBendSpeedLimit 觸發了 QTE → 延後切段
  // 等 QTE 結束（endBendQte 1.5 秒後）才切下一段
  // 這保證 endBendQte 內 getLaneBonusFor(playerLane) 拿到的是當前段、不是下一段
  // 注意：splash-bend 也算「QTE 已觸發」狀態（玩家還沒按確認鍵）
  //       _pendingBendQteTrigger 也算（飛字還在播、splash-bend 尚未切入）
  if (app.mode === "bend-qte" || app.mode === "splash-bend" || app._pendingBendQteTrigger) {
    app.stage2.pendingCircuitAdvance = true;
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
  const s2 = app.stage2;
  if (!s2) return;
  const order = s2.circuitOrder && s2.circuitOrder.length ? s2.circuitOrder : STAGE2_NORMAL_CIRCUITS_POOL;
  const curIdx = order.indexOf(s2.circuitIndex);
  const nextIdx = curIdx >= 0 ? (curIdx + 1) % order.length : 0;
  s2.circuitIndex = order[nextIdx];
  applyCircuit(STAGE2_CIRCUITS[s2.circuitIndex]);
}
// c8 紅綠燈干擾：揭曉玩家當前所在道（這圈 c8 內永久顯示真實 add）
function revealC8CurrentLane() {
  const s2 = app.stage2;
  if (!s2 || !s2.revealedC8Lanes) return;
  const circ = currentCircuit();
  if (!circ || !circ.hideLaneBonusUntilVisited) return;
  s2.revealedC8Lanes.add(app.playerLane);
}
// 彎道限速檢查：速度結算完後才呼叫
function checkBendSpeedLimit() {
  if (!app.stage2 || app.mode !== "playing") return;
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
  if (!app.stage2) return 0;
  const s2 = app.stage2;
  if (s2.slipstreamUsed) return 0;
  if (app.playerLane !== app.opponentLane) return 0;
  // 清道夫光環：B 所在道、玩家吃不到尾流
  // 同道 = 玩家跟 B 在同一道、所以這條也適用
  // bypassAura 是「B 自己豁免」、玩家仍受光環影響、仍吃不到尾流
  if (isOpponentAuraActive()) {
    // 不消費 slipstreamUsed、不顯示提示（玩家看到光環標籤就知道）
    return 0;
  }
  s2.slipstreamUsed = true;
  app.opponentActionFx = { label: "尾流！速度 +30", until: performance.now() + 1800, positive: true };
  // 教學：通知尾流事件
  tutorialNotify("slipstream");
  return 30;
}
// 尾流視覺檢查（不改速度，只用於 UI 顯示同道提示）
function checkSlipstream() {
  consumeSlipstreamDelta();  // 若同道且未用過就觸發，delta 直接丟棄（純副作用：標記 slipstreamUsed 和顯示 fx）
}
// 預覽用：玩家「如果在 lane 道、現在能否吃尾流」（不修改狀態）
// 條件：同道 + 未用過 + 不在 B 光環抵消下
function canGetSlipstreamAtLane(lane) {
  if (!app.stage2) return false;
  if (app.stage2.slipstreamUsed) return false;
  if (lane !== app.opponentLane) return false;
  if (isOpponentAuraActive()) return false;  // B 光環抵消尾流
  return true;
}
// 取得當前對手（從 stage2.currentOpponentId 拿配置）
function currentOpponent() {
  if (!app.stage2 || !app.stage2.currentOpponentId) return null;
  return STAGE2_OPPONENTS[app.stage2.currentOpponentId];
}
// 隨機從「前方對手陣容（排除 boss）」抽一個當當前對手
// BOSS 規則：當一般對手都被超過、ahead 只剩 BOSS（或包含 BOSS）→ 開戰最終 Boss NCC-7
function pickNextOpponent() {
  const s2 = app.stage2;
  if (!s2) return null;
  // 如果有指定（被反超後），直接用
  if (s2.pinnedNextOpponentId) {
    const id = s2.pinnedNextOpponentId;
    s2.pinnedNextOpponentId = null;
    return id;
  }
  const candidates = s2.ahead.filter(id => id !== "BOSS");
  // 一般對手全部超過、若 BOSS 還在 ahead → 開戰 BOSS（最終戰）
  if (candidates.length === 0) {
    if (s2.ahead.includes("BOSS")) return "BOSS";
    return null;  // 真的通關了
  }
  // v0.9：固定取「玩家前一個名次」的對手 = ahead 列表的最後一個
  //   ahead 的排列是「第 1 名、第 2 名、...、玩家前一名」
  //   所以最後一個 = 離玩家最近的對手 = 應該面對的對手
  return candidates[candidates.length - 1];
}
// 取得當前後車（追車）
function currentChaser() {
  if (!app.stage2 || !app.stage2.chaserId) return null;
  return STAGE2_OPPONENTS[app.stage2.chaserId];
}
// 套用當前對手到 app（speed + actions/behaviors）
function applyOpponentToApp(oppId) {
  const opp = STAGE2_OPPONENTS[oppId];
  if (!opp) return;
  // 對手初始速度（直接用 STAGE2_OPPONENTS 定義的 speed、不立即套加成）
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
  const opp = STAGE2_OPPONENTS[chaserId];
  if (!opp) return;
  app.chaserSpeed = opp.chaserSpeed;
  app.chaserTargetLane = app.playerLane;
  app.chaserVisualLane = app.playerLane;
  app.chaserLastActCount = -1;
}
// 初始化主關卡狀態
function initStage2State() {
  app.stage2 = {
    // 教學版陣容：P 陪跑員排在最末（pickNextOpponent 取最後一個 → P 第一個面對）
    // 後面接 A 禿鷹 → B 清道夫 → C 破風者 → BOSS NCC-7（共 5 對手、玩家從第 6 名開始）
    ahead: ["BOSS","C","B","A","P"],
    passed: [],
    currentOpponentId: null,
    pinnedNextOpponentId: null,
    chaserId: null,
    circuitIndex: 0,
    circuitOrder: [],  // 本局洗牌後的賽段順序（在下方填入）
    circuitJustChanged: false,
    circuitStepsLeft: 0,  // 當前賽段剩餘的動作數（每動作 -1、到 0 才切下一段）
    pendingCircuitAdvance: false,  // QTE 觸發時暫停切段、等 QTE 結束才切
    revealedC8Lanes: new Set(),  // c8 紅綠燈干擾：本圈 c8 已揭曉的道集合（applyCircuit 進 c8 時清空）
    deckBase: makeStage2InitialDeck(),
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
    roundsPlayed: 0,                       // 已進入的新回合次數（stage2StartNewRound 每次 +1）
    maxRounds: 15,                         // 終點線回合數
    // 教學版專用旗標
    firstRoundReady: true,   // 第一回合不執行 advanceCircuit（讓玩家直接玩 init 設好的 c3）
    tutorial: {
      active: true,
      stepIndex: 0,
      stepShownAt: performance.now(),
    },
  };
  // 第一回合抽當前對手（→ "P" 陪跑員）
  app.stage2.currentOpponentId = pickNextOpponent();
  // 教學版：賽段順序全部直線（c3）、直到 bendLimit step 動態注入彎道
  //   c3：3 道直線（讓玩家學換道）
  //   彎道用 bendLimit step 的 onEnter 強制注入到下一段
  const C3_IDX = STAGE2_CIRCUITS.findIndex(c => c.id === "c3");
  app.stage2.circuitOrder = [C3_IDX, C3_IDX, C3_IDX, C3_IDX, C3_IDX, C3_IDX];
  app.stage2.circuitIndex = C3_IDX;
  applyCircuit(STAGE2_CIRCUITS[C3_IDX]);
  // 初始化各對手「起始專注度」（給 UI 當 max 用）
  app.stage2.opponentFocusStartMap = {};
  for (const [id, opp] of Object.entries(STAGE2_OPPONENTS)) {
    app.stage2.opponentFocusStartMap[id] = opp.focus ?? 0;
  }
  // 當前專注度 = 起始專注度（QTE 成功時遞減）
  app.stage2.opponentFocusMap = { ...app.stage2.opponentFocusStartMap };
  // 把起始牌庫灌入抽牌堆（教學版：不洗牌、用 makeStage2InitialDeck 寫死的順序）
  app.stage2.drawPile = [...app.stage2.deckBase];
  app.stage2.discardPile = [];
  // ─── NCC-7 Boss 戰狀態（Phase 3 績效考核）──────────────────────────
  // 整個 Boss 戰持續、玩家真正超過 Boss 時才 reset
  app.stage2.boss = {
    currentTask: null,         // { def, subTasks: [{def, progress, extra}], ... }
    taskHistory: new Set(),    // 已派發過的任務 id（避免重複、池空時重洗）
    evalHistory: [],           // 評分紀錄 [{taskDisplay, passed, evalNumber}]、用於 modal「考核紀錄」
    evalCount: 0,              // 累計考核次數（顯示「第 N 次考核」用）
    lastCommentary: "",        // 最後一句長官評語、modal 顯示用
    buffStacks: 0,             // 績效考核達標堆疊（0-3）
    debuffStacks: 0,           // 績效考核未達標堆疊（0-3、跟 buff 互斥）
    espionageCumulative: 0,    // 本動間諜累計（per-action、間諜啟動時 reset）
    commentaryPicked: { start: new Set(), pass: new Set(), fail: new Set() },  // 已抽過的評語、避免重複
    suppressionActive: false,  // Phase 4 旗標、暫未啟用
  };
}
// 取得對手的「起始專注度」（display 的 max 用；教學版 A 會被覆寫）
//   - 優先讀 stage2.opponentFocusStartMap（per-stage 可覆寫）
//   - 沒有則 fallback 到 STAGE2_OPPONENTS 配置
function getOpponentFocusMax(oppId) {
  const s2 = app.stage2;
  if (s2?.opponentFocusStartMap && oppId in s2.opponentFocusStartMap) {
    return s2.opponentFocusStartMap[oppId];
  }
  return STAGE2_OPPONENTS[oppId]?.focus ?? 0;
}

// 把（deckBase + deckPermanent）全部丟進 drawPile + discardPile 重新洗
function refillAndShuffleDrawPile() {
  const s2 = app.stage2;
  if (!s2) return;
  s2.drawPile = [...s2.deckBase, ...s2.deckPermanent];
  s2.discardPile = [];
  shuffleArrayInPlace(s2.drawPile);
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
  initStage2State();
  // 清空飛字系統殘留（前一關沒播完的 pop、閘門、輸入鎖）
  app.speedPopsQueue = [];
  app.speedPopsActive = [];
  app.speedPopsNextSpawnAt = { player: 0, opponent: 0 };
  app._speedPopGates = [];
  app.inputLocked = false;
  app._pendingBendQteTrigger = false;
  // rank：玩家從最後一名開始，名次數 = ahead 對手數 + 玩家自己
  app.rankTotal = app.stage2.ahead.length + 1;
  app.rank = app.rankTotal;
  app.playerLane = 1;
  app.playerLaneVisual = 1;
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
  applyOpponentToApp(app.stage2.currentOpponentId);
  app.hand = [];
  // 教學版：跳過 stage-2-intro modal、直接開始第一回合
  // （tutorial overlay 會自動蓋在 playing 上面，從 step 0 開始）
  stage2StartNewRound();
}

// ─── 測試：跳過新手教學 ───────────────────────────────────────────────
// 開始畫面的測試按鈕用、結束教學、洗牌賽段、保留正常 5 對手陣容
// 教學階段包含陪跑員 P 的對戰、所以「跳過教學」也視為跳過 P、玩家從第 5 名開始面對 A 禿鷹
function skipTutorialForTest() {
  playNormalBgm();
  loadStage(0);
  const s2 = app.stage2;
  if (!s2) return;
  // 結束教學
  if (s2.tutorial) s2.tutorial.active = false;
  // 跳過陪跑員 P（視為教學的一部分）
  s2.passed = ["P"];
  s2.ahead = ["BOSS", "C", "B", "A"];
  app.rank = 5;  // rankTotal 6 - 1 passed = 5
  s2.currentOpponentId = "A";
  applyOpponentToApp("A");
  // 洗牌賽段順序、避免一直直線
  reshuffleNormalCircuitOrder();
  // 從洗牌結果取第一段套用（脫離教學的 c3）
  const firstCircuitIdx = s2.circuitOrder[0];
  s2.circuitIndex = firstCircuitIdx;
  applyCircuit(STAGE2_CIRCUITS[firstCircuitIdx]);
  // 重置回合資訊
  s2.firstRoundReady = false;
  app.message = "[測試] 跳過教學";
  app.mode = "playing";
}

// ─── 測試：直接跳到 Boss 戰 ────────────────────────────────────────────
// 開始畫面的測試按鈕用、跳過教學跟前面 4 個對手、直接面對 NCC-7
// 觸發前先讓玩家選 3 次牌（模擬一般流程從 A→B→C 的 3 次獎勵）
function skipToBossForTest() {
  playNormalBgm();
  loadStage(0);  // 正常 init 走一遍
  const s2 = app.stage2;
  if (!s2) return;
  // 結束教學
  if (s2.tutorial) s2.tutorial.active = false;
  // 前 4 個對手算超過、ahead 只剩 BOSS
  s2.passed = ["P", "A", "B", "C"];
  s2.ahead = ["BOSS"];
  app.rank = 2;  // 玩家在 Boss 的下一位
  // rankTotal 已經是 6（init 時設好）
  // 設定 Boss 為當前對手
  s2.currentOpponentId = "BOSS";
  applyOpponentToApp("BOSS");
  // 洗牌賽段順序、避免一直直線
  reshuffleNormalCircuitOrder();
  // 從洗牌結果取第一段套用（脫離教學的 c3）
  const firstCircuitIdx = s2.circuitOrder[0];
  s2.circuitIndex = firstCircuitIdx;
  applyCircuit(STAGE2_CIRCUITS[firstCircuitIdx]);
  // 重置回合資訊
  s2.roundsPlayed = 0;     // 第一次選牌後才算第 1 回合開始
  s2.firstRoundReady = true;  // Boss 戰第一回合不切段
  // 標記要先選 3 次牌（每次 stage2OnRewardPicked / Skip 後遞減）
  // 模擬一般流程：超過 A → 選牌、超過 B → 選牌、超過 C → 選牌、然後遇上 Boss
  s2._testRewardsRemaining = 3;
  app.message = "[測試] 進 NCC-7 戰前選 3 次牌";
  // 直接進入第一輪選牌
  stage2BeginRewardPick();
}

// ─── Reset ─────────────────────────────────────────────────────────────────
function reset() {
  stopNormalBgm();
  app.mode = "start-ready";
  app.rank = 4;
  app.rankTotal = 4;
  app.stageIndex = 0;
  app.playerSpeed = 0;
  app.stabilityCharges = 0;
  app.stabilityDropFx = null;
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

// 把手牌的某張牌丟進空力區（穩定區）：
//   - 牌進棄牌堆、不算行動、不觸發對手回合
//   - app.stabilityCharges +1（無上限；QTE tier 自然封頂在 easy）
//   - 本回合 QTE 道路節奏每張 -1 階；下回合 reset
function dropCardToStability(cardIdx) {
  if (cardIdx < 0 || cardIdx >= app.hand.length) return false;
  if (!isStage2()) return false;
  // 車隊牌不能丟（它們有自己的觸發邏輯）
  const card = app.hand[cardIdx];
  if (card.cardClass === "team") return false;
  // 處理
  app.hand.splice(cardIdx, 1);
  if (app.stage2) app.stage2.discardPile.push(card);
  app.stabilityCharges += 1;
  app.stabilityDropFx = { until: performance.now() + 520 };
  pushSpeedPop("player", "🛡 空力 -1 階", "rgba(110,255,140,0.95)");
  // 教學：通知有丟一張到穩定區
  tutorialNotify("stabilityDrop");
  // 績效考核：丟穩定區事件（resource 類任務）
  updateBossTaskProgress("stabilityDrop");
  // 不算行動、不觸發對手、不重置 lastCard 連擊鏈
  // 玩家還在自己的動作中、繼續等下一個操作
  return true;
}

function playCardToLane(cardIdx, targetLane) {
  if (cardIdx < 0 || cardIdx >= app.hand.length) return;
  const card = app.hand[cardIdx];

  const isCurrentLane = targetLane === app.playerLane;

  // 記錄「玩家動作前所在道」 — 對手 AI 用這個當目標、不追真實位置
  // 玩家在動作中可能換道、但對手仍以「動作前的道」為基準（給玩家閃避空間）
  if (isStage2()) {
    app.playerLaneBeforeAction = app.playerLane;
  }

  // drift（甩尾過彎）：只能在彎道段使用、且必須拖到自己道
  // TODO v0.10：接上「強制觸發彎道 QTE + 依結果調整加成」的完整機制
  //   現階段：在非彎道段被拖出 → 拒絕；在彎道段 → 當成普通 +0 牌處理（後續實作）
  if (isStage2() && card.requireBend) {
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
  // v0.9：team card 不算行動、不觸發對手、不切換賽段（除了純打牌效果）
  if (isStage2() && card.cardClass === "team") {
    app.hand.splice(cardIdx, 1);
    const s2 = app.stage2;
    s2.teamCardsActive.push(card);
    // 即時套用效果（permanent 效果由查詢點自然生效）
    // 績效考核：打車隊牌事件
    updateBossTaskProgress("teamCardPlay");
    checkAutoPrompt();
    return;
  }

  // v0.9：所有指令牌拖到別道都走標準棄牌換道機制（棄該牌、扣 10 速、換道）
  // 沒有「canChangeLane = 拖別道直接 +15 加速」這種特殊機制——太強

  // 換道：棄一張手牌 + 依跨道數扣速；速度 0 時不能換道
  if (!isCurrentLane) {
    if (app.playerSpeed <= 0) return;
    app.hand.splice(cardIdx, 1);
    if (isStage2() && app.stage2) app.stage2.discardPile.push(card);
    app.actionsThisRound = (app.actionsThisRound ?? 0) + 1;
    // 計算扣速量（跨道數 = abs(target - 當前)）
    const lanesCrossed = Math.abs(targetLane - app.playerLane);
    const laneCost = laneChangeCost(lanesCrossed);
    const newLane = targetLane;
    app.playerLane = newLane;  // 移到新道（純動作）
    if (isStage2()) {
      // 步驟 1：自身代價立即生效（扣 laneCost）+ 飛字 + Boss 抽成
      // 在套用速度變動「之前」啟動 Boss passive 行為（espionage、績效考核）
      maybeActivateBossPassivesEarly();
      playerSpeedSource(-laneCost, "跨道");
      // 績效考核：換道事件
      updateBossTaskProgress("laneChange", { newLane });
      // 換道打斷「連續指令牌」連擊鏈
      const s2 = app.stage2;
      s2.lastActionWasCard = false;
      s2.lastCardType = null;
      s2.lastCardSameStreak = 0;
      // 記錄玩家動作後是否跟對手同道（用於步驟 3 嘲諷檢測）
      const wasSameLane = (app.playerLane === app.opponentLane);
      // 標記待結算動作 → 對手過場結束後執行步驟 3+4
      app.pendingAction = { kind: "lane", card, wasSameLane };
      // 教學：通知換道事件（如果當前步在等這個就推進）
      tutorialNotify("laneChange");
      tutorialNotify("playerAction");
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
  if (isStage2() && app.stage2) app.stage2.discardPile.push(card);
  app.cardsPlayedThisRound += 1;
  app.actionsThisRound = (app.actionsThisRound ?? 0) + 1;

  if (isStage2()) {
    const s2 = app.stage2;
    // 在套用速度變動「之前」啟動 Boss passive 行為（espionage、績效考核）
    maybeActivateBossPassivesEarly();
    // 績效考核：打指令牌事件（戰術類車隊牌另外計、見上方 cardClass === "team" 分支）
    updateBossTaskProgress("cardPlay");
    if (card.penaltyNextHand) {
      s2.penaltyNextHand = (s2.penaltyNextHand || 0) + card.penaltyNextHand;
    }
    if (card.drawNextHand) {
      // 反 allIn：下回合多抽 1 張
      s2.penaltyNextHand = (s2.penaltyNextHand || 0) + card.drawNextHand;
    }
    // ─ 各速度來源 per-source 結算（pop + 套用 + Boss 抽成） ─
    // 1. 卡牌主效果
    const baseCardSpd = card.speedValue || 0;
    if (baseCardSpd) {
      playerSpeedSource(baseCardSpd, card.name || "加速");
    }
    // 2. fuelMaster：本回合內所有指令牌 +5
    const hasFuelMaster = s2.teamCardsActive.some(c => c.effect === "cardBonusThisRound");
    if (hasFuelMaster) {
      playerSpeedSource(5, "燃料管理大師");
    }
    // 3. rhythmCoach：連續同名指令牌 +10 / +20
    const hasRhythmCoach = s2.teamCardsActive.some(c => c.effect === "comboBonusThisRound");
    if (hasRhythmCoach) {
      // 計算「本回合連續同名打的張數」（含當前這張）
      const lastSameNameStreak = (s2.lastCardType === card.type)
        ? (s2.lastCardSameStreak || 1) + 1
        : 1;
      s2.lastCardType = card.type;
      s2.lastCardSameStreak = lastSameNameStreak;
      if (lastSameNameStreak === 2) {
        playerSpeedSource(10, "連擊");
      } else if (lastSameNameStreak >= 3) {
        playerSpeedSource(20, "連擊×3");
      }
    } else {
      // 沒裝 rhythmCoach 也要記錄、玩家可能後續再裝
      s2.lastCardType = card.type;
      s2.lastCardSameStreak = (s2.lastCardType === card.type) ? (s2.lastCardSameStreak || 1) + 1 : 1;
    }
    // 4. smoothOperator（賽車節奏）：若前一動作也是指令牌（不論種類） → 額外 +20
    if (card.smoothOperator && s2.lastActionWasCard) {
      playerSpeedSource(20, "賽車節奏");
    }
    // chill（冷靜應對）：本動 QTE 容錯 +qteForgive（用 flag 傳到 QTE 結算處）
    if (card.qteForgive) {
      s2.chillForgiveActive = card.qteForgive;
    }
    // 標記「上一動作是指令牌」給下次 smoothOperator 用
    s2.lastActionWasCard = true;
    // 記錄玩家動作後是否跟對手同道（用於步驟 3 嘲諷檢測）
    const wasSameLane = (app.playerLane === app.opponentLane);
    // 標記待結算動作 → 對手過場結束後執行步驟 3+4
    app.pendingAction = { kind: "card", card, wasSameLane };
    // 教學：通知打牌（在自己道）事件
    tutorialNotify("playCard");
    tutorialNotify("playerAction");
  } else {
    app.playerSpeed += card.speedValue;
  }

  // v0.9 canChangeLane（換道節奏 laneRhythm）：
  //   - 拖本道  → 加 speedValue、扣胎、然後進選道 modal 讓玩家選要換去哪
  //   - 拖別道  → 在前面已被當成標準棄牌換道處理過、根本進不到這裡
  // 注意：不能先 checkAutoPrompt！若這張是手牌最後一張，checkAutoPrompt 會把
  // mode 切到 prompt-overtake-or-pass、導致選道分支被跳過、永遠進不了選道。
  // 直接進選道 modal、選完道之後（line 2505 區）才會呼叫 checkAutoPrompt。
  if (card.canChangeLane && app.laneCount > 1) {
    app.cornerPickFromLane = app.playerLane;  // 紀錄選道前位置（取消用）
    app.mode = "stage2-corner-pick-lane";
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
  if (!isStage2()) {
    app.pendingAction = null;
    return;
  }
  const pa = app.pendingAction;
  // 步驟 3：檢查尾流（這時對手已動完）
  const slipDelta = consumeSlipstreamDelta();
  if (slipDelta) {
    playerSpeedSource(slipDelta, "尾流", "#ff9b54");
    // 績效考核：吃尾流事件
    updateBossTaskProgress("slipstream");
  } else if (pa.wasSameLane && app.playerLane !== app.opponentLane
             && !app.stage2?.slipstreamUsed) {
    // 玩家步驟 1 結束時同道、但對手切走 → 嘲諷
    // 但如果這回合 slipstream 已經被吃過（例如回合開頭同道立刻拿）→ 不嘲諷
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

// ─── Passive Behavior Layer ────────────────────────────────────────────
// 目前 NCC-7 的 espionage 跟 performanceReview 都改在 playCardToLane 開頭
// 用 maybeActivateBossPassivesEarly 提前觸發、這個函式只當保險用
function executePassiveBehavior(b) {
  // espionage / performanceReview 在動作開頭已經提前啟動、這裡 no-op
  // 未來其他 passive 行為的 fallback 入口
}

// 在玩家動作「最開頭」觸發 Boss 的「需要在動作期間生效」的 passive
//   - espionage：要 active 旗標、玩家第一個速度來源就能被抽
//   - performanceReview：移到動作結束才 fire（見 maybeFirePerfReviewAtEndOfAction）
//     原因：本動的賽道加成要算進當前任務、所以評分要在路面結算完之後
function maybeActivateBossPassivesEarly() {
  if (!app.opponentBehaviors || !app.opponentBehaviorLastTriggered) return;
  if (app.stage2?.currentOpponentId !== "BOSS") return;
  const actN = app.actionsThisRound ?? 0;
  for (const b of app.opponentBehaviors) {
    if (b.action !== "espionage") continue;
    const lastAt = app.opponentBehaviorLastTriggered[b.id] ?? -Infinity;
    if (actN - lastAt < getEffectiveCooldown(b)) continue;
    app.opponentBehaviorLastTriggered[b.id] = actN;
    app.espionageActiveThisAction = true;
    const boss = app.stage2.boss = app.stage2.boss || {};
    boss.espionageCumulative = 0;
    pushSpeedPop("opponent", "⚡ 監聽中", "rgba(255,100,200,0.95)");
    return;
  }
}

// 在玩家動作「結束時」觸發績效考核（賽道結算之後）
// 這樣本動的路面加成（含逆風 / 順風 / 紅綠燈 / 彎道 ×mult）會先算進當前任務、
// 才評分。確保「累積淨加速」這類任務不會少算本動的最後一筆。
// 呼叫時機：advanceCircuitOnCard 末端、clearEspionageFlagsAtEndOfAction 之後
function maybeFirePerfReviewAtEndOfAction() {
  if (!app.opponentBehaviors || !app.opponentBehaviorLastTriggered) return;
  if (app.stage2?.currentOpponentId !== "BOSS") return;
  const actN = app.actionsThisRound ?? 0;
  for (const b of app.opponentBehaviors) {
    if (b.action !== "performanceReview") continue;
    const lastAt = app.opponentBehaviorLastTriggered[b.id] ?? -Infinity;
    if (actN - lastAt < getEffectiveCooldown(b)) continue;
    app.opponentBehaviorLastTriggered[b.id] = actN;
    executePerformanceReview();
    return;
  }
}

// 兼容舊呼叫點：保留 maybeActivateEspionageEarly 名稱
const maybeActivateEspionageEarly = maybeActivateBossPassivesEarly;

// 動作結束時清旗標（呼叫於 advanceCircuitOnCard 末端、賽道結算之後）
// 累計顯示 boss.espionageCumulative 不清、要等下次 maybeActivateBossPassivesEarly 才重置
function clearEspionageFlagsAtEndOfAction() {
  app.espionageActiveThisAction = false;
}

// 取得 behavior 的「有效冷卻」
//   - Phase 4 企業壓制啟動時：espionage 跟 moveSmart 的 cd -1
//   - 績效考核 cd 不變
//   - 其他 behavior cd 不變
function getEffectiveCooldown(behavior) {
  if (!behavior) return 0;
  const baseCd = behavior.cooldown ?? 0;
  if (app.stage2?.boss?.suppressionActive) {
    if (behavior.action === "espionage" || behavior.action === "moveSmart") {
      return Math.max(0, baseCd - 1);
    }
  }
  return baseCd;
}

// ─── 績效考核（Phase 3）────────────────────────────────────────────────
// 觸發時機：cd 3 滿、由 maybeActivateBossPassivesEarly 呼叫
// 行為：評分當前任務 → 派發新任務 → 開啟中央 modal（含長官評語）
function executePerformanceReview() {
  const boss = app.stage2?.boss;
  if (!boss) return;
  let evalResult = null;
  if (boss.currentTask) {
    evalResult = evaluateCurrentBossTask();
  }
  assignNewBossTask();
  // 視覺：飛字 + 抽長官評語 + 彈中央 modal
  pushSpeedPop("opponent", "🔍 績效考核", "rgba(255,217,79,0.95)");
  boss.lastCommentary = pickNcc7Commentary(evalResult);
  openPerfReviewModal(false);  // 不再 auto-close、留給玩家手動縮小或點外面
}

// 評分當前任務、更新 buff/debuff 堆疊、寫入歷史
// 回傳 "pass" / "fail"
function evaluateCurrentBossTask() {
  const boss = app.stage2.boss;
  const ct = boss.currentTask;
  if (!ct) return null;
  const passed = ct.subTasks.every(st => st.progress >= st.def.targetN);
  // 累計考核次數（第 N 次）
  boss.evalCount = (boss.evalCount || 0) + 1;
  // 寫歷史紀錄（push 到尾端、最新的在最底下、舊的在最頂）
  boss.evalHistory.push({
    taskDisplay: ct.def.displayText,
    passed,
    evalNumber: boss.evalCount,
  });
  // 只保留最近 5 筆（從前面砍、保留最新的 5 筆）
  if (boss.evalHistory.length > 5) boss.evalHistory.shift();
  if (passed) {
    boss.buffStacks = Math.min(3, boss.buffStacks + 1);
    boss.debuffStacks = 0;
  } else {
    boss.debuffStacks = Math.min(3, boss.debuffStacks + 1);
    boss.buffStacks = 0;
  }
  boss.currentTask = null;
  return passed ? "pass" : "fail";
}

// 從評語池抽一句（依結果類型）
const NCC7_COMMENTARY_POOL = {
  start: [
    "霓虹道路株式會社啟動定期績效考核。請車手達成下方 KPI 目標。",
    "歡迎進入企業評估體系。第一份 KPI 已下發。",
    "第一份考核項目已下發、請務必如期完成。",
  ],
  pass: [
    "車手達成本季目標。為了維持競爭力、抽成將上調 10%。",
    "老闆對車手表現滿意、要求繼續精進。抽成 +10%。",
    "達標即是基線、抽成上調 10% 維持壓力。下季標準同步上修。",
    "KPI 完成、抽成提升 10%。組織期望持續高效運作。",
    "績效認列、抽成 +10%。企業政策:好的表現、要回饋更多給組織。",
    "達標獎勵已發放:抽成 +10%。請繼續為公司創造價值。",
  ],
  fail: [
    "KPI 未達標、抽成下調 10%。請車手立即改進。",
    "績效報告:未達標。NCC-7 將抽成下調 10%、惟仍會加強監控。",
    "KPI 未達、抽成下修 10%。NCC-7 建議車手檢討策略。",
    "績效低於預期、抽成 -10%。企業議會表示遺憾。",
    "未達標、抽成下調 10% 以紓困。NCC-7 觀察車手後續表現。",
  ],
};
// 抽評語、避開本場已抽過的（用 boss.commentaryPicked 記錄）
// 池內所有句子都抽過 → 清空該類別、重新抽
function pickNcc7Commentary(evalResult) {
  const key = evalResult === "pass" ? "pass" : evalResult === "fail" ? "fail" : "start";
  const pool = NCC7_COMMENTARY_POOL[key];
  if (!pool || pool.length === 0) return "";
  const boss = app.stage2?.boss;
  if (!boss) return pool[Math.floor(Math.random() * pool.length)];
  // 初始化 picked 結構（per Boss-fight、resetBossState 時清空）
  boss.commentaryPicked = boss.commentaryPicked || { start: new Set(), pass: new Set(), fail: new Set() };
  const picked = boss.commentaryPicked[key];
  // 找出還沒抽過的
  let unused = pool.filter(line => !picked.has(line));
  // 全部抽過了 → 重洗該類別
  if (unused.length === 0) {
    picked.clear();
    unused = pool.slice();
  }
  const line = unused[Math.floor(Math.random() * unused.length)];
  picked.add(line);
  return line;
}

// 中央 modal 狀態
//   visible        — 是否顯示（包含正在淡入淡出時）
//   state          — "opening" | "open" | "closing" | "closed"
//   stateStart     — 進入當前狀態的 timestamp（用於動畫進度）
//   bounds         — modal 當前的矩形範圍（給 click-outside 判定用、每 frame 更新）
function openPerfReviewModal(_unused) {
  app.perfReviewModal = app.perfReviewModal || {};
  app.perfReviewModal.visible = true;
  app.perfReviewModal.state = "opening";
  app.perfReviewModal.stateStart = performance.now();
}
function closePerfReviewModal() {
  if (!app.perfReviewModal || !app.perfReviewModal.visible) return;
  if (app.perfReviewModal.state === "closing") return;
  app.perfReviewModal.state = "closing";
  app.perfReviewModal.stateStart = performance.now();
}

// 取得下次績效考核還要幾動（給 MEMO + modal 顯示倒數用）
function getPerfReviewCountdown() {
  if (app.stage2?.currentOpponentId !== "BOSS") return null;
  if (!app.opponentBehaviors || !app.opponentBehaviorLastTriggered) return null;
  const actN = app.actionsThisRound ?? 0;
  for (const b of app.opponentBehaviors) {
    if (b.action !== "performanceReview") continue;
    const lastAt = app.opponentBehaviorLastTriggered[b.id] ?? -Infinity;
    if (lastAt === -Infinity) return null;
    return Math.max(0, lastAt + b.cooldown - actN);
  }
  return null;
}

// 取得車手心理狀態描述（依 buff / debuff 堆疊）
//   - 三層 buff / 三層 debuff 各自有些微不同的敘述
//   - 無堆疊：中性描述
//   回傳 { line, color }
function getDriverMoodDescription() {
  const boss = app.stage2?.boss;
  if (!boss) return null;
  const buff = boss.buffStacks;
  const debuff = boss.debuffStacks;
  if (buff > 0) {
    const lines = [
      "車手對於績效達標感到鼓勵！QTE 難度 -1。",
      "車手達標兩次、信心穩步提升！QTE 難度 -2。",
      "車手連續達標、進入心流狀態！QTE 難度 -3。",
    ];
    return { line: lines[Math.min(2, buff - 1)], color: "rgba(140, 255, 160, 0.95)" };
  }
  if (debuff > 0) {
    const lines = [
      "車手對於績效未達標感到沮喪…… QTE 難度 +1。",
      "車手連續未達標、開始感到焦慮…… QTE 難度 +2。",
      "車手績效持續低迷、瀕臨崩潰…… QTE 難度 +3。",
    ];
    return { line: lines[Math.min(2, debuff - 1)], color: "rgba(255, 130, 130, 0.95)" };
  }
  // 中性狀態（buff=0、debuff=0）
  // 有當前任務 → 考核已啟動、正在受評
  // 無當前任務 → 還沒被派發、靜待 KPI
  const neutralLine = boss.currentTask
    ? "車手正在接受績效考核……"
    : "車手保持平常心、靜待 KPI 派發。";
  return { line: neutralLine, color: "rgba(220, 220, 220, 0.75)" };
}

// 從任務池抽一個指定 level 的任務（排除已用過的、可指定排除 type）
function pickRandomBossTask(level, excludeType = null) {
  const boss = app.stage2.boss;
  let candidates = Object.values(BOSS_TASK_POOL).filter(t =>
    t.level === level
    && !boss.taskHistory.has(t.id)
    && (excludeType == null || t.type !== excludeType)
  );
  // 池空 → 清掉這個 level 的歷史、重新抽
  if (candidates.length === 0) {
    boss.taskHistory = new Set([...boss.taskHistory].filter(id => {
      const t = BOSS_TASK_POOL[id];
      return t && t.level !== level;
    }));
    candidates = Object.values(BOSS_TASK_POOL).filter(t =>
      t.level === level
      && (excludeType == null || t.type !== excludeType)
    );
    if (candidates.length === 0) return null;
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// 建立 sub-task 結構
function makeBossSubTask(def) {
  return {
    def,
    progress: 0,
    extra: {},  // for uniqueLanes 用 Set
  };
}

// 派發新任務
//   - 一般：抽一個 level = buffStacks+1（capped 3）的任務
//   - buff=3：抽兩個任務（L1+L3 或 L2+L2 隨機、不同 type）
//   - tactic_l3 特殊：遞迴抽兩個不同 type 的 L1
function assignNewBossTask() {
  const boss = app.stage2.boss;
  if (!boss) return;
  // buff 滿層（=3）：抽兩個任務、不同 type
  if (boss.buffStacks >= 3) {
    const useL1L3 = Math.random() < 0.5;
    const lA = useL1L3 ? 1 : 2;
    const lB = useL1L3 ? 3 : 2;
    const taskA = pickRandomBossTask(lA);
    const taskB = pickRandomBossTask(lB, taskA?.type);
    if (!taskA || !taskB) return;
    boss.taskHistory.add(taskA.id);
    boss.taskHistory.add(taskB.id);
    boss.currentTask = {
      def: { id:"buffmax_combo", type:"combo", level:4, displayText:"雙重任務" },
      subTasks: [makeBossSubTask(taskA), makeBossSubTask(taskB)],
    };
    return;
  }
  // 一般：抽一個 level = buffStacks+1 的任務
  const level = Math.min(3, boss.buffStacks + 1);
  const taskDef = pickRandomBossTask(level);
  if (!taskDef) return;
  boss.taskHistory.add(taskDef.id);
  // tactic_l3：遞迴抽兩個不同 type 的 L1
  if (taskDef.special === "recursive2L1") {
    const types = ["move", "resource", "output", "combat"];
    types.sort(() => Math.random() - 0.5);
    const subA = pickRandomBossTask(1);  // 任意 L1
    // pickRandomBossTask 第二次找一個不同 type 的 L1
    const subB = pickRandomBossTask(1, subA?.type);
    if (!subA || !subB) {
      // fallback：直接給 4 張車隊牌
      boss.currentTask = {
        def: taskDef,
        subTasks: [makeBossSubTask({ ...taskDef, targetN: 4, displayText: "打 4 張車隊牌", special: null })],
      };
      return;
    }
    boss.taskHistory.add(subA.id);
    boss.taskHistory.add(subB.id);
    boss.currentTask = {
      def: taskDef,
      subTasks: [makeBossSubTask(subA), makeBossSubTask(subB)],
    };
  } else {
    boss.currentTask = {
      def: taskDef,
      subTasks: [makeBossSubTask(taskDef)],
    };
  }
}

// 更新當前任務進度（呼叫於各種玩家事件、見後續 hooks）
//   eventType — "laneChange" | "discard" | "stabilityDrop" | "cardPlay" | "teamCardPlay" | "speedDelta" | "slipstream" | "qteSuccess"
//   data      — 事件相關資料（如 laneChange 帶 newLane、speedDelta 帶 delta）
function updateBossTaskProgress(eventType, data = {}) {
  if (app.stage2?.currentOpponentId !== "BOSS") return;
  const boss = app.stage2.boss;
  if (!boss?.currentTask) return;
  for (const sub of boss.currentTask.subTasks) {
    const def = sub.def;
    if (sub.progress >= def.targetN) continue;  // 已達標、跳過
    switch (def.type) {
      case "move":
        if (def.special === "uniqueLanes" && eventType === "laneChange") {
          sub.extra.lanesVisited = sub.extra.lanesVisited || new Set();
          sub.extra.lanesVisited.add(data.newLane);
          sub.progress = sub.extra.lanesVisited.size;
        } else if (eventType === "laneChange") {
          sub.progress += 1;
        }
        break;
      case "resource":
        if (def.special === "stabilityOnly") {
          if (eventType === "stabilityDrop") sub.progress += 1;
        } else if (def.special === "stabilityOrLaneChange") {
          // 穩定區 + 換道（laneChange）都算
          if (eventType === "stabilityDrop" || eventType === "laneChange") {
            sub.progress += 1;
          }
        } else if (eventType === "stabilityDrop" || eventType === "discard") {
          sub.progress += 1;
        }
        break;
      case "tactic":
        if (eventType === "teamCardPlay") sub.progress += 1;
        break;
      case "output":
        // 只計正向 delta（net、已含 espionage 抽走）
        if (eventType === "speedDelta" && data.delta > 0) {
          sub.progress = Math.min(def.targetN, sub.progress + data.delta);
        }
        break;
      case "combat":
        if (def.level === 1 && eventType === "slipstream") sub.progress += 1;
        else if (def.level === 2 && eventType === "cardPlay") sub.progress += 1;
        else if (def.level === 3 && eventType === "qteSuccess") sub.progress += 1;
        break;
    }
  }
}

// ─── 企業間諜視覺特效 ──────────────────────────────────────────────────
// 1. Boss 監聽中：紅紫掃描線 overlay + 邊框脈衝
// 2. Per-skim 資料光束：玩家→Boss 紅紫虛線 + 移動粒子
//
// 呼叫時機：drawScene 主流程、兩台車繪製之後、speedPops 之前

// 在 applyEspionageTransfer 結算時呼叫、push 一條光束
function spawnEspionageBeam(skim) {
  app.espionageBeams = app.espionageBeams || [];
  app.espionageBeams.push({
    startTime: performance.now(),
    duration: 700,
    magnitude: skim,  // 正：玩家被抽、Boss 取得；負：Boss 被扣、玩家拿回
  });
}

function drawEspionageEffects(time, opponentX, opponentY, playerX, playerY) {
  const ctx = app.ctx;

  // ─── 1. Boss 監聽中 overlay ─────────────────────────────────────
  if (app.espionageActiveThisAction) {
    const redW = 130, redH = 70;  // 對手車尺寸（同 drawCar）
    const bx = opponentX - redW / 2;
    const by = opponentY - redH / 2;
    // (a) 掃描線：3 條紅紫線、從上往下飄
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(bx, by, redW, redH, 6);
    ctx.clip();
    const phase = (time / 600) % 1;
    const lineAlpha = 0.45 + 0.25 * Math.sin(time / 180);
    ctx.strokeStyle = `rgba(255, 80, 200, ${lineAlpha})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const ly = by + ((phase + i / 3) % 1) * redH;
      ctx.beginPath();
      ctx.moveTo(bx, ly);
      ctx.lineTo(bx + redW, ly);
      ctx.stroke();
    }
    // (b) 紅紫色 tint
    ctx.fillStyle = `rgba(255, 80, 180, ${0.08 + 0.04 * Math.sin(time / 200)})`;
    ctx.fillRect(bx, by, redW, redH);
    ctx.restore();
    // (c) 外框脈衝光暈
    ctx.save();
    const borderAlpha = 0.45 + 0.25 * Math.sin(time / 200);
    ctx.strokeStyle = `rgba(255, 80, 200, ${borderAlpha})`;
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(255, 60, 180, 0.65)";
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.roundRect(bx - 3, by - 3, redW + 6, redH + 6, 8);
    ctx.stroke();
    ctx.restore();
  }

  // ─── 2. 資料光束（per-skim event）────────────────────────────────
  if (app.espionageBeams && app.espionageBeams.length) {
    const now = performance.now();
    for (let i = app.espionageBeams.length - 1; i >= 0; i--) {
      const beam = app.espionageBeams[i];
      const elapsed = now - beam.startTime;
      if (elapsed > beam.duration) {
        app.espionageBeams.splice(i, 1);
        continue;
      }
      const t = elapsed / beam.duration;  // 0..1
      // 光束端點：玩家頭頂 → Boss 中央
      const fx = playerX,  fy = playerY - 30;
      const tx = opponentX, ty = opponentY - 5;
      // 方向：正 skim 玩家→Boss（被抽）；負 skim Boss→玩家（拿回）
      const isReverse = beam.magnitude < 0;
      const sx = isReverse ? tx : fx;
      const sy = isReverse ? ty : fy;
      const ex = isReverse ? fx : tx;
      const ey = isReverse ? fy : ty;
      const color = isReverse
        ? `rgba(80, 255, 140, `    // 亮綠：玩家拿回（提亮）
        : `rgba(255, 100, 200, `;  // 紅紫：Boss 抽走
      const alpha = (1 - t) * 0.9;
      ctx.save();
      ctx.strokeStyle = color + `${alpha})`;
      // 綠色 beam 加厚（更顯眼）
      ctx.lineWidth = (isReverse ? 2.5 : 1.5) + Math.min(4, Math.abs(beam.magnitude) / 6);
      ctx.setLineDash([4, 6]);
      ctx.lineDashOffset = -t * 50;
      ctx.shadowColor = color + (isReverse ? `0.9)` : `0.7)`);
      ctx.shadowBlur = isReverse ? 14 : 8;
      // 曲線中點往上偏（避免穿過車體中間、有飛弧感）
      const mx = (sx + ex) / 2;
      const my = (sy + ey) / 2 - 60;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(mx, my, ex, ey);
      ctx.stroke();
      // 領頭粒子（順著曲線、比光束快一點抵達）
      const u = Math.min(1, t * 1.5);
      const px = (1 - u) * (1 - u) * sx + 2 * (1 - u) * u * mx + u * u * ex;
      const py = (1 - u) * (1 - u) * sy + 2 * (1 - u) * u * my + u * u * ey;
      ctx.setLineDash([]);
      ctx.fillStyle = color + `${alpha * 1.2})`;
      ctx.beginPath();
      ctx.arc(px, py, (isReverse ? 5 : 3) + Math.min(5, Math.abs(beam.magnitude) / 6), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

function triggerOpponentActions() {
  // 守門：如果 mode 已經被切到結束/結算狀態（如 result、stage2-finish-line），
  // 不應該再進對手回合過場（避免遮蓋輸/勝畫面）
  if (app.mode !== "playing" && app.mode !== "stage2-corner-pick-lane") {
    return;
  }
  // B 強招「豁免」只到下次玩家動作觸發對手回合為止 → 進入時重置
  app.opponentAuraBypassed = false;
  // 教學早期：陪跑員不動、走 idle 過場（讓「對手在順風道吃 +10」這類加成結算照走）
  if (tutorialBlocksOpponent()) {
    beginOpponentTurnIdle();
    return;
  }
  // ─── 冷卻系統 ──────────────────────────────────────────────────
  if (app.opponentBehaviors && app.opponentBehaviorLastTriggered) {
    const actN = app.actionsThisRound ?? 0;
    // 找出所有「冷卻已滿」的 behavior
    const ready = [];
    for (const b of app.opponentBehaviors) {
      const lastAt = app.opponentBehaviorLastTriggered[b.id] ?? -Infinity;
      if (actN - lastAt >= getEffectiveCooldown(b)) {
        ready.push(b);
      }
    }
    // ── Passive 層：跟主動 behavior 並行觸發、不走獨立 turn 動畫 ──
    // NCC-7 的 espionage 跟 performanceReview 不走這層：
    //   - espionage 由 maybeActivateBossPassivesEarly 於動作開頭觸發
    //   - performanceReview 由 maybeFirePerfReviewAtEndOfAction 於動作末端觸發
    // 兩者都自管 lastTriggered、dispatcher 不能再更新（會搶到 cd 永遠不滿）
    const isSelfManaged = (b) => b.action === "espionage" || b.action === "performanceReview";
    const passiveReady = ready.filter(b => b.weight === "passive" && !isSelfManaged(b));
    for (const passive of passiveReady) {
      app.opponentBehaviorLastTriggered[passive.id] = actN;
      executePassiveBehavior(passive);
    }
    // ── Active 層：擇一觸發、走 turn 動畫 ──
    const activeReady = ready.filter(b => b.weight !== "passive");
    if (activeReady.length > 0) {
      // 挑 weight 最強的一個（strong > medium > weak）
      const weightRank = { strong: 3, medium: 2, weak: 1 };
      activeReady.sort((a, b) => (weightRank[b.weight] || 0) - (weightRank[a.weight] || 0));
      const picked = activeReady[0];
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
      const targetLane = (isStage2() && app.playerLaneBeforeAction != null)
        ? app.playerLaneBeforeAction
        : app.playerLane;
      app.opponentLane = Math.max(0, Math.min(app.laneCount - 1, targetLane));
    } else if (typeof act.target === "number") {
      app.opponentLane = act.target;
    }
    // boostAfter：moveTo 之後附帶加速
    if (act.boostAfter) {
      app.opponentSpeed += act.boostAfter;
      pushSpeedDeltaPop("opponent", act.boostAfter, "加速");
      // 阻擋 / 遠離標籤
      let intentTag = "";
      if (isStage2() && app.playerLaneBeforeAction != null) {
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
      if (isStage2() && app.playerLaneBeforeAction != null) {
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
      if (isStage2() && app.playerLaneBeforeAction != null) {
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
    // 隨機切到相鄰道
    const prevLane = app.opponentLane;
    const candidates = [];
    if (prevLane > 0) candidates.push(prevLane - 1);
    if (prevLane < app.laneCount - 1) candidates.push(prevLane + 1);
    if (candidates.length > 0) {
      app.opponentLane = candidates[Math.floor(Math.random() * candidates.length)];
      announceOpponentMove(prevLane, app.opponentLane);
    }
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
  const playerRef = (isStage2() && app.playerLaneBeforeAction != null)
    ? app.playerLaneBeforeAction
    : app.playerLane;
  // dynamic 策略：依玩家是否吃過尾流轉換
  let effectiveStrategy = strategy;
  if (strategy === "dynamicAvoidOrBlock") {
    const slipstreamConsumed = app.stage2?.slipstreamUsed === true;
    if (slipstreamConsumed) {
      // 玩家已吃尾流 → 直接切到玩家動作前道（block）
      return playerRef;
    } else {
      // 玩家還沒吃尾流 → 等同 avoidPlayer
      effectiveStrategy = "avoidPlayer";
    }
  }
  // 計算每條道對手的顯示速度
  const scores = [];
  for (let i = 0; i < N; i++) {
    const isPlayerLane = (i === playerRef);
    // avoidPlayer 策略：玩家基準道直接排除
    if (effectiveStrategy === "avoidPlayer" && isPlayerLane) continue;
    scores.push({ lane: i, speed: calcOpponentSpeedAtLane(i, bypassAura) });
  }
  if (scores.length === 0) {
    // avoidPlayer 但所有道都是玩家道（不該發生）→ 退回 bestForSelf
    for (let i = 0; i < N; i++) {
      scores.push({ lane: i, speed: calcOpponentSpeedAtLane(i, bypassAura) });
    }
  }
  // bestForSelf（破風者）：在可選的非災害道之間隨機（v0.9 改動：不再挑最快、加上隨機性）
  if (effectiveStrategy === "bestForSelf") {
    return scores[Math.floor(Math.random() * scores.length)].lane;
  }
  // avoidPlayer：(1) 速度最高 (2) 離玩家越遠越好 (3) 仍平手 → 隨機（避免永遠待在同一道）
  if (effectiveStrategy === "avoidPlayer") {
    scores.sort((a, b) => {
      if (b.speed !== a.speed) return b.speed - a.speed;
      // 離玩家越遠越好（更符合「遠離」語意）
      const distA = Math.abs(a.lane - playerRef);
      const distB = Math.abs(b.lane - playerRef);
      return distB - distA;
    });
    // 找出與 top 同分（速度跟離玩家距離都相同）的所有道、隨機選一條
    const top = scores[0];
    const topDist = Math.abs(top.lane - playerRef);
    const tied = scores.filter(s =>
      s.speed === top.speed && Math.abs(s.lane - playerRef) === topDist
    );
    return tied[Math.floor(Math.random() * tied.length)].lane;
  }
  // 其他策略（保留原行為）：仍挑最快、同分時優先選跟當前道近的
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
  if (isStage2() && app.playerLaneBeforeAction != null) {
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
    // 教學：超車/Pass 提示出現
    tutorialNotify("canOvertake");
  }
}

function doOvertake() {
  if (isStage2()) {
    if (app.stage2) app.stage2.lastMistakeCount = 0;
    doOvertakeQTE();
    return;
  }
  app.rank = Math.max(1, app.rank - 1);
  clearLaneAfterOvertake();
  app.qteScore = null; app.qteScoreMax = null; app.qteScorePass = null;
  if (app.stage2) app.stage2.lastMistakeCount = 0;
  app.mode = "result";
  app.message = "超車成功！";
}

function doOvertakeQTE() {
  app.mode = "splash-overtake";
  app.message = "極限超車 QTE";
  app.qteStart = performance.now();
  carMotion = createCarMotion();  // 每次 QTE 都重生擺動參數、不可預測
  // 教學：玩家按超車鈕後、QTE 確認視窗出現 → 推進 tryOvertakePress 步
  tutorialNotify("overtakeButton");
  // 等玩家按「開始 QTE」確認鍵才進 rhythm-formal（按鈕在 drawSplash 顯示）
}

function doPass() {
  // 第五關走自己的流程
  if (isStage2()) {
    // 注意：必須在 clearLaneAfterOvertake 之前判斷後車條件
    stage2OnPass();
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
function isStage2() {
  return STAGES[app.stageIndex] && STAGES[app.stageIndex].isStage2;
}
// 觸發三選一
function stage2BeginRewardPick() {
  const s2 = app.stage2;
  if (!s2) return;
  // 牌池：1 指令 + 1 車隊 + 1 隨機（三張之間互不重複）
  //   - 排除 mistake：失誤牌只能從 QTE 懲罰取得、絕不在獎勵階段出現
  //   - 排除 color === "basic"：基本牌（加速、風阻減免）不在獎勵出現、玩家初始牌庫已有
  //   - 排除 requiresTires 標記的牌：本關沒有輪胎機制、相關牌沒意義
  //     （若未來新增有輪胎的關卡、把 stage.hasTires 設為 true 就會自動放回）
  //   - 排除「已裝備且 unique」的 equip 車隊牌（如大數據預測：拿到後不重複出現）
  const stageHasTires = !!(STAGES[app.stageIndex] && STAGES[app.stageIndex].hasTires);
  // 已裝備的 equip 車隊牌效果集合（用 effect 判斷、避免實例物件比對）
  const equippedEffects = new Set((s2.teamCardsActive || [])
    .filter(c => c.trigger === "equip")
    .map(c => c.effect));
  const isCardAllowed = (def) => {
    if (!def) return false;
    if (def.requiresTires && !stageHasTires) return false;
    if (def.color === "basic") return false;
    // equip-once 車隊牌：已裝備就不再出現
    if (def.cardClass === "team" && def.trigger === "equip"
        && def.effect && equippedEffects.has(def.effect)) {
      return false;
    }
    return true;
  };
  const cmdKeys = Object.keys(STAGE2_COMMAND_CARDS).filter(k =>
    k !== "mistake" && isCardAllowed(STAGE2_COMMAND_CARDS[k])
  );
  const teamKeys = Object.keys(STAGE2_TEAM_CARDS).filter(k =>
    isCardAllowed(STAGE2_TEAM_CARDS[k])
  );
  const cmdPick = cmdKeys[Math.floor(Math.random() * cmdKeys.length)];
  // teamPick：跟 cmdPick 不會重複（不同池）、所以直接抽
  const teamPick = teamKeys[Math.floor(Math.random() * teamKeys.length)];
  // randomPick：從所有牌中排除已選的兩張、再隨機抽
  const allKeys = [...cmdKeys, ...teamKeys];
  const remaining = allKeys.filter(k => k !== cmdPick && k !== teamPick);
  const randomPick = remaining[Math.floor(Math.random() * remaining.length)];
  const picks = [cmdPick, teamPick, randomPick];
  s2.rewardOptions = picks.map(t => makeStage2Card(t));
  s2.rewardSlotHover = -1;
  app.mode = "stage2-reward";
}
// 玩家選了一張獎勵
function stage2OnRewardPicked(slot) {
  const s2 = app.stage2;
  if (!s2 || !s2.rewardOptions || !s2.rewardOptions[slot]) return;
  const picked = s2.rewardOptions[slot];
  // v0.9 新分類（用 trigger 而非 persistence 判斷）：
  //   - trigger === "equip" → 進 teamCardsActive、不入牌庫、立即生效
  //   - trigger === "play"（或指令牌）→ 進牌庫、需要打出才生效
  const isEquipTeam = picked.cardClass === "team" && picked.trigger === "equip";
  if (isEquipTeam) {
    s2.teamCardsActive.push(picked);
  } else {
    // v0.9：獎勵牌直接放牌庫頂（drawPile 頂端 = unshift）、下次抽牌一定先抽到它
    // 同時加進 deckPermanent 紀錄、之後重洗時也會回到牌庫
    s2.deckPermanent.push(picked);
    s2.drawPile.unshift(picked);
  }
  s2.rewardOptions = [];
  s2.rewardSlotHover = -1;
  // 測試模式：直接跳 Boss 時、選滿 3 次才進回合
  if (s2._testRewardsRemaining && s2._testRewardsRemaining > 1) {
    s2._testRewardsRemaining--;
    stage2BeginRewardPick();
    return;
  }
  s2._testRewardsRemaining = 0;
  stage2StartNewRound();
}
// 玩家略過獎勵
function stage2OnRewardSkip() {
  const s2 = app.stage2;
  if (!s2) return;
  s2.rewardOptions = [];
  s2.rewardSlotHover = -1;
  // 測試模式：跳過也算一次
  if (s2._testRewardsRemaining && s2._testRewardsRemaining > 1) {
    s2._testRewardsRemaining--;
    stage2BeginRewardPick();
    return;
  }
  s2._testRewardsRemaining = 0;
  stage2StartNewRound();
}
// 套用車隊牌持續效果到本回合 app 狀態
function applyTeamCardEffects() {
  const s2 = app.stage2;
  if (!s2) return;
}
// 開始一個新回合（換對手、發牌、清狀態）
function stage2StartNewRound() {
  const s2 = app.stage2;
  if (!s2) return;
  // 清掉上回合可能殘留的超車動畫（避免新回合對手車卡在畫面外）
  app.overtakePassAnim = null;
  // 清企業間諜視覺殘留
  app.espionageBeams = [];
  app.espionageActiveThisAction = false;
  if (s2.ahead.length === 0) {
    stage2OnGameWin();
    return;
  }
  // 回合計數：本次「即將開始」的是第幾個新回合
  s2.roundsPlayed = (s2.roundsPlayed || 0) + 1;
  // 已跑完上限回合 → 越過終點線、依當前名次結束
  if (s2.roundsPlayed > (s2.maxRounds || 20)) {
    stage2OnFinishLineReached();
    return;
  }
  // 每一輪都切下一段賽道（Pass / 超車 / 防守失敗，都會走到這裡）
  // 教學版第一回合例外：保留 initStage2State 設好的 c3、不切段
  if (s2.firstRoundReady) {
    s2.firstRoundReady = false;
  } else {
    advanceCircuit();
  }
  // 進新賽段時隨機放玩家到任一道（QTE / Pass 結束後不延續上段位置）
  // 教學版第一回合例外：玩家固定放中間道（lane 1）
  // 注意：要在 applyOpponentToApp() 之前做，因為對手位置會依玩家位置決定
  if (app.laneCount > 0) {
    if (s2.tutorial?.active && s2.roundsPlayed === 1) {
      app.playerLane = Math.min(1, app.laneCount - 1);
    } else {
      app.playerLane = Math.floor(Math.random() * app.laneCount);
    }
    app.playerLaneVisual = app.playerLane;
  }
  // 一般回合
  // 1. 抽當前對手
  s2.currentOpponentId = pickNextOpponent();
  if (!s2.currentOpponentId) {
    stage2OnGameWin();
    return;
  }
  applyOpponentToApp(s2.currentOpponentId);
  // 2. 套用車隊牌持續效果
  applyTeamCardEffects();
  // 3. 後車邏輯：最後一名（共 4 名 → rank 4）無後車；否則從 passed 抽
  if (app.rank === app.rankTotal) {
    s2.chaserId = null;
  } else {
    // 但若 chaserId 已被指定（剛超過你的人）就保留
    if (!s2.chaserId) {
      // v0.9：後車可以隨機抽（玩家後方的名次順序不重要、混亂感反而合理）
      const behindCandidates = s2.passed.slice();
      if (behindCandidates.length > 0) {
        s2.chaserId = behindCandidates[Math.floor(Math.random() * behindCandidates.length)];
      }
    }
  }
  applyChaserToApp(s2.chaserId);
  // 4. 清回合狀態（套用車隊牌「維持胎溫」keepSpeed 效果）
  let keepSpeedBonus = 0;
  for (const c of s2.teamCardsActive) {
    if (c.effect === "keepSpeed") keepSpeedBonus += (c.value || 0);
  }
  // 速度從 10 起，keepSpeed 保留；加成在第一個行動時才結算
  app.playerSpeed = 10 + keepSpeedBonus;
  app.cardsPlayedThisRound = 0;
  app.actionsThisRound = 0;
  s2.slipstreamUsed = false;
  // v0.9：清掉 thisRound 車隊牌、reset 每回合一次性狀態
  s2.teamCardsActive = s2.teamCardsActive.filter(c => c.persistence !== "thisRound");
  s2.lastCardType = null;
  s2.lastCardSameStreak = 0;
  s2.lastActionWasCard = false;
  // 空力區（穩定區）：每回合歸零
  app.stabilityCharges = 0;
  app.stabilityDropFx = null;
  // 5. 發手牌
  dealStage2Hand();
  // 6. circuitJustChanged 在這回合 reset
  s2.circuitJustChanged = false;
  // 7. 進 playing
  app.mode = "playing";
  // 8. 回合開始就和對手同道 → 立刻給尾流
  checkSlipstream();
}
// 玩家超車成功
function stage2OnOvertakeSuccess() {
  const s2 = app.stage2;
  if (!s2) return;
  // 教學：超車 QTE 成功（不論真的超過或只是磨掉專注）→ 推進 tryOvertake 步
  tutorialNotify("overtakeAttempt");
  // 績效考核：QTE 成功事件（combat L3）
  updateBossTaskProgress("qteSuccess");
  const oppId = s2.currentOpponentId;

  if (oppId) {
    // 扣對手專注度
    const curFocus = s2.opponentFocusMap[oppId] ?? 0;
    if (curFocus > 0) {
      // 專注度還有 → 扣 1，尚未超過
      s2.opponentFocusMap[oppId] = curFocus - 1;
      // Phase 4 企業壓制：BOSS 第二次 QTE 破防、focus 跌到 0 → 啟動（最後一張臉、垂死掙扎）
      if (oppId === "BOSS" && curFocus === 1 && s2.boss && !s2.boss.suppressionActive) {
        s2.boss.suppressionActive = true;
        showSuppressionBanner();
      }
      app.message = `打破防守！（專注度剩 ${curFocus - 1}）`;
      app.mode = "stage2-overtake-result";
      // 不移動排名、不移除對手，下回合繼續面對同一對手
      return;
    }
    // 專注度 = 0 → 真正超過
    s2.ahead = s2.ahead.filter(id => id !== oppId);
    s2.passed.push(oppId);
    app.rank = Math.max(1, app.rank - 1);
    // Boss 真正被超過 → 清空 Boss 戰狀態（任務 / Buff / Debuff / 累計 / 紀錄）
    if (oppId === "BOSS" && s2.boss) {
      s2.boss.currentTask = null;
      s2.boss.taskHistory = new Set();
      s2.boss.buffStacks = 0;
      s2.boss.debuffStacks = 0;
      s2.boss.espionageCumulative = 0;
      s2.boss.commentaryPicked = { start: new Set(), pass: new Set(), fail: new Set() };
      s2.boss.suppressionActive = false;
      app.suppressionBanner = null;
      s2.boss.evalHistory = [];
      s2.boss.evalCount = 0;
      s2.boss.lastCommentary = "";
    }
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
      // 玩家車也凍結在 QTE 結束當下位置、避免動畫期間白車順移回 lane 中心
      playerStartX: app._lastPlayerRenderX ?? null,
      playerStartY: app._lastPlayerRenderY ?? null,
    };
  }
  s2.currentOpponentId = null;
  app.opponentSpeed = 0;
  app.message = "超車成功！";
  app.mode = "stage2-overtake-result";
}
// 玩家超車失敗（QTE 失敗）
function stage2OnOvertakeFail() {
  const s2 = app.stage2;
  if (!s2) return;
  // 教學：超車 QTE 失敗也算嘗試 → 推進 tryOvertake 步
  tutorialNotify("overtakeAttempt");
  // v0.9：玩家沒掉名次、面對的對手不變（ahead 最後一個保留）
  //   但其他前方對手 + 所有後方對手的名次可以重新洗
  shuffleStage2Ranks();
  app.message = "超車失敗";
  app.mode = "stage2-overtake-result";  // 統一用 overtake-result 顯示分數
}
// 玩家 Pass — 非最後一名才進防守 QTE；最後一名直接進下一回合
function stage2OnPass() {
  stage2DoPassActual();
}
function stage2DoPassActual() {
  const s2 = app.stage2;
  if (!s2) return;
  // 清除上次 QTE 分數，避免防守結算畫面顯示舊資料
  app.qteScore = null; app.qteScoreMax = null; app.qteScorePass = null;
  if (s2) s2.lastMistakeCount = 0;
  // v0.9：玩家沒掉名次、面對的對手不變、但其他名次可以重新洗
  shuffleStage2Ranks();
  // 最後一名：無後車、不防守、直接下一回合
  if (app.rank === app.rankTotal) {
    app.message = "未超車";
    app.mode = "stage2-no-overtake";
    return;
  }
  app.message = "防守！";
  app._stage2DefenseInProgress = true;
  beginDefenseSequence();
}
// 排名洗牌：前方對手洗（玩家「前一名」固定不動）+ 後方對手洗
function shuffleStage2Ranks() {
  const s2 = app.stage2;
  if (!s2) return;
  // 前方：最後一個（玩家前一名）固定不動、其他洗牌
  //   ahead 結構：[..., 玩家前一名]
  if (s2.ahead.length >= 2) {
    const fixedFront = s2.ahead[s2.ahead.length - 1];
    const shufflePool = s2.ahead.slice(0, s2.ahead.length - 1);
    // 洗中間（遠方的名次可以亂跳）
    for (let i = shufflePool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shufflePool[i], shufflePool[j]] = [shufflePool[j], shufflePool[i]];
    }
    s2.ahead = [...shufflePool, fixedFront];
  }
  // 後方對手洗牌（後方名次混亂可接受）
  for (let i = s2.passed.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [s2.passed[i], s2.passed[j]] = [s2.passed[j], s2.passed[i]];
  }
  // chaserId 也重抽（從新後方陣容隨機）
  // 但若已被 pinnedNextOpponentId 鎖定就不動（這保留「剛超過你必追」的規則）
  if (!s2.pinnedNextOpponentId && s2.passed.length > 0) {
    s2.chaserId = s2.passed[Math.floor(Math.random() * s2.passed.length)];
  }
}
// 防守結束（第五關專用，接 updateDefense 之後）
function stage2OnDefenseEnd(success) {
  const s2 = app.stage2;
  if (!s2) return;
  app._stage2DefenseInProgress = false;
  if (success) {
    // 守住，進新回合
    app.message = "防守成功！";
    app.mode = "stage2-defense-result";
    return;
  }
  // 防守失敗
  // 檢查「後援車隊」一次性救命
  const backupIdx = s2.teamCardsActive.findIndex(c => c.effect === "saveOnDefeat");
  if (backupIdx >= 0) {
    s2.teamCardsActive.splice(backupIdx, 1);
    app.message = "後援車隊保住名次！";
    app.mode = "stage2-defense-result";
    return;
  }
  // 真的掉名次（不會超過 rankTotal-1，因為最後一名不會進防守）
  // v0.9 規則：chaser（顯示）可以隨機、但實際超車的必須是 passed 最後一個（玩家後一名）
  //   passed 最後 = 最近被超過 = 真正排玩家後一名的對手
  //   不用 s2.chaserId（那是顯示用、可能是更後面的對手）
  const realChaserId = s2.passed[s2.passed.length - 1];
  if (realChaserId) {
    if (!s2.ahead.includes(realChaserId)) s2.ahead.push(realChaserId);
    s2.passed = s2.passed.filter(id => id !== realChaserId);
    s2.pinnedNextOpponentId = realChaserId;
    s2.chaserId = null;  // 清空顯示用 chaser、下回合會在 startNewRound 重抽
  }
  app.rank = Math.min(app.rankTotal, app.rank + 1);
  app.message = "防守失敗 — 掉 1 名次";
  app.mode = "stage2-defense-result";
}
// 通關 = 整個遊戲勝利
function stage2OnGameWin() {
  app.mode = "all-clear";
}
// 跑完設定的最大回合數 = 越過終點線、依當前名次結束
function stage2OnFinishLineReached() {
  app.mode = "stage2-finish-line";
}
// 棄掉「名次上升時棄」的車隊牌
function discardOnRankUp() {
  const s2 = app.stage2;
  if (!s2) return;
  s2.teamCardsActive = s2.teamCardsActive.filter(c => c.persistence !== "untilRankUp");
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
    if (isStage2() && app._stage2DefenseInProgress) {
      stage2OnDefenseEnd(app.defenseSucceeded);
      return;
    }
    if (!app.defenseSucceeded) app.rank = Math.min(app.rankTotal, app.rank + 1);
    app.mode = "defense-result";
  }
}

// ─── QTE 邏輯（沿用 Sam）──────────────────────────────────────────────────
// 速度檔位（每 20 速一檔，基準速度 10）
// 回傳 step = 0,1,2,3,4,5... 表示超出基準幾檔
// 速度檔位：每 20 速度 +1 檔（影響 QTE 難度）
// 玩家當前所在道若有 qteDifficultyOffset（如 c6 油污中央 +1）→ 該道 QTE 檔位 +offset
// （只有踏到該道才生效；其他道走超車 / 防守 QTE 不受影響）
function speedTierStep(speed) {
  const base = Math.max(0, Math.floor((speed - 10) / 20));
  const b = getLaneBonusFor(app.playerLane);
  const offset = (b && typeof b.qteDifficultyOffset === "number") ? b.qteDifficultyOffset : 0;
  // 空力區（穩定區）：每張牌 -1 階 QTE 難度
  const stab = app.stabilityCharges || 0;
  // 績效考核 Buff/Debuff：buff -1、debuff +1
  const buff = app.stage2?.boss?.buffStacks || 0;
  const debuff = app.stage2?.boss?.debuffStacks || 0;
  return Math.max(0, base + offset - stab - buff + debuff);
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
  const diff = currentLaneQteDiffResolved();
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
  if (isStage2() && app.stage2) {
    const s2 = app.stage2;
    // chill（冷靜應對）：本動 QTE 容錯（用後即清）
    if (s2.chillForgiveActive) {
      PASS_THRESHOLD = maxScore * (0.6 - s2.chillForgiveActive);
      s2.chillForgiveActive = 0;
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
  if (isStage2()) {
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
    if (app.stage2) {
      if (mistakeCount > 0) {
        for (let i = mistakeCount - 1; i >= 0; i--) {
          const uid = `qte-mis-${Date.now()}-${i}`;
          app.stage2.drawPile.unshift(makeCard("mistake", uid));
        }
      } else if (mistakeCount < 0) {
        const idx = app.stage2.drawPile.findIndex(c => c.type === "mistake");
        if (idx >= 0) app.stage2.drawPile.splice(idx, 1);
        else {
          const di = app.stage2.discardPile.findIndex(c => c.type === "mistake");
          if (di >= 0) app.stage2.discardPile.splice(di, 1);
        }
      }
      app.stage2.lastMistakeCount = mistakeCount;
    }
    if (success) {
      stage2OnOvertakeSuccess();
    } else {
      stage2OnOvertakeFail();
    }
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
    // 績效考核 modal 開啟時、點外面（非 modal 內、非 modal 縮小按鈕）→ 關閉 modal、消化點擊
    const prm = app.perfReviewModal;
    if (prm?.visible && prm.state === "open" && prm.bounds) {
      if (!inRect(p, prm.bounds)) {
        closePerfReviewModal();
        return;
      }
    }
    const hit = hitButton(p);
    if (hit) { handleButton(hit); return; }
    // corner-pick mode：檢查是否點到某道
    if (app.mode === "stage2-corner-pick-lane" && app.cornerLaneRects) {
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
    // 空力區（穩定區）優先：丟牌降本回合 QTE 難度
    // 必須先檢查、因為 stability zone 在左下、會被下方寬版的「取消區」y 範圍包住
    const stabZone = app.zones.stabilityZone;
    if (stabZone && inRect(p, stabZone)) {
      dropCardToStability(app.drag.from);
      app.drag = null;
      return;
    }
    // 取消區：拖回手牌列附近（中央區段）才算取消、左右兩側不算
    const handTop = app.h - 190 - 60;
    const handBottom = app.h - 190 + 164 + 30;
    const handHalfWidth = 360;  // 中央 720px 寬視為手牌取消區
    const cancelLeft = app.w / 2 - handHalfWidth;
    const cancelRight = app.w / 2 + handHalfWidth;
    if (p.y >= handTop && p.y <= handBottom && p.x >= cancelLeft && p.x <= cancelRight) {
      app.drag = null;
      return;
    }
    const laneIdx = laneAtPoint(p);
    if (laneIdx >= 0) {
      const zone = app.zones.lanes && app.zones.lanes[laneIdx];
      if (zone && zone.droppable) {
        if (tutorialBlocksDropOnLane(laneIdx)) { app.drag = null; return; }
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
    // 空力區（穩定區）優先（理由同上）
    const stabZone = app.zones.stabilityZone;
    if (stabZone && inRect(p, stabZone)) {
      dropCardToStability(app.drag.from);
      app.drag = null;
      return;
    }
    const handTop = app.h - 190 - 60;
    const handBottom = app.h - 190 + 164 + 30;
    const handHalfWidth = 360;
    const cancelLeft = app.w / 2 - handHalfWidth;
    const cancelRight = app.w / 2 + handHalfWidth;
    if (p.y >= handTop && p.y <= handBottom && p.x >= cancelLeft && p.x <= cancelRight) {
      app.drag = null;
      return;
    }
    const laneIdx = laneAtPoint(p);
    if (laneIdx >= 0) {
      const zone = app.zones.lanes && app.zones.lanes[laneIdx];
      if (zone && zone.droppable) {
        if (tutorialBlocksDropOnLane(laneIdx)) { app.drag = null; return; }
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

// 教學限制：是否要禁止丟到這個道？
// playCard 步：只能丟自己道
// changeLane 步：只能丟「沒對手、也不是玩家」的道（避開對手 + 演示換道）
// opponentTryAction 步：只能丟到非玩家當前道（任一換道都行）
// stabilityDrop / dropToStabilityOnly：任何 lane 都擋（玩家只能丟到穩定區）
function tutorialBlocksDropOnLane(laneIdx) {
  const t = app.stage2?.tutorial;
  if (!t?.active) return false;
  const step = TUTORIAL_STEPS[t.stepIndex];
  if (!step) return false;
  const stepId = step.id;
  if (step.dropToStabilityOnly) return true;
  if (stepId === "playCard" && laneIdx !== app.playerLane) return true;
  if (stepId === "changeLane"
      && (laneIdx === app.playerLane || laneIdx === app.opponentLane)) return true;
  if (stepId === "opponentTryAction" && laneIdx === app.playerLane) return true;
  if (stepId === "bendTry" && laneIdx !== 0) return true;  // 只允許丟到內彎
  return false;
}

function canDragCards() {
  if (app.inputLocked) return false;
  // 教學特例：dropToStabilityOnly 步、允許拖牌（drop gate 會擋掉非穩定區的目標）
  const t = app.stage2?.tutorial;
  const step = t?.active ? TUTORIAL_STEPS[t.stepIndex] : null;
  if (step?.dropToStabilityOnly) return app.mode === "playing";
  if (tutorialBlocksGameplay()) return false;
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
  // 測試：直接跳到 Boss 戰
  if (id === "test-skip-to-boss") {
    skipToBossForTest();
    return;
  }
  // 測試：跳過新手教學
  if (id === "test-skip-tutorial") {
    skipTutorialForTest();
    return;
  }
  // 績效考核 MEMO 展開 → 開啟 modal（用戶手動、不自動縮小）
  if (id === "perfreview-memo-expand") {
    openPerfReviewModal(false);
    return;
  }
  // 績效考核 modal 縮小 → 關閉 modal
  if (id === "perfreview-modal-collapse") {
    closePerfReviewModal();
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
  // 教學：按繼續鈕推進步驟
  if (id === "tutorial-continue") {
    tutorialAdvance();
    return;
  }
  // 開場 intro 確認
  if ((id === "stage2-intro-next" || id === "stage2-intro-ok") && app.mode === "stage-2-intro") {
    stage2StartNewRound();
    return;
  }
  if (id === "stage2-corner-cancel-pick" && app.mode === "stage2-corner-pick-lane") {
    // 不換道：回 playing
    app.mode = "playing";
    app.cornerLaneRects = null;
    checkAutoPrompt();
    return;
  }
  // 超車成功結算 → 進三選一
  if (id === "stage2-to-reward" && app.mode === "stage2-overtake-result") {
    // 棄掉「名次上升時棄」的車隊牌
    discardOnRankUp();
    stage2BeginRewardPick();
    return;
  }
  // 沒超車（一般 result） → 進新回合
  if (id === "stage2-next-round" && (app.mode === "stage2-no-overtake" || app.mode === "stage2-defense-result" || app.mode === "stage2-overtake-result")) {
    stage2StartNewRound();
    return;
  }
  // 三選一：選擇 / 略過
  if (id && id.startsWith("stage2-reward-pick-") && app.mode === "stage2-reward") {
    const slot = parseInt(id.replace("stage2-reward-pick-", ""), 10);
    stage2OnRewardPicked(slot);
    return;
  }
  if (id === "stage2-reward-skip" && app.mode === "stage2-reward") {
    stage2OnRewardSkip();
    return;
  }
  // 打牌階段
  if (id === "btn-overtake" && app.mode === "playing" && !app.inputLocked
      && (!app.stage2?.tutorial?.active || tutorialAllowsOvertakeButton())) {
    if (canDirectOvertake()) pressOvertake();
    return;
  }
  if (id === "btn-pass" && app.mode === "playing" && !app.inputLocked
      && !app.stage2?.tutorial?.active) {
    pressPass();
    return;
  }
  // 詢問超車或 Pass
  if (id === "prompt-overtake" && app.mode === "prompt-overtake-or-pass"
      && (!app.stage2?.tutorial?.active || tutorialAllowsOvertakeButton())) {
    app.mode = "playing";
    pressOvertake();
    return;
  }
  if (id === "prompt-pass" && app.mode === "prompt-overtake-or-pass"
      && !app.stage2?.tutorial?.active) {
    app.mode = "playing";
    pressPass();
    return;
  }
  // QTE 確認鍵：玩家看完難度面板按下、開始 QTE
  //   教學中：只有 tryOvertakeQteStart / recapPress 步才放行
  if (id === "qte-confirm-overtake" && app.mode === "splash-overtake") {
    const t = app.stage2?.tutorial;
    if (t?.active) {
      const stepId = TUTORIAL_STEPS[t.stepIndex]?.id;
      if (stepId !== "tryOvertakeQteStart" && stepId !== "recapPress") return;
    }
    app.mode = "rhythm-formal";
    resetRhythmState();
    tutorialNotify("overtakeStart");
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
  if (m === "start-ready" || m === "rules" || m.includes("intro") || m === "stage2-reward") {
    drawModalBackdrop(time);
  }

  if (m === "start-ready")              { drawStartModal(); drawExpressionDock(time); return; }
  if (m === "rules")                    { drawRulesModal(time); drawExpressionDock(time); return; }
  if (m === "stage-2-intro")            { drawStage2IntroModal(time); drawExpressionDock(time); return; }
  if (m === "stage2-corner-pick-lane")  { drawStage2CornerLanePick(time); drawExpressionDock(time); return; }

  // HUD 常駐
  drawHud(time);
  drawCarPartsHud(time);
  // 主關卡常駐：右上角下一賽段預告 + 賽況面板
  if (m === "playing" || m === "prompt-overtake-or-pass" || m === "stage2-overtake-result"
      || m === "stage2-no-overtake" || m === "stage2-defense-result" || m === "stage2-reward"
      || m === "bend-qte" || m === "bend-qte-result" || m.startsWith("splash") || isRhythmMode() || m === "defense") {
    drawSpeedLimitAR(time);
    drawStage2SidePanel(time);
    drawStage2NextCircuit(time);
  }

  if (m === "playing" || m === "prompt-overtake-or-pass") {
    drawLanes(time);
    // 飛字播放期間（閘門等待中）隱藏手牌，讓玩家專注看結算
    // 教學特例：dropToStabilityOnly 步、要顯示手牌讓玩家拖到穩定區
    const t = app.stage2?.tutorial;
    const tStep = t?.active ? TUTORIAL_STEPS[t.stepIndex] : null;
    const dropToStab = !!tStep?.dropToStabilityOnly;
    if (!app.inputLocked && (!tutorialBlocksGameplay() || tutorialShowsHandReadonly() || dropToStab)) drawHand(time);
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
  if (m === "stage2-finish-line") drawStage2FinishLineModal();
  // 主關卡專屬結算
  if (m === "stage2-overtake-result") drawStage2OvertakeResultModal();
  if (m === "stage2-no-overtake")     drawStage2NoOvertakeModal();
  if (m === "stage2-defense-result")  drawStage2DefenseResultModal();
  if (m === "stage2-reward")          drawStage2RewardModal(time);

  // 拖曳中的牌
  if (app.drag) {
    drawCard(app.drag.card, app.drag.x, app.drag.y, app.drag.w, app.drag.h, true);
    // 換道時(拖到非當前道):在卡片上覆蓋「棄牌 / 卡牌效果不觸發」提示
    if (isStage2() && app.mode === "playing") {
      const _dCx = app.drag.x + app.drag.w/2;
      const _dCy = app.drag.y + app.drag.h/2;
      const _isTeam = app.drag.card?.cardClass === "team";
      const _handTop = app.h - 190 - 60;
      const _handBottom = app.h - 190 + 164 + 30;
      const _onCancel = _dCy >= _handTop && _dCy <= _handBottom;
      const _stabZ = app.zones?.stabilityZone;
      const _onStab = !_isTeam && _stabZ && inRect({ x: _dCx, y: _dCy }, _stabZ);
      if (!_isTeam && !_onCancel && !_onStab) {
        const _hL = laneAtPoint({ x: _dCx, y: _dCy });
        if (_hL >= 0 && _hL !== app.playerLane) {
          const ctx2 = app.ctx;
          const _pulse = 0.78 + Math.sin(time * 0.005) * 0.22;
          ctx2.save();
          // 暗色遮罩蓋滿牌面、保留圓角
          ctx2.fillStyle = "rgba(6,14,28,0.86)";
          ctx2.beginPath();
          ctx2.roundRect(app.drag.x, app.drag.y, app.drag.w, app.drag.h, 10);
          ctx2.fill();
          // 黃色強調邊框
          ctx2.strokeStyle = `rgba(255,210,90,${0.85 * _pulse})`;
          ctx2.lineWidth = 2;
          ctx2.stroke();
          // 文字
          ctx2.globalAlpha = _pulse;
          ctx2.textAlign = "center";
          ctx2.textBaseline = "middle";
          // 上行:棄牌(亮黃、強調)
          ctx2.shadowColor = "rgba(255, 180, 60, 0.7)";
          ctx2.shadowBlur = 14;
          ctx2.fillStyle = "rgba(255, 210, 90, 0.98)";
          ctx2.font = `900 38px system-ui, "Microsoft JhengHei", sans-serif`;
          ctx2.fillText("棄牌", _dCx, _dCy - 22);
          // 下行:卡牌效果不觸發
          ctx2.shadowColor = "rgba(255, 220, 180, 0.5)";
          ctx2.shadowBlur = 8;
          ctx2.fillStyle = "rgba(240, 240, 240, 0.95)";
          ctx2.font = `800 16px system-ui, "Microsoft JhengHei", sans-serif`;
          ctx2.fillText("卡牌效果不觸發", _dCx, _dCy + 22);
          ctx2.restore();
        }
      }
    }
    // 拖到非當前道：在牌正上方顯示「換道（棄此牌）」
    if (isStage2() && app.mode === "playing") {
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
            && !(app.stage2?.revealedC8Lanes?.has(li));
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
  if (isStage2()) drawStage2TeamCardTooltip(time);

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

  drawTutorialOverlay(time);
  drawExpressionDock(time);
  // Boss 績效考核 modal：放在最末確保不被其他 UI 覆蓋（包含 tutorial overlay）
  drawPerfReviewModal(time);
  // 企業壓制啟動橫幅（Phase 4）：放在最最末、覆蓋 modal
  drawSuppressionBanner(time);
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

// ═══════ 賽博龐克天際線 v5 ═══════════════════════════════════════════════
// 5 層深度 + 13 棟個性近景樓 + 3 招牌 + 3 多燈天線 + 4 霓虹邊條
// + 飛行載具(Spinner 風格) + 2 道掃射探照燈 + 地平線霾光

function cycleText(time, texts, periodMs) {
  if (!texts || !texts.length) return '';
  return texts[Math.floor((time / periodMs) % texts.length)];
}

function drawHorizonHaze(ctx, w, horizon) {
  const yS = horizon / 200;
  const yTop = 138 * yS;
  const grad = ctx.createLinearGradient(0, yTop, 0, horizon);
  grad.addColorStop(0,    "rgba(255,48,144,0)");
  grad.addColorStop(0.55, "rgba(255,58,152,0.45)");
  grad.addColorStop(1,    "rgba(255,112,184,0.62)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, yTop, w, horizon - yTop);
}

function drawAvLight(ctx, cx, cy, r, time, freqMs, phaseMs) {
  const t = ((time + phaseMs) % freqMs) / freqMs;
  const wave = 0.5 - 0.5*Math.cos(t * Math.PI * 2);
  const alpha = 0.3 + 0.7*wave;
  ctx.fillStyle = "rgba(255,48,48,0.22)";
  ctx.beginPath(); ctx.arc(cx, cy, r*2.2, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = `rgba(255,80,80,${alpha})`;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
}

function drawCityFarLayer(ctx, w, horizon, layerIdx, time) {
  const xS = w / 680, yS = horizon / 200;
  const cfgs = [
    { count: 33, opacity: 0.55, yTopMin: 180, yTopMax: 195, wMin: 10, wMax: 22,
      gradTop: "#5a2058", gradBot: "#48184a", polyChance: 0.12, windowsChance: 0 },
    { count: 21, opacity: 0.7,  yTopMin: 162, yTopMax: 178, wMin: 18, wMax: 30,
      gradTop: "#3e1850", gradBot: "#2e1245", polyChance: 0.25, windowsChance: 0 },
    { count: 17, opacity: 0.82, yTopMin: 130, yTopMax: 168, wMin: 28, wMax: 46,
      gradTop: "#2a1240", gradBot: "#180828", polyChance: 0.30, windowsChance: 0.55 },
  ];
  const cfg = cfgs[layerIdx];
  const grad = ctx.createLinearGradient(0, cfg.yTopMin*yS, 0, horizon);
  grad.addColorStop(0, cfg.gradTop);
  grad.addColorStop(1, cfg.gradBot);

  ctx.save();
  ctx.globalAlpha = cfg.opacity;
  ctx.fillStyle = grad;

  for (let i = 0; i < cfg.count; i++) {
    const s = i*2.17 + layerIdx*19.1;
    const sa = skylineHash01(s),
          sb = skylineHash01(s*1.9+1),
          sc = skylineHash01(s*3.3+2),
          sd = skylineHash01(s*4.7+3);
    const bw = (cfg.wMin + sa*(cfg.wMax-cfg.wMin)) * xS;
    const bx = ((i/cfg.count)*680 + (sc-0.5)*8) * xS;
    const ty = (cfg.yTopMin + sb*(cfg.yTopMax-cfg.yTopMin)) * yS;

    if (sd < cfg.polyChance) {
      const tilt = (skylineHash01(s*5)-0.5) * 6 * yS;
      ctx.beginPath();
      ctx.moveTo(bx, horizon);
      ctx.lineTo(bx+bw, horizon);
      ctx.lineTo(bx+bw, ty + tilt);
      ctx.lineTo(bx, ty - tilt);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(bx, ty, bw, horizon - ty);
    }
  }

  if (cfg.windowsChance > 0) {
    ctx.globalAlpha = cfg.opacity * 0.55;
    const wColors = ["#ffb84d", "#00e8ff", "#ff2da3", "#a64dff"];
    for (let i = 0; i < cfg.count; i++) {
      const s = i*2.17 + layerIdx*19.1 + 50;
      if (skylineHash01(s*7) > cfg.windowsChance) continue;
      const bw = (cfg.wMin + skylineHash01(s)*(cfg.wMax-cfg.wMin)) * xS;
      const bx = ((i/cfg.count)*680) * xS;
      const ty = (cfg.yTopMin + skylineHash01(s*1.9+1)*(cfg.yTopMax-cfg.yTopMin)) * yS;
      const wx = bx + bw * (0.25 + skylineHash01(s*17)*0.5);
      const wy = ty + (horizon - ty) * (0.2 + skylineHash01(s*19)*0.6);
      ctx.fillStyle = wColors[Math.floor(skylineHash01(s*13)*4)];
      if (skylineHash01(s*23) > 0.5) ctx.fillRect(wx, wy, 1.2*xS, 8*yS);
      else                            ctx.fillRect(wx, wy, 2*xS, 3*yS);
    }
  }
  ctx.restore();
}

function drawCityMidLayer(ctx, w, horizon, time) {
  const xS = w/680, yS = horizon/200;
  const X = mx => mx*xS, Y = my => my*yS;

  const grad = ctx.createLinearGradient(0, Y(95), 0, horizon);
  grad.addColorStop(0, "#231038");
  grad.addColorStop(1, "#150828");

  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = grad;

  const polys = [
    [[3,200],[45,200],[45,118],[40,112],[3,112]],
    [[52,200],[84,200],[84,130],[52,130]],
    [[88,200],[134,200],[134,108],[128,102],[96,102],[88,108]],
    [[140,200],[168,200],[168,125],[140,125]],
    [[200,200],[248,200],[248,105],[222,100],[200,105]],
    [[254,200],[290,200],[290,118],[254,118]],
    [[266,118],[290,118],[278,108]],
    [[368,200],[405,200],[405,116],[400,110],[368,110]],
    [[411,200],[441,200],[441,135],[411,135]],
    [[448,200],[482,200],[482,118],[448,118]],
    [[455,118],[463,118],[463,108],[455,108]],
    [[488,200],[538,200],[538,112],[530,104],[496,104],[488,112]],
    [[568,200],[600,200],[600,124],[568,124]],
    [[606,200],[650,200],[650,108],[645,102],[611,102],[606,108]],
    [[656,200],[678,200],[678,125],[656,125]],
  ];
  for (const p of polys) {
    ctx.beginPath();
    ctx.moveTo(X(p[0][0]), Y(p[0][1]));
    for (let i = 1; i < p.length; i++) ctx.lineTo(X(p[i][0]), Y(p[i][1]));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  const midWin = [
    [20,125,'s','#00e8ff'],[30,140,'s','#ff2da3'],[62,138,'s','#ffb84d'],
    [74,155,'w','#00e8ff'],[100,115,'s','#ff2da3'],[115,130,'s','#00e8ff'],
    [148,135,'s','#ffb84d'],[158,150,'s','#a64dff'],[210,115,'s','#ff2da3'],
    [225,130,'w','#00e8ff'],[265,125,'s','#ffb84d'],[278,145,'s','#00e8ff'],
    [380,120,'s','#a64dff'],[395,135,'s','#ff2da3'],[420,145,'s','#00e8ff'],
    [458,128,'s','#ffb84d'],[470,145,'s','#ff2da3'],[498,120,'s','#00e8ff'],
    [515,135,'w','#a64dff'],[575,135,'s','#ff2da3'],[590,150,'s','#00e8ff'],
    [615,118,'s','#ffb84d'],[635,135,'s','#ff2da3'],[660,140,'s','#00e8ff'],
  ];
  ctx.save();
  ctx.globalAlpha = 0.6;
  for (const [wx, wy, k, c] of midWin) {
    ctx.fillStyle = c;
    if (k === 'w') ctx.fillRect(X(wx), Y(wy), X(20), Y(1.2));
    else           ctx.fillRect(X(wx), Y(wy), X(2),  Y(3));
  }
  ctx.restore();
}

function drawCityNearLayer(ctx, w, horizon, time) {
  const xS = w/680, yS = horizon/200;
  const X = mx => mx*xS, Y = my => my*yS;

  const grad = ctx.createLinearGradient(0, Y(40), 0, horizon);
  grad.addColorStop(0, "#1f0c30");
  grad.addColorStop(1, "#0a0418");
  ctx.fillStyle = grad;

  // ─── 13 棟近景樓 ─────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(X(20), Y(200)); ctx.lineTo(X(62), Y(200)); ctx.lineTo(X(62), Y(95));
  ctx.lineTo(X(55), Y(85)); ctx.lineTo(X(20), Y(85)); ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(X(70), Y(200)); ctx.lineTo(X(100), Y(200)); ctx.lineTo(X(100), Y(138));
  ctx.lineTo(X(96), Y(130)); ctx.lineTo(X(74), Y(130)); ctx.lineTo(X(70), Y(138));
  ctx.closePath(); ctx.fill();
  ctx.fillRect(X(110), Y(82), X(55), Y(118));
  ctx.fillRect(X(120), Y(58), X(35), Y(24));
  ctx.fillRect(X(131), Y(42), X(13), Y(16));
  ctx.fillRect(X(172), Y(125), X(35), Y(75));
  ctx.beginPath();
  ctx.moveTo(X(172), Y(125)); ctx.lineTo(X(207), Y(125)); ctx.lineTo(X(189.5), Y(105));
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(X(215), Y(200)); ctx.lineTo(X(260), Y(200)); ctx.lineTo(X(260), Y(80));
  ctx.lineTo(X(240), Y(80));  ctx.lineTo(X(240), Y(68));  ctx.lineTo(X(215), Y(68));
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(X(268), Y(200)); ctx.lineTo(X(298), Y(200)); ctx.lineTo(X(298), Y(130));
  ctx.lineTo(X(268), Y(140)); ctx.closePath(); ctx.fill();
  ctx.fillRect(X(305), Y(70), X(58), Y(130));
  ctx.beginPath();
  ctx.moveTo(X(305), Y(70)); ctx.lineTo(X(363), Y(70)); ctx.lineTo(X(348), Y(52)); ctx.lineTo(X(320), Y(52));
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(X(372), Y(200)); ctx.lineTo(X(404), Y(200)); ctx.lineTo(X(404), Y(128));
  ctx.lineTo(X(388), Y(118)); ctx.lineTo(X(372), Y(128)); ctx.closePath(); ctx.fill();
  ctx.fillRect(X(412), Y(110), X(48), Y(90));
  ctx.fillRect(X(420), Y(82),  X(22), Y(28));
  ctx.fillRect(X(468), Y(125), X(35), Y(75));
  ctx.beginPath();
  ctx.moveTo(X(468), Y(125));
  ctx.quadraticCurveTo(X(485.5), Y(108), X(503), Y(125));
  ctx.closePath(); ctx.fill();
  ctx.fillRect(X(512), Y(80), X(52), Y(120));
  ctx.fillRect(X(520), Y(62), X(36), Y(18));
  ctx.beginPath();
  ctx.moveTo(X(520), Y(62));
  ctx.quadraticCurveTo(X(538), Y(53), X(556), Y(62));
  ctx.closePath(); ctx.fill();
  ctx.fillRect(X(572), Y(128), X(30), Y(72));
  ctx.beginPath();
  ctx.moveTo(X(572), Y(128)); ctx.lineTo(X(602), Y(128)); ctx.lineTo(X(602), Y(118));
  ctx.lineTo(X(588), Y(114)); ctx.lineTo(X(572), Y(120)); ctx.closePath(); ctx.fill();
  ctx.fillRect(X(610), Y(100), X(45), Y(100));
  ctx.beginPath();
  ctx.moveTo(X(610), Y(100)); ctx.lineTo(X(655), Y(100)); ctx.lineTo(X(650), Y(92)); ctx.lineTo(X(615), Y(92));
  ctx.closePath(); ctx.fill();
  ctx.fillRect(X(628), Y(74), X(6), Y(18));

  // ─── 4 條垂直霓虹邊條 ─────────────────────────────
  const neonStrips = [
    [59,92,'255,45,163', 108],
    [214,70,'0,232,255', 130],
    [457,110,'255,45,163',90],
    [609,100,'0,232,255',100],
  ];
  for (const [sx, sy, rgb, sh] of neonStrips) {
    ctx.fillStyle = `rgba(${rgb},0.25)`;
    ctx.fillRect(X(sx-1), Y(sy), X(4), Y(sh));
    ctx.fillStyle = `rgba(${rgb},0.9)`;
    ctx.fillRect(X(sx), Y(sy), X(2), Y(sh));
  }

  // ─── 窗光 ────────────────────────────────────────
  const NEAR_WINDOWS = [
    [26,105,3,4,'#00e8ff'],[36,105,3,4,'#ff2da3'],[46,115,3,4,'#ffb84d'],
    [26,125,1.5,10,'#a64dff'],[36,138,3,4,'#00e8ff'],[46,152,3,4,'#ff2da3'],
    [26,170,18,2,'#ffb84d'],[46,178,3,4,'#00e8ff'],[36,190,3,3,'#ff2da3'],
    [76,146,3,4,'#ff2da3'],[74,160,22,1.5,'#00e8ff'],[88,174,3,4,'#ffb84d'],[76,186,3,3,'#00e8ff'],
    [135,48,6,3,'#ffb84d'],
    [124,64,28,1.5,'#ff2da3'],
    [124,72,8,4,'#00e8ff'],[136,72,5,4,'#a64dff'],[145,72,8,4,'#ffb84d'],
    [116,92,3,4,'#ff2da3'],[127,92,3,4,'#00e8ff'],[139,92,3,4,'#ffb84d'],[151,92,3,4,'#a64dff'],
    [116,106,3,4,'#ffb84d'],[139,106,3,4,'#00e8ff'],[151,106,3,4,'#ff2da3'],
    [116,120,3,4,'#ff2da3'],[127,120,3,4,'#00e8ff'],[151,120,3,4,'#ffb84d'],
    [120,134,33,1.5,'#00e8ff'],
    [116,144,3,4,'#a64dff'],[127,144,3,4,'#ff2da3'],[139,144,3,4,'#00e8ff'],[151,144,3,4,'#ff2da3'],
    [116,158,3,4,'#00e8ff'],[139,158,3,4,'#ffb84d'],[151,158,3,4,'#a64dff'],
    [116,172,3,4,'#ff2da3'],[139,172,3,4,'#00e8ff'],
    [116,186,3,4,'#ffb84d'],[139,186,3,4,'#a64dff'],[151,186,3,4,'#ff2da3'],
    [186,118,2,3,'#ffb84d'],
    [178,135,1.5,12,'#00e8ff'],[186,135,1.5,12,'#ff2da3'],[194,135,1.5,12,'#ffb84d'],[202,135,1.5,12,'#00e8ff'],
    [178,158,1.5,14,'#a64dff'],[194,158,1.5,14,'#ff2da3'],
    [178,180,3,4,'#ffb84d'],[200,182,3,4,'#00e8ff'],[186,190,3,3,'#ff2da3'],
    [222,73,14,1.5,'#00e8ff'],
    [220,86,38,2,'#ffb84d'],[220,98,38,1.5,'#00e8ff'],[220,112,38,2,'#ff2da3'],
    [220,124,38,1.5,'#a64dff'],[220,138,38,2,'#00e8ff'],[220,152,38,1.5,'#ffb84d'],
    [220,166,38,2,'#ff2da3'],[220,182,38,1.5,'#00e8ff'],
    [274,148,3,4,'#ffb84d'],[286,148,3,4,'#00e8ff'],
    [272,162,22,1.5,'#ff2da3'],[280,175,3,4,'#00e8ff'],[288,188,3,3,'#ffb84d'],
    [318,60,28,1.5,'#ffb84d'],[320,82,40,2,'#ff2da3'],
    [316,92,8,5,'#ff2da3'],[330,92,14,5,'#00e8ff'],[350,92,8,5,'#a64dff'],
    [312,118,3,4,'#ffb84d'],[324,118,3,4,'#ff2da3'],[336,118,3,4,'#00e8ff'],[348,118,3,4,'#a64dff'],
    [312,132,3,4,'#00e8ff'],[336,132,3,4,'#ff2da3'],[348,132,3,4,'#ffb84d'],
    [312,146,44,1.5,'#ff2da3'],
    [312,158,3,4,'#a64dff'],[324,158,3,4,'#00e8ff'],[336,158,3,4,'#ffb84d'],[348,158,3,4,'#ff2da3'],
    [312,172,3,4,'#00e8ff'],[336,172,3,4,'#a64dff'],
    [312,186,3,4,'#ffb84d'],[324,186,3,4,'#00e8ff'],[348,186,3,4,'#ff2da3'],
    [386,123,3,3,'#ffb84d'],
    [378,138,1.5,10,'#ff2da3'],[388,138,3,4,'#00e8ff'],[398,138,3,4,'#ffb84d'],
    [376,158,24,1.5,'#a64dff'],[386,172,3,4,'#ff2da3'],[378,184,3,3,'#00e8ff'],
    [424,92,1.5,14,'#00e8ff'],[432,92,1.5,14,'#ff2da3'],[438,92,1.5,14,'#ffb84d'],
    [418,120,1.5,14,'#ff2da3'],[438,120,1.5,14,'#00e8ff'],[448,120,1.5,14,'#a64dff'],
    [418,144,1.5,14,'#ffb84d'],[428,144,1.5,14,'#00e8ff'],[448,144,1.5,14,'#ff2da3'],
    [416,168,40,1.5,'#a64dff'],
    [428,180,3,4,'#00e8ff'],[448,186,3,3,'#ff2da3'],
    [481,117,9,5,'#ffb84d'],
    [474,130,6,4,'#ff2da3'],[488,130,3,4,'#a64dff'],[498,130,3,4,'#00e8ff'],
    [474,146,3,4,'#00e8ff'],[490,146,3,4,'#ff2da3'],
    [472,160,28,1.5,'#ffb84d'],[486,172,3,4,'#ff2da3'],[476,186,3,4,'#00e8ff'],
    [528,58,20,1.5,'#ffb84d'],
    [524,68,12,6,'#ff2da3'],[540,68,12,6,'#00e8ff'],
    [518,92,42,1.5,'#a64dff'],
    [520,132,3,4,'#00e8ff'],[534,132,3,4,'#ff2da3'],[546,132,3,4,'#ffb84d'],[558,132,3,4,'#a64dff'],
    [520,146,3,4,'#ffb84d'],[546,146,3,4,'#00e8ff'],[558,146,3,4,'#ff2da3'],
    [518,160,44,1.5,'#00e8ff'],
    [520,172,3,4,'#ff2da3'],[534,172,3,4,'#a64dff'],[546,172,3,4,'#00e8ff'],
    [520,186,3,4,'#00e8ff'],[546,186,3,4,'#ff2da3'],[558,186,3,3,'#ffb84d'],
    [578,138,1.5,10,'#ffb84d'],[588,138,3,4,'#00e8ff'],
    [578,158,3,4,'#ff2da3'],[588,172,3,4,'#00e8ff'],[578,186,3,3,'#ffb84d'],
    [630,78,2,3,'#ff2da3'],
    [618,106,1.5,12,'#ff2da3'],[628,106,1.5,12,'#00e8ff'],[638,106,1.5,12,'#ffb84d'],[648,106,1.5,12,'#a64dff'],
    [618,128,1.5,12,'#00e8ff'],[638,128,1.5,12,'#ff2da3'],
    [616,148,36,1.5,'#ffb84d'],[628,158,3,4,'#00e8ff'],
    [618,172,3,4,'#a64dff'],[648,172,3,4,'#ff2da3'],[628,186,3,3,'#00e8ff'],
  ];
  for (const [wx, wy, ww, wh, c] of NEAR_WINDOWS) {
    ctx.fillStyle = c;
    ctx.fillRect(X(wx), Y(wy), X(ww), Y(wh));
  }

  // ─── 3 招牌 ─────────────────────────────────────
  ctx.fillStyle = "#15081f";
  ctx.fillRect(X(156), Y(82), X(3), Y(58));
  ctx.fillStyle = "rgba(0,232,255,0.82)";
  ctx.fillRect(X(159), Y(78), X(22), Y(62));
  ctx.strokeStyle = "rgba(128,244,255,0.85)";
  ctx.lineWidth = Math.max(1, 0.5*yS);
  ctx.strokeRect(X(159), Y(78), X(22), Y(62));
  ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = Math.max(0.5, 0.5*yS);
  ctx.beginPath();
  ctx.moveTo(X(159),Y(92));  ctx.lineTo(X(181),Y(92));
  ctx.moveTo(X(159),Y(110)); ctx.lineTo(X(181),Y(110));
  ctx.moveTo(X(159),Y(128)); ctx.lineTo(X(181),Y(128));
  ctx.stroke();
  const verTexts = ["新宿","渋谷","秋葉","池袋"];
  const verCurrent = cycleText(time, verTexts, 9000);
  ctx.font = `700 ${Math.round(14*yS)}px sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = "#0a0418";
  ctx.fillText(verCurrent[0], X(170), Y(98));
  ctx.fillText(verCurrent[1], X(170), Y(120));

  ctx.fillStyle = "#15081f";
  ctx.fillRect(X(361), Y(62), X(4), Y(14));
  ctx.fillStyle = "#3a1f48";
  ctx.fillRect(X(363), Y(66), X(15), Y(2));
  ctx.fillStyle = "#15081f";
  ctx.fillRect(X(376), Y(63), X(3), Y(10));
  ctx.fillStyle = "rgba(255,45,163,0.82)";
  ctx.fillRect(X(378), Y(56), X(46), Y(24));
  ctx.strokeStyle = "rgba(255,112,192,0.85)"; ctx.lineWidth = Math.max(1, 0.5*yS);
  ctx.strokeRect(X(378), Y(56), X(46), Y(24));
  ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = Math.max(0.5, 0.6*yS);
  ctx.beginPath();
  ctx.moveTo(X(378),Y(64)); ctx.lineTo(X(424),Y(64));
  ctx.moveTo(X(378),Y(73)); ctx.lineTo(X(424),Y(73));
  ctx.stroke();
  const proTexts = ["霓虹","電脳","不夜","機甲"];
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${Math.round(14*yS)}px sans-serif`;
  ctx.fillText(cycleText(time, proTexts, 9000), X(401), Y(69));

  ctx.fillStyle = "rgba(255,184,77,0.85)";
  ctx.fillRect(X(518), Y(100), X(40), Y(22));
  ctx.strokeStyle = "rgba(255,214,128,0.85)"; ctx.lineWidth = Math.max(1, 0.5*yS);
  ctx.strokeRect(X(518), Y(100), X(40), Y(22));
  ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = Math.max(0.5, 0.6*yS);
  ctx.beginPath();
  ctx.moveTo(X(518),Y(107)); ctx.lineTo(X(558),Y(107));
  ctx.moveTo(X(518),Y(115)); ctx.lineTo(X(558),Y(115));
  ctx.stroke();
  const horTexts = ["神龍","夜城","賽博","光速"];
  ctx.fillStyle = "#3a1500";
  ctx.font = `700 ${Math.round(14*yS)}px sans-serif`;
  ctx.fillText(cycleText(time, horTexts, 9000), X(538), Y(111));

  // ─── 3 天線塔 + 多燈 ─────────────────────────────
  ctx.strokeStyle = "#3a1f48"; ctx.lineWidth = Math.max(1, 0.8*yS);
  ctx.beginPath(); ctx.moveTo(X(137), Y(42)); ctx.lineTo(X(137), Y(12)); ctx.stroke();
  drawAvLight(ctx, X(137), Y(12), 1.5*yS, time, 1400, 0);
  drawAvLight(ctx, X(137), Y(22), 1.3*yS, time, 1700, 400);
  drawAvLight(ctx, X(137), Y(32), 1.3*yS, time, 2000, 900);
  ctx.beginPath(); ctx.moveTo(X(334), Y(52)); ctx.lineTo(X(334), Y(22)); ctx.stroke();
  ctx.lineWidth = Math.max(0.7, 0.6*yS);
  ctx.beginPath(); ctx.moveTo(X(326), Y(34)); ctx.lineTo(X(342), Y(34)); ctx.stroke();
  drawAvLight(ctx, X(334), Y(22), 1.5*yS, time, 1500, 0);
  drawAvLight(ctx, X(326), Y(34), 1.2*yS, time, 1800, 300);
  drawAvLight(ctx, X(342), Y(34), 1.2*yS, time, 2100, 600);
  ctx.lineWidth = Math.max(1, 0.8*yS);
  ctx.beginPath(); ctx.moveTo(X(538), Y(57)); ctx.lineTo(X(538), Y(24)); ctx.stroke();
  ctx.lineWidth = Math.max(0.7, 0.6*yS);
  ctx.beginPath(); ctx.moveTo(X(532), Y(38)); ctx.lineTo(X(544), Y(38)); ctx.stroke();
  drawAvLight(ctx, X(538), Y(24), 1.5*yS, time, 1600, 0);
  drawAvLight(ctx, X(532), Y(38), 1.2*yS, time, 2000, 500);
  drawAvLight(ctx, X(544), Y(38), 1.2*yS, time, 1900, 1000);
}

function drawCitySkyline(ctx, w, h, horizon, time) {
  drawCityFarLayer(ctx, w, horizon, 0, time);
  drawCityFarLayer(ctx, w, horizon, 1, time);
  drawCityFarLayer(ctx, w, horizon, 2, time);
  drawCityMidLayer(ctx, w, horizon, time);
  drawCityNearLayer(ctx, w, horizon, time);
}

function drawFlyingVehicle(ctx, w, horizon, time) {
  const yS = horizon / 200;
  const period = 14000;
  const restRatio = 0.22;
  const travel = 1 - restRatio;
  const t = (time % period) / period;
  if (t > travel) return;
  const progress = t / travel;

  const S = yS * 2.5;
  const x = -30*S + (w + 60*S) * progress;
  const y = (82 - 7*progress) * yS;

  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "#0a0418";
  ctx.strokeStyle = "#3a1f48"; ctx.lineWidth = Math.max(0.5, 0.4*S);
  ctx.beginPath();
  ctx.moveTo(-10*S, 1*S); ctx.lineTo(7*S, 1*S);
  ctx.lineTo(10*S, 2.5*S); ctx.lineTo(7*S, 4*S);
  ctx.lineTo(-10*S, 4*S); ctx.lineTo(-11*S, 2.5*S);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "rgba(0,232,255,0.95)";
  ctx.fillRect(-8*S, 1.7*S, 14*S, 1.6*S);
  ctx.fillStyle = "rgba(255,184,77,0.32)";
  ctx.beginPath(); ctx.arc(-10*S, 2.5*S, 2.8*S, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = "#ffb84d";
  ctx.beginPath(); ctx.arc(-10*S, 2.5*S, 1.4*S, 0, Math.PI*2); ctx.fill();
  const strobe = 0.6 + 0.4*Math.abs(Math.sin(time * 0.012));
  ctx.fillStyle = `rgba(255,255,255,${strobe})`;
  ctx.beginPath(); ctx.arc(9*S, 2.5*S, 0.6*S, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = "rgba(10,4,24,0.85)";
  ctx.beginPath();
  ctx.moveTo(-4*S, 4*S); ctx.lineTo(-4*S, 5.5*S); ctx.lineTo(-1*S, 4*S);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(1*S, 4*S); ctx.lineTo(1*S, 5.5*S); ctx.lineTo(4*S, 4*S);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(255,184,77,0.55)";
  ctx.lineWidth = Math.max(0.7, 0.7*S); ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-17*S, 2.5*S); ctx.lineTo(-12*S, 2.5*S); ctx.stroke();
  ctx.restore();
}

function drawSearchlights(ctx, w, horizon, time) {
  const xS = w/680, yS = horizon/200;
  const beam = (sx, sy, lengthMul, baseW, rgbCore, rgbOuter, ang1, ang2, period) => {
    const t = (time % period) / period;
    const angDeg = ang1 + (ang2 - ang1) * (0.5 - 0.5*Math.cos(t * Math.PI * 2));
    const angRad = angDeg * Math.PI / 180;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(angRad);
    const farEnd = -sy * lengthMul;  // 光束向天空(往上)延伸

    // 外暈光錐(寬而淡):單一三角形 + 沿軸線的線性漸層
    const gradOuter = ctx.createLinearGradient(0, 0, 0, farEnd);
    gradOuter.addColorStop(0,    `rgba(${rgbOuter},0.28)`);
    gradOuter.addColorStop(0.15, `rgba(${rgbOuter},0.18)`);
    gradOuter.addColorStop(0.40, `rgba(${rgbOuter},0.08)`);
    gradOuter.addColorStop(0.75, `rgba(${rgbOuter},0.02)`);
    gradOuter.addColorStop(1,    `rgba(${rgbOuter},0)`);
    ctx.fillStyle = gradOuter;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(baseW/2, farEnd);
    ctx.lineTo(-baseW/2, farEnd);
    ctx.closePath();
    ctx.fill();

    // 核心光柱(窄而亮):同樣是單一三角形 + 平滑漸層,前段衰減快、後段慢
    const coreW = baseW * 0.45;
    const gradCore = ctx.createLinearGradient(0, 0, 0, farEnd);
    gradCore.addColorStop(0,    `rgba(${rgbCore},0.65)`);
    gradCore.addColorStop(0.12, `rgba(${rgbCore},0.42)`);
    gradCore.addColorStop(0.30, `rgba(${rgbCore},0.22)`);
    gradCore.addColorStop(0.55, `rgba(${rgbCore},0.09)`);
    gradCore.addColorStop(0.82, `rgba(${rgbCore},0.025)`);
    gradCore.addColorStop(1,    `rgba(${rgbCore},0)`);
    ctx.fillStyle = gradCore;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(coreW/2, farEnd);
    ctx.lineTo(-coreW/2, farEnd);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // 燈具錨點 — 多層光暈製造鏡頭眩光感
    ctx.fillStyle = `rgba(${rgbCore},0.22)`;
    ctx.beginPath(); ctx.arc(sx, sy, 7*xS, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = `rgba(${rgbCore},0.65)`;
    ctx.beginPath(); ctx.arc(sx, sy, 3.5*xS, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(sx, sy, 1.5*xS, 0, Math.PI*2); ctx.fill();
  };

  beam(227*xS, 68*yS, 1.05, 100*xS, "255,210,236", "255,144,216", -26, 30, 7000);
  beam(431*xS, 82*yS, 1.05, 110*xS, "208,244,255", "144,232,255",  28, -30, 9000);
}

// ─── 雨 ──────────────────────────────────────────────────────────────
// 每滴雨的長度、粗細、亮度、相位都用 skylineHash01 隨機,避免「一個樣」
function drawRainLayer(ctx, w, h, horizon, time, cfg) {
  const yS = horizon / 200;
  const angRad = 12 * Math.PI / 180;  // 12° 風偏角
  const sinA = Math.sin(angRad), cosA = Math.cos(angRad);

  ctx.lineCap = "round";
  for (let i = 0; i < cfg.count; i++) {
    const s = i * 1.61 + cfg.seedOffset;
    const sxNorm  = skylineHash01(s*1.1);
    const sphase  = skylineHash01(s*1.7+1);
    const slen    = skylineHash01(s*2.3+2);
    const swid    = skylineHash01(s*2.9+3);
    const salpha  = skylineHash01(s*3.7+4);
    const sspeed  = skylineHash01(s*4.3+5);  // 速度微擾,讓雨絲不會列隊整齊

    const dropLen   = (cfg.lenMin + slen*(cfg.lenMax-cfg.lenMin)) * yS;
    const dropWid   = Math.max(0.4, (cfg.widthMin + swid*(cfg.widthMax-cfg.widthMin)) * yS);
    const dropAlpha = cfg.alphaMin + salpha*(cfg.alphaMax-cfg.alphaMin);
    const speedMul  = 0.85 + sspeed*0.3;  // 每滴 0.85x–1.15x 基準速度

    const period = cfg.periodMs / speedMul;
    const cycle = ((time / period) + sphase) % 1;
    const yTop = -dropLen + cycle * (h + dropLen*2);
    // 水平位置橫跨整個畫面寬度,加 20% 緩衝避免邊緣空白
    const xTop = (sxNorm * 1.4 - 0.2) * w;

    ctx.strokeStyle = `rgba(210,232,250,${dropAlpha})`;
    ctx.lineWidth = dropWid;
    ctx.beginPath();
    ctx.moveTo(xTop, yTop);
    ctx.lineTo(xTop + dropLen*sinA, yTop + dropLen*cosA);
    ctx.stroke();
  }
}

function drawRainFar(ctx, w, h, horizon, time) {
  // 遠雨:多、短、細、極淡 → 像霧氣裡的水珠
  drawRainLayer(ctx, w, h, horizon, time, {
    count: 95, periodMs: 5000, seedOffset: 0,
    lenMin: 8,  lenMax: 14, widthMin: 0.4, widthMax: 0.7,
    alphaMin: 0.18, alphaMax: 0.35,
  });
}
function drawRainMid(ctx, w, h, horizon, time) {
  // 中雨:主要雨絲,長度/粗細/亮度都個別變化
  drawRainLayer(ctx, w, h, horizon, time, {
    count: 130, periodMs: 1800, seedOffset: 100,
    lenMin: 18, lenMax: 26, widthMin: 0.7, widthMax: 1.1,
    alphaMin: 0.32, alphaMax: 0.55,
  });
}
function drawRainNear(ctx, w, h, horizon, time) {
  // 近雨:少而粗長、很快 → 偶爾飄過畫面前景的大雨滴
  drawRainLayer(ctx, w, h, horizon, time, {
    count: 55, periodMs: 700, seedOffset: 200,
    lenMin: 36, lenMax: 52, widthMin: 1.0, widthMax: 1.6,
    alphaMin: 0.55, alphaMax: 0.88,
  });
}

function drawRace(time) {
  const ctx=app.ctx, w=app.w, h=app.h;
  ctx.clearRect(0,0,w,h);
  {
    // 賽博龐克夜空:深藍紫 → 紫紅 → 洋紅(地平線) → 暗黑(路面)
    const bg=ctx.createLinearGradient(0,0,0,h);
    bg.addColorStop(0,    "#080418");
    bg.addColorStop(0.17, "#1c0a35");
    bg.addColorStop(0.32, "#3c104e");
    bg.addColorStop(0.38, "#5a1858");
    bg.addColorStop(0.4,  "#15081f");
    bg.addColorStop(1,    "#05090d");
    ctx.fillStyle=bg; ctx.fillRect(0,0,w,h);
    const horizon=h*0.38;
    drawHorizonHaze(ctx,w,horizon);
    drawCitySkyline(ctx,w,h,horizon,time);
    // 遠/中雨在城市之前;探照燈以 screen 合成疊上,自然照亮雨絲;近雨在最前
    drawRainFar(ctx,w,h,horizon,time);
    drawRainMid(ctx,w,h,horizon,time);
    drawFlyingVehicle(ctx,w,horizon,time);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    drawSearchlights(ctx,w,horizon,time);
    ctx.restore();
    drawRainNear(ctx,w,h,horizon,time);
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
  //   - startX/Y/W 在 stage2OnOvertakeSuccess 觸發時就用 cache 填好了
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
  if (isStage2() && app.stage2) {
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
  // 超車成功動畫：白車凍結在 QTE 結束當下位置（不要跑回 lane 中心、避免「順移」感）
  if (app.overtakePassAnim && app.overtakePassAnim.playerStartX != null) {
    whiteX = app.overtakePassAnim.playerStartX;
  }
  // 每 frame 記下當下玩家車的真實位置（給超車成功動畫當凍結點用）
  app._lastPlayerRenderX = whiteX;
  app._lastPlayerRenderY = whiteY;
  drawCar(whiteX, whiteY, whiteW, 82, "#dceaff");

  // 企業間諜視覺特效（Boss 監聽中 + 資料光束）
  // 兩台車繪製之後、飛字之前
  if (isStage2()) {
    drawEspionageEffects(time, redX, opponentY, whiteX, whiteY);
  }

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
    // 雙重保險：夾住到有效 lane 範圍（萬一 laneCount 變了沒被清乾淨）
    const chaserMaxLane = Math.max(0, (app.laneCount || 1) - 1);
    if (app.chaserTargetLane > chaserMaxLane) app.chaserTargetLane = chaserMaxLane;
    if (app.chaserTargetLane < 0) app.chaserTargetLane = 0;
    if (app.chaserVisualLane > chaserMaxLane) app.chaserVisualLane = chaserMaxLane;
    if (app.chaserVisualLane < 0) app.chaserVisualLane = 0;
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

  // ── 車體狀態區優先：拖到左下面板（stabilityZone）→ 棄手牌、提升空力
  //    比 cancel zone 優先（兩區 y 範圍會重疊）
  const stabZone = app.zones.stabilityZone;
  const isOverStabZone = app.drag.card?.cardClass !== "team" && stabZone &&
    inRect({ x: dragCx, y: dragCy }, stabZone);
  if (isOverStabZone) {
    // 不畫紅色取消邊框（chassis 面板自身已亮起綠邊）
    // 只在牌上方印綠色「棄手牌至此」提示
    text("棄手牌至此，此回合QTE難度降低",
      dragCx, app.drag.y - 18, 18, `rgba(180, 255, 200, ${pulse})`, "900", "center");
    return;
  }

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
        && !(app.stage2?.revealedC8Lanes?.has(li));
      if (!isC8Hidden) {
        const b = getLaneBonusFor(li);
        if (b?.label) subTips.push(b.label);
      } else {
        subTips.push("? 未揭曉");
      }
      subTips.forEach((tip, idx) => {
        text(tip, tx, ty + 24 + idx * 18, 12,
          `rgba(220, 230, 240, ${pulse * 0.85})`, "700", "center");
      });
    }
  }
}


// ─── HUD ───────────────────────────────────────────────────────────────────
function statusHudRect() {
  // 輪胎搬到左下「車子部件」面板後、本面板高度從 250 縮成 200
  return { x: app.w - 300, y: app.h - 200 - 24, w: 276, h: 200 };
}

function drawHud(time) {
  const s = statusHudRect();
  panel(s.x, s.y, s.w, s.h, "rgba(8,18,32,0.88)", "rgba(105,164,224,0.50)");
  const ctx = app.ctx;
  const hr = y => {
    ctx.save(); ctx.strokeStyle="rgba(105,164,224,0.18)"; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(s.x+16,y); ctx.lineTo(s.x+s.w-16,y); ctx.stroke(); ctx.restore();
  };

  // ── 名次 ── (y 30-54)
  text("名次", s.x+20, s.y+34, 13, "rgba(160,190,230,0.65)", "700");
  text(`${app.rank} / ${app.rankTotal}`, s.x+s.w-20, s.y+34, 15, "rgba(214,228,255,0.95)", "900", "right");
  hr(s.y+54);

  // ── 玩家速度 ── (y 66-110)
  const laneSpd = currentLaneSpeed();
  const laneBonus = getLaneBonusFor(app.playerLane);
  text("速度", s.x+20, s.y+82, 13, "rgba(100,200,255,0.7)", "700");
  if (laneBonus) {
    text(laneBonus.label || "", s.x+20, s.y+96, 9, "rgba(100,200,255,0.55)", "600");
  }
  text(`${laneSpd}`, s.x+s.w-20, s.y+88, 28, "rgba(120,220,255,0.95)", "900", "right");
  hr(s.y+114);

  // ── 對手區 ── (y 126-188)
  const oppSpd = opponentDisplaySpeed();
  const opp = isStage2() ? currentOpponent() : null;
  const s2 = app.stage2;
  const focusMax = opp ? getOpponentFocusMax(opp.id) : 0;
  const focusCur = (opp && s2) ? (s2.opponentFocusMap?.[opp.id] ?? 0) : 0;
  const focusBroken = opp && (focusMax === 0 || focusCur === 0);
  const speedEnough = opp && (laneSpd > oppSpd);
  const differentLane = opp && (app.playerLane !== app.opponentLane);
  const canOvertakeNow = focusBroken && speedEnough && differentLane;
  const nameStr = opp?.name || "對手速度";
  const nameColor = canOvertakeNow ? "rgba(120,255,160,0.95)" : "rgba(255,160,160,0.85)";
  text(nameStr, s.x+20, s.y+138, 13, nameColor, "800");
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
      text("!", s.x+20 + nameW + 8, s.y+138, 14, "rgba(120,255,160,0.95)", "900");
    }
  }
  const spdColor = canOvertakeNow ? "rgba(140,255,180,0.95)" : "rgba(255,150,150,0.95)";
  text(`${oppSpd}`, s.x+s.w-20, s.y+148, 26, spdColor, "900", "right");
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
    text(predictStr, s.x+s.w-20, s.y+178, 11, arrowColor, "800", "right");
  }
}

// ─── 車子部件 HUD（左下、SC1 復古未來主義線框風）──────────────────────
// 整輛車的掃描圖（v10 設計）：尾翼 / 動力系統 / V6 / 駕駛艙 / 鼻錐 / 前翼
// 顏色：輪胎用 tireHealthColor 變紅警示；其他部件永遠保持綠色
// Hover：移到部件上 → 該部件亮起並顯示部件名稱與敘述 tooltip
// 整個面板是 stability drop zone（拖牌進來 → 充能尾翼 = 空力穩定系統）
function carPartsHudRect() {
  // 跟右下 statusHudRect 對稱
  return { x: 24, y: app.h - 170 - 24, w: 290, h: 170 };
}

// ── 各部件 metadata（名稱 + 敘述 / 預告）──
const CHASSIS_PARTS = {
  tyres:      { name: "輪胎",         pending: true },
  aero:       { name: "空力穩定系統", desc: "棄手牌至此，此回合QTE難度降低。" },
  powertrain: { name: "動力系統",     pending: true },
  rearWing:   { name: "尾翼",         pending: true },
  frontWing:  { name: "前翼",         pending: true },
  cockpit:    { name: "駕駛艙",       pending: true },
  sidepod:    { name: "側箱",         pending: true },
  suspension: { name: "懸吊系統",     pending: true },
  nose:       { name: "鼻錐",         pending: true },
};
const CHASSIS_PENDING_TEXT = "此部件尚未在測試版本開放，敬請期待。";

// 設定畫筆樣式給某個部件
// tier: "bold" | "med" | "thin" — 對應線粗細
// isTyre: 是否屬輪胎（會跟著 tireHealthColor 變紅）
// 其他部件永遠用綠色；hover 中的部件用亮綠 + 加 shadow
function _carPartStroke(ctx, part, hoverPart, isTyre, hc, tier = "med") {
  const isHover = (hoverPart === part);
  const widths = { bold: 1.6, med: 1.0, thin: 0.7 };
  const blurs  = { bold: 4, med: 3, thin: 2 };
  ctx.lineWidth = widths[tier] || 1.0;
  if (isTyre) {
    ctx.strokeStyle = isHover ? "#dfffe8" : hc.main;
    ctx.shadowColor = isHover ? "rgba(180,255,200,0.7)" : hc.glow;
    ctx.shadowBlur = (blurs[tier] || 3) + (isHover ? 3 : 0);
  } else if (isHover) {
    ctx.strokeStyle = "#bfffd0";
    ctx.shadowColor = "rgba(180,255,200,0.7)";
    ctx.shadowBlur = (blurs[tier] || 3) + 3;
  } else {
    ctx.strokeStyle = "#5dff7a";
    ctx.shadowColor = "rgba(93,255,122,0.4)";
    ctx.shadowBlur = blurs[tier] || 3;
  }
}

// 計算車子部件 hit areas（在 v10 510×240 design 座標系中、會轉成 canvas 座標）
// 回傳順序 = 繪製順序，hit test 從後往前掃（後加的優先勝過先加的）
function chassisHitAreas(x, y, w, h) {
  const SX = w / 510, SY = h / 240;
  const cy = 120;
  const trackHalf = 88, wheelW = 60, wheelH = 36;
  const bodyHalf = 16, sidepodHalf = 66, noseHalf = 4, floorHalf = 70;
  const rwX1 = 10, rwX2 = 54;
  const rearWheelCx = 105;
  const gearboxX2 = 168;
  const sidepodX1 = 158, sidepodX2 = 300;
  const airboxX2 = 238;
  const cockpitX1 = 238, cockpitX2 = 282;
  const noseBaseX = 304;
  const frontWheelCx = 388;
  const noseTipX = 462;
  const fwX2 = 502;

  const areas = [];
  const push = (part, vx, vy, vw, vh) => {
    areas.push({ part, x: x + vx * SX, y: y + vy * SY, w: vw * SX, h: vh * SY });
  };

  // 1. AERO – top floor strip
  push("aero", rearWheelCx + wheelW/2 - 4, cy - floorHalf - 2,
    (frontWheelCx - wheelW/2 + 4) - (rearWheelCx + wheelW/2 - 4),
    (cy - sidepodHalf) - (cy - floorHalf - 2));
  // 2. AERO – bottom floor strip
  push("aero", rearWheelCx + wheelW/2 - 4, cy + sidepodHalf,
    (frontWheelCx - wheelW/2 + 4) - (rearWheelCx + wheelW/2 - 4),
    (cy + floorHalf + 2) - (cy + sidepodHalf));
  // 3. REAR WING
  push("rearWing", rwX1 - 8, cy - trackHalf - 8,
    (rwX2 + 6) - (rwX1 - 8), trackHalf * 2 + 16);
  // 4. AERO – slat counter (rear wing center)
  push("aero", rwX1 + 2, cy - 30, rwX2 - rwX1 - 4, 60);
  // 5. POWERTRAIN
  push("powertrain", rwX2 + 2, cy - bodyHalf - 4,
    airboxX2 - (rwX2 + 2), bodyHalf * 2 + 8);
  // 6. TYRES (4 wheels)
  [[rearWheelCx, cy - trackHalf], [rearWheelCx, cy + trackHalf],
   [frontWheelCx, cy - trackHalf], [frontWheelCx, cy + trackHalf]].forEach(([cx, cyW]) => {
    push("tyres", cx - wheelW/2 - 4, cyW - wheelH/2 - 4, wheelW + 8, wheelH + 8);
  });
  // 7. REAR SUSPENSION (top + bottom)
  push("suspension", rearWheelCx - 4, (cy - trackHalf + wheelH/2) - 4,
    (gearboxX2 + 4) - (rearWheelCx - 4),
    (cy - bodyHalf) - ((cy - trackHalf + wheelH/2) - 4));
  push("suspension", rearWheelCx - 4, cy + bodyHalf,
    (gearboxX2 + 4) - (rearWheelCx - 4),
    ((cy + trackHalf - wheelH/2) + 4) - (cy + bodyHalf));
  // 8. SIDEPOD (top + bottom)
  push("sidepod", sidepodX1, cy - sidepodHalf,
    sidepodX2 - sidepodX1, sidepodHalf - bodyHalf);
  push("sidepod", sidepodX1, cy + bodyHalf,
    sidepodX2 - sidepodX1, sidepodHalf - bodyHalf);
  // 9. AERO – bargeboards
  push("aero", sidepodX2 + 4, cy - floorHalf,
    (noseBaseX + 30) - (sidepodX2 + 4), floorHalf * 2);
  // 10. COCKPIT (drawn AFTER powertrain so wins overlap)
  push("cockpit", cockpitX1 - 4, cy - bodyHalf - 6,
    (cockpitX2 + 4) - (cockpitX1 - 4), bodyHalf * 2 + 12);
  // 11. NOSE
  push("nose", noseBaseX + 30, cy - noseHalf - 8,
    (noseTipX - 4) - (noseBaseX + 30), noseHalf * 2 + 16);
  // 12. FRONT SUSPENSION (top + bottom)
  push("suspension", noseBaseX + 70, (cy - trackHalf + wheelH/2) - 4,
    (frontWheelCx - 8) - (noseBaseX + 70),
    (cy - bodyHalf) - ((cy - trackHalf + wheelH/2) - 4));
  push("suspension", noseBaseX + 70, cy + bodyHalf,
    (frontWheelCx - 8) - (noseBaseX + 70),
    ((cy + trackHalf - wheelH/2) + 4) - (cy + bodyHalf));
  // 13. FRONT WING
  push("frontWing", noseTipX - 2, cy - trackHalf - 18,
    (fwX2 + 10) - (noseTipX - 2), trackHalf * 2 + 36);

  return areas;
}

// 偵測滑鼠當下停留在哪個部件
function chassisHoverPart(x, y, w, h) {
  if (!app.mouse) return null;
  const areas = chassisHitAreas(x, y, w, h);
  for (let i = areas.length - 1; i >= 0; i--) {
    if (inRect(app.mouse, areas[i])) return areas[i].part;
  }
  return null;
}

// 繪製部件 tooltip（panel 左上、shematic 區覆蓋）
function drawChassisTooltip(R, partKey) {
  const data = CHASSIS_PARTS[partKey];
  if (!data) return;
  const ctx = app.ctx;
  const name = data.name;
  const desc = data.pending ? CHASSIS_PENDING_TEXT : data.desc;
  const pending = !!data.pending;

  const tooltipW = 200;
  const padX = 10, padY = 8;
  const nameSize = 13;
  const descSize = 11;
  const lineHeight = descSize * 1.5;

  // 中文逐字斷行
  ctx.save();
  ctx.font = `400 ${descSize * FONT_SCALE}px system-ui, "Microsoft JhengHei", sans-serif`;
  const maxLineW = tooltipW - padX * 2;
  const lines = [];
  let curLine = "";
  for (const ch of desc) {
    const test = curLine + ch;
    if (ctx.measureText(test).width > maxLineW && curLine.length > 0) {
      lines.push(curLine);
      curLine = ch;
    } else {
      curLine = test;
    }
  }
  if (curLine.length > 0) lines.push(curLine);
  ctx.restore();

  const tooltipH = padY * 2 + nameSize + 6 + lines.length * lineHeight;

  // 位置：跟著滑鼠（右上方一點偏移）、加邊界保護
  const offsetX = 16;
  const offsetY = -tooltipH - 12;  // 預設放在游標上方
  let tx = (app.mouse?.x ?? R.x) + offsetX;
  let ty = (app.mouse?.y ?? R.y) + offsetY;
  // 右側超出 → 改放游標左邊
  if (tx + tooltipW > app.w - 8) {
    tx = (app.mouse?.x ?? R.x) - tooltipW - offsetX;
  }
  // 上方超出 → 改放游標下方
  if (ty < 8) {
    ty = (app.mouse?.y ?? R.y) + 18;
  }
  // 下方超出 → 上推
  if (ty + tooltipH > app.h - 8) {
    ty = app.h - tooltipH - 8;
  }
  // 左側超出 → 貼左邊
  if (tx < 8) tx = 8;

  // 背景：深綠玻璃、亮綠邊框、斜切角
  ctx.save();
  ctx.fillStyle = "rgba(8, 20, 12, 0.94)";
  ctx.strokeStyle = "rgba(93, 255, 122, 0.6)";
  ctx.lineWidth = 1;
  ctx.shadowColor = "rgba(93, 255, 122, 0.3)";
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx + tooltipW - 6, ty);
  ctx.lineTo(tx + tooltipW, ty + 6);
  ctx.lineTo(tx + tooltipW, ty + tooltipH);
  ctx.lineTo(tx + 6, ty + tooltipH);
  ctx.lineTo(tx, ty + tooltipH - 6);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();
  ctx.restore();

  // 部件名稱（亮綠粗體）
  text(name, tx + padX, ty + padY + nameSize, nameSize, "#5dff7a", "800", "left");

  // 敘述（pending 用較暗顏色）
  const descColor = pending ? "rgba(140, 180, 156, 0.85)" : "rgba(200, 230, 215, 0.95)";
  const descWeight = pending ? "500" : "400";
  for (let i = 0; i < lines.length; i++) {
    text(lines[i], tx + padX, ty + padY + nameSize + 8 + (i + 1) * lineHeight - 3,
      descSize, descColor, descWeight, "left");
  }
}

// 輪胎機制已移除；保留 health color 介面只是因為 drawCarSchematic 還用它代表整輛車的健康色
// 永遠回傳鮮綠色組
function tireHealthColor(time) {
  return {
    main: "#5dff7a",
    dim: "rgba(80, 200, 110, 0.55)",
    glow: "rgba(90, 255, 130, 0.55)",
    danger: false,
    pulse: 1,
  };
}

function drawCarPartsHud(time) {
  if (!isStage2()) return;
  const ctx = app.ctx;
  const R = carPartsHudRect();
  const hc = tireHealthColor(time);

  // ── 拖曳互動狀態（無上限，永遠可接收）──
  const isDragging = !!app.drag && app.drag.card?.cardClass !== "team";
  const canAccept = isDragging;
  const inHover = canAccept && app.zones.stabilityZone && inRect(
    { x: app.drag.x + app.drag.w/2, y: app.drag.y + app.drag.h/2 },
    app.zones.stabilityZone
  );
  const dropFx = app.stabilityDropFx;
  const dropPulse = dropFx ? Math.max(0, Math.min(1, (dropFx.until - performance.now()) / 520)) : 0;

  // ── 邊框色：永遠綠色（不受輪胎影響）；拖曳可接收時亮 pulse、inHover 最亮
  let borderAccent = "#5dff7a";
  let borderGlow = "rgba(93, 255, 122, 0.4)";
  if (inHover) {
    borderAccent = "#bfffd0";
    borderGlow = "rgba(180, 255, 200, 0.85)";
  } else if (canAccept) {
    const p = 0.55 + 0.45 * Math.sin(time * 0.006);
    borderAccent = `rgba(140, 255, 170, ${p})`;
    borderGlow = `rgba(140, 255, 170, ${0.4 * p + 0.2})`;
  }

  // ── 外框
  drawTerranPanel(R.x, R.y, R.w, R.h, borderAccent, borderGlow);

  // drop fx：閃光蓋層
  if (dropPulse > 0) {
    ctx.save();
    ctx.fillStyle = `rgba(150, 255, 180, ${0.16 * dropPulse})`;
    ctx.fillRect(R.x + 4, R.y + 4, R.w - 8, R.h - 8);
    ctx.restore();
  }

  // ── 標題列文字（標題綠；空力綠）
  text("車體狀態 · CHASSIS",
    R.x + 14, R.y + 20, 12, "rgba(93, 255, 122, 0.75)", "800");
  textRaw(`空力 ${app.stabilityCharges}`,
    R.x + R.w - 14, R.y + 19, 11, "#9fff9f", "900", "right", true);

  // ── 主體：俯視掃描圖
  const carX = R.x + 10;
  const carY = R.y + 32;
  const carW = R.w - 20;
  const carH = R.h - 42;

  // 計算 hover（拖曳中不顯示 tooltip，避免干擾）
  let hoverPart = null;
  if (!isDragging && app.mouse && inRect(app.mouse, R)) {
    hoverPart = chassisHoverPart(carX, carY, carW, carH);
  }
  // 拖曳時 inHover 視為 aero 部件 active（aero 全部亮起）
  const aeroActive = inHover ? "aero" : null;
  const drawHover = hoverPart || aeroActive;
  app.chassisHover = hoverPart;

  drawCarSchematic(carX, carY, carW, carH, hc, time, drawHover);

  // ── 掃描線（垂直方向掃過）
  drawScanLine(carX, carY, carW, carH, time, hc);

  // ── 拖牌中的中央提示
  if (isDragging) {
    const msgColor = inHover ? "rgba(220, 255, 230, 1)" : "rgba(150, 255, 180, 0.95)";
    text("棄手牌至此，穩定車身(-1階QTE難度)",
      R.x + R.w / 2, R.y + R.h - 12, 12, msgColor, "900", "center");
  } else if (hc.danger) {
    // 危急時面板下方文字警示（只在這裡警示、不影響其他部位顏色）
    const a = 0.65 + 0.3 * hc.pulse;
    text("⚠ 輪胎危急 · CRITICAL",
      R.x + R.w / 2, R.y + R.h - 12, 12, `rgba(255, 110, 110, ${a})`, "900", "center");
  }

  // ── tooltip（hover 中且非拖曳）
  if (hoverPart && !isDragging) {
    drawChassisTooltip(R, hoverPart);
  }

  // 註冊 stability drop zone：整個面板（標題列以下）都可接受
  app.zones.stabilityZone = {
    x: R.x + 6, y: R.y + 30, w: R.w - 12, h: R.h - 36
  };
}

// 把 hex / "#rrggbb" 加上 alpha；或把 rgba(...) 改 alpha
function fadeColor(c, a) {
  if (!c) return `rgba(140, 255, 140, ${a})`;
  if (c.startsWith("#")) {
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  // 已是 rgba/rgb：粗暴覆蓋 alpha
  return c.replace(/rgba?\(([^)]+)\)/, (_, inner) => {
    const parts = inner.split(",").map(s => s.trim());
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${a})`;
  });
}

// SC1 Terran 風格的面板：兩層線框、四角斜切、深色玻璃感
// accent / glow 由呼叫者決定（隨健康色變）
function drawTerranPanel(x, y, w, h, accent, glow) {
  const ctx = app.ctx;
  ctx.save();
  // 底色：深色玻璃漸層
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, "rgba(6, 22, 12, 0.92)");
  grad.addColorStop(1, "rgba(3, 12, 8, 0.94)");
  ctx.fillStyle = grad;
  // 用斜切角的 path 取代圓角，更像 SC1
  const cut = 10;
  ctx.beginPath();
  ctx.moveTo(x + cut, y);
  ctx.lineTo(x + w - cut, y);
  ctx.lineTo(x + w, y + cut);
  ctx.lineTo(x + w, y + h - cut);
  ctx.lineTo(x + w - cut, y + h);
  ctx.lineTo(x + cut, y + h);
  ctx.lineTo(x, y + h - cut);
  ctx.lineTo(x, y + cut);
  ctx.closePath();
  ctx.fill();
  // 外層線框（亮 + 微光）
  ctx.shadowColor = glow || "rgba(80, 255, 110, 0.45)";
  ctx.shadowBlur = 10;
  ctx.strokeStyle = accent || "rgba(80, 255, 110, 0.85)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // 內層細線
  ctx.strokeStyle = fadeColor(accent || "rgba(60, 180, 90, 1)", 0.32);
  ctx.lineWidth = 1;
  ctx.beginPath();
  const inset = 4;
  const cut2 = cut - 2;
  ctx.moveTo(x + inset + cut2, y + inset);
  ctx.lineTo(x + w - inset - cut2, y + inset);
  ctx.lineTo(x + w - inset, y + inset + cut2);
  ctx.lineTo(x + w - inset, y + h - inset - cut2);
  ctx.lineTo(x + w - inset - cut2, y + h - inset);
  ctx.lineTo(x + inset + cut2, y + h - inset);
  ctx.lineTo(x + inset, y + h - inset - cut2);
  ctx.lineTo(x + inset, y + inset + cut2);
  ctx.closePath();
  ctx.stroke();
  // 標題列底色
  ctx.fillStyle = fadeColor(accent || "rgba(50, 160, 80, 1)", 0.15);
  ctx.fillRect(x + 6, y + 6, w - 12, 22);
  // 標題列下緣分隔線
  ctx.strokeStyle = fadeColor(accent || "rgba(120, 255, 150, 1)", 0.4);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 6, y + 28);
  ctx.lineTo(x + w - 6, y + 28);
  ctx.stroke();
  // 標題列左側裝飾小方塊
  ctx.fillStyle = fadeColor(accent || "rgba(120, 255, 150, 1)", 0.85);
  ctx.fillRect(x + 10, y + 12, 4, 10);
  ctx.restore();
}

// ─── 整輛車的俯視掃描圖 ─────────────────────────────────────────────
// 看的方向：俯視（top-down）、車頭朝右（→），車尾朝左（←）
// 元素排列：[後翼+充能槽] → [後輪×2] → [引擎/側箱] → [駕駛艙+halo] → [鼻錐] → [前輪×2] → [前翼]
function drawCarSchematic(x, y, w, h, hc, time, hoverPart) {
  const ctx = app.ctx;
  // v10 設計座標系（510×240）→ canvas 縮放
  const SX = w / 510, SY = h / 240;
  const TX = (vx) => x + vx * SX;
  const TY = (vy) => y + vy * SY;
  // y 軸用 SY 等比例縮放尺寸（半寬 / 半高等）
  const SH = (n) => n * SY;
  const SW = (n) => n * SX;

  // v10 設計座標
  const dCy = 120;
  const trackHalf = 88, wheelW = 60, wheelH = 36;
  const bodyHalf = 16, sidepodHalf = 66, noseHalf = 4, floorHalf = 70;
  const rwX1 = 10, rwX2 = 54;
  const rearWheelCx = 105;
  const gearboxX1 = 138, gearboxX2 = 168;
  const engineX1 = 168, engineX2 = 214;
  const sidepodX1 = 158, sidepodX2 = 300;
  const airboxX1 = 214, airboxX2 = 238;
  const cockpitX1 = 238, cockpitX2 = 282;
  const noseBaseX = 304;
  const frontWheelCx = 388;
  const noseTipX = 462;
  const fwX1 = 458, fwX2 = 502;

  const cy = TY(dCy);
  const topWheelInnerY = TY(dCy - trackHalf + wheelH/2);
  const botWheelInnerY = TY(dCy + trackHalf - wheelH/2);

  // ════════════════════════════════════════════════════════════════
  // LAYER 1: FLOOR (aero)
  // ════════════════════════════════════════════════════════════════
  ctx.save();
  _carPartStroke(ctx, "aero", hoverPart, false, hc, "thin");
  ctx.setLineDash([4 * SX, 3 * SX]);
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.moveTo(TX(rearWheelCx + wheelW/2 - 2), TY(dCy - floorHalf));
  ctx.lineTo(TX(frontWheelCx - wheelW/2 + 2), TY(dCy - floorHalf));
  ctx.lineTo(TX(frontWheelCx - wheelW/2 - 4), TY(dCy - bodyHalf - 10));
  ctx.lineTo(TX(noseTipX - 30), TY(dCy - noseHalf - 4));
  ctx.lineTo(TX(noseTipX - 30), TY(dCy + noseHalf + 4));
  ctx.lineTo(TX(frontWheelCx - wheelW/2 - 4), TY(dCy + bodyHalf + 10));
  ctx.lineTo(TX(frontWheelCx - wheelW/2 + 2), TY(dCy + floorHalf));
  ctx.lineTo(TX(rearWheelCx + wheelW/2 - 2), TY(dCy + floorHalf));
  ctx.closePath();
  // 半透明 fill
  const isAeroActive = hoverPart === "aero";
  ctx.fillStyle = isAeroActive ? "rgba(180,255,200,0.20)" : "rgba(93,255,122,0.14)";
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Floor edge vortex generators
  ctx.save();
  _carPartStroke(ctx, "aero", hoverPart, false, hc, "med");
  for (let i = 0; i < 7; i++) {
    const vx = sidepodX2 - 10 - i * 14;
    if (vx < sidepodX1 + 30) break;
    ctx.beginPath();
    ctx.moveTo(TX(vx),     TY(dCy - floorHalf + 2));
    ctx.lineTo(TX(vx + 4), TY(dCy - floorHalf - 5));
    ctx.lineTo(TX(vx + 8), TY(dCy - floorHalf + 2));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(TX(vx),     TY(dCy + floorHalf - 2));
    ctx.lineTo(TX(vx + 4), TY(dCy + floorHalf + 5));
    ctx.lineTo(TX(vx + 8), TY(dCy + floorHalf - 2));
    ctx.stroke();
  }
  ctx.restore();

  // ════════════════════════════════════════════════════════════════
  // LAYER 2: BODY SILHOUETTE (shared, no hover)
  // ════════════════════════════════════════════════════════════════
  ctx.save();
  ctx.fillStyle = "rgba(93,255,122,0.18)";
  ctx.strokeStyle = "#5dff7a";
  ctx.shadowColor = "rgba(93,255,122,0.4)";
  ctx.shadowBlur = 3;
  ctx.lineWidth = 1.4;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(TX(rwX2 + 4), TY(dCy - bodyHalf + 2));
  ctx.lineTo(TX(gearboxX1 - 4), TY(dCy - bodyHalf));
  ctx.bezierCurveTo(
    TX(gearboxX2 + 10), TY(dCy - bodyHalf - 2),
    TX(sidepodX1 + 4), TY(dCy - sidepodHalf + 18),
    TX(sidepodX1 + 30), TY(dCy - sidepodHalf)
  );
  ctx.bezierCurveTo(
    TX(sidepodX1 + 80), TY(dCy - sidepodHalf - 1),
    TX(sidepodX2 - 80), TY(dCy - sidepodHalf - 1),
    TX(sidepodX2 - 30), TY(dCy - sidepodHalf)
  );
  ctx.bezierCurveTo(
    TX(sidepodX2 - 4), TY(dCy - sidepodHalf + 14),
    TX(sidepodX2 + 18), TY(dCy - bodyHalf - 8),
    TX(noseBaseX + 8), TY(dCy - bodyHalf)
  );
  ctx.bezierCurveTo(
    TX(noseBaseX + 40), TY(dCy - bodyHalf),
    TX(noseBaseX + 80), TY(dCy - noseHalf - 2),
    TX(noseBaseX + 100), TY(dCy - noseHalf)
  );
  ctx.lineTo(TX(noseTipX - 8), TY(dCy - noseHalf + 0.5));
  ctx.lineTo(TX(noseTipX), TY(dCy - 1));
  ctx.lineTo(TX(noseTipX + 6), TY(dCy));
  ctx.lineTo(TX(noseTipX), TY(dCy + 1));
  ctx.lineTo(TX(noseTipX - 8), TY(dCy + noseHalf - 0.5));
  ctx.lineTo(TX(noseBaseX + 100), TY(dCy + noseHalf));
  ctx.bezierCurveTo(
    TX(noseBaseX + 80), TY(dCy + noseHalf + 2),
    TX(noseBaseX + 40), TY(dCy + bodyHalf),
    TX(noseBaseX + 8), TY(dCy + bodyHalf)
  );
  ctx.bezierCurveTo(
    TX(sidepodX2 + 18), TY(dCy + bodyHalf + 8),
    TX(sidepodX2 - 4), TY(dCy + sidepodHalf - 14),
    TX(sidepodX2 - 30), TY(dCy + sidepodHalf)
  );
  ctx.bezierCurveTo(
    TX(sidepodX2 - 80), TY(dCy + sidepodHalf + 1),
    TX(sidepodX1 + 80), TY(dCy + sidepodHalf + 1),
    TX(sidepodX1 + 30), TY(dCy + sidepodHalf)
  );
  ctx.bezierCurveTo(
    TX(sidepodX1 + 4), TY(dCy + sidepodHalf - 18),
    TX(gearboxX2 + 10), TY(dCy + bodyHalf + 2),
    TX(gearboxX1 - 4), TY(dCy + bodyHalf)
  );
  ctx.lineTo(TX(rwX2 + 4), TY(dCy + bodyHalf - 2));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // ════════════════════════════════════════════════════════════════
  // LAYER 3: REAR WING
  // ════════════════════════════════════════════════════════════════
  ctx.save();
  _carPartStroke(ctx, "rearWing", hoverPart, false, hc, "bold");
  // 主翼框
  ctx.strokeRect(TX(rwX1), TY(dCy - trackHalf), SW(rwX2 - rwX1), SH(trackHalf * 2));
  // 端板
  ctx.strokeRect(TX(rwX1 - 6), TY(dCy - trackHalf - 6), SW(6), SH(trackHalf * 2 + 12));
  ctx.strokeRect(TX(rwX2),     TY(dCy - trackHalf - 6), SW(6), SH(trackHalf * 2 + 12));
  // DRS slot + flap divisions
  _carPartStroke(ctx, "rearWing", hoverPart, false, hc, "med");
  ctx.beginPath();
  ctx.moveTo(TX(rwX1 + 2), TY(dCy - trackHalf + 8));
  ctx.lineTo(TX(rwX2 - 2), TY(dCy - trackHalf + 8));
  ctx.moveTo(TX(rwX1 + 2), TY(dCy - trackHalf + 12));
  ctx.lineTo(TX(rwX2 - 2), TY(dCy - trackHalf + 12));
  for (let i = 1; i < 4; i++) {
    const yi = dCy - trackHalf + i * (trackHalf * 2 / 4);
    ctx.moveTo(TX(rwX1), TY(yi));
    ctx.lineTo(TX(rwX2), TY(yi));
  }
  // 端板 louvre
  for (let i = 0; i < 4; i++) {
    const ey = (dCy - trackHalf - 6) + 14 + i * (((trackHalf * 2 + 12) - 28) / 3);
    ctx.moveTo(TX(rwX1 - 6), TY(ey));
    ctx.lineTo(TX(rwX1),     TY(ey));
    ctx.moveTo(TX(rwX2),     TY(ey));
    ctx.lineTo(TX(rwX2 + 6), TY(ey));
  }
  ctx.stroke();
  ctx.restore();

  // ════════════════════════════════════════════════════════════════
  // LAYER 4: AERO SLAT COUNTER (rear wing center)
  // ════════════════════════════════════════════════════════════════
  const visibleCharges = Math.min(app.stabilityCharges, 6);
  const overflow = Math.max(0, app.stabilityCharges - 6);
  const slatThick = 4, slatGap = 4;
  ctx.save();
  ctx.shadowColor = "rgba(140,255,170,0.85)";
  ctx.shadowBlur = 4;
  ctx.fillStyle = isAeroActive ? "rgba(220,255,230,0.95)" : "rgba(180,255,200,0.88)";
  for (let i = 0; i < visibleCharges; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const step = Math.floor(i / 2) + 1;
    const sy = dCy + side * (step * (slatThick + slatGap)) - slatThick / 2;
    ctx.fillRect(TX(rwX1 + 4), TY(sy), SW(rwX2 - rwX1 - 8), SH(slatThick));
  }
  ctx.restore();
  if (overflow > 0) {
    textRaw(`+${overflow}`, TX((rwX1 + rwX2) / 2), cy + 4, 11,
      "rgba(180,255,200,0.98)", "900", "center", true);
  }

  // ════════════════════════════════════════════════════════════════
  // LAYER 5: POWERTRAIN (rear pylons + diffuser + gearbox + V6 + airbox)
  // ════════════════════════════════════════════════════════════════
  ctx.save();
  _carPartStroke(ctx, "powertrain", hoverPart, false, hc, "bold");
  // 後翼 pylons (3)
  ctx.beginPath();
  ctx.moveTo(TX(rwX2),       TY(dCy - 14));
  ctx.lineTo(TX(gearboxX1),  TY(dCy - bodyHalf + 4));
  ctx.moveTo(TX(rwX2),       TY(dCy + 14));
  ctx.lineTo(TX(gearboxX1),  TY(dCy + bodyHalf - 4));
  ctx.moveTo(TX(rwX2),       cy);
  ctx.lineTo(TX(gearboxX1),  cy);
  ctx.stroke();
  // Diffuser strakes (4)
  for (let i = 0; i < 4; i++) {
    const vx = rwX2 + 8 + i * 14;
    if (vx > gearboxX1 - 6) break;
    ctx.strokeRect(TX(vx), TY(dCy - bodyHalf + 4), SW(3), SH(bodyHalf * 2 - 8));
  }
  // Gearbox
  ctx.strokeRect(TX(gearboxX1), TY(dCy - bodyHalf + 2),
                 SW(gearboxX2 - gearboxX1), SH(bodyHalf * 2 - 4));
  _carPartStroke(ctx, "powertrain", hoverPart, false, hc, "med");
  ctx.beginPath();
  for (let i = 1; i < 4; i++) {
    const ly = dCy - bodyHalf + 2 + i * (bodyHalf * 2 - 4) / 4;
    ctx.moveTo(TX(gearboxX1 + 3), TY(ly));
    ctx.lineTo(TX(gearboxX2 - 3), TY(ly));
  }
  ctx.stroke();
  // V6 engine block
  _carPartStroke(ctx, "powertrain", hoverPart, false, hc, "bold");
  ctx.strokeRect(TX(engineX1 + 2), TY(dCy - bodyHalf + 2),
                 SW(engineX2 - engineX1 - 4), SH(bodyHalf * 2 - 4));
  // V6 cylinders (2 rows × 3)
  const cylRows = [dCy - bodyHalf * 0.55, dCy + bodyHalf * 0.55];
  for (const cyR of cylRows) {
    for (let i = 0; i < 3; i++) {
      const ccx = engineX1 + 10 + i * 14;
      // 外圈
      ctx.beginPath();
      ctx.ellipse(TX(ccx), TY(cyR), SW(4.5), SH(4.5), 0, 0, Math.PI * 2);
      ctx.stroke();
      // 內圈
      _carPartStroke(ctx, "powertrain", hoverPart, false, hc, "med");
      ctx.beginPath();
      ctx.ellipse(TX(ccx), TY(cyR), SW(2), SH(2), 0, 0, Math.PI * 2);
      ctx.stroke();
      _carPartStroke(ctx, "powertrain", hoverPart, false, hc, "bold");
    }
  }
  // Intake plenum
  ctx.strokeRect(TX(engineX1 + 6), TY(dCy - 2.5),
                 SW(engineX2 - engineX1 - 12), SH(5));
  // Plenum runners
  _carPartStroke(ctx, "powertrain", hoverPart, false, hc, "med");
  ctx.beginPath();
  for (const cyR of cylRows) {
    for (let i = 0; i < 3; i++) {
      const ccx = engineX1 + 10 + i * 14;
      const dy = cyR < dCy ? dCy - 2.5 : dCy + 2.5;
      ctx.moveTo(TX(ccx), TY(cyR + (cyR < dCy ? 4.5 : -4.5)));
      ctx.lineTo(TX(ccx), TY(dy));
    }
  }
  ctx.stroke();
  // Exhaust headers
  _carPartStroke(ctx, "powertrain", hoverPart, false, hc, "bold");
  ctx.beginPath();
  ctx.moveTo(TX(engineX1 + 10), TY(dCy - bodyHalf * 0.55 - 4.5));
  ctx.quadraticCurveTo(TX(engineX1 - 2), TY(dCy - bodyHalf * 0.85),
                       TX(engineX1 - 6), TY(dCy - bodyHalf + 2));
  ctx.moveTo(TX(engineX1 + 10), TY(dCy + bodyHalf * 0.55 + 4.5));
  ctx.quadraticCurveTo(TX(engineX1 - 2), TY(dCy + bodyHalf * 0.85),
                       TX(engineX1 - 6), TY(dCy + bodyHalf - 2));
  ctx.stroke();
  // Airbox
  ctx.strokeRect(TX(airboxX1), TY(dCy - bodyHalf + 2),
                 SW(airboxX2 - airboxX1), SH(bodyHalf * 2 - 4));
  _carPartStroke(ctx, "powertrain", hoverPart, false, hc, "thin");
  ctx.beginPath();
  ctx.moveTo(TX(airboxX1 + 2), TY(dCy - 5));
  ctx.lineTo(TX(airboxX2 - 2), TY(dCy - 5));
  ctx.moveTo(TX(airboxX1 + 2), TY(dCy + 5));
  ctx.lineTo(TX(airboxX2 - 2), TY(dCy + 5));
  ctx.stroke();
  // Intake mouth
  _carPartStroke(ctx, "powertrain", hoverPart, false, hc, "bold");
  ctx.beginPath();
  ctx.moveTo(TX(airboxX1),     TY(dCy - 10));
  ctx.lineTo(TX(airboxX1 - 8), TY(dCy - 6));
  ctx.lineTo(TX(airboxX1 - 8), TY(dCy + 6));
  ctx.lineTo(TX(airboxX1),     TY(dCy + 10));
  ctx.stroke();
  ctx.restore();

  // ════════════════════════════════════════════════════════════════
  // LAYER 6: TYRES (4 wheels, use hc for color)
  // ════════════════════════════════════════════════════════════════
  function drawWheelV10(cxV, cyVdesign) {
    ctx.save();
    _carPartStroke(ctx, "tyres", hoverPart, true, hc, "bold");
    const wx = TX(cxV - wheelW/2);
    const wy = TY(cyVdesign - wheelH/2);
    const wW = SW(wheelW), wH = SH(wheelH);
    const r = SW(6);
    // 圓角矩形
    ctx.beginPath();
    ctx.moveTo(wx + r, wy);
    ctx.lineTo(wx + wW - r, wy);
    ctx.quadraticCurveTo(wx + wW, wy, wx + wW, wy + r);
    ctx.lineTo(wx + wW, wy + wH - r);
    ctx.quadraticCurveTo(wx + wW, wy + wH, wx + wW - r, wy + wH);
    ctx.lineTo(wx + r, wy + wH);
    ctx.quadraticCurveTo(wx, wy + wH, wx, wy + wH - r);
    ctx.lineTo(wx, wy + r);
    ctx.quadraticCurveTo(wx, wy, wx + r, wy);
    ctx.closePath();
    ctx.stroke();
    // 內側 sidewall band
    _carPartStroke(ctx, "tyres", hoverPart, true, hc, "med");
    ctx.strokeRect(TX(cxV - wheelW/2 + 5), TY(cyVdesign - wheelH/2 + 4),
                   SW(wheelW - 10), SH(wheelH - 8));
    // 中央 brake disc 3 層 ellipse
    _carPartStroke(ctx, "tyres", hoverPart, true, hc, "bold");
    ctx.beginPath();
    ctx.ellipse(TX(cxV), TY(cyVdesign), SW(wheelW * 0.28), SH(wheelH * 0.42), 0, 0, Math.PI * 2);
    ctx.stroke();
    _carPartStroke(ctx, "tyres", hoverPart, true, hc, "med");
    ctx.beginPath();
    ctx.ellipse(TX(cxV), TY(cyVdesign), SW(wheelW * 0.20), SH(wheelH * 0.30), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(TX(cxV), TY(cyVdesign), SW(wheelW * 0.10), SH(wheelH * 0.16), 0, 0, Math.PI * 2);
    ctx.stroke();
    // 中央十字
    ctx.beginPath();
    ctx.moveTo(TX(cxV - 3), TY(cyVdesign));
    ctx.lineTo(TX(cxV + 3), TY(cyVdesign));
    ctx.moveTo(TX(cxV), TY(cyVdesign - 3));
    ctx.lineTo(TX(cxV), TY(cyVdesign + 3));
    ctx.stroke();
    // Brake caliper（內側亮條）
    _carPartStroke(ctx, "tyres", hoverPart, true, hc, "bold");
    const inboardY = cyVdesign < dCy
      ? cyVdesign + wheelH * 0.32
      : cyVdesign - wheelH * 0.32 - 5;
    ctx.strokeRect(TX(cxV - 10), TY(inboardY), SW(20), SH(5));
    // 胎面紋
    _carPartStroke(ctx, "tyres", hoverPart, true, hc, "thin");
    ctx.beginPath();
    for (let i = -1; i <= 1; i++) {
      const ty = cyVdesign + i * (wheelH * 0.22);
      ctx.moveTo(TX(cxV - wheelW/2 + 3), TY(ty));
      ctx.lineTo(TX(cxV + wheelW/2 - 3), TY(ty));
    }
    ctx.stroke();
    ctx.restore();
  }
  drawWheelV10(rearWheelCx, dCy - trackHalf);
  drawWheelV10(rearWheelCx, dCy + trackHalf);
  drawWheelV10(frontWheelCx, dCy - trackHalf);
  drawWheelV10(frontWheelCx, dCy + trackHalf);

  // ════════════════════════════════════════════════════════════════
  // LAYER 7: REAR SUSPENSION (3 arms per side)
  // ════════════════════════════════════════════════════════════════
  ctx.save();
  _carPartStroke(ctx, "suspension", hoverPart, false, hc, "bold");
  ctx.beginPath();
  // Top
  ctx.moveTo(TX(gearboxX2 - 2), TY(dCy - bodyHalf));
  ctx.lineTo(TX(rearWheelCx + wheelW/2 - 10), TY(dCy - trackHalf + wheelH/2 + 1));
  ctx.moveTo(TX(gearboxX1 + 4), TY(dCy - bodyHalf));
  ctx.lineTo(TX(rearWheelCx - wheelW/2 + 10), TY(dCy - trackHalf + wheelH/2 + 1));
  ctx.moveTo(TX(gearboxX1 + 14), TY(dCy - bodyHalf + 4));
  ctx.lineTo(TX(rearWheelCx),    TY(dCy - trackHalf + wheelH/2 + 4));
  // Bottom
  ctx.moveTo(TX(gearboxX2 - 2), TY(dCy + bodyHalf));
  ctx.lineTo(TX(rearWheelCx + wheelW/2 - 10), TY(dCy + trackHalf - wheelH/2 - 1));
  ctx.moveTo(TX(gearboxX1 + 4), TY(dCy + bodyHalf));
  ctx.lineTo(TX(rearWheelCx - wheelW/2 + 10), TY(dCy + trackHalf - wheelH/2 - 1));
  ctx.moveTo(TX(gearboxX1 + 14), TY(dCy + bodyHalf - 4));
  ctx.lineTo(TX(rearWheelCx),    TY(dCy + trackHalf - wheelH/2 - 4));
  ctx.stroke();
  ctx.restore();

  // ════════════════════════════════════════════════════════════════
  // LAYER 8: SIDEPOD (inlets + cooling louvres)
  // ════════════════════════════════════════════════════════════════
  ctx.save();
  _carPartStroke(ctx, "sidepod", hoverPart, false, hc, "med");
  // Inlets
  ctx.beginPath();
  ctx.moveTo(TX(sidepodX1 + 2), TY(dCy - bodyHalf));
  ctx.lineTo(TX(sidepodX1 + 18), TY(dCy - sidepodHalf + 8));
  ctx.lineTo(TX(sidepodX1 + 28), TY(dCy - sidepodHalf + 8));
  ctx.moveTo(TX(sidepodX1 + 2), TY(dCy + bodyHalf));
  ctx.lineTo(TX(sidepodX1 + 18), TY(dCy + sidepodHalf - 8));
  ctx.lineTo(TX(sidepodX1 + 28), TY(dCy + sidepodHalf - 8));
  // Structural ridges
  ctx.moveTo(TX(sidepodX1 + 22), TY(dCy - sidepodHalf + 12));
  ctx.lineTo(TX(sidepodX2 - 24), TY(dCy - sidepodHalf + 12));
  ctx.moveTo(TX(sidepodX1 + 22), TY(dCy + sidepodHalf - 12));
  ctx.lineTo(TX(sidepodX2 - 24), TY(dCy + sidepodHalf - 12));
  // Cooling louvres
  for (let i = 0; i < 6; i++) {
    const lx = sidepodX2 - 34 + i * 5;
    if (lx > sidepodX2 - 6) break;
    ctx.moveTo(TX(lx),     TY(dCy - sidepodHalf + 4));
    ctx.lineTo(TX(lx + 3), TY(dCy - sidepodHalf + 14));
    ctx.moveTo(TX(lx),     TY(dCy + sidepodHalf - 4));
    ctx.lineTo(TX(lx + 3), TY(dCy + sidepodHalf - 14));
  }
  ctx.stroke();
  ctx.restore();

  // ════════════════════════════════════════════════════════════════
  // LAYER 9: BARGEBOARDS (aero) — between sidepod and front wheels
  // ════════════════════════════════════════════════════════════════
  ctx.save();
  _carPartStroke(ctx, "aero", hoverPart, false, hc, "med");
  const bbX1 = sidepodX2 + 4;
  const bbX2 = noseBaseX + 30;
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const off = i * 4;
    ctx.moveTo(TX(bbX1 + 4 - off), TY(dCy - bodyHalf - 2));
    ctx.quadraticCurveTo(TX(bbX1 + 16),       TY(dCy - floorHalf + off + 8),
                         TX(bbX2 - 4 + off),  TY(dCy - bodyHalf - 4 + off));
    ctx.moveTo(TX(bbX1 + 4 - off), TY(dCy + bodyHalf + 2));
    ctx.quadraticCurveTo(TX(bbX1 + 16),       TY(dCy + floorHalf - off - 8),
                         TX(bbX2 - 4 + off),  TY(dCy + bodyHalf + 4 - off));
  }
  ctx.stroke();
  // Turning vanes
  _carPartStroke(ctx, "aero", hoverPart, false, hc, "thin");
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const bx = bbX1 + 8 + i * 8;
    if (bx > bbX2 - 4) break;
    ctx.moveTo(TX(bx), TY(dCy - floorHalf + 6));
    ctx.lineTo(TX(bx), TY(dCy - bodyHalf - 2));
    ctx.moveTo(TX(bx), TY(dCy + floorHalf - 6));
    ctx.lineTo(TX(bx), TY(dCy + bodyHalf + 2));
  }
  ctx.stroke();
  ctx.restore();

  // ════════════════════════════════════════════════════════════════
  // LAYER 10: COCKPIT (drawn AFTER powertrain so wins overlap)
  // ════════════════════════════════════════════════════════════════
  const cockpitCx = (cockpitX1 + cockpitX2) / 2;
  ctx.save();
  _carPartStroke(ctx, "cockpit", hoverPart, false, hc, "bold");
  // Cockpit tub
  ctx.strokeRect(TX(cockpitX1), TY(dCy - bodyHalf + 2),
                 SW(cockpitX2 - cockpitX1), SH(bodyHalf * 2 - 4));
  // Halo (outer ellipse)
  ctx.beginPath();
  ctx.ellipse(TX(cockpitCx), cy, SW(16), SH(12), 0, 0, Math.PI * 2);
  ctx.stroke();
  // Halo inner
  _carPartStroke(ctx, "cockpit", hoverPart, false, hc, "med");
  ctx.beginPath();
  ctx.ellipse(TX(cockpitCx), cy, SW(14), SH(10), 0, 0, Math.PI * 2);
  ctx.stroke();
  // Halo Y-strut forward
  _carPartStroke(ctx, "cockpit", hoverPart, false, hc, "bold");
  ctx.strokeRect(TX(cockpitCx + 12), TY(dCy - 2), SW(10), SH(4));
  // Halo aft mounts
  _carPartStroke(ctx, "cockpit", hoverPart, false, hc, "med");
  ctx.beginPath();
  ctx.moveTo(TX(cockpitCx - 12), TY(dCy - 5));
  ctx.lineTo(TX(cockpitCx - 18), TY(dCy - 8));
  ctx.moveTo(TX(cockpitCx - 12), TY(dCy + 5));
  ctx.lineTo(TX(cockpitCx - 18), TY(dCy + 8));
  ctx.stroke();
  // Helmet
  _carPartStroke(ctx, "cockpit", hoverPart, false, hc, "bold");
  ctx.beginPath();
  ctx.ellipse(TX(cockpitCx), cy, SW(9), SH(7), 0, 0, Math.PI * 2);
  ctx.stroke();
  // Visor (dark band)
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.85)";
  ctx.fillRect(TX(cockpitCx - 5), TY(dCy - 2), SW(10), SH(4));
  ctx.restore();
  ctx.strokeRect(TX(cockpitCx - 5), TY(dCy - 2), SW(10), SH(4));
  // Steering wheel
  ctx.strokeRect(TX(cockpitCx - 7), TY(dCy + 10), SW(14), SH(3));
  ctx.restore();

  // ════════════════════════════════════════════════════════════════
  // LAYER 11: NOSE (S-ducts + car number)
  // ════════════════════════════════════════════════════════════════
  ctx.save();
  _carPartStroke(ctx, "nose", hoverPart, false, hc, "bold");
  // S-duct nostrils
  ctx.beginPath();
  ctx.ellipse(TX(noseBaseX + 38), TY(dCy - 2.5), SW(3), SH(1.2), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(TX(noseBaseX + 38), TY(dCy + 2.5), SW(3), SH(1.2), 0, 0, Math.PI * 2);
  ctx.stroke();
  // Car number badge
  ctx.strokeRect(TX(noseBaseX + 58), TY(dCy - 4), SW(14), SH(8));
  ctx.restore();
  textRaw("01", TX(noseBaseX + 65), TY(dCy + 2), 8,
    hoverPart === "nose" ? "#bfffd0" : "#5dff7a", "900", "center", true);

  // ════════════════════════════════════════════════════════════════
  // LAYER 12: FRONT SUSPENSION (4 arms per side)
  // ════════════════════════════════════════════════════════════════
  ctx.save();
  _carPartStroke(ctx, "suspension", hoverPart, false, hc, "bold");
  const susTopFrom = noseBaseX + 78;
  const susBotFrom = noseBaseX + 96;
  ctx.beginPath();
  ctx.moveTo(TX(susTopFrom), TY(dCy - bodyHalf - 2));
  ctx.lineTo(TX(frontWheelCx - 8), TY(dCy - trackHalf + 10));
  ctx.moveTo(TX(susBotFrom), TY(dCy - bodyHalf));
  ctx.lineTo(TX(frontWheelCx + 8), TY(dCy - trackHalf + 10));
  ctx.moveTo(TX(susTopFrom), TY(dCy + bodyHalf + 2));
  ctx.lineTo(TX(frontWheelCx - 8), TY(dCy + trackHalf - 10));
  ctx.moveTo(TX(susBotFrom), TY(dCy + bodyHalf));
  ctx.lineTo(TX(frontWheelCx + 8), TY(dCy + trackHalf - 10));
  ctx.stroke();
  _carPartStroke(ctx, "suspension", hoverPart, false, hc, "med");
  ctx.beginPath();
  ctx.moveTo(TX(susTopFrom), TY(dCy - bodyHalf));
  ctx.lineTo(TX(frontWheelCx - 8), TY(dCy - trackHalf - 4));
  ctx.moveTo(TX(susBotFrom), TY(dCy - bodyHalf + 2));
  ctx.lineTo(TX(frontWheelCx + 8), TY(dCy - trackHalf - 4));
  ctx.moveTo(TX(susTopFrom), TY(dCy + bodyHalf));
  ctx.lineTo(TX(frontWheelCx - 8), TY(dCy + trackHalf + 4));
  ctx.moveTo(TX(susBotFrom), TY(dCy + bodyHalf - 2));
  ctx.lineTo(TX(frontWheelCx + 8), TY(dCy + trackHalf + 4));
  ctx.stroke();
  ctx.restore();

  // ════════════════════════════════════════════════════════════════
  // LAYER 13: FRONT WING (chevron, ㄑ endplates)
  // ════════════════════════════════════════════════════════════════
  ctx.save();
  _carPartStroke(ctx, "frontWing", hoverPart, false, hc, "bold");
  // Center span
  ctx.strokeRect(TX(noseTipX), TY(dCy - 6), SW(fwX2 - noseTipX - 6), SH(12));
  // 2 pylons
  ctx.strokeRect(TX(noseTipX), TY(dCy - 5), SW(8), SH(3));
  ctx.strokeRect(TX(noseTipX), TY(dCy + 2), SW(8), SH(3));
  // Top cascade
  ctx.beginPath();
  ctx.moveTo(TX(noseTipX),       TY(dCy - 6));
  ctx.lineTo(TX(noseTipX + 14),  TY(dCy - trackHalf + 6));
  ctx.lineTo(TX(fwX2 - 8),       TY(dCy - trackHalf + 6));
  ctx.lineTo(TX(fwX2 - 6),       TY(dCy - 6));
  ctx.closePath();
  ctx.stroke();
  // Bottom cascade
  ctx.beginPath();
  ctx.moveTo(TX(noseTipX),       TY(dCy + 6));
  ctx.lineTo(TX(noseTipX + 14),  TY(dCy + trackHalf - 6));
  ctx.lineTo(TX(fwX2 - 8),       TY(dCy + trackHalf - 6));
  ctx.lineTo(TX(fwX2 - 6),       TY(dCy + 6));
  ctx.closePath();
  ctx.stroke();
  // Cascade flap lines
  _carPartStroke(ctx, "frontWing", hoverPart, false, hc, "med");
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const t = (i + 1) / 4;
    const yTop = dCy - 6 + t * ((dCy - trackHalf + 6) - (dCy - 6));
    ctx.moveTo(TX(noseTipX + 4 + t * 12), TY(yTop));
    ctx.lineTo(TX(fwX2 - 6), TY(yTop));
    const yBot = dCy + 6 + t * ((dCy + trackHalf - 6) - (dCy + 6));
    ctx.moveTo(TX(noseTipX + 4 + t * 12), TY(yBot));
    ctx.lineTo(TX(fwX2 - 6), TY(yBot));
  }
  ctx.stroke();
  // ㄑ endplates
  _carPartStroke(ctx, "frontWing", hoverPart, false, hc, "bold");
  const wingY1 = dCy - trackHalf - 14;
  const wingY2 = dCy - trackHalf + 16;
  const wingY3 = dCy + trackHalf - 16;
  const wingY4 = dCy + trackHalf + 14;
  ctx.beginPath();
  // Top endplate (folded)
  ctx.moveTo(TX(fwX2 - 10), TY(wingY1));
  ctx.lineTo(TX(fwX2),      TY(wingY1 + 8));
  ctx.lineTo(TX(fwX2),      TY(wingY2 + 6));
  ctx.lineTo(TX(fwX2 - 4),  TY(wingY2 + 8));
  // Bottom endplate (mirror)
  ctx.moveTo(TX(fwX2 - 10), TY(wingY4));
  ctx.lineTo(TX(fwX2),      TY(wingY4 - 8));
  ctx.lineTo(TX(fwX2),      TY(wingY3 - 6));
  ctx.lineTo(TX(fwX2 - 4),  TY(wingY3 - 8));
  ctx.stroke();
  // Endplate vertical bars (front edges)
  ctx.strokeRect(TX(fwX2), TY(wingY1 + 8), SW(4), SH((wingY2 + 6) - (wingY1 + 8)));
  ctx.strokeRect(TX(fwX2), TY(wingY3 - 6), SW(4), SH((wingY4 - 8) - (wingY3 - 6)));
  // Endplate louvre slits
  _carPartStroke(ctx, "frontWing", hoverPart, false, hc, "med");
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const ey = wingY1 + 10 + i * 5;
    ctx.moveTo(TX(fwX2),     TY(ey));
    ctx.lineTo(TX(fwX2 + 4), TY(ey));
    const ey2 = wingY3 - 10 + i * 5;
    ctx.moveTo(TX(fwX2),     TY(ey2));
    ctx.lineTo(TX(fwX2 + 4), TY(ey2));
  }
  ctx.stroke();
  ctx.restore();
}

// 俯視輪胎：圓角矩形 + 中央橫線（從上看的輪胎輪廓）
function drawTopWheel(ctx, cx, cy, w, h, hc) {
  ctx.save();
  ctx.shadowColor = hc.glow;
  ctx.shadowBlur = 5;
  ctx.strokeStyle = hc.main;
  ctx.lineWidth = 1.5;
  // 圓角矩形 path
  const r = h * 0.42;
  ctx.beginPath();
  ctx.moveTo(cx - w/2 + r, cy - h/2);
  ctx.lineTo(cx + w/2 - r, cy - h/2);
  ctx.quadraticCurveTo(cx + w/2, cy - h/2, cx + w/2, cy - h/2 + r);
  ctx.lineTo(cx + w/2, cy + h/2 - r);
  ctx.quadraticCurveTo(cx + w/2, cy + h/2, cx + w/2 - r, cy + h/2);
  ctx.lineTo(cx - w/2 + r, cy + h/2);
  ctx.quadraticCurveTo(cx - w/2, cy + h/2, cx - w/2, cy + h/2 - r);
  ctx.lineTo(cx - w/2, cy - h/2 + r);
  ctx.quadraticCurveTo(cx - w/2, cy - h/2, cx - w/2 + r, cy - h/2);
  ctx.closePath();
  ctx.stroke();
  // 中央橫線（輪輻側面 / 胎面紋的暗示）
  ctx.shadowBlur = 0;
  ctx.strokeStyle = hc.dim;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.35, cy);
  ctx.lineTo(cx + w * 0.35, cy);
  ctx.stroke();
  // 兩條輔助胎面紋
  ctx.strokeStyle = fadeColor(hc.main, 0.3);
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.30, cy - h * 0.25);
  ctx.lineTo(cx + w * 0.30, cy - h * 0.25);
  ctx.moveTo(cx - w * 0.30, cy + h * 0.25);
  ctx.lineTo(cx + w * 0.30, cy + h * 0.25);
  ctx.stroke();
  ctx.restore();
}

// ─── 掃描線：垂直方向來回掃過整輛車 ───────────────────────────────
function drawScanLine(x, y, w, h, time, hc) {
  const ctx = app.ctx;
  const period = 3200;
  // tri wave: 0 → 1 → 0 → ...
  const phase = (time % period) / period;
  const t = phase < 0.5 ? phase * 2 : (1 - phase) * 2;  // 0..1..0
  const scanY = y + 8 + (h - 16) * t;

  // 條紋光暈
  ctx.save();
  const grad = ctx.createLinearGradient(0, scanY - 14, 0, scanY + 14);
  const baseColor = hc.main.startsWith("#")
    ? `${hc.main}`
    : "rgba(140, 255, 160, 1)";
  grad.addColorStop(0, fadeColor(baseColor, 0));
  grad.addColorStop(0.5, fadeColor(baseColor, 0.30));
  grad.addColorStop(1, fadeColor(baseColor, 0));
  ctx.fillStyle = grad;
  ctx.fillRect(x + 4, scanY - 14, w - 8, 28);
  // 中央細亮線
  ctx.strokeStyle = fadeColor(baseColor, 0.7);
  ctx.lineWidth = 1;
  ctx.shadowColor = fadeColor(baseColor, 0.6);
  ctx.shadowBlur = 4;
  ctx.beginPath();
  ctx.moveTo(x + 4, scanY);
  ctx.lineTo(x + w - 4, scanY);
  ctx.stroke();
  ctx.restore();
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
    const c8Hidden2 = c8HideMode2 && app.stage2 && app.stage2.revealedC8Lanes && !app.stage2.revealedC8Lanes.has(i);

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
    // 預覽速度不含尾流（跟 BIG speed sign 一致、避免顯示跟警告對不上）
    const b = getLaneBonusFor(i);
    const add = c8Hidden2 ? 0 : (b?.add ?? 0);
    const mult = c8Hidden2 ? 1 : (b?.mult ?? 1);
    let previewSpeed = app.playerSpeed;
    if (i === app.playerLane) {
      const cardSpd = app.drag.card.speedValue ?? 0;
      previewSpeed = Math.floor((app.playerSpeed + cardSpd + add) * mult);
    } else if (droppable && app.playerSpeed > 0) {
      const lanesCrossed = Math.abs(i - app.playerLane);
      const laneCost = laneChangeCost(lanesCrossed);
      previewSpeed = Math.floor((app.playerSpeed - laneCost + add) * mult);
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
  // 教學期間：除了 tryOvertakePress 步、所有按鈕都鎖（防止 event 步玩家亂按）
  const allowsOvertake = tutorialAllowsOvertakeButton();
  const t_ = app.stage2?.tutorial;
  const inTutorial = !!t_?.active;
  const tStep_ = inTutorial ? TUTORIAL_STEPS[t_.stepIndex] : null;
  const inStrictGate = !!tStep_?.strictGate;
  const isFreePlayPhase = (app.mode === "playing" || app.mode === "prompt-overtake-or-pass")
    && !app.inputLocked
    && (!tutorialBlocksGameplay() || inStrictGate);

  if (isFreePlayPhase) {
    const laneSpd = currentLaneSpeed();
    const sameLane = app.playerLane === app.opponentLane;
    const lbl = sameLane ? "先換道才能超車"
              : canDirectOvertake() ? "✓ 超車 QTE"
              : `超車（差 ${app.opponentSpeed - laneSpd}）`;
    // 教學期間：除了 tryOvertakePress、超車鈕都 disabled
    const overtakeDisabled = !canDirectOvertake() || (inTutorial && !allowsOvertake);
    button("btn-overtake", lbl, actualBtnX0, btnY, overtakeW, btnH,
      overtakeDisabled,
      (canDirectOvertake() && !overtakeDisabled) ? "start" : "primary");
    // 緩存超車鈕 rect 給教學 spotlight 用
    app._overtakeBtnRect = { x: actualBtnX0, y: btnY, w: overtakeW, h: btnH };

    // 教學期間：Pass 鈕一律 disabled
    button("btn-pass", "Pass →", actualBtnX0 + overtakeW + btnGap, btnY, passW, btnH,
      inTutorial, "gray");
  } else {
    app._overtakeBtnRect = null;
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
  const s2 = app.stage2;
  const ctx = app.ctx;
  const focusMax = getOpponentFocusMax(opp.id);
  const focusCur = s2.opponentFocusMap[opp.id] ?? 0;
  // 大數據預測不改名條外觀（plate 寬度、label 都跟沒裝備時一樣）
  // 它只影響 ⚡ icon tooltip 內容（描述具體技能）
  // 名條本身永遠用 compact mode
  const hint = computeOpponentNextActionHint("compact");

  // 面板尺寸
  const plateW = 180;
  const nameRowH = 28;            // 名字 + 專注度的高度
  const hintRowH = hint ? 36 : 0; // 預告區高度（有招才顯示）
  const plateH = nameRowH + hintRowH;
  const plateX = redX - plateW / 2;
  const plateY = opponentY - redH / 2 - plateH - 10;

  // 整體底板（兩區共用）
  const isStrong = hint?.weight === "strong";
  // 偵測下回合是否有特殊行動（⚡ 或 🔍）→ 名條外框紅紫脈衝光暈
  const hasEspWarning = hint?.icons?.some(ic => ic === "⚡" || ic === "🔍");
  // Phase 4 企業壓制：BOSS 在壓制狀態時、名條外框紅色強脈衝
  const isSuppressed = opp.id === "BOSS" && s2?.boss?.suppressionActive;
  const borderColor = focusCur === 0
    ? "rgba(100,255,160,0.75)"
    : isSuppressed
      ? "rgba(255,80,100,1)"        // 紅色：企業壓制最高優先
      : hasEspWarning
        ? "rgba(255,120,200,0.95)"   // 紅紫：⚡ 預警次之
        : isStrong
          ? "rgba(255,120,120,0.85)"
          : "rgba(220,80,60,0.75)";

  ctx.save();
  // 光暈優先級：企業壓制 > ⚡ 特殊行動 > 強招 > 一般
  if (isSuppressed) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.012);
    ctx.shadowColor = `rgba(255, 60, 80, ${0.9 * pulse})`;
    ctx.shadowBlur = 28;
  } else if (hasEspWarning) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.008);
    ctx.shadowColor = `rgba(255, 80, 200, ${0.75 * pulse})`;
    ctx.shadowBlur = 22;
  } else if (isStrong) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.008);
    ctx.shadowColor = `rgba(255, 80, 80, ${0.6 * pulse})`;
    ctx.shadowBlur = 18;
  }
  ctx.fillStyle = "rgba(6,12,24,0.92)";
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = isSuppressed ? 2.5 : (hasEspWarning ? 2 : 1.5);
  ctx.beginPath();
  ctx.roundRect(plateX, plateY, plateW, plateH, 8);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();

  // 企業壓制狀態：名條上方 +5px 處印「壓制中」紅色小標籤
  if (isSuppressed) {
    const tagW = 62, tagH = 16;
    const tagX = plateX + plateW - tagW - 6;
    const tagY = plateY - tagH - 2;
    ctx.save();
    ctx.fillStyle = "rgba(255, 50, 80, 0.92)";
    ctx.shadowColor = "rgba(255, 60, 80, 0.8)";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.roundRect(tagX, tagY, tagW, tagH, 3);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
    text("壓制中", tagX + tagW / 2, tagY + tagH - 4, 10,
      "rgba(255, 255, 255, 0.95)", "900", "center");
  }

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
  // 光環狀態指示（B 清道夫專用）— 標籤位置用 measureText 精算 + 多 8px gap
  app._opponentAuraTagRect = null;
  if (isOpponentAuraActive()) {
    const auraText = app.opponentAuraBypassed ? "✦光環(豁免)" : "✦光環";
    const auraColor = app.opponentAuraBypassed
      ? "rgba(255,200,100,0.95)"
      : "rgba(255,140,200,0.95)";
    ctx.save();
    ctx.font = `900 ${14 * FONT_SCALE}px system-ui, "Microsoft JhengHei", sans-serif`;
    const nameWidth = ctx.measureText(opp.name).width;
    ctx.font = `800 ${10 * FONT_SCALE}px system-ui, sans-serif`;
    const auraW = ctx.measureText(auraText).width;
    ctx.restore();
    const auraX = plateX + 14 + nameWidth + 10;
    text(auraText, auraX, nameY + 18, 10, auraColor, "800", "left");
    // 記錄 rect 供 hover tooltip
    app._opponentAuraTagRect = {
      x: auraX - 3,
      y: nameY + 4,
      w: auraW + 6,
      h: 20,
      bypassed: !!app.opponentAuraBypassed,
    };
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
  // 滑鼠 hover 光環標籤 → 繪製光環說明 tooltip
  if (app.mouse && app._opponentAuraTagRect &&
      inRect(app.mouse, app._opponentAuraTagRect)) {
    drawAuraTooltip(app._opponentAuraTagRect);
  }
}

// 找出下回合會觸發的「特殊」行為、組成 title + desc（大數據預測 tooltip 用）
// 包括：boost / boostAfter / bypassAura / absBonus 跟 passive 的 espionage
function describeSpecialActionsThisTurn() {
  if (!app.opponentBehaviors || !app.opponentBehaviorLastTriggered) return null;
  const actN = app.actionsThisRound ?? 0;
  // 收集下動會觸發、且帶有特殊效果的 behavior
  const items = [];
  for (const b of app.opponentBehaviors) {
    const lastAt = app.opponentBehaviorLastTriggered[b.id] ?? -Infinity;
    const rem = Math.max(1, getEffectiveCooldown(b) - (actN - lastAt));
    if (rem !== 1) continue;
    if (b.action === "espionage") {
      const pct = Math.round(getEffectiveEspionageRatio() * 100);
      items.push({
        name: "企業間諜",
        desc: `對手抽走玩家下動每個速度來源的 ${pct}%（依績效調整、正負皆轉嫁）`,
      });
    } else if (b.action === "performanceReview") {
      items.push({
        name: "績效考核",
        desc: `評分當前任務、派發新任務`,
      });
    } else if (b.action === "boost") {
      items.push({ name: "加速", desc: `對手加速 +${b.amount || 1}` });
    } else if (b.boostAfter) {
      items.push({ name: "加速", desc: `切道後加速 +${b.boostAfter}` });
    } else if (b.bypassAura) {
      items.push({ name: "豁免光環", desc: "本動豁免自身光環、吃道路加成" });
    } else if (b.absBonus) {
      items.push({ name: "取 abs", desc: "本道加成取絕對值（永遠拿正）" });
    }
  }
  if (items.length === 0) return null;
  if (items.length === 1) {
    return { title: items[0].name, desc: items[0].desc };
  }
  return {
    title: items.map(i => i.name).join(" + "),
    desc: items.map(i => i.desc).join("、"),
  };
}

// 按 icon 對應「下動就會發生」的特殊行為描述（單一 icon、不合併）
//   icon: "⚡" → espionage / "🔍" → performanceReview / 其他 → null
//   expanded: true → 帶具體數字（%、機制細節）／ false → 僅顯示招式名 + 簡短說明
function describeSpecialActionByIcon(icon, expanded = false) {
  if (!app.opponentBehaviors || !app.opponentBehaviorLastTriggered) return null;
  const actN = app.actionsThisRound ?? 0;
  for (const b of app.opponentBehaviors) {
    const lastAt = app.opponentBehaviorLastTriggered[b.id] ?? -Infinity;
    const rem = Math.max(1, getEffectiveCooldown(b) - (actN - lastAt));
    if (rem !== 1) continue;
    if (icon === "⚡" && b.action === "espionage") {
      if (expanded) {
        const pct = Math.round(getEffectiveEspionageRatio() * 100);
        return {
          title: "企業間諜",
          desc: `對手抽走玩家下動每個速度來源的 ${pct}%（正負皆轉嫁）`,
        };
      }
      return {
        title: "企業間諜",
        desc: "對手會抽走玩家下動每個速度來源",
      };
    }
    if (icon === "🔍" && b.action === "performanceReview") {
      return {
        title: "績效考核",
        desc: "本動結束評分當前任務、派發新任務",
      };
    }
  }
  return null;
}

// 預測對手下動的目標道（給 ⛔/💨 tooltip 顯示確切道號用）
// 找出下動會觸發的 move behavior、用 dispatcher 同一套邏輯算 lane
// 隨機 tie-break 部分快取於 app.stage2._opponentLanePrediction（同個 actN + behaviorId 不重算）
function predictOpponentMoveLane() {
  if (!app.opponentBehaviors || !app.opponentBehaviorLastTriggered) return null;
  const actN = app.actionsThisRound ?? 0;
  for (const b of app.opponentBehaviors) {
    if (b.action !== "moveSmart" && b.action !== "moveTo") continue;
    const lastAt = app.opponentBehaviorLastTriggered[b.id] ?? -Infinity;
    if (actN - lastAt < getEffectiveCooldown(b)) continue;
    // 快取命中（同個 actN + 同個 behavior）→ 用上次算的、避免隨機 tie-break 每 frame 跳
    const cache = app.stage2?._opponentLanePrediction;
    if (cache && cache.actN === actN && cache.behaviorId === b.id) {
      return cache.lane;
    }
    // 計算 lane
    let lane;
    if (b.action === "moveTo") {
      lane = (b.target === "playerLane") ? app.playerLane : b.target;
    } else {
      lane = pickSmartLaneForOpponent(b.strategy, b.bypassAura);
    }
    if (app.stage2) {
      app.stage2._opponentLanePrediction = { actN, behaviorId: b.id, lane };
    }
    return lane;
  }
  return null;
}

// 對手意圖 icon tooltip
function drawOpponentIconTooltip(rect, plateX, plateY) {
  const ctx = app.ctx;
  let title = "";
  let desc = "";
  const hasBigData = app.stage2?.teamCardsActive?.some(c => c.effect === "showOpponent");
  if (rect.icon === "⛔") {
    title = "阻擋";
    if (hasBigData) {
      desc = `對手會切到道 ${app.playerLane + 1}（你的道）`;
    } else {
      desc = "對手會移動到你當前的道";
    }
  } else if (rect.icon === "💨") {
    title = "遠離";
    if (hasBigData) {
      const lane = predictOpponentMoveLane();
      desc = (lane != null)
        ? `對手會切到道 ${lane + 1}、避開你`
        : "對手會避開你當前的道";
    } else {
      desc = "對手會避開你當前的道";
    }
  } else if (rect.icon === "❓") {
    title = "未知";
    desc = "對手選自己最快路線、或隨機切道，無法預測";
  } else if (rect.icon === "❗") {
    title = "賽道干擾";
    desc = "對手原意圖可能被賽道機制打亂、結果不確定";
  } else if (rect.icon === "⚡" || rect.icon === "🔍") {
    // 即使沒大數據、仍顯示招式名稱（desc 是否帶具體數字、依 bigData）
    const detail = describeSpecialActionByIcon(rect.icon, hasBigData);
    if (detail) {
      title = detail.title;
      desc = detail.desc;
    } else {
      title = "特殊行動";
      desc = "對手準備特殊行動……";
    }
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

// 清道夫光環 hover tooltip
function drawAuraTooltip(rect) {
  const ctx = app.ctx;
  const bypassed = !!rect.bypassed;
  const title = "清道夫光環";
  const lines = bypassed
    ? [
        "對手所在道：加成全部失效（含玩家進入此道）。",
        "本動：對手豁免自己的光環（強招）。",
      ]
    : [
        "對手所在道：玩家道路加乘失效、無法獲得尾流。",
      ];

  const padX = 12;
  const padY = 10;
  const titleSize = 13;
  const descSize = 11;
  const lineH = descSize * 1.6;

  // 量寬
  ctx.save();
  ctx.font = `900 ${titleSize * FONT_SCALE}px system-ui, "Microsoft JhengHei", sans-serif`;
  let maxW = ctx.measureText(title).width;
  ctx.font = `600 ${descSize * FONT_SCALE}px system-ui, "Microsoft JhengHei", sans-serif`;
  for (const ln of lines) {
    maxW = Math.max(maxW, ctx.measureText(ln).width);
  }
  ctx.restore();

  const tipW = maxW + padX * 2;
  const tipH = padY * 2 + titleSize + 4 + lines.length * lineH;

  let tx = rect.x + rect.w / 2 - tipW / 2;
  let ty = rect.y - tipH - 6;
  if (tx < 8) tx = 8;
  if (tx + tipW > app.w - 8) tx = app.w - tipW - 8;
  if (ty < 8) ty = rect.y + rect.h + 6;

  // 背景：粉紅邊框（跟標籤色一致、稍暗）
  const borderColor = bypassed
    ? "rgba(255,200,100,0.75)"
    : "rgba(255,140,200,0.75)";
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 8;
  ctx.fillStyle = "rgba(20,14,28,0.96)";
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(tx, ty, tipW, tipH, 6);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // 標題
  text(title, tx + padX, ty + padY + titleSize, titleSize,
    bypassed ? "rgba(255,210,140,0.98)" : "rgba(255,180,220,0.98)", "900", "left");
  // 描述（多行）
  for (let i = 0; i < lines.length; i++) {
    text(lines[i], tx + padX, ty + padY + titleSize + 8 + (i + 1) * lineH - 4,
      descSize, "rgba(220,230,250,0.92)", "600", "left");
  }
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
      const rem = Math.max(1, getEffectiveCooldown(b) - (actN - lastAt));
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
  const playerRef = (isStage2() && app.playerLaneBeforeAction != null)
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
      const slipstreamConsumed = app.stage2?.slipstreamUsed === true;
      intent = slipstreamConsumed ? "block" : "flee";
    } else {
      intent = "unknown";  // bestForSelf：看當下道路、不確定
    }
  } else if (nextAct.action === "moveAdjacent") {
    intent = "unknown";  // 隨機相鄰
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
  // 加上同一回合會同時觸發的 passive behavior icon（例：企業間諜 ⚡）
  // 主要 nextAct 已經被選為「最早觸發」的；找其他同 remaining 的 passive
  if (app.opponentBehaviors && app.opponentBehaviorLastTriggered) {
    const actN = app.actionsThisRound ?? 0;
    for (const b of app.opponentBehaviors) {
      if (b === nextAct) continue;  // 跳過主要的
      const lastAt = app.opponentBehaviorLastTriggered[b.id] ?? -Infinity;
      const rem = Math.max(1, getEffectiveCooldown(b) - (actN - lastAt));
      if (rem !== remaining) continue;  // 不同回合觸發、不疊圖示
      if (b.action === "espionage" && !icons.includes("⚡")) {
        icons.push("⚡");
      }
      if (b.action === "performanceReview" && !icons.includes("🔍")) {
        icons.push("🔍");
      }
    }
  }
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
        const slipstreamConsumed = app.stage2?.slipstreamUsed === true;
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
    // 大數據預測 full mode：同回合若 NCC-7 間諜也觸發、label 補上抽成資訊
    if (app.opponentBehaviors && app.opponentBehaviorLastTriggered) {
      const actN = app.actionsThisRound ?? 0;
      for (const b of app.opponentBehaviors) {
        if (b === nextAct) continue;
        if (b.action !== "espionage") continue;
        const lastAt = app.opponentBehaviorLastTriggered[b.id] ?? -Infinity;
        const rem = Math.max(1, getEffectiveCooldown(b) - (actN - lastAt));
        if (rem === remaining) {
          const pct = Math.round((b.skimRatio ?? 0.5) * 100);
          label = label ? `${label}+間諜抽${pct}%` : `間諜抽${pct}%`;
        }
      }
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
      const rem = Math.max(0, getEffectiveCooldown(b) - (actN - lastAt));
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

  // ── 色系主題（取代舊的左側色線、整張卡背景 + 邊框依色變化）──
  // basic = 維持原本中性藍背景；其他色用該色的暗化版當背景、亮色當邊框
  const COLOR_THEMES = {
    red:    { bg: "rgba(50, 12, 14, 0.96)",   bgDrag: "rgba(58, 14, 16, 0.98)",  border: "rgba(255, 100, 100, 0.85)", label: "rgba(255, 130, 130, 0.95)" },
    black:  { bg: "rgba(18, 18, 22, 0.97)",   bgDrag: "rgba(24, 24, 28, 0.98)",  border: "rgba(170, 170, 200, 0.7)",  label: "rgba(200, 200, 220, 0.95)" },
    yellow: { bg: "rgba(46, 36, 8, 0.96)",    bgDrag: "rgba(54, 42, 10, 0.98)",  border: "rgba(255, 215, 90, 0.85)",  label: "rgba(255, 225, 130, 0.98)" },
    green:  { bg: "rgba(10, 38, 22, 0.96)",   bgDrag: "rgba(12, 44, 26, 0.98)",  border: "rgba(120, 230, 150, 0.85)", label: "rgba(150, 240, 180, 0.98)" },
    blue:   { bg: "rgba(10, 26, 50, 0.96)",   bgDrag: "rgba(12, 30, 58, 0.98)",  border: "rgba(110, 180, 255, 0.85)", label: "rgba(140, 200, 255, 0.98)" },
  };
  let bg, border;
  const theme = card.color ? COLOR_THEMES[card.color] : null;
  if (theme) {
    bg = dragging ? theme.bgDrag : theme.bg;
    border = theme.border;
  } else {
    // basic / 失誤 / 戰術 / 車隊 → 走原本配色
    bg    = dragging   ? "rgba(14,28,50,0.98)"
          : isTactic   ? "rgba(28,18,8,0.96)"
          : isTeam     ? "rgba(14,32,22,0.96)"
          :              "rgba(14,28,50,0.96)";
    border = isTactic   ? "rgba(255,180,60,0.75)"
           : isTeam     ? "rgba(120,220,160,0.75)"
           :              "rgba(105,164,224,0.55)";
  }
  roundPanel(x, y, w, h, 10, bg, border, dragging ? 2.5 : 2);

  // 卡牌類型標籤（指令牌：「X色 ● 動作」、車隊：「車隊」、戰術：「戰術」）
  const COLOR_LABELS = { red: "紅色", black: "黑色", yellow: "黃色", green: "綠色", blue: "藍色" };
  let typeLabel, typeColor;
  if (isTactic) {
    typeLabel = "戰術"; typeColor = "rgba(255,180,60,0.8)";
  } else if (isTeam) {
    typeLabel = "車隊"; typeColor = "rgba(120,220,160,0.85)";
  } else if (theme && COLOR_LABELS[card.color]) {
    typeLabel = `${COLOR_LABELS[card.color]} ‧ 動作`;
    typeColor = theme.label;
  } else {
    // basic 或無色系的指令牌
    typeLabel = "基礎 ‧ 動作";
    typeColor = "rgba(100,180,255,0.7)";
  }
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
  const SCV = window.StoryCanvasViewport;
  // bctx 套 dpr + design transform，跟主 ctx 一致，這樣 drawRace 用 design 座標時才能正確填到整個 canvas
  bctx.setTransform(app.dpr,0,0,app.dpr,0,0);
  if (SCV && app.viewport) SCV.applyDesignTransform(bctx, app.viewport);
  const prev = app.ctx; app.ctx = bctx;
  drawRace(time);
  app.ctx = prev;
  const ctx = app.ctx;
  // 此時主 ctx 已套了 design transform（外層 draw() 套的）。直接用 design 座標 (0,0,app.w,app.h) 畫
  // ⚠ 不再用 setTransform 切到 dpr-only、那會清掉 design transform、讓後續繪製跑掉
  ctx.save();
  ctx.clearRect(0, 0, app.w, app.h);
  ctx.filter = "blur(6px)"; ctx.globalAlpha = 0.96;
  // drawImage source 是整個 backdrop canvas（內部緩衝、像素座標）、dest 是 design (0,0,app.w,app.h)
  ctx.drawImage(app.backdropCanvas,
    0, 0, app.backdropCanvas.width, app.backdropCanvas.height,   // source: 整張 backdrop
    0, 0, app.w, app.h                                            // dest: design 0,0,1920,1080
  );
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
  const box = getCenteredModalBox(460, 440);
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
  button("start-game", "開始遊戲", cx-110, box.y+220*UI_SCALE, 220, 48, false, "start");
  // 測試按鈕區
  text("[ 測試模式 ]", cx, box.y+290*UI_SCALE, 11, "rgba(255,140,180,0.6)", "700", "center");
  button("test-skip-tutorial", "跳過新手教學", cx-90, box.y+302*UI_SCALE, 180, 36, false, "gray");
  button("test-skip-to-boss",  "直接打 NCC-7",   cx-90, box.y+346*UI_SCALE, 180, 36, false, "gray");
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

  // ─── 4. 拖牌到不同車道 → 「棄牌、卡牌效果不觸發」提示
  drawLaneDiscardHint(time);

  // ─── 5. Boss 績效考核 MEMO 紙條（NCC-7 戰鬥中才顯示）──────────────
  drawBossTaskMemo(time);
  // 中央 modal 改在 drawInner 末端繪製、確保覆蓋其他 UI（見 drawInner）
}

// Boss 績效考核 MEMO 紙條 + Buff/Debuff 堆疊指示器
function drawBossTaskMemo(time) {
  if (app.stage2?.currentOpponentId !== "BOSS") return;
  const boss = app.stage2?.boss;
  if (!boss) return;
  // modal 開啟時（含動畫中）不畫 MEMO、避免兩個都同時顯示
  if (app.perfReviewModal?.visible) return;
  const ctx = app.ctx;
  const ct = boss.currentTask;
  // 計算需要幾列
  const lines = [];
  if (ct) {
    const subs = ct.subTasks;
    if (subs.length === 1) {
      const s = subs[0];
      lines.push({
        text: `${s.def.displayText}`,
        progress: `${Math.min(s.progress, s.def.targetN)}/${s.def.targetN}`,
        done: s.progress >= s.def.targetN,
      });
    } else {
      lines.push({ text: ct.def.displayText, header: true });
      for (const s of subs) {
        lines.push({
          text: `　${s.def.displayText}`,
          progress: `${Math.min(s.progress, s.def.targetN)}/${s.def.targetN}`,
          done: s.progress >= s.def.targetN,
        });
      }
    }
  } else {
    lines.push({ text: "（尚未派發任務）", muted: true });
  }
  // 尺寸
  const cx = app.w / 2;
  const boxW = 400;
  const lineH = 22;
  const headerH = 26;
  const stackRowH = 22;
  const padTop = 8;
  const padBot = 8;
  const boxH = headerH + lines.length * lineH + stackRowH + padTop + padBot;
  const boxY = 60;
  // 註冊點擊區（按了 → 開啟 modal、用戶手動展開、無 auto-close）
  app.zones.buttons.push({
    id: "perfreview-memo-expand",
    rect: { x: cx - boxW / 2, y: boxY, w: boxW, h: boxH },
    disabled: false,
  });
  // hover 檢測
  const memoRect = { x: cx - boxW / 2, y: boxY, w: boxW, h: boxH };
  const hovered = app.mouse && inRect(app.mouse, memoRect);
  // 底板：黃色 sticky-note 風（hover 時邊框加亮 + 光暈強化）
  ctx.save();
  ctx.shadowColor = hovered ? "rgba(255, 217, 79, 0.55)" : "rgba(0,0,0,0.5)";
  ctx.shadowBlur = hovered ? 16 : 10;
  ctx.fillStyle = "rgba(28, 22, 12, 0.94)";
  ctx.strokeStyle = hovered ? "rgba(255, 240, 130, 0.95)" : "rgba(255, 217, 79, 0.65)";
  ctx.lineWidth = hovered ? 2 : 1.5;
  ctx.beginPath();
  ctx.roundRect(cx - boxW / 2, boxY, boxW, boxH, 8);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // 標題（左側）+ 倒數（右側）
  text("📋 績效考核", cx - boxW / 2 + 20, boxY + 18, 13,
    "rgba(255, 217, 79, 0.9)", "900", "left");
  const countdown = getPerfReviewCountdown();
  if (countdown !== null && countdown > 0) {
    text(`下一季考核：${countdown} 動後`, cx + boxW / 2 - 20, boxY + 18, 11,
      "rgba(220, 200, 140, 0.7)", "700", "right");
  } else if (countdown === 0) {
    text(`下次考核：本動觸發`, cx + boxW / 2 - 20, boxY + 18, 11,
      "rgba(255, 180, 100, 0.95)", "800", "right");
  }
  // 分隔線
  ctx.save();
  ctx.strokeStyle = "rgba(255, 217, 79, 0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - boxW / 2 + 20, boxY + 26);
  ctx.lineTo(cx + boxW / 2 - 20, boxY + 26);
  ctx.stroke();
  ctx.restore();
  // 任務列
  let lineY = boxY + headerH + padTop + 8;
  for (const ln of lines) {
    const color = ln.muted ? "rgba(180, 170, 140, 0.6)"
                : ln.done  ? "rgba(140, 255, 160, 0.95)"
                : ln.header? "rgba(255, 220, 130, 0.95)"
                :            "rgba(245, 235, 210, 0.95)";
    const weight = ln.header ? "900" : "700";
    text(ln.text, cx - boxW / 2 + 20, lineY, 12, color, weight, "left");
    if (ln.progress) {
      text(ln.progress, cx + boxW / 2 - 20, lineY, 12,
        ln.done ? "rgba(140, 255, 160, 0.95)" : "rgba(245, 235, 210, 0.85)",
        "900", "right");
    }
    lineY += lineH;
  }
  // Buff / Debuff 堆疊指示器（底部一列、3 顆點）
  const stackY = boxY + boxH - padBot - 12;
  const isBuff = boss.buffStacks > 0;
  const isDebuff = boss.debuffStacks > 0;
  const stacks = isBuff ? boss.buffStacks : boss.debuffStacks;
  const dotSpacing = 22;
  const totalW = dotSpacing * 2;
  const startX = cx - totalW / 2;
  const stackLabel = isBuff ? "達標 +Buff" : isDebuff ? "未達標 +Debuff" : "—";
  const stackColor = isBuff ? "rgba(140, 255, 160, 0.95)"
                   : isDebuff ? "rgba(255, 130, 130, 0.95)"
                   : "rgba(120, 120, 120, 0.4)";
  for (let i = 0; i < 3; i++) {
    const active = i < stacks;
    ctx.save();
    ctx.fillStyle = active ? stackColor : "rgba(100, 100, 100, 0.25)";
    if (active) {
      ctx.shadowColor = stackColor;
      ctx.shadowBlur = 6;
    }
    ctx.beginPath();
    ctx.arc(startX + i * dotSpacing, stackY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (isBuff || isDebuff) {
    text(stackLabel, startX + totalW + 18, stackY + 4, 11, stackColor, "800", "left");
  }
  // hover 提示「點擊展開」
  if (hovered) {
    text("點擊展開詳細資訊 ▾", cx, boxY + boxH + 14, 10,
      "rgba(255, 217, 79, 0.85)", "700", "center");
  }
}

// ─── 中央 modal：考核啟動 / 達標 / 未達標 完整資訊 ─────────────────────
// 內容：事件標題 / 副標、長官評語、當前任務、考核紀錄、倒數 + 車手心理、縮小按鈕
// 動畫：開啟時從 MEMO 位置滑下（ease-out cubic）+ 淡入；縮小時往上滑回（ease-in）+ 淡出
function drawPerfReviewModal(time) {
  const modal = app.perfReviewModal;
  if (!modal || !modal.visible) return;
  if (app.stage2?.currentOpponentId !== "BOSS") return;
  const boss = app.stage2?.boss;
  if (!boss) return;

  // ─── 動畫狀態 ─────────────────────────────────────────
  const ANIM_DUR = 280;
  const stateElapsed = performance.now() - modal.stateStart;
  let animProgress;
  if (modal.state === "opening") {
    animProgress = Math.min(1, stateElapsed / ANIM_DUR);
    if (animProgress >= 1) modal.state = "open";
  } else if (modal.state === "closing") {
    animProgress = Math.max(0, 1 - stateElapsed / ANIM_DUR);
    if (animProgress <= 0) {
      modal.visible = false;
      modal.state = "closed";
      return;
    }
  } else {
    animProgress = 1;
    // 已不再 auto-close、open 狀態純等用戶互動
  }
  const eased = modal.state === "closing"
    ? animProgress * animProgress * animProgress       // ease-in（往上滑回）
    : 1 - Math.pow(1 - animProgress, 3);                // ease-out（往下滑入）

  // 取最近一筆考核結果（決定標題樣式）
  // evalHistory 用 push 寫入、最新在陣列尾端
  const lastEval = boss.evalHistory[boss.evalHistory.length - 1];
  const isFirst = !lastEval;
  let title, subtitle, titleColor, accentColor, bgGlow;
  if (isFirst) {
    title = "📋 績效考核啟動";
    subtitle = "霓虹道路株式會社 — KPI 評估體系";
    titleColor = "rgba(255, 217, 79, 1)";
    accentColor = "rgba(255, 217, 79, 0.85)";
    bgGlow = "rgba(220, 180, 60, 0.55)";
  } else if (lastEval.passed) {
    title = "✅ 績效達標";
    subtitle = "車手達成 KPI、企業議會表示認可";
    titleColor = "rgba(140, 255, 160, 1)";
    accentColor = "rgba(140, 255, 160, 0.85)";
    bgGlow = "rgba(80, 220, 120, 0.55)";
  } else {
    title = "✗ 績效未達標";
    subtitle = "車手未能達成 KPI、企業議會表示失望";
    titleColor = "rgba(255, 130, 130, 1)";
    accentColor = "rgba(255, 130, 130, 0.85)";
    bgGlow = "rgba(220, 80, 80, 0.55)";
  }

  // 尺寸與位置
  const modalW = 560;
  const modalH = 500;
  const memoY = 60;
  const finalY = (app.h - modalH) / 2;
  const my = memoY + (finalY - memoY) * eased;
  const mx = (app.w - modalW) / 2;
  // 儲存當前 modal 矩形給 click-outside 判定用
  modal.bounds = { x: mx, y: my, w: modalW, h: modalH };
  const ctx = app.ctx;

  // 半透明背景遮罩
  ctx.save();
  ctx.fillStyle = `rgba(0, 0, 0, ${0.35 * eased})`;
  ctx.fillRect(0, 0, app.w, app.h);
  ctx.restore();

  // Modal 底板
  ctx.save();
  ctx.globalAlpha = eased;
  ctx.shadowColor = bgGlow;
  ctx.shadowBlur = 32;
  ctx.fillStyle = "rgba(12, 16, 26, 0.98)";
  ctx.strokeStyle = titleColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(mx, my, modalW, modalH, 14);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();

  // 動畫進行中、避免畫面閃爍：早期 opening 跟所有 closing 都只畫底板
  if (modal.state === "opening" && animProgress < 0.55) return;
  if (modal.state === "closing") return;

  // 縮小按鈕（右上角）— 只在 open 狀態註冊點擊
  const btnW = 70, btnH = 28;
  const btnX = mx + modalW - btnW - 14;
  const btnY = my + 14;
  if (modal.state === "open") {
    app.zones.buttons.push({
      id: "perfreview-modal-collapse",
      rect: { x: btnX, y: btnY, w: btnW, h: btnH },
      disabled: false,
    });
  }
  const collapseHovered = modal.state === "open"
    && app.mouse && inRect(app.mouse, { x: btnX, y: btnY, w: btnW, h: btnH });
  ctx.save();
  ctx.fillStyle = collapseHovered ? "rgba(70, 76, 88, 0.95)" : "rgba(50, 56, 70, 0.8)";
  ctx.strokeStyle = "rgba(190, 198, 210, 0.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(btnX, btnY, btnW, btnH, 6);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  text("▴ 縮小", btnX + btnW / 2, btnY + btnH / 2 + 4, 12,
    "rgba(220, 230, 245, 0.95)", "800", "center");

  // ─── 內容區 ─────────────────────────────────────────
  let cy = my + 32;
  text(title, mx + modalW / 2, cy + 24, 28, titleColor, "900", "center");
  cy += 38;
  text(subtitle, mx + modalW / 2, cy + 14, 13, accentColor, "700", "center");
  cy += 28;
  drawModalDivider(mx, modalW, cy);
  cy += 14;
  // ─ NCC-7 評估部備註（移到上方）─
  text("NCC-7 評估部備註", mx + 28, cy + 14, 11,
    "rgba(180, 195, 220, 0.7)", "800", "left");
  cy += 22;
  text(`「${boss.lastCommentary || "（無）"}」`, mx + 28, cy + 14, 14,
    "rgba(230, 215, 175, 0.95)", "700", "left");
  cy += 32;
  drawModalDivider(mx, modalW, cy);
  cy += 14;
  // ─ 考核項目 ─
  const categoryName = (() => {
    if (!boss.currentTask) return null;
    const t = boss.currentTask.def.type;
    return ({
      move: "移動", resource: "資源", tactic: "戰術",
      output: "產出", combat: "戰鬥", combo: "多重任務",
    })[t] || t;
  })();
  const itemHeader = categoryName
    ? `📌 考核項目:${categoryName}`
    : `📌 考核項目`;
  text(itemHeader, mx + 28, cy + 14, 11,
    "rgba(180, 195, 220, 0.7)", "800", "left");
  cy += 22;
  if (boss.currentTask) {
    const ct = boss.currentTask;
    if (ct.subTasks.length === 1) {
      const s = ct.subTasks[0];
      const prog = `${Math.min(s.progress, s.def.targetN)}/${s.def.targetN}`;
      const done = s.progress >= s.def.targetN;
      text(s.def.displayText, mx + 28, cy + 14, 14,
        done ? "rgba(140, 255, 160, 0.95)" : "rgba(245, 235, 210, 0.95)", "700", "left");
      text(prog, mx + modalW - 28, cy + 14, 14,
        done ? "rgba(140, 255, 160, 0.95)" : "rgba(245, 235, 210, 0.85)", "900", "right");
      cy += 22;
    } else {
      text(ct.def.displayText, mx + 28, cy + 14, 13,
        "rgba(255, 220, 130, 0.95)", "900", "left");
      cy += 22;
      for (const s of ct.subTasks) {
        const prog = `${Math.min(s.progress, s.def.targetN)}/${s.def.targetN}`;
        const done = s.progress >= s.def.targetN;
        text(`　${s.def.displayText}`, mx + 28, cy + 14, 13,
          done ? "rgba(140, 255, 160, 0.95)" : "rgba(245, 235, 210, 0.95)", "700", "left");
        text(prog, mx + modalW - 28, cy + 14, 13,
          done ? "rgba(140, 255, 160, 0.95)" : "rgba(245, 235, 210, 0.85)", "900", "right");
        cy += 22;
      }
    }
  } else {
    text("（無任務）", mx + 28, cy + 14, 13, "rgba(180, 170, 140, 0.6)", "700", "left");
    cy += 22;
  }
  cy += 6;
  drawModalDivider(mx, modalW, cy);
  cy += 14;
  // ─ 下季考核（字大一點）+ 車手心理 ─
  const cd = getPerfReviewCountdown();
  let cdText = "";
  if (cd !== null && cd > 0) cdText = `下季考核:${cd} 動後`;
  else if (cd === 0) cdText = "下次考核:本動觸發";
  if (cdText) {
    text(cdText, mx + 28, cy + 18, 16,
      "rgba(255, 220, 130, 0.95)", "900", "left");
    cy += 26;
  }
  const mood = getDriverMoodDescription();
  if (mood) {
    text(mood.line, mx + 28, cy + 14, 13, mood.color, "700", "left");
    cy += 22;
  }
  cy += 6;
  drawModalDivider(mx, modalW, cy);
  cy += 14;
  // ─ 考核紀錄（往下長、舊→新）─
  text("📚 考核紀錄", mx + 28, cy + 14, 11,
    "rgba(180, 195, 220, 0.7)", "800", "left");
  cy += 22;
  if (boss.evalHistory.length === 0) {
    text("（暫無紀錄）", mx + 28, cy + 14, 12, "rgba(180, 170, 140, 0.5)", "700", "left");
    cy += 20;
  } else {
    for (const h of boss.evalHistory) {
      const sym = h.passed ? "✓" : "✗";
      const symColor = h.passed ? "rgba(140, 255, 160, 0.95)" : "rgba(255, 130, 130, 0.95)";
      text(sym, mx + 28, cy + 14, 13, symColor, "900", "left");
      text(h.taskDisplay, mx + 50, cy + 14, 12,
        "rgba(220, 225, 240, 0.85)", "700", "left");
      if (h.evalNumber != null) {
        text(`第 ${h.evalNumber} 次考核`, mx + modalW - 28, cy + 14, 11,
          "rgba(180, 195, 220, 0.65)", "700", "right");
      }
      cy += 20;
    }
  }
}

// modal 區間分隔線
function drawModalDivider(mx, modalW, y) {
  const ctx = app.ctx;
  ctx.save();
  ctx.strokeStyle = "rgba(180, 195, 220, 0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(mx + 28, y);
  ctx.lineTo(mx + modalW - 28, y);
  ctx.stroke();
  ctx.restore();
}

// ─── 企業壓制啟動橫幅（Phase 4）──────────────────────────────────────
// 在 BOSS 第一次 QTE 被破（focus 2→1）時觸發、紅色震撼風
// 持續 3.5 秒、淡入 0.1 / 持續 0.7 / 淡出 0.2
function showSuppressionBanner() {
  app.suppressionBanner = {
    startTime: performance.now(),
    duration: 3500,
  };
}

function drawSuppressionBanner(time) {
  if (!app.suppressionBanner) return;
  const b = app.suppressionBanner;
  const elapsed = time - b.startTime;
  if (elapsed > b.duration) {
    app.suppressionBanner = null;
    return;
  }
  const t = elapsed / b.duration;
  let alpha = 1;
  if (t < 0.1) alpha = t / 0.1;
  else if (t > 0.8) alpha = (1 - t) / 0.2;
  alpha = Math.min(1, Math.max(0, alpha));

  const ctx = app.ctx;
  const cx = app.w / 2;
  const cy = app.h / 2;

  // 全屏紅色閃光底
  const flashAlpha = alpha * 0.28 * (1 + Math.sin(time / 110) * 0.35);
  ctx.save();
  ctx.fillStyle = `rgba(255, 50, 80, ${flashAlpha})`;
  ctx.fillRect(0, 0, app.w, app.h);
  ctx.restore();

  // 大號 banner box
  const boxW = 760;
  const boxH = 150;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(255, 60, 80, 0.95)";
  ctx.shadowBlur = 48;
  ctx.fillStyle = "rgba(18, 8, 12, 0.97)";
  ctx.strokeStyle = "rgba(255, 90, 110, 1)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH, 14);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();

  // 標題
  ctx.save();
  ctx.globalAlpha = alpha;
  text("⚠ 企業壓制啟動 ⚠", cx, cy - 20, 38,
    "rgba(255, 110, 130, 1)", "900", "center");
  text("NCC-7 啟動全面監聽模式", cx, cy + 18, 17,
    "rgba(255, 180, 200, 0.95)", "800", "center");
  text("企業間諜頻率倍增、迴避動作每動觸發",
    cx, cy + 44, 13, "rgba(255, 160, 180, 0.85)", "700", "center");
  ctx.restore();
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
  const s2 = app.stage2;

  // 道路頂端的 x 範圍（用 horizon 那條線的路寬均分給各道）
  const bounds = roadLaneBoundsAt(horizon);
  const laneW = (bounds.right - bounds.left) / laneCount;

  // 在 horizon 上方一點（天空區、原本速限的位置）
  const cy = horizon - 40 * UI_SCALE;

  // 第一步：算出每個 lane 要顯示什麼、量出 panel 寬度
  const items = [];
  for (let li = 0; li < laneCount; li++) {
    // 取原始 bonus（不經光環抹平）→ 才看得到內彎 ×1.25 等被光環蓋住的加成
    const b = getLaneBonusFor(li, "player", true);
    // 另外判斷該道是否被光環抑制（用來決定渲染樣式）
    const auraSuppressed = !!(isOpponentAuraActive() && app.opponentLane === li);
    const isHiddenLane = isC8Hidden && s2 && !s2.revealedC8Lanes?.has(li);
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
        // add === 0：標準道顯示「+0」、灰色低調
        mainText = "+0";
        color = "rgba(200,210,225,0.75)";
        glow = "rgba(180,200,220,0.3)";
      }
      // 光環抑制：用灰色 + 加副文「光環抑制」、繪製時會加刪除線
      if (auraSuppressed && mainText) {
        color = "rgba(180,180,190,0.7)";
        glow = "rgba(160,160,180,0.3)";
        subText = "光環抑制";
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
      panelW, panelH, fontSize, auraSuppressed,
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
    // 光環抑制：在主文字上畫刪除線
    if (it.auraSuppressed) {
      const mainW = ctx.measureText(it.mainText).width;
      ctx.shadowBlur = 0;
      ctx.strokeStyle = it.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(it.targetCx - mainW / 2 - 2, itemCy);
      ctx.lineTo(it.targetCx + mainW / 2 + 2, itemCy);
      ctx.stroke();
    }
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
  // c8 紅綠燈未揭曉道：不能把 ?道隱藏的 add/mult 算進預覽（否則洩漏值）
  // 預覽速度不含尾流（混淆玩家、改成只有打牌動作 + 道路明值）
  const circForPreview = currentCircuit();
  const isC8HiddenForPreview = circForPreview?.hideLaneBonusUntilVisited
    && !(app.stage2?.revealedC8Lanes?.has(hoverLane));
  const b = getLaneBonusFor(hoverLane);
  const add = isC8HiddenForPreview ? 0 : (b?.add ?? 0);
  const mult = isC8HiddenForPreview ? 1 : (b?.mult ?? 1);
  let preview;
  if (hoverLane === app.playerLane) {
    const cardSpd = app.drag.card.speedValue ?? 0;
    preview = Math.floor((baseSpeed + cardSpd + add) * mult);
  } else if (baseSpeed > 0) {
    const lanesCrossed = Math.abs(hoverLane - app.playerLane);
    const laneCost = laneChangeCost(lanesCrossed);
    preview = Math.floor((baseSpeed - laneCost + add) * mult);
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

// ── 棄牌換道提示 ───────────────────────────────────────────────
// 已搬到拖曳卡片本身（drawInner 拖曳區塊）；保留函式空殼以兼容呼叫點
function drawLaneDiscardHint(time) {
  return;
}
function _legacyDrawLaneDiscardHint(time) {
  if (!app.drag) return;
  const isDragTeamCard = app.drag.card?.cardClass === "team";
  if (isDragTeamCard) return;  // 車隊牌不算

  const dragCx = app.drag.x + app.drag.w / 2;
  const dragCy = app.drag.y + app.drag.h / 2;

  // 排除：拖回手牌列（取消）或拖到 stability zone（充能尾翼）
  const handTop = app.h - 190 - 60;
  const handBottom = app.h - 190 + 164 + 30;
  if (dragCy >= handTop && dragCy <= handBottom) return;
  if (app.zones.stabilityZone && inRect({ x: dragCx, y: dragCy }, app.zones.stabilityZone)) return;

  // 必須懸停在某一道、且該道不是玩家當前道
  const hoverLane = laneAtPoint({ x: dragCx, y: dragCy });
  if (hoverLane < 0 || hoverLane === app.playerLane) return;

  // ── 道路位置：在速度大字下方一點（速度 t 範圍 0.12–0.26、這裡用 0.34–0.48）
  const ctx = app.ctx;
  const h = app.h;
  const horizon = h * 0.38;
  const laneCount = app.laneCount || 2;

  const tNear = 0.48, tFar = 0.34;
  const yNear = horizon + (h - horizon) * tNear;
  const yFar  = horizon + (h - horizon) * tFar;
  const bNear = roadLaneBoundsAt(yNear);
  const bFar  = roadLaneBoundsAt(yFar);
  const laneWNear = (bNear.right - bNear.left) / laneCount;
  const laneWFar  = (bFar.right  - bFar.left)  / laneCount;
  const cxNear = bNear.left + laneWNear * (hoverLane + 0.5);
  const cxFar  = bFar.left  + laneWFar  * (hoverLane + 0.5);
  const cx = (cxNear + cxFar) / 2;
  const cy = (yNear + yFar) / 2;

  // 投影：跟 drawCurrentSpeedSign 同款，但稍寬一點 yScale 讓字看起來不那麼壓扁
  const xScale = (laneWFar / laneWNear) * 0.85;
  const yScale = 0.30;
  const pulse = 0.78 + Math.sin(time * 0.005) * 0.22;

  ctx.save();
  ctx.globalAlpha = pulse;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.translate(cx, cy);
  ctx.scale(xScale, yScale);

  // 上行：棄牌（亮黃、強調）
  ctx.shadowColor = "rgba(255, 180, 60, 0.7)";
  ctx.shadowBlur = 24;
  ctx.fillStyle = "rgba(255, 210, 90, 0.98)";
  ctx.font = `900 90px system-ui, "Microsoft JhengHei", sans-serif`;
  ctx.fillText("棄牌", 0, -30);

  // 下行：卡牌效果不觸發（白色、較小）
  ctx.shadowColor = "rgba(255, 220, 180, 0.5)";
  ctx.shadowBlur = 16;
  ctx.fillStyle = "rgba(240, 240, 240, 0.92)";
  ctx.font = `800 50px system-ui, "Microsoft JhengHei", sans-serif`;
  ctx.fillText("卡牌效果不觸發", 0, 50);

  ctx.restore();
}
// 左側面板：當前對手 / 後車 / 車隊牌
function drawStage2SidePanel(time) {
  const s2 = app.stage2;
  if (!s2) return;
  const ctx = app.ctx;
  const x = 14;
  const y = 80;
  const w = 240;  // 字體放大後加寬讓標題跟回合計時不重疊
  let curY = y;
  // 估算面板高度：標題 34 + 名次標 22 + 4 列 × 30 + 後車警告 58 + 尾流 22 + 車隊牌
  const rankBlockH = 4 * 26 + 3 * 4;  // = 116
  const teamCardsH = s2.teamCardsActive.length > 0 ? 28 + s2.teamCardsActive.length * 26 : 0;
  const panelH = 16 + 34 + 22 + rankBlockH + 16 + teamCardsH + 80;
  roundPanel(x, y, w, panelH, 12, "rgba(10,18,28,0.88)", "rgba(120,170,220,0.35)", 1.5);
  curY = y + 16;
  text("機制驗證場", x + 14, curY + 14, 17, "rgba(255,220,120,0.85)", "900");
  // 回合計時：顯示「回合 X / MAX」，最後 3 回合時用警示色
  const maxR = s2.maxRounds || 20;
  const curR = Math.min(maxR, Math.max(1, s2.roundsPlayed || 1));
  const roundsLeft = maxR - curR;
  const roundColor = roundsLeft <= 2 ? "rgba(255,140,140,0.95)"
                   : roundsLeft <= 5 ? "rgba(255,210,120,0.9)"
                   :                   "rgba(180,200,230,0.8)";
  text(`回合 ${curR} / ${maxR}`, x + w - 14, curY + 14, 13, roundColor, "800", "right");
  curY += 34;
  // 名次陣容（垂直）
  text("名次", x + 14, curY + 14, 13, "rgba(180,200,230,0.7)", "700");
  curY += 22;
  const rankH = drawRankLineup(x + 14, curY, w - 28, s2);
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
  if (s2.slipstreamUsed) {
    text("💨 尾流已取得（+30 本回合）", x + 14, curY + 14, 12, "rgba(100,220,255,0.85)", "800");
    curY += 22;
  } else if (opp && app.playerLane === app.opponentLane) {
    const slipPulse = 0.5 + Math.sin(performance.now() * 0.008) * 0.5;
    text("💨 同道！尾流 +30 可取得", x + 14, curY + 14, 12, `rgba(100,220,255,${0.6 + slipPulse * 0.4})`, "800");
    curY += 22;
  }
  // 車隊牌列表（每張可 hover）
  if (s2.teamCardsActive.length > 0) {
    curY += 8;
    text("✦ 場上車隊牌：", x + 14, curY + 12, 13, "rgba(150,220,180,0.85)", "800");
    curY += 20;
    // 重設 hover rects 然後逐張畫
    s2._teamCardRects = [];
    for (const c of s2.teamCardsActive) {
      const itemY = curY;
      const itemRect = { x: x + 14, y: itemY, w: w - 28, h: 22, card: c };
      s2._teamCardRects.push(itemRect);
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
    s2._teamCardRects = [];
  }
}


// ─── UI 尺寸選擇器（S / M / L）─────────────────────────────────────────
// 透過 ctx 全局 transform 套用倍率（resize 內處理）、UI 元素整體縮放
// 位置：右上角「下賽段預告框」正下方
// 場上車隊牌 hover tooltip（在最上層繪製）
function drawStage2TeamCardTooltip(time) {
  const s2 = app.stage2;
  if (!s2 || !s2._teamCardRects || s2._teamCardRects.length === 0) return;
  if (!app.mouse) return;
  const hovered = s2._teamCardRects.find(r => inRect(app.mouse, r));
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
function drawRankLineup(x, y, w, s2) {
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
      if (idx >= 0 && idx < s2.ahead.length) {
        fullName = STAGE2_OPPONENTS[s2.ahead[idx]]?.name || s2.ahead[idx];
        color = "#ffb070";
      } else {
        fullName = "?"; color = "rgba(180,140,80,0.5)";
      }
    } else { // pos > playerRank
      // 後方（仍然 active）
      const idx = pos - playerRank - 1;
      if (idx >= 0 && idx < s2.passed.length) {
        fullName = STAGE2_OPPONENTS[s2.passed[idx]]?.name || s2.passed[idx];
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
function drawStage2NextCircuit(time) {
  const s2 = app.stage2;
  if (!s2) return;
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
  // 緩存面板 rect 給教學 spotlight 用
  // currentRowY 是「當前賽段」那行的中心 y、依 innerH 動態
  app._nextCircuitPanelRect = {
    x, y, w, h,
    innerBottom: y + 8 + innerHCalc,  // 黃框底（下一賽段區結束）
    currentRowTop: y + 8 + innerHCalc, // 當前賽段區的頂
  };
  roundPanel(x, y, w, h, 14, "rgba(10,18,28,0.92)", "rgba(120,170,220,0.4)", 1.5);

  if (next) {
    const nextHideBonus = !!next.hideLaneBonusUntilVisited;
    const innerLaneRows = laneRows;  // 跟外框一致
    const innerH = 60 + innerLaneRows * lineH + 12;
    roundPanel(x + 8, y + 8, w - 16, innerH, 10, "rgba(255,200,80,0.08)", "rgba(255,200,80,0.4)", 1.5);
    text("→ 下一賽段", x + 20, y + 26, 11, "rgba(255,200,80,0.8)", "800");
    text(`${next.icon} ${next.name}`, x + 20, y + 52, 22, "rgba(255,225,130,0.98)", "900");
    // 賽段長度顯示在右側（單純數字）
    const nextLen = next.length ?? 2;
    text(`${nextLen}`, x + w - 28, y + 52, 18,
      "rgba(255,200,80,0.85)", "800", "right");
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
    // 當前賽段剩餘動作：右側顯示剩餘數字
    // 教學「賽段長度」步驟時放大 + 變顯眼青藍
    if (cur) {
      const stepsLeft = Math.max(0, s2.circuitStepsLeft ?? (cur.length ?? 2));
      const tStepId = s2.tutorial?.active ? TUTORIAL_STEPS[s2.tutorial.stepIndex]?.id : null;
      const highlight = tStepId === "actionsSegmentCount";
      const size = highlight ? 22 : 14;
      const color = highlight ? "rgba(140,210,255,0.95)" : "rgba(160,180,210,0.65)";
      const weight = highlight ? "900" : "800";
      const yOffset = highlight ? 2 : 0;
      text(`${stepsLeft}`, x + w - 28, cy + yOffset, size, color, weight, "right");
    }
  } else if (cur) {
    text("當前賽段", x + 20, y + 30, 10, "rgba(160,180,210,0.5)", "700");
    text(`${cur.icon} ${cur.name}`, x + 90, y + 30, 15, "rgba(180,200,230,0.75)", "800");
    const stepsLeft = Math.max(0, s2.circuitStepsLeft ?? (cur.length ?? 2));
    const tStepId = s2.tutorial?.active ? TUTORIAL_STEPS[s2.tutorial.stepIndex]?.id : null;
    const highlight = tStepId === "actionsSegmentCount";
    const size = highlight ? 22 : 14;
    const color = highlight ? "rgba(140,210,255,0.95)" : "rgba(160,180,210,0.65)";
    const weight = highlight ? "900" : "800";
    const yOffset = highlight ? 2 : 0;
    text(`${stepsLeft}`, x + w - 28, y + 30 + yOffset, size, color, weight, "right");
  }
}

function drawStage2IntroModal(time) {
  const s2 = app.stage2;
  if (!s2) return;
  const ctx = app.ctx;
  drawRace(time);
  drawHud(time);
  drawCarPartsHud(time);
  drawStage2SidePanel(time);
  drawStage2NextCircuit(time);
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
  button("stage2-intro-ok", "出發", boxX + boxW/2 - 80, boxY + boxH - 50, 160, 38, false, "start");
}

function drawStage2OvertakeResultModal() {
  const pct = app.qteScoreMax > 0 ? app.qteScore / app.qteScoreMax : 0;
  const isPerfect = pct >= 1.0;
  const title = pct >= 1.0  ? "完美超車！"
              : pct >= 0.7  ? "順利超車！"
              : pct >= 0.6  ? "勉強過關"
              : pct >= 0.5  ? "輕度失敗"
              :               "嚴重失敗";
  const titleColor = pct >= 0.6 ? (pct >= 1.0 ? "#ffd94f" : "#7be0a0")
                   : pct >= 0.5 ? "#ffb060" : "#ff8a8a";
  const mistakeCount = app.stage2?.lastMistakeCount ?? 0;
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
  const opp = STAGE2_OPPONENTS[app.stage2?.passed[app.stage2.passed.length-1]];
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
    text(`⚠ 獲得 ${mistakeCount} 張失誤牌`, cx, box.y+162*UI_SCALE, 13, "rgba(255,180,80,0.95)", "800", "center");
  } else if (!isSuccess) {
    text("失敗", cx, box.y+162*UI_SCALE, 13, "rgba(255,150,130,0.9)", "800", "center");
  } else {
    text("無懲罰", cx, box.y+162*UI_SCALE, 13, "rgba(160,200,160,0.7)", "700", "center");
  }
  if (isSuccess) {
    button("stage2-to-reward", "選擇獎勵牌 →", cx - 110, box.y + boxH - 54, 220, 44, false, "start");
  } else {
    button("stage2-next-round", "下一回合 →", cx - 100, box.y + boxH - 54, 200, 42, false, "primary");
  }
}

// 最後一名 Pass：不防守、不扣胎
function drawStage2NoOvertakeModal() {
  const box = getCenteredModalBox(380, 160);
  drawModalPanel(box, "rgba(100,130,180,0.35)");
  const cx = box.x + box.w/2;
  text("Pass", cx, box.y+54*UI_SCALE, 28, "#a0b8e0", "900", "center");
  text("最後一名，無後車追擊", cx, box.y+90*UI_SCALE, 13, "rgba(180,200,230,0.75)", "700", "center");
  button("stage2-next-round", "下一回合 →", cx - 100, box.y+box.h-46*UI_SCALE, 200, 40, false, "primary");
}

// 防守結算
function drawStage2DefenseResultModal() {
  const success = app.message === "防守成功！" || app.message === "後援車隊保住名次！";
  const box = getCenteredModalBox(420, 200);
  drawModalPanel(box, success ? "rgba(120,220,150,0.5)" : "rgba(255,120,120,0.5)");
  const cx = box.x + box.w/2;
  text(app.message || "防守結束", cx, box.y+70*UI_SCALE, 26, success ? "#7be0a0" : "#ff8a8a", "900", "center");
  text(`名次：${app.rank} / ${app.rankTotal}`, cx, box.y+110*UI_SCALE, 14, "rgba(220,240,225,0.85)", "700", "center");
  button("stage2-next-round", "下一回合 →", cx - 100, box.y+box.h-56*UI_SCALE, 200, 42, false, success ? "start" : "primary");
}

// ─── 彎道 QTE（Helldivers 箭頭風格）──────────────────────────────────────
function endBendQte(success) {
  let mistakeCount = 0;
  if (!success) {
    // 失敗：1 張失誤牌進牌庫頂（輪胎機制已移除）
    mistakeCount = 1;
    pushSpeedPop("player", "彎道失誤 +1 失誤牌", "#ff5fa0");
    if (app.stage2) {
      const uid = `bend-mis-${Date.now()}`;
      app.stage2.drawPile.unshift(makeCard("mistake", uid));
    }
  }
  app.bendQteResult = { success, mistakeCount, slippedTo: null };
  app.mode = "bend-qte-result";
  // 教學：彎道 QTE 完成（成功/失敗）→ 推進
  tutorialNotify("bendAttempt");
  // 1.5 秒後自動繼續
  setTimeout(() => {
    if (app.mode === "bend-qte-result") {
      app.mode = "playing";
      // 處理延後的切段（彎道 QTE 觸發時 advanceCircuitOnCard 被擱置）
      if (app.stage2?.pendingCircuitAdvance) {
        app.stage2.pendingCircuitAdvance = false;
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
  const r = app.bendQteResult || { success: false, mistakeCount: 0 };
  const ctx = app.ctx;
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(0, 0, app.w, app.h);
  const extraRows = (r.mistakeCount > 0 ? 1 : 0);
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
    if (r.mistakeCount > 0) {
      text(`獲得 ${r.mistakeCount} 張失誤牌`, cx, line, 13, "rgba(255,200,100,0.85)", "700", "center");
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

// 終點線結束畫面（跑滿 maxRounds 回合觸發）
// 顯示玩家當前名次；第 1 名走勝利風，其餘走中性結算風
function drawStage2FinishLineModal() {
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
function drawStage2RewardModal(time) {
  const s2 = app.stage2;
  if (!s2) return;
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
    const c = s2.rewardOptions[i];
    if (!c) continue;
    const cx0 = startX + i * (cardW + gap);
    const hov = (s2.rewardSlotHover === i);
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
    button(`stage2-reward-pick-${i}`, "選這張", cx0 + 14, cardY + cardH - 56, cardW - 28, 44, false, "start");
  }
  button("stage2-reward-skip", "略過（不拿）", cx - 90, box.y+box.h-58*UI_SCALE, 180, 42, false, "gray");
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
function drawStage2CornerLanePick(time) {
  const ctx = app.ctx;
  // 先畫底層場景
  drawRace(time);
  drawHud(time);
  drawCarPartsHud(time);
  drawStage2SidePanel(time);
  drawStage2NextCircuit(time);
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
  button("stage2-corner-cancel-pick", "不換道", app.w - 130, 26, 110, 36, false, "gray");
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
    ["賽段循環", "每次推進切換下一賽段：直線 / 彎道 / 急彎 / 紅綠燈。"],
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
  // 教學中：只在 tryOvertakeQteStart / recapPress 步開放「開始 QTE」按鈕
  let confirmDisabled = false;
  if (isOvertake) {
    const t = app.stage2?.tutorial;
    if (t?.active) {
      const stepId = TUTORIAL_STEPS[t.stepIndex]?.id;
      if (stepId !== "tryOvertakeQteStart" && stepId !== "recapPress") confirmDisabled = true;
    }
  }
  button(btnId, "開始 QTE", btnX, btnY, btnW, btnH, confirmDisabled, "start");
  // 緩存「開始 QTE」鈕 rect 給教學 spotlight 用（只在 splash-overtake 時）
  if (isOvertake) {
    app._qteStartBtnRect = { x: btnX, y: btnY, w: btnW, h: btnH };
  }
}

// 三種 QTE 共用的難度面板（splash 階段顯示）
//   - overtake: 圓圈數、間隔
//   - defense:  總時長、難度級別
//   - bend:     箭頭數、時限
function drawQteDifficultyPanel(qteType) {
  const ctx = app.ctx;
  const speed = app.playerSpeed;
  const speedComponent = Math.max(0, Math.floor((speed - 10) / 20));
  const laneBonus = getLaneBonusFor(app.playerLane);
  const offset = (laneBonus && typeof laneBonus.qteDifficultyOffset === "number")
    ? laneBonus.qteDifficultyOffset : 0;

  // 空力區（穩定區）：只影響 overtake QTE 的 tier
  const stabCharges = app.stabilityCharges || 0;
  const showStability = (qteType === "overtake") && stabCharges > 0;
  // Boss 績效考核 Buff/Debuff
  const bossBuff = app.stage2?.boss?.buffStacks || 0;
  const bossDebuff = app.stage2?.boss?.debuffStacks || 0;
  const showPerfReview = (qteType === "overtake") && (bossBuff > 0 || bossDebuff > 0);
  // 最終 tier：含空力區 + buff/debuff
  const step = Math.max(0, speedComponent + offset
    - (showStability ? stabCharges : 0)
    - bossBuff + bossDebuff);

  // 道路節奏：本道天然 diff（hard/normal/easy）、不再被 stab 影響
  const laneDiff = currentLaneQteDiff();

  // 各 QTE 的副標（用 step 算最終時間 / 間距）
  let subline = "";
  if (qteType === "overtake") {
    const circleCount = Math.min(10, Math.round(5 * Math.pow(1.10, step)));
    const intervalScale = laneDiff === "easy" ? 1.25 : laneDiff === "hard" ? 0.75 : 1.0;
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

  // 道路節奏只在超車 QTE 顯示
  const showQteDiff = (qteType === "overtake");

  const panelW = 460 * UI_SCALE;
  // 額外列：空力區 + 績效考核（buff/debuff）
  const baseH = showQteDiff ? 220 : 194;
  const extraRows = (showStability ? 1 : 0) + (showPerfReview ? 1 : 0);
  const panelH = (baseH + extraRows * 24) * UI_SCALE;
  const panelX = (app.w - panelW) / 2;
  const panelY = app.h * 0.42;
  // 緩存難度面板 rect 給教學 spotlight 用
  app._qteDifficultyPanelRect = { x: panelX, y: panelY, w: panelW, h: panelH };
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
  const rowY4 = panelY + 216 * UI_SCALE;
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

  // 第 3 列：道路節奏（只有超車 QTE 顯示、顯示本道天然 diff、不再有 stab 過渡）
  if (showQteDiff) {
    const diffLabel = laneDiff === "easy" ? "易（圓圈間距 ×1.25）"
                    : laneDiff === "hard" ? "難（圓圈間距 ×0.75 + 抖動）"
                    : "一般";
    const diffColor = laneDiff === "easy" ? "rgba(140,230,170,0.95)"
                    : laneDiff === "hard" ? "rgba(255,150,140,0.95)"
                    : "rgba(200,215,235,0.85)";
    text(`道路節奏　${diffLabel}`, labelX, rowY3, 12,
      diffColor, "700", "left");
  }

  // 第 4 列：空力區折扣（僅當 overtake 且有 charges）
  // 直接從 tier 扣（不再透過 diff 過渡）
  if (showStability) {
    text(`✦ 空力區　QTE 難度 -${stabCharges}`,
      labelX, rowY4, 12, "rgba(140, 255, 160, 0.95)", "800", "left");
    text(`-${stabCharges}`, valueX, rowY4, 14,
      "rgba(140, 255, 160, 0.95)", "900", "right");
  }
  // 第 5 列：Boss 績效考核 Buff/Debuff
  if (showPerfReview) {
    const rowY5 = rowY4 + (showStability ? 24 : 0) * UI_SCALE;
    const isBuff = bossBuff > 0;
    const stacks = isBuff ? bossBuff : bossDebuff;
    const sign = isBuff ? "-" : "+";
    const label = isBuff ? `✅ 績效考核達標 ×${stacks}` : `✗ 績效考核未達標 ×${stacks}`;
    const color = isBuff ? "rgba(140, 230, 170, 0.95)" : "rgba(255, 130, 130, 0.95)";
    text(`${label}　QTE 難度 ${sign}${stacks}`, labelX, rowY5, 12, color, "800", "left");
    text(`${sign}${stacks}`, valueX, rowY5, 14, color, "900", "right");
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
  // 原本貼底（cy = app.h - 20 - R - 10），現在挪到左下車子部件面板上方
  //   面板上緣 = app.h - 224；pill 底 = 面板上緣 - 8；pill 頂 = cy + R - 18
  //   → cy = (app.h - 224) - 8 - 26 + 18 - R = app.h - 240 - R
  const cx=18+R, cy=app.h - 240 - R;
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
  // 文字真正垂直置中：用 textBaseline="middle"、對中文字較準（alphabetic 對中文會偏上）
  const ctx2 = app.ctx;
  const fontSize = 16;
  ctx2.save();
  ctx2.fillStyle = disabled ? "rgba(216,236,255,0.55)" : (start ? "#fff4d6" : "#d8ecff");
  ctx2.font = `${start ? "1000" : "800"} ${fontSize * FONT_SCALE}px system-ui,"Microsoft JhengHei",sans-serif`;
  ctx2.textAlign = "center";
  ctx2.textBaseline = "middle";
  ctx2.shadowColor = "rgba(0,0,0,0.55)";
  ctx2.shadowBlur = 6;
  ctx2.fillText(label, x + w/2, y + h/2);
  ctx2.restore();
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
  // ── 版本驗證標記（用於確認瀏覽器載入的是哪一版 game.js）
  console.log("%c[Final Driver] game.js loaded · QTE tier formula: (speed - 10) / 20",
    "color:#5dff7a;font-weight:bold;");
  window.__qteTier = (speed) => Math.max(0, Math.floor((speed - 10) / 20));
  window.__gameVersion = "tier-step-20";

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
