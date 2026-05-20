// ─── 靜態資料 ─────────────────────────────────────────────────────────────
// 所有遊戲設定資料（賽段、對手、卡牌、QTE 常數）。
// 純資料，無副作用、無 import 其他模組。

// ─── QTE 常數 ─────────────────────────────────────────────────────────────
export const RHYTHM_DURATIONS      = [1150, 1150, 1150, 1150, 1800];
export const RHYTHM_BEAT_ERROR_PERFECT  = 0.05;
export const RHYTHM_BEAT_ERROR_GOOD     = 0.12;
export const RHYTHM_FORMAL_EASY_PERFECT = 0.42;
export const RHYTHM_FORMAL_EASY_GOOD    = 0.72;
export const RHYTHM_SCATTER_MIN_CENTER_DIST = 132;
export const RHYTHM_OUTER_R   = 48;
export const RHYTHM_UI_AVOID_PAD = 24;

// ─── 關卡定義 ─────────────────────────────────────────────────────────────
// 目前只有「機制驗證場」一關。未來加新關卡就往這個陣列加。
export const STAGES = [
  {
    id: "stage-5",
    title: "機制驗證場",
    isStage5: true,
    lanes: 3,
    playerLane: 1,
    opponentLane: 0,
    opponentSpeed: 50,
    noDefense: false,
    deal: "dealStage5Initial",
    opponentActions: [],
    laneBonus: null,
    laneBonuses: null,
    intro: [],
    goal: "登頂第 1 名",
  },
];

// ─── 對手陣容與行為系統 ─────────────────────────────────────────────────
// 每個 behavior 有 cooldown（觸發間隔的行動數）跟 weight（強度標籤）
//   weight: "weak"(弱招) | "medium"(中招) | "strong"(強招)
//   每回合 actionClock 從 0 重新起算
//   選擇邏輯：找出當下所有「cooldown 已滿」的行為，挑 weight 最強的觸發
//
// action 類型：
//   moveTo        target: laneIdx | "playerLane"   切到指定道
//   moveSmart     strategy: "bestForSelf" | "avoidPlayer"  依策略選道（後手最佳化）
//   moveAdjacent  隨機切相鄰道
//   boost         amount: N                         加速（少用，現在主要靠選道吃加成）
//
// ★ 對手預設不吃任何賽道加成（add/mult/speedLimit 全免疫）。
//   若需讓特定賽道也影響對手，於 lane bonus 加 forOpponent: { add, mult, speedLimit } 覆寫。
//   設計意圖：賽道是玩家的工具，對手只受自己的動作（切道/boost/absBonus）影響。
export const STAGE5_OPPONENTS = {
  A: {
    id: "A", name: "禿鷹", speed: 60, chaserSpeed: 50, focus: 0,
    behaviors: [
      // 動態策略：玩家沒吃尾流 → 遠離；吃了尾流 → 阻擋
      // 弱招（cd 1）：dynamic、無加速
      { id:"a-weak",   cooldown: 1, weight: "weak",   action: "moveSmart", strategy: "dynamicAvoidOrBlock" },
      // 強招（cd 3）：dynamic + 加速 20
      { id:"a-strong", cooldown: 3, weight: "strong", action: "moveSmart", strategy: "dynamicAvoidOrBlock", boostAfter: 20 },
    ],
    flavor: "脫逃型 — 避開玩家道、拉開距離",
  },
  B: {
    id: "B", name: "清道夫", speed: 60, chaserSpeed: 60, focus: 1,
    behaviors: [
      // 強招：阻擋玩家、自己豁免光環、取 abs 拿正加成
      // 沒弱招：B 的常駐威脅是被動光環（所在道對雙方失加成 + 抵消尾流）
      { id:"b-strong", cooldown: 2, weight: "strong", action: "moveTo", target: "playerLane", bypassAura: true, absBonus: true },
    ],
    flavor: "戰術型 — 所在道對雙方失加成、抵消尾流；強招時切到玩家道、取 abs 拿正加成",
  },
  C: {
    id: "C", name: "破風者", speed: 50, chaserSpeed: 50, focus: 0,
    behaviors: [
      // 弱招：選自己最快的道（無視玩家）+ 加速 5
      { id:"c-weak",   cooldown: 1, weight: "weak",   action: "moveSmart", strategy: "bestForSelf", boostAfter: 5 },
      // 強招：選自己最快的道（無視玩家）+ 加速 10
      { id:"c-strong", cooldown: 2, weight: "strong", action: "moveSmart", strategy: "bestForSelf", boostAfter: 10 },
    ],
    flavor: "獨行型 — 自顧自地跑最快路線、邊跑邊加速",
  },
};

// ─── 霓虹多線街區：賽段定義 ──────────────────────────────────────────────
// laneBonuses 新格式：{ lane, add, mult, speedLimit, qteDiff, label }
// add=加法加成, mult=乘法加成, speedLimit=彎道限速（顯示速度比較）
export const STAGE5_CIRCUITS = [
  {
    id:"c1", name:"直線段", icon:"🛣", lanes:2, bendCurve:0, roadWidthScale:1.0,
    type:"straight", length: 3,
    laneBonuses:[
      { lane:0, add:10,  mult:1,    label:"順風道 +10" },
      { lane:1, add:-10, mult:1,    label:"逆風道 -10" },
    ],
    hint:"順風 vs 逆風，選道是博弈",
  },
  {
    id:"c2", name:"彎道段", icon:"↩", lanes:2, bendCurve:0.18, roadWidthScale:1.0,
    type:"bend", length: 1,
    laneBonuses:[
      { lane:0, add:0, mult:1.25, speedLimit:75, qteDiff:"hard",  label:"內彎 ×1.25 | 限速 75" },
      { lane:1, add:0, mult:0.9,  speedLimit:105, qteDiff:"easy",  label:"外彎 ×0.9 | 限速 105" },
    ],
    hint:"內彎快但限速低，外彎慢但寬鬆",
  },
  {
    id:"c3", name:"直線段", icon:"🛣", lanes:3, bendCurve:0, roadWidthScale:1.0,
    type:"straight", length: 3,
    laneBonuses:[
      { lane:0, add:0,  mult:1,   label:"標準道" },
      { lane:1, add:10,  mult:1,   label:"順風道 +10" },
      { lane:2, add:-10, mult:1,   label:"逆風道 -10" },
    ],
    hint:"中間有順風道",
  },
  {
    // c4 改右彎（bendCurve 負值）：lane 0=急外彎在左、lane 1=急內彎在右
    // 跟 c2 左彎成對、視覺上一個左彎一個右彎
    id:"c4", name:"急彎段", icon:"↪", lanes:2, bendCurve:-0.28, roadWidthScale:1.0,
    type:"bend", length: 1,
    laneNames: ["急外彎", "急內彎"],
    laneBonuses:[
      { lane:0, add:0, mult:0.85, speedLimit:90, qteDiff:"easy",  label:"急外彎 ×0.85 | 限速 90" },
      { lane:1, add:0, mult:1.3,  speedLimit:60, qteDiff:"hard",  label:"急內彎 ×1.3 | 限速 60" },
    ],
    hint:"急彎限速更低，高速超車必須換道",
  },
  // ─── c7 坑洞段 ─────────────────────────────────────────────────
  // 三道 add 都 +5，但進關時隨機抽一道有坑洞（玩家可見）。
  // 走進坑洞道結算 -1 輪胎；坑洞位置存在 app.stage5.potholeLanes（陣列，2 道有坑、1 道安全）。
  {
    id:"c7", name:"坑洞段", icon:"🕳", lanes:3, bendCurve:0.1, roadWidthScale:1.0,
    type:"straight", length: 2,
    randomPothole: true,
    laneBonuses:[
      { lane:0, add:5, mult:1, label:"左道 +5" },
      { lane:1, add:5, mult:1, label:"中道 +5" },
      { lane:2, add:5, mult:1, label:"右道 +5" },
    ],
    hint:"三道都 +5，但有一道藏坑（可見）",
  },
  // ─── c6 油污段 ─────────────────────────────────────────────────
  // 中央道強制彎道 QTE：踏入即觸發（不看速度）；失敗 -1 胎 + 1 失誤牌 + 滑到鄰道。
  // 油污中央道 QTE 難度 +1 級（只有踏進中央時、QTE 才變難）。
  {
    id:"c6", name:"油污段", icon:"🛢", lanes:3, bendCurve:0, roadWidthScale:1.0,
    type:"straight", length: 2,
    laneBonuses:[
      { lane:0, add:-10, mult:1, label:"外緣 -10（安全）" },
      { lane:1, add:+10, mult:1,
        forceCornerQte: true,        // 踏入此道強制觸發彎道 QTE
        slipOnQteFail: "adjacent",   // QTE 失敗時滑到隨機鄰道
        qteDifficultyOffset: 1,      // 這道的 QTE 難度 +1 級
        label:"油污中央 +10（強制 QTE）"
      },
      { lane:2, add:-10, mult:1, label:"外緣 -10（安全）" },
    ],
    hint:"中央 +10 但強制彎道 QTE、難度 +1 級",
  },
  // ─── c8 紅綠燈干擾路段 ────────────────────────────────────────────
  // 電磁場干擾路面：三道 add 從機率分布獨立抽取，每次進入 c8 都重抽。
  // 引擎在 applyCircuit 時把 laneBonusDistribution 解析成實際的 laneBonuses。
  // 預設未揭曉顯示「?」，玩家駛過某道後該道在這圈 c8 內永遠揭曉。
  {
    id:"c8", name:"紅綠燈干擾路段", icon:"🚦", lanes:3, bendCurve:0, roadWidthScale:1.0,
    type:"straight", length: 2,
    hideLaneBonusUntilVisited: true,   // 駛過揭曉機制旗標
    laneNames: ["紅道", "黃道", "綠道"],
    laneColors: ["#ff5b5b", "#ffd24a", "#5be86f"],
    laneBonusDistribution: [
      { value: -20, weight:  5 },
      { value: -15, weight: 10 },
      { value: -10, weight: 15 },
      { value:  -5, weight: 20 },
      { value:  +5, weight: 20 },
      { value: +10, weight: 15 },
      { value: +15, weight: 10 },
      { value: +20, weight:  5 },
    ],
    // laneBonuses 在 applyCircuit 動態生成（不要寫死）
    laneBonuses: null,
    hint:"紅綠燈電磁干擾——三道加成隱藏，駛過才知道",
  },
];
// 一般循環的「賽段池」（c1-c4 + c7 + c6 + c8）— 每次開局會隨機洗牌一次，
// 結果存在 app.stage5.circuitOrder，之後整局都沿這個固定順序循環。
// 注意：array index 跟 id 不對應（id 是字串、index 只是位置）。
//   0=c1, 1=c2, 2=c3, 3=c4, 4=c7, 5=c6, 6=c8
export const STAGE5_NORMAL_CIRCUITS_POOL = [0,1,2,3,4,5,6];
// ─── 第五關卡池（v0.9 重設計） ─────────────────────────────────────────
// 指令牌：拖到自己道上打 → +speedValue（玩家動作）；可選效果：tireCost、canChangeLane、qteOnPlay
export const STAGE5_COMMAND_CARDS = {
  turbo:         { type:"turbo",         cardClass:"action", name:"渦輪增壓", speedValue:30, note:"", color:"red" },
  tailwind:      { type:"tailwind",      cardClass:"action", name:"加速",     speedValue:20, note:"", color:"basic" },
  drag:          { type:"drag",          cardClass:"action", name:"風阻減免", speedValue:15, note:"", color:"basic" },
  laneRhythm:    { type:"laneRhythm",    cardClass:"action", name:"換道節奏", speedValue:15, tireCost:1, note:"打加速後換道且消耗 1 胎", canChangeLane:true, color:"red" },
  nitro:         { type:"nitro",         cardClass:"action", name:"氮氣噴射", speedValue:60, tireCost:1, note:"消耗 1 胎", color:"red" },
  reignite:      { type:"reignite",      cardClass:"action", name:"重燃引擎", speedValue:25, note:"下回合手牌 +1", drawNextHand:1, color:"green" },
  drift:         { type:"drift",         cardClass:"action", name:"甩尾過彎", speedValue:0,  note:"僅彎道：必觸 QTE，依結果調整賽道加成（成功 +60 / Good +30 / Miss -10）", driftQte:true, requireBend:true, color:"blue" },
  chill:         { type:"chill",         cardClass:"action", name:"冷靜應對", speedValue:10, note:"本動 QTE 容錯 +50%", qteForgive:0.5, color:"yellow" },
  smoothOp:      { type:"smoothOp",      cardClass:"action", name:"賽車節奏", speedValue:20, note:"前一動作也是指令牌 → +40", smoothOperator:true, color:"black" },
  mistake:       { type:"mistake",       cardClass:"action", name:"失誤",     speedValue:0,  note:"無效果", color:"basic" },
};


// 車隊牌：兩個獨立維度
//   trigger      何時觸發 / 是否進牌庫
//     - "equip" → 獎勵階段選了立即生效、不進牌庫、不會出現在手牌
//     - "play"  → 進牌庫、洗到手牌、拖出來才生效
//   persistence  何時消失（觸發後）
//     - "permanent"    永久（直到遊戲結束）
//     - "oneShot"      條件達成觸發一次後消失（如 backup、patch）
//     - "untilRankUp"  名次上升時消失
//     - "thisRound"    回合結束時消失
// 設計意圖：兩個維度獨立、可組合出例如「進牌庫但效果永久」這種卡
export const STAGE5_TEAM_CARDS = {
  // === 裝備類（trigger: equip）— 選了立即生效、不進牌庫 ===
  newTireWarm:      { type:"newTireWarm",      cardClass:"team", name:"暖胎電熱絲",   note:"啟動時 -1 輪胎；之後每回合結算後保留 +10 速度",     effect:"keepSpeed",           value:10, costOnEquip:{ tire:1 }, trigger:"equip", persistence:"permanent",  persistenceLabel:"永久",      color:"team" },
  bigData:          { type:"bigData",          cardClass:"team", name:"大數據預測",   note:"預告升級：顯示對手下一招的具體內容",              effect:"showOpponent",        value:1,                          trigger:"equip", persistence:"permanent",  persistenceLabel:"永久",      color:"team" },
  backup:           { type:"backup",           cardClass:"team", name:"後援車隊",     note:"裝備後生效；防守失敗時不掉名次，觸發一次後消失",   effect:"saveOnDefeat",        value:1,                          trigger:"equip", persistence:"oneShot",    persistenceLabel:"觸發後棄",  color:"team" },
  patch:            { type:"patch",            cardClass:"team", name:"補丁",         note:"撞坑時不扣胎、不降速(一次)",                   effect:"savePothole",         value:1,                          trigger:"equip", persistence:"oneShot",    persistenceLabel:"觸發後棄",  color:"team" },
  tirePreservation: { type:"tirePreservation", cardClass:"team", name:"保胎策略",     note:"所有指令牌 -10 速度；無視每回合第 1 次輪胎消耗",effect:"tirePreserve",        value:1,                          trigger:"equip", persistence:"permanent",  persistenceLabel:"永久",      color:"team" },
  // === 打出類（trigger: play）— 進牌庫、需要打出才生效 ===
  fuelMaster:       { type:"fuelMaster",       cardClass:"team", name:"燃料管理大師", note:"本回合內、所有指令牌 +5 速度",                   effect:"cardBonusThisRound",  value:5,                          trigger:"play",  persistence:"thisRound",  persistenceLabel:"本回合",    color:"team" },
  rhythmCoach:      { type:"rhythmCoach",      cardClass:"team", name:"節奏教練",     note:"本回合內、連續同名指令牌：第 2 張 +10、第 3 張 +20", effect:"comboBonusThisRound", value:10,                         trigger:"play",  persistence:"thisRound",  persistenceLabel:"本回合",    color:"team" },
};
export const STAGE5_ALL_CARDS = { ...STAGE5_COMMAND_CARDS, ...STAGE5_TEAM_CARDS };
