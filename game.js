// ─────────────────────────────────────────────
//  Project: New York New York — Playtest v0.3
//  新增：部件系統、耗材輪胎、附贈動作
// ─────────────────────────────────────────────

// ── Tooltip 系統 ──────────────────────────────
const tooltip = {
  el: null,
  init() { this.el = document.getElementById("cardTooltip"); },
  show(e, fc) {
    if (!this.el) return;
    const tc = { complex:"#f05d5e", simple:"#25d17f", info:"#ffcf4d" }[fc.type] || "#aaa";
    const bonusLine = fc.bonus ? `<div class="tt-bonus">附贈：${getBonusName(fc.bonus)}</div>` : "";
    const kwLine = (fc.keywords?.length)
      ? fc.keywords.map(kw => `<div class="tt-kw"><u><b>${kw}</b></u>：${KW_DESC[kw] || ""}</div>`).join("")
      : "";
    const reactionNote = fc.keywords?.includes(KW.REACTION)
      ? `<div style="color:#f5a623;font-size:0.72rem;margin-top:4px">🔒 等待觸發條件，不能主動翻開</div>` : "";

    // 動態狀態（指定側、指示物等）
    let stateLines = "";
    if (fc._rhythmSide)        stateLines += `<div class="tt-row"><span>指定側</span><span>${fc._rhythmSide === "left" ? "左側" : "右側"}</span></div>`;
    if (fc._fakeInfoSide)      stateLines += `<div class="tt-row"><span>指定側</span><span>${fc._fakeInfoSide === "left" ? "左側" : "右側"}</span></div>`;
    if (fc._jamSide)           stateLines += `<div class="tt-row"><span>指定側</span><span>${fc._jamSide === "left" ? "左側" : "右側"}</span></div>`;
    if (fc._showoffCounters)   stateLines += `<div class="tt-row"><span>作秀指示物</span><span>${fc._showoffCounters}</span></div>`;
    if (fc._fakeCutActive)     stateLines += `<div class="tt-row"><span>狀態</span><span>等待換側</span></div>`;

    this.el.innerHTML = `
      <strong style="color:${tc}">${fc.name}</strong>
      <small>${fc.text || ""}</small>
      ${kwLine}
      ${reactionNote}
      <div class="tt-row"><span>動力消耗</span><span>${fc.powerCost || 0}</span></div>
      <div class="tt-row"><span>壓力</span><span>${fc.pressure || 0}</span></div>
      ${stateLines}
      ${bonusLine}`;
    this.el.classList.add("visible");
    this.move(e);
  },
  showKw(e, kw) {
    if (!this.el) return;
    this.el.innerHTML = `
      <strong style="color:#e8c84a;text-decoration:underline">${kw}</strong>
      <small>${KW_DESC[kw] || ""}</small>`;
    this.el.classList.add("visible");
    this.move(e);
  },
  showNpc(e) {
    if (!this.el) return;
    this.el.innerHTML = `<strong style="color:var(--muted)">面朝下</strong><small>對手的指令，內容未知。</small>`;
    this.el.classList.add("visible");
    this.move(e);
  },
  move(e) {
    if (!this.el) return;
    const pad = 14;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    if (x + w > window.innerWidth)  x = e.clientX - w - pad;
    if (y + h > window.innerHeight) y = e.clientY - h - pad;
    this.el.style.left = x + "px";
    this.el.style.top  = y + "px";
  },
  hide() {
    if (!this.el) return;
    this.el.classList.remove("visible");
  },
};

window.addEventListener("DOMContentLoaded", () => tooltip.init());
document.addEventListener("mousemove", e => {
  if (tooltip.el?.classList.contains("visible")) {
    tooltip.move(e);
    // 若滑鼠不在任何 tooltip 觸發元素上，隱藏
    const over = e.target.closest(".field-card-mini, .card-kw, .log-card-name, .log, #cardTooltip");
    if (!over) tooltip.hide();
  }
});

const HAND_LIMIT    = 7;
const DRAW_PER_TURN = 4;
const BASE_SPEED    = 3;
const MAX_SPEED     = 6;
const BASE_POWER    = 3;
const MAX_GEAR      = 5;
const MAX_ROUNDS    = 3;
const INT_LIMIT = 7;   // 場上牌數上限（含負擔牌）

const PHASE = {
  PLAN:       "plan",
  RADIO:      "radio",
  ACTION:     "action",
  FIELD:      "field",
  RESOLUTION: "resolution",
};

// ── 附贈動作常數 ──────────────────────────────
const BONUS = {
  OPERATE: "operate",   // 操作車子
  REORDER: "reorder",   // 再下令
  TYRE:    "tyre",      // 消耗輪胎
};

// ── 部件定義 ──────────────────────────────────
// 每個部件有：id、名稱、被動效果（passive）、元件牌堆（components）
// 元件牌：{ id, name, effect: fn(car, game) }

function buildComponentDecks() {
  return {
    engine: {
      id: "engine",
      name: "動力單元",
      // 被動：在 makeCarState 裡已設定初始值，每回合重算
      passive: { baseSpeed: BASE_SPEED, maxSpeed: MAX_SPEED, power: BASE_POWER },
      // 元件牌堆（順序固定，循環）
      components: [
        {
          id: "turbo_output",
          name: "增壓輸出",
          desc: "加速 · 封鎖動力單元",
          effect(car, g) {
            car.speed += 1 * car.baseSpeed;
            g.engineBlockedThisTurn = true;
            g.message(`增壓輸出：Speed +${(1 * car.baseSpeed).toFixed(1)}（× BS ${car.baseSpeed}）。本回合動力單元封鎖。`);
          }
        },
        {
          id: "heat_recovery",
          name: "熱回收系統",
          desc: "加速 · 動力愈高效果愈強",
          effect(car, g) {
            const val = (car.power / 2) * car.baseSpeed;
            car.speed += val;
            g.message(`熱回收系統：Speed +${val.toFixed(1)}（動力 ${car.power} / 2 × BS ${car.baseSpeed}）。`);
          }
        },
        {
          id: "high_pressure_manifold",
          name: "高壓進氣岐管",
          desc: "加速 · 空力 VH 愈高效果愈強",
          effect(car, g) {
            const aeroVH = g.turnAeroVH || 0;
            const val = (aeroVH / 3) * car.baseSpeed;
            car.speed += val;
            g.message(`高壓進氣岐管：Speed +${val.toFixed(1)}（空力VH ${aeroVH} / 3 × BS ${car.baseSpeed}）。`);
          }
        },
      ],
      ptr: 0,  // 目前牌頂指標
    },

    aero: {
      id: "aero",
      name: "空力系統",
      passive: {},
      components: [
        {
          id: "variable_diffuser",
          name: "可變擴散器",
          desc: "操控 +1 · 搭配鼻錐有額外抓地力",
          effect(car, g) {
            car.vh += 1;
            g.turnAeroVH = (g.turnAeroVH || 0) + 1;
            // 碳纖維鼻錐：若本回合已結算，擴散器觸發時補 +3 Grip
            if (g.noseconeActiveThisTurn) {
              car.grip += 3;
              g.message(`可變擴散器：VH +1。碳纖維鼻錐觸發：抓地力 +3。`);
            } else {
              g.message(`可變擴散器：VH +1。`);
            }
          }
        },
        {
          id: "guided_airbox",
          name: "引導式氣箱",
          desc: "操控 · 動力單元加速愈多效果愈強",
          effect(car, g) {
            const engineSpeed = g.turnEngineSpeed || 0;
            const bs = car.baseSpeed || BASE_SPEED;
            const val = bs > 0 ? engineSpeed / bs : 0;
            car.vh += val;
            g.turnAeroVH = (g.turnAeroVH || 0) + val;
            g.message(`引導式氣箱：VH +${val.toFixed(1)}（引擎Speed ${engineSpeed} / BS ${bs}）。`);
          }
        },
        {
          id: "carbon_nosecone",
          name: "碳纖維鼻錐",
          desc: "操控 +1 · 本回合擴散器觸發時 +3 抓地力",
          effect(car, g) {
            car.vh += 1;
            g.turnAeroVH = (g.turnAeroVH || 0) + 1;
            g.noseconeActiveThisTurn = true;
            g.message(`碳纖維鼻錐：VH +1。本回合擴散器觸發時額外 +3 抓地力。`);
          }
        },
      ],
      ptr: 0,
    },

    gearbox: {
      id: "gearbox",
      name: "變速箱",
      passive: { maxGear: MAX_GEAR },
      components: [
        {
          id: "shift_a",
          name: "打檔",
          desc: "升降檔 ±1",
          effect(car, g, delta) {
            const d = delta || 0;
            car.gear = clamp(car.gear + d, 1, car.maxGear);
            recalcGearPassive(car);
            g.message(`打檔：Gear ${d >= 0 ? "+" : ""}${d} → ${car.gear} 檔。BS=${car.baseSpeed.toFixed(1)}，MaxSpd=${car.maxSpeed}。`);
          },
          requiresDelta: true,
          deltaRange: [-1, 1],
        },
        {
          id: "shift_b",
          name: "打檔",
          desc: "升降檔 ±1",
          effect(car, g, delta) {
            const d = delta || 0;
            car.gear = clamp(car.gear + d, 1, car.maxGear);
            recalcGearPassive(car);
            g.message(`打檔：Gear ${d >= 0 ? "+" : ""}${d} → ${car.gear} 檔。BS=${car.baseSpeed.toFixed(1)}，MaxSpd=${car.maxSpeed}。`);
          },
          requiresDelta: true,
          deltaRange: [-1, 1],
        },
        {
          id: "shift_plus",
          name: "打檔+",
          desc: "升降檔 ±2（自選幅度）",
          effect(car, g, delta) {
            const d = delta || 0;
            car.gear = clamp(car.gear + d, 1, car.maxGear);
            recalcGearPassive(car);
            g.message(`打檔+：Gear ${d >= 0 ? "+" : ""}${d} → ${car.gear} 檔。BS=${car.baseSpeed.toFixed(1)}，MaxSpd=${car.maxSpeed}。`);
          },
          requiresDelta: true,
          deltaRange: [-2, 2],
        },
      ],
      ptr: 0,
    },
  };
}

// 變速箱被動重算
function recalcGearPassive(car) {
  const gear = car.gear;
  car.baseSpeed = BASE_SPEED + (gear - 1) * (-0.5);
  car.maxSpeed  = MAX_SPEED  + (gear - 1) * 3;
  // 速度不超過新上限
  car.speed = clamp(car.speed, 0, car.maxSpeed);
}

// ── 耗材定義 ──────────────────────────────────
function buildTyreDeck() {
  // 順序：凹槽（頂）→ 外層 → 中層（底）
  return [
    { id: "tyre_groove",  name: "輪胎凹槽", desc: "消耗後放逐。",                          penalty: null },
    { id: "tyre_outer",   name: "輪胎外層", desc: "消耗後放逐。",                          penalty: null },
    { id: "tyre_middle",  name: "輪胎中層", desc: "消耗後放逐。下回合抽牌 -1。",            penalty: "draw_minus1" },
  ];
}

// ── 指令牌庫 ──────────────────────────────────
// cardPool 與 npcCardPool 定義於 cards.js



// ── 車況狀態 ──────────────────────────────────
function makeCarState() {
  return {
    speed: 0, baseSpeed: BASE_SPEED, maxSpeed: MAX_SPEED,
    vh: 0, grip: 4,
    gear: 1, maxGear: MAX_GEAR,
    power: BASE_POWER, maxPower: BASE_POWER,
    shield: false, sp: 0, pressure: 0,
    position: 1,
  };
}

// ── 遊戲狀態 ──────────────────────────────────
const game = {
  phase: PHASE.PLAN,
  round: 1,
  segment: 1,
  over: false,
  winner: null,

  hand: [], deck: [], discard: [],

  playerLeft: [], playerRight: [],
  npcLeft: [],    npcRight: [],
  playerBurden: 0,   // 負擔牌佔用的 INT 數量

  player: makeCarState(),
  npc:    makeCarState(),

  playerPassed: false,
  npcPassed:    false,
  actionTurn:   "player",

  rivalRevealed: false,
  log: [],

  radioSlots: { complex: 0, simple: 0 },
  radioLimit: null,

  overtakeAnim: null,

  // 部件系統（玩家專屬，NPC 無部件）
  components: null,   // buildComponentDecks() 的結果
  tyre: null,         // buildTyreDeck() 的結果（耗材）
  tyreExiled: [],     // 已放逐的輪胎牌

  // 附贈動作狀態
  pendingBonus: null,   // null | { type, sourceCard }
  bonusReorderCard: null,  // 再下令時暫存出的牌索引

  // 回合追蹤（連動用）
  turnAeroVH: 0,         // 本回合空力系統累積的 VH
  turnEngineSpeed: 0,    // 本回合動力單元累積的 Speed
  engineBlockedThisTurn: false,  // 增壓輸出觸發後封鎖
  noseconeActiveThisTurn: false, // 碳纖維鼻錐已結算

  // 懲罰追蹤
  nextTurnDrawPenalty: 0,

  message(t, type = "system") {
    this.log.push({ text: t, type });
    this.log = this.log.slice(-24);
  },
};

game.player.position = 2;
game.npc.position    = 1;

// ── 牌堆操作 ──────────────────────────────────
function buildDeck() {
  const d = [...cardPool, ...cardPool].map((c, i) => ({ ...c, uid: `p_${i}` }));
  shuffle(d);
  return d;
}

function buildNpcDeck() {
  const d = [...npcCardPool, ...npcCardPool, ...npcCardPool].map((c, i) => ({ ...c, uid: `n_${i}` }));
  shuffle(d);
  return d;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function drawCards(n = 1) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (game.deck.length === 0) {
      game.deck = [...game.discard];
      game.discard = [];
      shuffle(game.deck);
      if (game.deck.length === 0) break;
      game.message("牌庫已重洗。");
    }
    out.push(game.deck.pop());
  }
  return out;
}

// ── INT（場上牌數）計算 ───────────────────────
function playerINT() {
  // 場上實際牌數 + 負擔牌佔位
  return game.playerLeft.length + game.playerRight.length + game.playerBurden;
}

function canPlaceCard() {
  return playerINT() < INT_LIMIT;
}

// 移除牌（進棄牌堆）；若有負擔關鍵詞，playerBurden++
function removeFieldCard(pile, idx) {
  const fc = pile.splice(idx, 1)[0];
  if (!fc) return;
  game.discard.push(fc);
  if (fc.keywords?.includes(KW.BURDEN)) {
    game.playerBurden++;
    game.message(`「${fc.name}」移除（負擔：佔用 INT 至賽段結束）。`);
  } else {
    game.message(`「${fc.name}」移除。`);
  }
  return fc;
}



function startPlanPhase() {
  // 回合結束事件（換回合前觸發）
  if (game.round > 1) fireRoundEnd();

  game.phase = PHASE.PLAN;
  game.player.power = game.player.maxPower;
  game.npc.power    = game.npc.maxPower;

  game.playerPassed = false;
  game.npcPassed    = false;
  game.actionTurn   = resolveActionFirstTurn();
  game.rivalRevealed = false;
  game.radioSlots   = { complex: 0, simple: 0 };
  game.radioLimit   = null;
  game.pendingBonus = null;

  // 回合追蹤重置
  game.turnAeroVH             = 0;
  game.turnEngineSpeed        = 0;
  game.engineBlockedThisTurn  = false;
  game.noseconeActiveThisTurn = false;

  // 回合開始事件（第一回合不觸發）
  if (game.round > 1) fireEvent("onRoundStart", {});

  // 若 onRoundStart 設定了 pendingChoice（如心理戰），先等玩家處理
  // pendingChoice 的 onConfirm/onSkip 完成後需呼叫 finishPlanPhase()
  if (game.pendingChoice) {
    game._planPhasePending = true;
    render();
    return;
  }

  finishPlanPhase();
}

function finishPlanPhase() {
  game._planPhasePending = false;

  // 懲罰
  let drawCount = DRAW_PER_TURN;
  if (game.nextTurnDrawPenalty > 0) {
    drawCount = Math.max(0, drawCount - game.nextTurnDrawPenalty);
    game.message(`輪胎磨損懲罰：本回合少抽 ${game.nextTurnDrawPenalty} 張。`);
    game.nextTurnDrawPenalty = 0;
  }

  const drawn = drawCards(drawCount);
  game.hand.push(...drawn);
  while (game.hand.length > HAND_LIMIT) game.discard.push(game.hand.pop());

  game.message(`── 賽段 ${game.segment} 第 ${game.round} 回合｜計畫階段：補牌 ${drawn.length} 張。`, "phase");
  render();
}

function resolveActionFirstTurn() {
  return game.npc.position < game.player.position ? "npc" : "player";
}

function startRadioPhase() {
  game.phase = PHASE.RADIO;
  game.radioSlots = { complex: 0, simple: 0 };
  game.radioLimit = null;
  game.message("── 通訊階段：將手牌拖到左側或右側（面朝下）。資訊指令也需選側，行動階段開始時立即結算。確認完畢後按「確認」。");
  render();
}

// 通訊階段出牌上限（自動計算，不需玩家選方案）
// 規則：複雜最多 1 張，簡易最多 2 張，總計不超過 2 張（不含資訊指令）
const RADIO_MAX = { complex: 1, simple: 2, total: 2 };

function canPlayCard(card) {
  if (card.type === "info") return true; // 資訊指令不限數量
  const slots = game.radioSlots;
  const total = slots.complex + slots.simple;
  if (total >= RADIO_MAX.total) return false;
  if (card.type === "complex") return slots.complex < RADIO_MAX.complex;
  if (card.type === "simple")  return slots.simple  < RADIO_MAX.simple;
  return false;
}

// 通訊階段目前放入的牌組合描述（供 UI 提示）
function radioSlotsDesc() {
  const s = game.radioSlots;
  if (s.complex === 0 && s.simple === 0) return "尚未出牌";
  const parts = [];
  if (s.complex > 0) parts.push(`複雜 ×${s.complex}`);
  if (s.simple  > 0) parts.push(`簡易 ×${s.simple}`);
  if (s.info    > 0) parts.push(`資訊 ×${s.info}`);
  return parts.join("　");
}

function playCardToSide(index, side) {
  if (game.over) return;

  // 再下令模式：行動階段中途出牌
  if (game.phase === PHASE.ACTION && game.pendingBonus?.type === BONUS.REORDER) {
    const card = game.hand[index];
    if (!card) return;
    if (card.type === "info") {
      game.hand.splice(index, 1);
      resolveCardEffect(card, game.player, game.npc);
      game.discard.push(card);
      game.message(`再下令：資訊指令「${card.name}」立即生效。`);
      game.pendingBonus = null;
      render(); return;
    }
    // 簡易或複雜：面朝下放到場上
    game.hand.splice(index, 1);
    const fieldCard = { ...card, revealed: false, owner: "player" };
    if (side === "left")  game.playerLeft.push(fieldCard);
    else                  game.playerRight.push(fieldCard);
    game.message(`再下令：「${card.name}」→ ${side === "left" ? "左側" : "右側"}（面朝下）。`);
    game.pendingBonus = null;
    render(); return;
  }

  if (game.phase !== PHASE.RADIO) return;
  const card = game.hand[index];
  if (!card) return;

  if (!canPlayCard(card)) {
    if (card.type !== "info") game.message("已達本回合出牌上限（複雜 1 + 簡易 2）。");
    render(); return;
  }

  // INT 檢查（資訊牌不佔 INT）
  if (card.type !== "info" && !canPlaceCard()) {
    game.message(`場上已達上限（INT ${INT_LIMIT}），無法再放置指令。`);
    render(); return;
  }

  game.hand.splice(index, 1);

  // 所有牌（含資訊指令）一律面朝下入場，行動階段開始時資訊牌立即結算
  if (card.type === "complex")     game.radioSlots.complex++;
  else if (card.type === "simple") game.radioSlots.simple++;
  else if (card.type === "info")   game.radioSlots.info = (game.radioSlots.info || 0) + 1;

  const fieldCard = { ...card, revealed: false, owner: "player" };
  fieldCard._currentSide = side;
  if (side === "left")  game.playerLeft.push(fieldCard);
  else                  game.playerRight.push(fieldCard);

  game.message(`「${card.name}」→ ${side === "left" ? "左側" : "右側"}（面朝下）。`);
  render();
}

function confirmRadioPhase() {
  if (game.phase !== PHASE.RADIO) return;

  npcRadioAction();
  game.message("通訊階段結束，進入行動階段。", "phase");
  game.phase = PHASE.ACTION;
  game.actionTurn = resolveActionFirstTurn();

  // 行動階段開始：翻開並立即結算所有資訊指令，保留在場上
  const allPlayerCards = [...game.playerLeft, ...game.playerRight];
  allPlayerCards.forEach(fc => {
    if (fc.type === "info" && !fc.revealed) {
      fc.revealed = true;
      game.message(`資訊指令「${fc.name}」立即生效。`, "player");
      resolveCardEffect(fc, game.player, game.npc, fc._currentSide);
    }
  });

  // 養精蓄銳：行動階段開始時彈出選側，自動入場
  if (game.conservedCard) {
    const card = game.conservedCard;
    game.conservedCard = null;
    game.pendingChoice = {
      type: "twoOption",
      prompt: `養精蓄銳：「${card.name}」入場，選擇哪一側？`,
      options: [
        { label: "← 左側", action() {
          game.playerLeft.push({ ...card, revealed: false, owner: "player" });
          game.message(`養精蓄銳：「${card.name}」入場至左側。`);
          game.pendingChoice = null;
          if (game.actionTurn === "npc") npcActionStep();
          render();
        }},
        { label: "右側 →", action() {
          game.playerRight.push({ ...card, revealed: false, owner: "player" });
          game.message(`養精蓄銳：「${card.name}」入場至右側。`);
          game.pendingChoice = null;
          if (game.actionTurn === "npc") npcActionStep();
          render();
        }},
      ]
    };
    render();
    return;
  }

  // 若心理戰鎖定，雙方都無法行動，直接進賽場階段
  if (isActionLocked()) {
    game.message("心理戰：行動全面鎖定，雙方跳過行動階段。", "warn");
    game.playerPassed = true;
    game.npcPassed    = true;
    setTimeout(() => startFieldPhase(), 400);
    render();
    return;
  }

  if (game.actionTurn === "npc") npcActionStep();
  render();
}

function npcRadioAction() {
  const npcDeck = game.npcDeck || [];
  const plans = [
    { complex: 1, simple: 1 }, { complex: 0, simple: 2 },
    { complex: 1, simple: 0 }, { complex: 0, simple: 1 }
  ];
  const plan = plans[Math.floor(Math.random() * plans.length)];
  let complex = 0, simple = 0;
  for (const card of [...npcDeck]) {
    if (card.type === "complex" && complex < plan.complex) complex++;
    else if (card.type === "simple" && simple < plan.simple) simple++;
    else continue;
    const side = Math.random() < 0.5 ? "left" : "right";
    const fieldCard = { ...card, revealed: false, owner: "npc" };
    if (side === "left") game.npcLeft.push(fieldCard);
    else                 game.npcRight.push(fieldCard);
  }
  game.message(`紅車已蓋牌（共 ${game.npcLeft.length + game.npcRight.length} 張）。`);
}

// ── 行動階段 ──────────────────────────────────

function executeAction(side, cardIndex) {
  tooltip.hide();
  if (game.phase !== PHASE.ACTION) return;
  if (game.playerPassed) { game.message("你已 Pass，無法再行動。"); render(); return; }
  if (game.actionTurn !== "player") { game.message("現在是紅車的行動回合。"); render(); return; }

  const pile = side === "left" ? game.playerLeft : game.playerRight;
  const fieldCard = pile[cardIndex];
  if (!fieldCard || fieldCard.revealed) { game.message("這張牌已翻開或不存在。"); render(); return; }

  if ((fieldCard.powerCost || 0) > game.player.power) {
    game.message(`動力不足（需要 ${fieldCard.powerCost}，剩餘 ${game.player.power}）。`);
    render(); return;
  }

  // 反應牌不能主動翻開
  if (fieldCard.keywords?.includes(KW.REACTION)) {
    game.message(`「${fieldCard.name}」是反應牌，只能在滿足條件時觸發。`);
    render(); return;
  }

  // 心理戰鎖定檢查
  if (isActionLocked()) {
    game.message("心理戰：行動鎖定，無法執行。");
    render(); return;
  }

  game.player.power -= (fieldCard.powerCost || 0);
  fieldCard.revealed = true;
  resolveCardEffect(fieldCard, game.player, game.npc, side);
  game.message(`翻開「${fieldCard.name}」並結算效果。`, "player");

  // 複雜行動後強制 Pass（有熟練則例外）
  if (fieldCard.type === "complex" && !fieldCard.keywords?.includes(KW.SKILLED)) {
    game.playerPassed = true;
    game.message("複雜行動執行完畢，自動 Pass。");
  } else if (fieldCard.type === "complex") {
    game.message("複雜行動執行完畢（熟練：不強制 Pass）。");
  }

  // 若 resolve 設定了 pendingChoice，等玩家選擇完再繼續
  // pendingChoice.onConfirm 執行完後需自行呼叫 continueAfterAction()
  if (game.pendingChoice) {
    game._pendingAfterAction = { bonus: fieldCard.bonus };
    render(); return;
  }

  // 觸發附贈動作
  if (fieldCard.bonus) {
    triggerBonus(fieldCard.bonus, fieldCard);
    return;
  }

  afterPlayerAction();
  render();
}

// pendingChoice 完成後繼續流程
function continueAfterAction() {
  const pending = game._pendingAfterAction;
  game._pendingAfterAction = null;
  if (pending?.bonus) {
    triggerBonus(pending.bonus, pending.sourceCard || {});
    return;
  }
  afterPlayerAction();
  render();
}

// 通訊階段：收回場上的牌到手牌
function recallCardFromField(fc, side) {
  if (game.phase !== PHASE.RADIO) return;
  const pile = side === "left" ? game.playerLeft : game.playerRight;
  const idx = pile.indexOf(fc);
  if (idx === -1) return;
  pile.splice(idx, 1);
  // 退還出牌計數
  if (fc.type === "complex")     game.radioSlots.complex = Math.max(0, (game.radioSlots.complex || 0) - 1);
  else if (fc.type === "simple") game.radioSlots.simple  = Math.max(0, (game.radioSlots.simple  || 0) - 1);
  else if (fc.type === "info")   game.radioSlots.info    = Math.max(0, (game.radioSlots.info    || 0) - 1);
  // 退還原始牌（不帶 fieldCard 的額外屬性）
  const originalCard = cardPool.find(c => c.id === fc.id);
  game.hand.push(originalCard ? { ...originalCard, uid: fc.uid } : fc);
  game.message(`「${fc.name}」收回手牌。`);
  render();
}



function triggerBonus(bonusType, sourceCard) {
  const isDouble = sourceCard?.bonusDouble && !game._bonusDoubleUsed;
  if (isDouble) game._bonusDoubleUsed = false; // 初始化標記

  game.pendingBonus = { type: bonusType, sourceCard, isDouble, cardFilter: sourceCard?._reorderFilter || null };

  if (bonusType === BONUS.OPERATE) {
    game.message(`附贈動作：操作車子。`);
    render();

  } else if (bonusType === BONUS.REORDER) {
    const filter = game.pendingBonus.cardFilter;
    const available = filter ? game.hand.filter(filter) : game.hand;
    if (available.length === 0) {
      game.message("附贈動作：再下令，但無符合條件的手牌，跳過。");
      game.pendingBonus = null;
      afterPlayerAction();
      render();
    } else {
      const hint = filter ? "（限：有附贈操作車子的指令）" : "";
      game.message(`附贈動作：再下令${hint}。請選一張手牌。`);
      render();
    }

  } else if (bonusType === BONUS.TYRE) {
    consumeTyre();
  }
}

// 玩家取消附贈動作
function skipBonus() {
  if (!game.pendingBonus) return;
  game.message("跳過附贈動作。");
  game.pendingBonus = null;
  afterPlayerAction();
  render();
}

// 操作車子：玩家點選部件
function operateComponent(componentId, delta) {
  if (!game.pendingBonus || game.pendingBonus.type !== BONUS.OPERATE) return;

  const comp = game.components[componentId];
  if (!comp) { game.message("無效的部件。"); render(); return; }

  // 增壓輸出封鎖檢查
  if (componentId === "engine" && game.engineBlockedThisTurn) {
    game.message("本回合動力單元已封鎖（增壓輸出效果），請選其他部件。");
    render(); return;
  }

  // 部件報廢檢查
  if (comp.components.length === 0) {
    game.message(`${comp.name} 已無元件，部件報廢！車輛被淘汰。`);
    game.over = true;
    game.winner = "retired";
    render(); return;
  }

  // 取出牌頂元件
  const element = comp.components[comp.ptr];

  // 需要 delta 的元件（打檔類）
  if (element.requiresDelta && delta === undefined) {
    game.message(`請選擇 ${element.name} 的檔位變化量（${element.deltaRange[0]} ~ ${element.deltaRange[1]}）。`);
    render(); return;
  }

  // 結算元件效果
  const speedBefore = game.player.speed;
  element.effect(game.player, game, delta);

  // 追蹤動力單元本回合累積 Speed（供空力連動）
  if (componentId === "engine") {
    game.turnEngineSpeed += (game.player.speed - speedBefore);
  }

  clampCar(game.player);

  // 元件移至牌底（循環）
  comp.ptr = (comp.ptr + 1) % comp.components.length;

  // bonusDouble：得心應手，第一次完成後再觸發一次
  const wasDouble = game.pendingBonus?.isDouble && !game._bonusDoubleUsed;
  game.pendingBonus = null;

  if (wasDouble) {
    game._bonusDoubleUsed = true;
    game.message("得心應手：附贈動作再執行一次。");
    triggerBonus(BONUS.OPERATE, game.pendingBonus?.sourceCard || {});
    return;
  }

  game._bonusDoubleUsed = false;
  afterPlayerAction();
  render();
}

// 消耗輪胎
function consumeTyre() {
  if (!game.tyre || game.tyre.length === 0) {
    game.message("輪胎已全部磨損！車輛被淘汰。");
    game.over = true;
    game.winner = "retired";
    game.pendingBonus = null;
    render(); return;
  }

  const layer = game.tyre.shift(); // 從頂部取出
  game.tyreExiled.push(layer);
  game.message(`消耗輪胎：${layer.name} 放逐。`);

  if (layer.penalty === "draw_minus1") {
    game.nextTurnDrawPenalty += 1;
    game.message("輪胎中層磨損！下回合抽牌 -1。");
  }

  if (game.tyre.length === 0) {
    game.message("⚠️ 輪胎完全磨損！車輛被淘汰。");
    game.over = true;
    game.winner = "retired";
  }

  game.pendingBonus = null;
  afterPlayerAction();
  render();
}

function playerPass() {
  if (game.phase !== PHASE.ACTION) return;
  if (game.actionTurn !== "player") return;
  // 若有待處理的附贈動作，先取消
  if (game.pendingBonus) { game.pendingBonus = null; }
  game.playerPassed = true;
  game.message("你選擇 Pass。");
  afterPlayerAction();
  render();
}

function afterPlayerAction() {
  if (game.playerPassed && game.npcPassed) { startFieldPhase(); return; }
  if (!game.npcPassed) {
    game.actionTurn = "npc";
    render();
    setTimeout(() => { npcActionStep(); render(); }, 700);
  } else {
    game.actionTurn = "player";
    render();
  }
}

function afterNpcAction() {
  if (game.playerPassed && game.npcPassed) { startFieldPhase(); return; }
  if (!game.playerPassed) {
    game.actionTurn = "player";
    render();
  } else {
    game.actionTurn = "npc";
    render();
    setTimeout(() => { npcActionStep(); render(); }, 700);
  }
}

function npcActionStep() {
  if (game.npcPassed) return;
  if (isActionLocked()) {
    game.message("心理戰：行動鎖定，紅車無法行動。", "npc");
    game.npcPassed = true;
    afterNpcAction();
    return;
  }
  const target = game.npcLeft.find(c => !c.revealed) || game.npcRight.find(c => !c.revealed);
  if (!target) {
    game.npcPassed = true;
    game.message("紅車沒有可行動的牌，Pass。", "npc");
  } else {
    target.revealed = true;
    resolveCardEffect(target, game.npc, game.player);
    game.message(`紅車翻開「${target.name}」並結算。`, "npc");
    if (target.type === "complex") {
      game.npcPassed = true;
      game.message("紅車複雜行動，自動 Pass。", "npc");
    }
  }
  afterNpcAction();
}

// ── 賽場階段 ──────────────────────────────────

function startFieldPhase() {
  game.phase = PHASE.FIELD;
  const posName = game.player.position === 2 ? "你落後紅車" : "你領先紅車";
  game.message(`── 賽場階段。${posName}。是否選擇超車？`);
  render();
}

function fieldNoOvertake() {
  if (game.phase !== PHASE.FIELD) return;
  if (game.round >= MAX_ROUNDS) {
    game.message("第三回合結束，未選擇超車，賽段結束。");
    startResolutionPhase(null);
  } else {
    game.message("不超車，進入下一回合。");
    game.round++;
    startPlanPhase();
  }
}

function fieldOvertake(side) {
  if (game.phase !== PHASE.FIELD) return;
  game.message(`選擇以${side === "left" ? "左側" : "右側"}超車，進入結算。`);
  startResolutionPhase(side);
}

// ── 結算階段 ──────────────────────────────────

function startResolutionPhase(overtakeSide) {
  game.phase = PHASE.RESOLUTION;
  game.message("── 結算階段開始。");
  fireResolutionStart();

  const pSP = calcSP(game.player);
  const nSP  = calcSP(game.npc);
  game.player.sp = pSP;
  game.npc.sp    = nSP;
  game.message(`SP — 你：${pSP}　紅車：${nSP}`);

  if (pSP > 8) { game.player.pressure += 1; game.message("你的 SP 超高，壓力值 +1。"); }
  if (nSP  > 8) { game.npc.pressure += 1; }

  if (overtakeSide !== null) {
    resolveOvertake(overtakeSide, pSP, nSP);
  } else {
    game.message("未嘗試超車，維持現有位置。");
  }

  setTimeout(() => { cleanupAndReset(); render(); }, 600);
}

function resolveOvertake(side, pSP, nSP) {
  game.overtakeAnim = side;
  const sideName   = side === "left" ? "左側" : "右側";
  const playerSide = side === "left" ? game.playerLeft  : game.playerRight;
  const npcSide    = side === "left" ? game.npcLeft      : game.npcRight;

  playerSide.forEach(c => { c.revealed = true; });
  npcSide.forEach(c => { c.revealed = true; });

  const pP = calcSidePressure(playerSide);
  const nP = calcSidePressure(npcSide);
  game.message(`結算${sideName} — 你的壓力：${pP}　紅車壓力：${nP}`);

  if (game.player.position === 2) {
    if (pP >= nP) {
      game.message("超車窗口打開！");
      if (pSP > nSP) {
        game.player.position = 1;
        game.npc.position    = 2;
        game.winner = "overtake_success";
        game.message("🏆 穩定超車成功！你超越了紅車！");
      } else {
        game.winner = "reckless";
        game.message("⚠️ 魯莽超車！SP 不足以穩定超車。");
      }
    } else {
      if (game.player.speed > game.npc.speed) {
        game.message(`壓力不足，速度從 ${game.player.speed.toFixed(1)} 降至紅車速度 ${game.npc.speed}。`);
        game.player.speed = game.npc.speed;
      }
      game.message("超車失敗，維持現有位置。");
    }
  }
}

function calcSP(car) {
  return Math.max(0, Math.round(car.vh * 0.5 + car.grip * 1 + car.speed * 2));
}

function refreshSP() {
  game.player.sp = calcSP(game.player);
  game.npc.sp    = calcSP(game.npc);
}

function calcSidePressure(cards) {
  return cards.reduce((s, c) => s + (c.pressure || 0), 0);
}

function cleanupAndReset() {
  [...game.playerLeft, ...game.playerRight,
   ...game.npcLeft,    ...game.npcRight].forEach(c => game.discard.push(c));
  game.playerLeft = []; game.playerRight = [];
  game.npcLeft    = []; game.npcRight    = [];
  game.overtakeAnim = null;

  const resetCar = (car) => {
    car.vh     = 0;
    car.grip   = 4;
    car.power  = car.maxPower;
    car.sp     = 0;
    car.speed  = car.baseSpeed;
    car.shield = false;
  };
  resetCar(game.player);
  resetCar(game.npc);
  game.message("車體數值重置（檔位保留）。");

  game.over = true;
  if (!game.winner) game.winner = "draw";
  const msgs = {
    overtake_success: "🏆 賽段結束！你成功超越紅車！",
    reckless:         "⚠️ 賽段結束！魯莽超車，後果不明。",
    retired:          "💥 車輛退賽。",
    draw:             "賽段結束。位置維持，平局。",
  };
  game.message(msgs[game.winner] || "賽段結束。");
  render();
}

// ── 事件系統 ──────────────────────────────────

let _firingEvent = false;

function fireEvent(eventType, payload = {}) {
  const allCards = [
    ...game.playerLeft, ...game.playerRight,
    ...game.npcLeft,    ...game.npcRight,
  ];
  const wasAlreadyFiring = _firingEvent;
  _firingEvent = true;
  allCards.forEach(fc => {
    if (fc.fieldEffects?.[eventType]) {
      // 只在最外層事件時印反應觸發提示，避免嵌套事件重複印
      if (!wasAlreadyFiring && fc.keywords?.includes(KW.REACTION)) {
        game.message(`⚡ 反應觸發：「${fc.name}」`, "reaction");
      }
      fc.fieldEffects[eventType](payload);
    }
  });
  if (!wasAlreadyFiring) _firingEvent = false;
}

function fireRoundEnd() { fireEvent("onRoundEnd", {}); }
function fireResolutionStart() { fireEvent("onResolutionStart", {}); }

// 檢查心理戰鎖定
function isActionLocked() {
  return [...game.playerLeft, ...game.playerRight,
          ...game.npcLeft,    ...game.npcRight]
    .some(fc => fc.fieldEffects?.lockActions);
}

// ── 效果結算 ──────────────────────────────────

function resolveCardEffect(card, owner, opponent, side) {
  // 優先使用 resolve 函式
  if (card.resolve) {
    const ctx = { card, owner, opponent, side,
      pile: side === "left"
        ? (owner === game.player ? game.playerLeft  : game.npcLeft)
        : (owner === game.player ? game.playerRight : game.npcRight)
    };
    card.resolve(ctx);
    return;
  }
  // 舊版相容（無 resolve 的牌）
  if (card.changes) applyChanges(owner, card.changes);
  if (card.targetChanges) {
    if (opponent.shield) { opponent.shield = false; game.message("對方防守擋下了干擾。"); }
    else { applyChanges(opponent, card.targetChanges); game.message(`對方受到影響：${describeChanges(card.targetChanges)}。`); }
  }
  if (card.shield) owner.shield = true;
  if (card.draw)   { const d = drawCards(card.draw); game.hand.push(...d); }
  if (card.revealRival) { game.rivalRevealed = true; game.message(`賽道掃描：紅車速度 ${game.npc.speed.toFixed(1)}。`); }
}

// ── 數值工具 ──────────────────────────────────

function applyChanges(car, changes = {}) {
  if (!changes) return;
  const speedBefore = car.speed;
  Object.entries(changes).forEach(([k, v]) => {
    if (k === "speed_bs") {
      // 速度乘以 BS 的通則
      car.speed += v * car.baseSpeed;
    } else if (k === "gear") {
      car.gear = clamp(car.gear + v, 1, car.maxGear);
      recalcGearPassive(car);
    } else if (k in car) {
      car[k] += v;
    }
  });
  // 追蹤動力單元本回合 Speed 增量（指令卡直接加速時）
  if (changes.speed_bs && car === game.player) {
    game.turnEngineSpeed += (car.speed - speedBefore);
  }
  clampCar(car);
}

function clampCar(car) {
  car.speed    = clamp(car.speed, 0, car.maxSpeed || MAX_SPEED);
  car.vh       = clamp(car.vh, -5, 10);
  car.grip     = clamp(car.grip, 0, 10);
  car.gear     = clamp(car.gear, 1, car.maxGear || MAX_GEAR);
  car.power    = clamp(car.power, 0, car.maxPower || BASE_POWER);
  car.pressure = clamp(car.pressure, 0, 999);
  car.sp       = clamp(car.sp, 0, 999);
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function describeChanges(changes = {}) {
  const L = { speed: "速度", speed_bs: "速度", vh: "車體操控", grip: "抓地力", gear: "檔位", baseSpeed: "基礎速度", maxSpeed: "速度上限", power: "動力" };
  return Object.entries(changes).filter(([, v]) => v !== 0)
    .map(([k, v]) => `${L[k] || k} ${v > 0 ? "+" : ""}${v}`).join("、");
}

function getTypeName(t) { return { complex: "複雜指令", simple: "簡易指令", info: "資訊指令" }[t] || "指令"; }
function getBonusName(b) { return { operate: "操作車子", reorder: "再下令", tyre: "消耗輪胎" }[b] || ""; }

const KW_DESC = {
  "熟練": "複雜指令結算後不強制 Pass，可繼續行動。",
  "負擔": "此牌被移除後仍佔用 INT 一格，直到賽段結束。",
  "反應": "此牌不能主動翻開，只能在滿足描述的條件時觸發。",
};

// ── 重置遊戲 ──────────────────────────────────

function resetGame() {
  game.phase   = PHASE.PLAN;
  game.round   = 1;
  game.segment = 1;
  game.over    = false;
  game.winner  = null;

  game.hand = []; game.deck = buildDeck(); game.discard = [];
  game.npcDeck = buildNpcDeck();

  game.playerLeft = []; game.playerRight = [];
  game.npcLeft    = []; game.npcRight    = [];
  game.playerBurden = 0;
  game.npc    = makeCarState();
  game.player.position = 2;
  game.npc.position    = 1;

  game.playerPassed = false;
  game.npcPassed    = false;
  game.actionTurn   = "npc";
  game.rivalRevealed = false;
  game.radioSlots   = { complex: 0, simple: 0 };
  game.radioLimit   = null;
  game.overtakeAnim = null;
  game.pendingBonus = null;
  game.pendingChoice = null;
  game.conservedCard = null;
  game.tyreSaveCharges = 0;
  game.npcRadioBlocked = false;

  // 部件系統初始化
  game.components   = buildComponentDecks();
  game.tyre         = buildTyreDeck();
  game.tyreExiled   = [];

  // 回合追蹤重置
  game.turnAeroVH             = 0;
  game.turnEngineSpeed        = 0;
  game.engineBlockedThisTurn  = false;
  game.noseconeActiveThisTurn = false;
  game.nextTurnDrawPenalty    = 0;

  game.log = ["綠車從後方起跑，紅車領先。賽事開始！"];
  const drawn = drawCards(DRAW_PER_TURN);
  game.hand.push(...drawn);
  game.message(`計畫階段：補牌 ${drawn.length} 張。`);
  render();
}

// ──────────────────────────────────────────────
//  拖拉 & 點擊系統
// ──────────────────────────────────────────────

const dragState = { active: false, moved: false, ghost: null, index: -1, offsetX: 0, offsetY: 0, startX: 0, startY: 0 };
let suppressNextCardClick = false;
let pendingCardIndex = -1;

function startPointerCardDrag(e, el, idx) {
  if (e.button !== undefined && e.button !== 0) return;
  if (game.over || el.disabled) return;
  e.preventDefault();
  const r = el.getBoundingClientRect();
  Object.assign(dragState, {
    active: true, moved: false, ghost: null, index: idx,
    offsetX: e.clientX - r.left, offsetY: e.clientY - r.top,
    startX: e.clientX, startY: e.clientY,
    origWidth: r.width, sourceEl: el
  });
  document.addEventListener("pointermove", onDocPointerMove);
  document.addEventListener("pointerup",   onDocPointerUp);
  document.addEventListener("pointercancel", onDocPointerCancel);
}

function onDocPointerMove(e) {
  if (!dragState.active) return;
  if (!dragState.moved && Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY) > 6) {
    dragState.moved = true;
    suppressNextCardClick = true;
    const ghost = dragState.sourceEl.cloneNode(true);
    ghost.className = dragState.sourceEl.className + " is-pointer-dragging";
    ghost.style.width  = dragState.origWidth + "px";
    ghost.style.left   = (dragState.startX - dragState.offsetX) + "px";
    ghost.style.top    = (dragState.startY - dragState.offsetY) + "px";
    ghost.style.pointerEvents = "none";
    document.body.appendChild(ghost);
    dragState.ghost = ghost;
    dragState.sourceEl.classList.add("is-dragging");
  }
  if (!dragState.moved) return;
  dragState.ghost.style.left = (e.clientX - dragState.offsetX) + "px";
  dragState.ghost.style.top  = (e.clientY - dragState.offsetY) + "px";
  const overLeft  = isPointInZone(e.clientX, e.clientY, els.playerLeftZone);
  const overRight = isPointInZone(e.clientX, e.clientY, els.playerRightZone);
  els.playerLeftZone.classList.toggle("is-ready", overLeft);
  els.playerRightZone.classList.toggle("is-ready", overRight);
  if (typeof Track !== "undefined") Track.setHover(overLeft, overRight);
}

function onDocPointerUp(e) {
  if (!dragState.active) return;
  const overLeft  = isPointInZone(e.clientX, e.clientY, els.playerLeftZone);
  const overRight = isPointInZone(e.clientX, e.clientY, els.playerRightZone);
  const idx = dragState.index;
  const moved = dragState.moved;
  cleanDrag();
  if (moved) {
    if (overLeft)       playCardToSide(idx, "left");
    else if (overRight) playCardToSide(idx, "right");
  }
}

function onDocPointerCancel() { cleanDrag(); }

function cleanDrag() {
  if (dragState.ghost && dragState.ghost.parentNode) dragState.ghost.parentNode.removeChild(dragState.ghost);
  if (dragState.sourceEl) dragState.sourceEl.classList.remove("is-dragging");
  if (els.playerLeftZone)  els.playerLeftZone.classList.remove("is-ready");
  if (els.playerRightZone) els.playerRightZone.classList.remove("is-ready");
  if (typeof Track !== "undefined") Track.setHover(false, false);
  document.removeEventListener("pointermove",   onDocPointerMove);
  document.removeEventListener("pointerup",     onDocPointerUp);
  document.removeEventListener("pointercancel", onDocPointerCancel);
  Object.assign(dragState, { active: false, moved: false, ghost: null, index: -1, sourceEl: null });
}

function isPointInZone(x, y, el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function onCardClick(index) {
  if (suppressNextCardClick) { suppressNextCardClick = false; return; }

  // 再下令模式：點選手牌
  if (game.phase === PHASE.ACTION && game.pendingBonus?.type === BONUS.REORDER) {
    const card = game.hand[index];
    if (!card) return;
    if (card.type === "info") { playCardToSide(index, "left"); return; }
    pendingCardIndex = index;
    els.sideModal.classList.remove("hidden");
    return;
  }

  if (game.over || game.phase !== PHASE.RADIO) return;
  const card = game.hand[index];
  if (!card) return;
  if (!canPlayCard(card)) { game.message("已達本回合出牌上限。"); render(); return; }
  pendingCardIndex = index;
  els.sideModal.classList.remove("hidden");
}

// 打檔選擇：玩家選擇 delta 後呼叫
function onGearDeltaSelected(componentId, delta) {
  operateComponent(componentId, delta);
}

// ──────────────────────────────────────────────
//  DOM 綁定
// ──────────────────────────────────────────────
const els = {
  phaseLabel:   document.querySelector("#phaseLabel"),
  roundLabel:   document.querySelector("#roundLabel"),
  energy:       document.querySelector("#energy"),
  statusLabel:  document.querySelector("#statusLabel"),
  deckCount:    document.querySelector("#deckCount"),
  discardCount: document.querySelector("#discardCount"),
  handCount:    document.querySelector("#handCount"),

  pSpeed:    document.querySelector("#pSpeed"),
  pBS:       document.querySelector("#pBS"),
  pVH:       document.querySelector("#pVH"),
  pGrip:     document.querySelector("#pGrip"),
  pGear:     document.querySelector("#pGear"),
  pPower:    document.querySelector("#pPower"),
  pSP:       document.querySelector("#pSP"),
  pINT:      document.querySelector("#pINT"),
  pPressure: document.querySelector("#pPressure"),
  pShield:   document.querySelector("#pShield"),
  pPos:      document.querySelector("#pPos"),

  rSpeed:    document.querySelector("#rSpeed"),
  rVH:       document.querySelector("#rVH"),
  rGrip:     document.querySelector("#rGrip"),
  rSP:       document.querySelector("#rSP"),
  rPressure: document.querySelector("#rPressure"),
  rShield:   document.querySelector("#rShield"),
  rPos:      document.querySelector("#rPos"),

  playerLeftZone:      document.querySelector("#playerLeftZone"),
  playerRightZone:     document.querySelector("#playerRightZone"),
  npcLeftZone:         document.querySelector("#npcLeftZone"),
  npcRightZone:        document.querySelector("#npcRightZone"),

  panelPlan:       document.querySelector("#panelPlan"),
  panelRadio:      document.querySelector("#panelRadio"),
  panelAction:     document.querySelector("#panelAction"),
  panelField:      document.querySelector("#panelField"),
  panelResolution: document.querySelector("#panelResolution"),

  radioPlanBtns:   document.querySelectorAll("[data-plan]"),
  confirmRadioBtn: document.querySelector("#confirmRadioBtn"),

  playerPassBtn:   document.querySelector("#playerPassBtn"),
  actionTurnLabel: document.querySelector("#actionTurnLabel"),

  overtakeLeftBtn:  document.querySelector("#overtakeLeftBtn"),
  overtakeRightBtn: document.querySelector("#overtakeRightBtn"),
  noOvertakeBtn:    document.querySelector("#noOvertakeBtn"),

  cards:      document.querySelector("#cards"),
  sideModal:  document.querySelector("#sideModal"),
  sideLeft:   document.querySelector("#sideLeft"),
  sideRight:  document.querySelector("#sideRight"),
  sideCancel: document.querySelector("#sideCancel"),
  log:        document.querySelector("#log"),

  resetButton:  document.querySelector("#resetButton"),
  nextPhaseBtn: document.querySelector("#nextPhaseBtn"),

  // 部件面板
  componentPanel: document.querySelector("#componentPanel"),
  tyreStatus:     document.querySelector("#tyreStatus"),
};

// ──────────────────────────────────────────────
//  渲染
// ──────────────────────────────────────────────

const PHASE_NAMES = {
  plan: "計畫階段", radio: "通訊階段", action: "行動階段",
  field: "賽場階段", resolution: "結算階段"
};

function renderHud() {
  if (els.phaseLabel)   els.phaseLabel.textContent   = PHASE_NAMES[game.phase] || game.phase;
  if (els.roundLabel)   els.roundLabel.textContent   = `${game.round} / ${MAX_ROUNDS}`;
  if (els.energy)       els.energy.textContent       = `${game.player.power} / ${game.player.maxPower}`;
  if (els.deckCount)    els.deckCount.textContent    = game.deck.length;
  if (els.discardCount) els.discardCount.textContent = game.discard.length;
  if (els.handCount)    els.handCount.textContent    = game.hand.length;

  if (els.statusLabel) {
    if (game.over) {
      const m = { overtake_success: "🏆 超車成功", reckless: "⚠️ 魯莽超車", retired: "💥 退賽", draw: "平局" }[game.winner] || "結束";
      els.statusLabel.textContent = m;
    } else {
      els.statusLabel.textContent = game.player.position === 1 ? "領先" : "落後";
    }
  }

  const p = game.player, n = game.npc;
  if (els.pSpeed)    els.pSpeed.textContent    = `${p.speed.toFixed(1)} / ${p.maxSpeed}`;
  if (els.pBS)       els.pBS.textContent       = p.baseSpeed.toFixed(1);
  if (els.pVH)       els.pVH.textContent       = p.vh.toFixed(1);
  if (els.pGrip)     els.pGrip.textContent     = p.grip.toFixed(1);
  if (els.pGear)     els.pGear.textContent     = p.gear;
  if (els.pPower)    els.pPower.textContent    = `${p.power}/${p.maxPower}`;
  if (els.pSP)       els.pSP.textContent       = p.sp;
  if (els.pINT)      els.pINT.textContent      = `${playerINT()} / ${INT_LIMIT}`;
  if (els.pPressure) els.pPressure.textContent = p.pressure;
  if (els.pShield)   { els.pShield.textContent = p.shield ? "🛡 防守中" : "—"; els.pShield.style.color = p.shield ? "var(--warn)" : "var(--muted)"; }
  if (els.pPos)      els.pPos.textContent      = p.position === 1 ? "🥇 領先" : "🥈 落後";

  if (els.rSpeed)    els.rSpeed.textContent    = game.rivalRevealed ? n.speed : "?";
  if (els.rVH)       els.rVH.textContent       = "?";
  if (els.rGrip)     els.rGrip.textContent     = "?";
  if (els.rSP)       els.rSP.textContent       = n.sp;
  if (els.rPressure) els.rPressure.textContent = n.pressure;
  if (els.rShield)   { els.rShield.textContent = n.shield ? "🛡 防守中" : "—"; els.rShield.style.color = n.shield ? "var(--warn)" : "var(--muted)"; }
  if (els.rPos)      els.rPos.textContent      = n.position === 1 ? "🥇 領先" : "🥈 落後";

  if (els.log) {
    els.log.innerHTML = game.log.map(entry => {
      const t    = typeof entry === "string" ? entry : entry.text;
      const type = typeof entry === "string" ? "system" : entry.type;

      const colorMap = {
        player:   "var(--accent)",
        npc:      "var(--danger)",
        reaction: "var(--warn)",
        system:   "var(--muted)",
        phase:    "#a0c4a0",
        warn:     "var(--danger)",
      };
      const color  = colorMap[type] || "var(--muted)";
      const indent = (type === "system" && !t.startsWith("──")) ? "padding-left:10px" : "";

      // 關鍵字粗體化
      const keywords = ["移除", "放逐", "翻開", "Pass", "觸發", "封鎖", "超車", "入場", "抽"];
      let html = t;
      keywords.forEach(kw => { html = html.replaceAll(kw, `<b>${kw}</b>`); });

      // 牌名（「」包起來的）變成可 hover 的 span
      html = html.replace(/「([^」]+)」/g, (_, name) => {
        const card = [...cardPool, ...npcCardPool].find(c => c.name === name);
        if (card) {
          return `「<span class="log-card-name" data-cardid="${card.id}" style="text-decoration:underline dotted;cursor:help;color:inherit">${name}</span>」`;
        }
        return `「${name}」`;
      });

      return `<div style="color:${color};${indent};border-left:2px solid ${color}33;padding-left:6px;margin-bottom:2px;line-height:1.5">${html}</div>`;
    }).join("");

    // 綁定牌名 hover tooltip
    els.log.querySelectorAll(".log-card-name").forEach(el => {
      el.addEventListener("mouseenter", e => {
        const id = el.dataset.cardid;
        const card = [...cardPool, ...npcCardPool].find(c => c.id === id);
        if (card) tooltip.show(e, card);
      });
      el.addEventListener("mouseleave", () => tooltip.hide());
    });
    // 捲到底部（最新訊息）
    els.log.scrollTop = els.log.scrollHeight;
  }

  renderPhaseUI();
  renderComponentPanel();
}

function renderPhaseUI() {
  const phases = [PHASE.PLAN, PHASE.RADIO, PHASE.ACTION, PHASE.FIELD, PHASE.RESOLUTION];
  const panelMap = {
    [PHASE.PLAN]:       els.panelPlan,
    [PHASE.RADIO]:      els.panelRadio,
    [PHASE.ACTION]:     els.panelAction,
    [PHASE.FIELD]:      els.panelField,
    [PHASE.RESOLUTION]: els.panelResolution,
  };
  phases.forEach(ph => {
    const el = panelMap[ph];
    if (el) el.classList.toggle("hidden", game.phase !== ph || game.over);
  });

  if (game.phase === PHASE.RADIO) {
    // 更新出牌狀態提示
    const radioStatusEl = document.querySelector("#radioStatus");
    if (radioStatusEl) radioStatusEl.textContent = radioSlotsDesc();
    // 確認按鈕永遠可按（玩家可以選擇不出牌直接確認）
    if (els.confirmRadioBtn) els.confirmRadioBtn.disabled = false;
  }

  if (game.phase === PHASE.ACTION) {
    if (els.actionTurnLabel) {
      if (game.pendingBonus) {
        const bonusName = getBonusName(game.pendingBonus.type);
        els.actionTurnLabel.textContent = `附贈動作：${bonusName}`;
      } else {
        els.actionTurnLabel.textContent = game.actionTurn === "player" ? "你的行動回合" : "等待紅車行動…";
      }
    }
    if (els.playerPassBtn) {
      els.playerPassBtn.disabled = game.playerPassed || game.actionTurn !== "player";
    }
  }

  if (game.phase === PHASE.FIELD) {
    const isRear = game.player.position === 2;
    if (els.overtakeLeftBtn)  els.overtakeLeftBtn.disabled  = !isRear;
    if (els.overtakeRightBtn) els.overtakeRightBtn.disabled = !isRear;
    if (!isRear && !game._shownLeadMsg) {
      game.message("你目前領先，無需超車。");
      game._shownLeadMsg = true;
    }
  } else {
    game._shownLeadMsg = false;
  }

  renderFieldZone("playerLeftZone",  game.playerLeft,  "player", "left");
  renderFieldZone("playerRightZone", game.playerRight, "player", "right");
  renderFieldZone("npcLeftZone",     game.npcLeft,     "npc",    "left");
  renderFieldZone("npcRightZone",    game.npcRight,    "npc",    "right");

  renderPendingChoice();
}

// ── pendingChoice UI ──────────────────────────

function renderPendingChoice() {
  let modal = document.getElementById("choiceModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "choiceModal";
    modal.className = "side-modal";
    document.body.appendChild(modal);
  }

  if (!game.pendingChoice) { modal.classList.add("hidden"); return; }
  modal.classList.remove("hidden");

  const pc = game.pendingChoice;

  if (pc.type === "twoOption") {
    modal.innerHTML = `<div class="side-modal-box">
      <p>${pc.prompt || "請選擇"}</p>
      <div class="side-modal-btns" style="grid-template-columns:1fr 1fr">
        ${pc.options.map((o,i) => `<button class="primary" data-opt="${i}">${o.label}</button>`).join("")}
      </div>
    </div>`;
    pc.options.forEach((o,i) => {
      modal.querySelector(`[data-opt="${i}"]`).addEventListener("click", () => {
        o.action();
        if (!game.pendingChoice) continueAfterAction();
      });
    });

  } else if (pc.type === "singleSelect" || pc.type === "multiSelect") {
    const max = pc.maxSelect || 99;
    let selected = [];
    const renderInner = () => {
      modal.innerHTML = `<div class="side-modal-box" style="min-width:320px;max-width:480px">
        <p>${pc.prompt}</p>
        <div style="display:flex;flex-direction:column;gap:5px;margin:8px 0;max-height:400px;overflow-y:auto">
          ${pc.choices.map((fc,i) => `
            <div class="choice-item ${selected.includes(fc)?"selected":""}" data-idx="${i}"
                 style="padding:6px 10px;border-radius:6px;border:1px solid ${selected.includes(fc)?"var(--accent)":"var(--line)"};
                        background:${selected.includes(fc)?"rgba(37,209,127,0.12)":"var(--panel-2)"};cursor:pointer;font-size:0.82rem">
              <strong>${fc.name}</strong>
              ${fc.text ? `<span style="color:var(--muted);font-size:0.72rem;margin-left:6px">${fc.text}</span>` : ""}
            </div>`).join("")}
        </div>
        <div class="side-modal-btns" style="grid-template-columns:1fr${pc.onSkip?" 1fr":""}">
          <button class="primary" id="choiceConfirm" ${selected.length===0?"disabled":""}>確認${max===1&&selected.length===1?` (${selected[0].name})`:""}${max>1&&selected.length>0?` (${selected.length}張)`:""}</button>
          ${pc.onSkip ? '<button class="ghost" id="choiceSkip">跳過</button>' : ""}
        </div>
      </div>`;
      pc.choices.forEach((fc,i) => {
        modal.querySelector(`[data-idx="${i}"]`).addEventListener("click", () => {
          if (selected.includes(fc)) {
            selected = selected.filter(x => x !== fc);  // 點已選的取消選取
          } else if (selected.length < max) {
            selected.push(fc);
          } else if (max === 1) {
            selected = [fc];  // 單選時直接換選
          }
          renderInner();
        });
      });
      modal.querySelector("#choiceConfirm")?.addEventListener("click", () => {
        if (selected.length === 0) return;
        pc.onConfirm(selected);
        if (!game.pendingChoice) continueAfterAction();
      });
      modal.querySelector("#choiceSkip")?.addEventListener("click", () => {
        pc.onSkip?.();
        if (!game.pendingChoice) continueAfterAction();
      });
    };
    renderInner();

  } else if (pc.type === "showoffTrigger") {
    modal.innerHTML = `<div class="side-modal-box">
      <p>作秀：隨機移除自己 1 張牌並獲得指示物？</p>
      <div class="side-modal-btns">
        <button class="primary" id="showoffYes">是</button>
        <button class="ghost"   id="showoffNo">否</button>
      </div>
    </div>`;
    modal.querySelector("#showoffYes").addEventListener("click", () => pc.onYes());
    modal.querySelector("#showoffNo").addEventListener("click",  () => pc.onNo());

  } else if (pc.type === "showoff") {
    let remaining = pc.remaining;
    modal.innerHTML = `<div class="side-modal-box" style="min-width:280px">
      <p>作秀：還需選擇 <b id="showoffRem">${remaining}</b> 個效果</p>
      <div style="display:flex;flex-direction:column;gap:6px;margin:8px 0">
        ${pc.effects.map((e,i) => `<button class="plan-btn" data-eff="${i}">${e.label}</button>`).join("")}
      </div>
    </div>`;
    pc.effects.forEach((e,i) => {
      modal.querySelector(`[data-eff="${i}"]`).addEventListener("click", () => {
        e.fn(); remaining--;
        if (remaining <= 0) { game.pendingChoice=null; render(); return; }
        modal.querySelector("#showoffRem").textContent = remaining;
      });
    });

  } else if (pc.type === "opt2") {
    let toTop = [...pc.cards], toBottom = [];
    const renderOpt2 = () => {
      modal.innerHTML = `<div class="side-modal-box" style="min-width:320px">
        <p>大數據運算：決定順序</p>
        <div style="display:flex;gap:12px;margin:8px 0">
          <div style="flex:1">
            <div style="font-size:0.78rem;font-weight:800;color:var(--accent);margin-bottom:6px">放回頂（上方 = 最頂）</div>
            ${toTop.map((c,i)=>`<div class="choice-item" data-zone="top" data-idx="${i}"
              style="padding:5px 8px;border-radius:6px;border:1px solid var(--accent);background:rgba(37,209,127,0.1);
                     margin-bottom:4px;cursor:pointer;font-size:0.80rem">
              <strong>${c.name}</strong>
              <span style="float:right;font-size:0.70rem;color:var(--muted)">→底</span>
            </div>`).join("")}
            ${toTop.length === 0 ? '<div style="color:var(--muted);font-size:0.78rem">（空）</div>' : ""}
          </div>
          <div style="flex:1">
            <div style="font-size:0.78rem;font-weight:800;color:var(--warn);margin-bottom:6px">放到底</div>
            ${toBottom.map((c,i)=>`<div class="choice-item" data-zone="bottom" data-idx="${i}"
              style="padding:5px 8px;border-radius:6px;border:1px solid var(--warn);background:rgba(255,207,77,0.08);
                     margin-bottom:4px;cursor:pointer;font-size:0.80rem">
              <strong>${c.name}</strong>
              <span style="float:right;font-size:0.70rem;color:var(--muted)">→頂</span>
            </div>`).join("")}
            ${toBottom.length === 0 ? '<div style="color:var(--muted);font-size:0.78rem">（空）</div>' : ""}
          </div>
        </div>
        <p style="font-size:0.74rem;color:var(--muted)">點擊牌可在頂/底之間移動</p>
        <button class="primary" id="opt2Confirm">確認</button>
      </div>`;

      modal.querySelectorAll("[data-zone='top']").forEach(el => {
        el.addEventListener("click", () => {
          const i = parseInt(el.dataset.idx);
          toBottom.push(toTop.splice(i, 1)[0]);
          renderOpt2();
        });
      });
      modal.querySelectorAll("[data-zone='bottom']").forEach(el => {
        el.addEventListener("click", () => {
          const i = parseInt(el.dataset.idx);
          toTop.push(toBottom.splice(i, 1)[0]);
          renderOpt2();
        });
      });
      modal.querySelector("#opt2Confirm").addEventListener("click", () => {
        pc.onConfirm(toTop, toBottom);
      });
    };
    renderOpt2();
    let selected = [];
    const renderInner = () => {
      modal.innerHTML = `<div class="side-modal-box" style="min-width:300px">
        <p>${pc.prompt}</p>
        <div style="display:flex;flex-direction:column;gap:6px;margin:8px 0;max-height:240px;overflow-y:auto">
          ${pc.choices.map((fc,i) => `
            <div class="choice-item ${selected.includes(fc)?"selected":""}" data-idx="${i}"
                 style="padding:6px 10px;border-radius:6px;border:1px solid ${selected.includes(fc)?"var(--accent)":"var(--line)"};
                        background:${selected.includes(fc)?"rgba(37,209,127,0.12)":"var(--panel-2)"};cursor:pointer;font-size:0.82rem">
              <strong>${fc.name}</strong>
            </div>`).join("")}
        </div>
        <button class="primary" id="exileConfirm" ${selected.length===0?"disabled":""}>確認放逐</button>
      </div>`;
      pc.choices.forEach((fc,i) => {
        modal.querySelector(`[data-idx="${i}"]`).addEventListener("click", () => {
          selected = [fc];
          renderInner();
        });
      });
      modal.querySelector("#exileConfirm")?.addEventListener("click", () => {
        if (selected.length > 0) {
          pc.onConfirm(selected);
          if (!game.pendingChoice) continueAfterAction();
        }
      });
    };
    renderInner();
  }
}

// ── 部件面板渲染 ──────────────────────────────

function renderComponentPanel() {
  const panel = els.componentPanel;
  if (!panel) return;
  if (!game.components) { panel.innerHTML = ""; return; }

  const isOperating = game.phase === PHASE.ACTION && game.pendingBonus?.type === BONUS.OPERATE;

  const compOrder = ["engine", "aero", "gearbox"];
  const compEmoji = { engine: "⚙️", aero: "🌬", gearbox: "🔧" };

  const compPassiveDesc = {
    engine:  `基礎速度 ${game.player.baseSpeed.toFixed(1)}　速度上限 ${game.player.maxSpeed}　動力 ${game.player.maxPower}`,
    aero:    `（無固定加成）`,
    gearbox: `最高 ${game.player.maxGear} 檔<br>每升 1 檔：基礎速度 -0.5　速度上限 +3`,
  };

  panel.innerHTML = compOrder.map(cid => {
    const comp = game.components[cid];
    if (!comp) return "";
    const topEl = comp.components[comp.ptr];
    const isBlocked = cid === "engine" && game.engineBlockedThisTurn;
    const canClick  = isOperating && !isBlocked && !game.over;

    const nextEl  = comp.components[(comp.ptr + 1) % comp.components.length];
    const afterEl = comp.components[(comp.ptr + 2) % comp.components.length];

    return `
      <div class="comp-card ${canClick ? "clickable" : ""} ${isBlocked ? "blocked" : ""}"
           data-compid="${cid}"
           title="${canClick ? "點擊操作此部件" : isBlocked ? "本回合已封鎖" : ""}">
        <div class="comp-header">
          <span class="comp-name">${compEmoji[cid]} ${comp.name}</span>
          ${isBlocked ? '<span class="comp-blocked-tag">封鎖</span>' : ""}
        </div>
        <div class="comp-passive">${compPassiveDesc[cid]}</div>
        <div class="comp-top">
          <span class="comp-top-label">▶ 牌頂</span>
          <strong>${topEl ? topEl.name : "—"}</strong>
          <small>${topEl ? topEl.desc : ""}</small>
        </div>
        <div class="comp-queue">
          <span class="comp-queue-label">後續：${nextEl ? nextEl.name : "—"} → ${afterEl ? afterEl.name : "—"}</span>
        </div>
      </div>`;
  }).join("");

  // 用 addEventListener 綁定點擊（避免 onclick 字串的作用域問題）
  panel.querySelectorAll(".comp-card.clickable").forEach(card => {
    card.addEventListener("click", () => {
      const cid = card.dataset.compid;
      const comp = game.components[cid];
      if (!comp) return;
      const topEl = comp.components[comp.ptr];
      if (topEl.requiresDelta) {
        showGearPicker(cid, topEl.deltaRange);
      } else {
        operateComponent(cid);
      }
    });
  });

  // 輪胎狀態
  if (els.tyreStatus) {
    const remaining = game.tyre ? game.tyre.length : 0;
    const layers    = game.tyre ? game.tyre.map(t => t.name).join(" → ") : "—";
    els.tyreStatus.innerHTML = `
      <span class="comp-name">🏎️ 輪胎（${remaining} 層剩餘）</span>
      <small>${layers || "已磨損"}</small>`;
  }
}

// 打檔選擇 picker（inline modal）
function showGearPicker(componentId, deltaRange) {
  if (!game.pendingBonus || game.pendingBonus.type !== BONUS.OPERATE) return;
  const [min, max] = deltaRange;
  const modal = els.sideModal;
  modal.querySelector("p").textContent = "選擇檔位變化";
  const btns = modal.querySelector(".side-modal-btns");

  let html = "";
  for (let d = min; d <= max; d++) {
    if (d === 0) continue;
    html += `<button class="plan-btn gear-btn" data-delta="${d}" type="button">${d > 0 ? "+" : ""}${d} 檔</button>`;
  }
  btns.innerHTML = html;
  btns.style.gridTemplateColumns = `repeat(${max - min}, 1fr)`;

  // 用 closure 直接捕捉數字，不依賴 dataset 字串解析
  const gearBtns = btns.querySelectorAll(".gear-btn");
  let btnIdx = 0;
  for (let d = min; d <= max; d++) {
    if (d === 0) continue;
    const delta = d;  // closure 捕捉
    gearBtns[btnIdx].addEventListener("click", () => {
      const newGear = game.player.gear + delta;
      if (newGear < 1) {
        game.message(`已是最低檔（${game.player.gear} 檔），請重新選擇。`);
        render(); return;
      }
      if (newGear > game.player.maxGear) {
        game.message(`已是最高檔（${game.player.gear} 檔），請重新選擇。`);
        render(); return;
      }
      closeGearPicker();
      onGearDeltaSelected(componentId, delta);
    });
    btnIdx++;
  }

  modal.classList.remove("hidden");
}

function closeGearPicker() {
  const modal = els.sideModal;
  modal.classList.add("hidden");
  const btns = modal.querySelector(".side-modal-btns");
  // 還原原始按鈕
  btns.innerHTML = `
    <button id="sideLeft"  type="button" class="primary">← 左側</button>
    <button id="sideRight" type="button" class="primary">右側 →</button>`;
  btns.style.gridTemplateColumns = "";
  // 重新綁定事件（因為 innerHTML 已替換）
  btns.querySelector("#sideLeft").addEventListener("click", () => {
    els.sideModal.classList.add("hidden");
    if (pendingCardIndex >= 0) { playCardToSide(pendingCardIndex, "left"); pendingCardIndex = -1; }
  });
  btns.querySelector("#sideRight").addEventListener("click", () => {
    els.sideModal.classList.add("hidden");
    if (pendingCardIndex >= 0) { playCardToSide(pendingCardIndex, "right"); pendingCardIndex = -1; }
  });
}

function renderFieldZone(zoneId, cards, owner, side) {
  const zone = document.getElementById(zoneId);
  if (!zone) return;
  zone.innerHTML = "";
  zone.classList.toggle("has-cards", cards.length > 0);
  if (cards.length === 0) return;

  cards.forEach((fc, idx) => {
    const div = document.createElement("div");
    const tc = { complex: "#f05d5e", simple: "#25d17f", info: "#ffcf4d" }[fc.type] || "#aaa";
    const isMyTurn       = game.phase === PHASE.ACTION && !game.playerPassed && game.actionTurn === "player";
    const canAfford      = (fc.powerCost || 0) <= game.player.power;
    const noBonusPending = !game.pendingBonus;
    const isReaction     = fc.keywords?.includes(KW.REACTION);
    const canExecute     = owner === "player" && !fc.revealed && isMyTurn && canAfford && noBonusPending && !isReaction;

    if (fc.revealed) {
      div.className = "field-card-mini revealed-mini";
      div.style.borderLeft = `3px solid ${tc}`;
      div.innerHTML = `<span class="mini-name">${fc.name}</span><span class="mini-pressure" style="color:${tc}">壓 ${fc.pressure || 0}</span>`;
      div.addEventListener("mouseenter", e => tooltip.show(e, fc));
      div.addEventListener("mouseleave", () => tooltip.hide());

    } else if (owner === "player") {
      const borderColor = isReaction ? "#f5a623" : (canExecute ? "var(--accent)" : tc);
      const isRadioPhase = game.phase === PHASE.RADIO;
      div.className = `field-card-mini player-mini${isReaction ? " reaction-card" : ""}`;
      div.style.borderLeft = `3px solid ${borderColor}`;
      div.innerHTML = `
        <span class="mini-name">${fc.name}</span>
        <span class="mini-pressure" style="color:${tc}">壓 ${fc.pressure || 0}</span>
        ${isReaction ? '<span class="mini-reaction-icon">🔒</span>' : ""}
        ${isRadioPhase ? '<span class="mini-warn" style="color:var(--muted)">↩</span>' : ""}
        ${!canAfford && !isReaction && !isRadioPhase ? '<span class="mini-warn">⚡不足</span>' : ""}`;
      div.addEventListener("mouseenter", e => tooltip.show(e, fc));
      div.addEventListener("mouseleave", () => tooltip.hide());

      if (isRadioPhase) {
        div.classList.add("clickable");
        div.title = "點擊收回手牌";
        div.addEventListener("click", () => recallCardFromField(fc, side));
      } else if (canExecute) {
        div.classList.add("clickable");
        div.addEventListener("click", () => executeAction(side, idx));
      }

    } else {
      div.className = "field-card-mini npc-mini";
      div.innerHTML = `<span class="mini-name" style="color:var(--muted)">？</span>`;
      div.addEventListener("mouseenter", e => tooltip.showNpc(e));
      div.addEventListener("mouseleave", () => tooltip.hide());
    }

    zone.appendChild(div);
  });
}

function renderCards() {
  if (!els.cards) return;
  els.cards.innerHTML = "";
  const isRadio    = game.phase === PHASE.RADIO;
  const isReorder  = game.phase === PHASE.ACTION && game.pendingBonus?.type === BONUS.REORDER;

  game.hand.forEach((card, index) => {
    const btn = document.createElement("button");
    btn.className = "card"; btn.type = "button";
    const tc = { complex: "#f05d5e", simple: "#25d17f", info: "#ffcf4d" }[card.type] || "#aaa";
    const filter = game.pendingBonus?.cardFilter;
    const passesFilter = !filter || filter(card);
    const canPlay = (isRadio && canPlayCard(card)) || (isReorder && passesFilter);
    btn.disabled = game.over || (!isRadio && !isReorder) || !canPlay;

    const bonusTag = card.bonus ? `<span style="font-size:0.70rem;font-weight:800;color:#ffcf4d">附贈：${getBonusName(card.bonus)}</span>` : "";
    const infoTag  = card.type === "info" ? `<span style="font-size:0.70rem;font-weight:800;color:var(--warn)">行動開始時立即生效</span>` : "";
    const kwTags   = (card.keywords?.length)
      ? card.keywords.map(kw => `<span class="card-kw" data-kw="${kw}">${kw}</span>`).join("") : "";

    btn.innerHTML = `
      <span class="cost" style="background:${tc};color:#111">${card.powerCost} 動力</span>
      <span>
        <span class="type" style="background:${tc}22;color:${tc}">${getTypeName(card.type)}</span>
        <strong>${card.name}</strong>
        ${kwTags}
        <small>${card.text}</small>
        ${bonusTag}${infoTag}
      </span>
      <span class="card-pressure">施加 ${card.pressure} 壓力</span>
      <span class="play-hint">${
        isReorder ? "點擊或拖曳：再下令" :
        !isRadio  ? "等待通訊階段" :
        "拖到左側或右側"
      }</span>`;

    // 關鍵詞標籤：自訂 tooltip
    btn.querySelectorAll(".card-kw").forEach(kwEl => {
      const kw = kwEl.dataset.kw;
      kwEl.addEventListener("mouseenter", e => {
        e.stopPropagation();
        tooltip.showKw(e, kw);
      });
      kwEl.addEventListener("mousemove", e => { e.stopPropagation(); tooltip.move(e); });
      kwEl.addEventListener("mouseleave", () => tooltip.hide());
    });

    btn.addEventListener("click", () => onCardClick(index));
    btn.addEventListener("pointerdown", e => startPointerCardDrag(e, btn, index));
    els.cards.appendChild(btn);
  });
}

function render() { refreshSP(); renderHud(); renderCards(); }

// ──────────────────────────────────────────────
//  事件綁定
// ──────────────────────────────────────────────

if (els.nextPhaseBtn) els.nextPhaseBtn.addEventListener("click", () => { if (game.phase === PHASE.PLAN) startRadioPhase(); });

if (els.confirmRadioBtn) els.confirmRadioBtn.addEventListener("click", confirmRadioPhase);

if (els.playerPassBtn) els.playerPassBtn.addEventListener("click", playerPass);

if (els.overtakeLeftBtn)  els.overtakeLeftBtn.addEventListener("click",  () => fieldOvertake("left"));
if (els.overtakeRightBtn) els.overtakeRightBtn.addEventListener("click", () => fieldOvertake("right"));
if (els.noOvertakeBtn)    els.noOvertakeBtn.addEventListener("click",    fieldNoOvertake);

if (els.sideLeft) {
  els.sideLeft.addEventListener("click", () => {
    els.sideModal.classList.add("hidden");
    if (pendingCardIndex >= 0) { playCardToSide(pendingCardIndex, "left"); pendingCardIndex = -1; }
  });
}
if (els.sideRight) {
  els.sideRight.addEventListener("click", () => {
    els.sideModal.classList.add("hidden");
    if (pendingCardIndex >= 0) { playCardToSide(pendingCardIndex, "right"); pendingCardIndex = -1; }
  });
}
if (els.sideCancel) {
  els.sideCancel.addEventListener("click", () => {
    els.sideModal.classList.add("hidden");
    pendingCardIndex = -1;
  });
}

if (els.resetButton) els.resetButton.addEventListener("click", resetGame);

// 跳過附贈動作按鈕（動態綁定）
document.addEventListener("click", e => {
  if (e.target.id === "skipBonusBtn") skipBonus();
});

resetGame();
