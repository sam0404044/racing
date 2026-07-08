// ─── 靜態資料 ─────────────────────────────────────────────────────────────
// 所有遊戲設定資料（賽段、對手、卡牌、QTE 常數）。
// 純資料，無副作用、無 import 其他模組。

// ─── QTE 常數 ─────────────────────────────────────────────────────────────
export const RHYTHM_DURATIONS      = [1380, 1380, 1380, 1380, 2160];
// 超車 QTE 圓圈起點的基礎間隔（ms）。越大圈攤越開、同時在場的圈越少、越好按。
// 只受道路難度縮放（easy ×1.25 / hard ×0.75），不隨速度檔位變 → 不影響攀升曲線。
export const RHYTHM_BASE_INTERVAL  = 760;
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
    id: "stage-2",
    title: "機制驗證場",
    isStage2: true,
    hasTires: true,            // 第三關移植：輪胎機制啟用
    lanes: 3,
    playerLane: 1,
    opponentLane: 0,
    opponentSpeed: 50,
    noDefense: false,
    deal: "dealStage2Initial",
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
export const STAGE2_OPPONENTS = {
  P: {
    id: "P", name: "陪跑員", speed: 40, chaserSpeed: 40, focus: 1,
    behaviors: [
      // cd 3、strong：lastTriggeredAt 初始為 0、要等滿 3 動才觸發
      // → 名條顯示「3 動後 ⛔」倒數、第 3 動結束才切過來阻擋
      { id:"p-block", cooldown: 3, weight: "strong", action: "moveTo", target: "playerLane" },
    ],
    flavor: "陪跑員 — 你的訓練夥伴、總是切到你的道上阻擋",
  },
  A: {
    id: "A", name: "禿鷹", speed: 60, chaserSpeed: 50, focus: 1,
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
  // ─── 霓虹多線街區 最終 Boss：NCC-7 ─────────────────────────────────────
  // 設定文件：BOSS_DESIGN.md
  // Phase 1：移動層（cd 1 dynamicAvoidOrBlock）✓
  // Phase 2：企業間諜（cd 2、per-source 抽 50% 玩家加速、轉嫁、Boss 飛字累計）✓
  // Phase 3（目前）：績效考核（cd 3、任務驅動 + Buff/Debuff 績效螺旋）
  //   - 觸發：評分當前任務 → 派發新任務
  //   - 任務難度 = buff stacks + 1（capped at 3、buff=3 時抽兩個任務）
  //   - Buff（達標）：QTE 難度 -1 / stack、最多 3、清掉 debuff
  //   - Debuff（未達標）：QTE 難度 +1 / stack、最多 3、清掉 buff
  // Phase 4（TODO）：focus 1 觸發企業壓制（移動 / 間諜 cd -1、績效考核 cd 不變）
  BOSS: {
    id: "BOSS", name: "NCC-7", speed: 50, chaserSpeed: 50, focus: 2,
    behaviors: [
      // 移動層：cd 1、每動觸發、依玩家動作前位置決定避或擋
      { id:"ncc7-move",       cooldown: 1, weight: "weak",    action: "moveSmart", strategy: "dynamicAvoidOrBlock" },
      // 企業間諜：cd 2、per-source 抽 50% 玩家速度
      { id:"ncc7-espionage",  cooldown: 2, weight: "passive", action: "espionage", skimRatio: 0.5 },
      // 績效考核：cd 3、評分當前任務 + 派發新任務
      { id:"ncc7-perfreview", cooldown: 3, weight: "passive", action: "performanceReview" },
    ],
    flavor: "霓虹道路株式會社：NCC-7 — 管制本街區路權的企業 AI",
  },
};

// ─── NCC-7 績效考核任務池 ────────────────────────────────────────────
// 5 大類 × 3 等級。每個任務的 def 包含：
//   id            — 唯一識別（用於 taskHistory 去重）
//   type          — move / resource / tactic / output / combat
//   level         — 1 / 2 / 3
//   targetN       — 達標需要的進度數字
//   displayText   — MEMO 紙條顯示文字
//   special       — 特殊處理標記（uniqueLanes / stabilityOnly / cardPlayOnly / recursive2L1）
export const BOSS_TASK_POOL = {
  // 移動類
  move_l1:    { id:"move_l1",    type:"move",     level:1, targetN:2,  displayText:"換道 2 次" },
  move_l2:    { id:"move_l2",    type:"move",     level:2, targetN:3,  displayText:"換道 3 次" },
  move_l3:    { id:"move_l3",    type:"move",     level:3, targetN:3,  displayText:"3 道各踩 1 次", special:"uniqueLanes" },
  // 資源類
  resource_l1:{ id:"resource_l1",type:"resource", level:1, targetN:1,  displayText:"棄 1 張到穩定區", special:"stabilityOnly" },
  resource_l2:{ id:"resource_l2",type:"resource", level:2, targetN:2,  displayText:"棄 2 張到穩定區", special:"stabilityOnly" },
  resource_l3:{ id:"resource_l3",type:"resource", level:3, targetN:3,  displayText:"棄 3 張牌（穩定區+換道）", special:"stabilityOrLaneChange" },
  // 戰術類
  tactic_l1:  { id:"tactic_l1",  type:"tactic",   level:1, targetN:2,  displayText:"打 2 張車隊牌" },
  tactic_l2:  { id:"tactic_l2",  type:"tactic",   level:2, targetN:3,  displayText:"打 3 張車隊牌" },
  tactic_l3:  { id:"tactic_l3",  type:"tactic",   level:3, targetN:0,  displayText:"完成兩個 L1 任務", special:"recursive2L1" },
  // 產出類（淨加速、含 espionage 抽走後的淨值）
  output_l1:  { id:"output_l1",  type:"output",   level:1, targetN:15, displayText:"累積淨加速 +15" },
  output_l2:  { id:"output_l2",  type:"output",   level:2, targetN:20, displayText:"累積淨加速 +20" },
  output_l3:  { id:"output_l3",  type:"output",   level:3, targetN:25, displayText:"累積淨加速 +25" },
  // 戰鬥類
  combat_l1:  { id:"combat_l1",  type:"combat",   level:1, targetN:1,  displayText:"吃尾流 1 次" },
  combat_l2:  { id:"combat_l2",  type:"combat",   level:2, targetN:2,  displayText:"打 2 張指令牌", special:"cardPlayOnly" },
  combat_l3:  { id:"combat_l3",  type:"combat",   level:3, targetN:1,  displayText:"成功 1 次 QTE" },
};

// ─── 霓虹多線街區：賽段定義 ──────────────────────────────────────────────
// laneBonuses 新格式：{ lane, add, mult, speedLimit, qteDiff, label }
// add=加法加成, mult=乘法加成, speedLimit=彎道限速（顯示速度比較）
export const STAGE2_CIRCUITS = [
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
  // ─── c7 坑洞段（第三關移植）──────────────────────────────────────
  // 三道 add 都 +5，但進段時隨機抽 1 安全道、其他都是坑（玩家可見）。
  // 走進坑洞道結算 -1 輪胎；坑洞位置存在 app.stage2.potholeLanes。
  {
    id:"c7", name:"坑洞段", icon:"🕳", lanes:3, bendCurve:0.1, roadWidthScale:1.0,
    type:"straight", length: 2,
    randomPothole: true,
    laneBonuses:[
      { lane:0, add:5, mult:1, label:"左道 +5" },
      { lane:1, add:5, mult:1, label:"中道 +5" },
      { lane:2, add:5, mult:1, label:"右道 +5" },
    ],
    hint:"三道都 +5，但有兩道藏坑（可見）",
  },
  // ─── c6 油污段（第三關移植）──────────────────────────────────────
  // 油污道強制彎道 QTE：踏入即觸發（不看速度）；失敗 -1 胎 + 1 失誤牌 + 滑到鄰道。
  // 油污道 QTE 難度 +1 級；油污位置每次進段隨機重抽（rerollCircuitHazards）。
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
    hint:"油污 +10 但強制彎道 QTE、難度 +1 級",
  },
];
// 一般循環的「賽段池」（c1-c4 + c8 + c7 + c6）— 每次開局會隨機洗牌一次，
// 結果存在 app.stage2.circuitOrder，之後整局都沿這個固定順序循環。
// 注意：array index 跟 id 不對應（id 是字串、index 只是位置）。
//   0=c1, 1=c2, 2=c3, 3=c4, 4=c8, 5=c7, 6=c6
export const STAGE2_NORMAL_CIRCUITS_POOL = [0,1,2,3,4,5,6];
// ─── 第二關卡池 ─────────────────────────────────────────
// 指令牌：拖到自己道上打 → +speedValue（玩家動作）；可選效果：canChangeLane、qteOnPlay
export const STAGE2_COMMAND_CARDS = {
  turbo:         { type:"turbo",         cardClass:"action", name:"渦輪增壓", speedValue:30, note:"", color:"red" },
  tailwind:      { type:"tailwind",      cardClass:"action", name:"加速",     speedValue:20, note:"", color:"basic" },
  drag:          { type:"drag",          cardClass:"action", name:"風阻減免", speedValue:15, note:"打出後若吃到對手尾流、尾流加成 +20", slipstreamBonusOnLaneChange:20, color:"basic" },
  laneRhythm:    { type:"laneRhythm",    cardClass:"action", name:"換道節奏", speedValue:15, tireCost:1, note:"打加速後換道且消耗 1 胎", canChangeLane:true, color:"red" },
  nitro:         { type:"nitro",         cardClass:"action", name:"氮氣噴射", speedValue:60, tireCost:1, note:"消耗 1 胎", color:"red" },
  reignite:      { type:"reignite",      cardClass:"action", name:"重燃引擎", speedValue:25, note:"下回合手牌 +1", drawNextHand:1, color:"green" },
  drift:         { type:"drift",         cardClass:"action", name:"甩尾過彎", speedValue:0,  note:"僅彎道可使用：必定觸發彎道 QTE、依結果獲得額外賽道加成（通過 +30、失敗 -20）", driftQte:true, requireBend:true, driftBonusPass:30, driftBonusFail:-20, color:"blue" },
  chill:         { type:"chill",         cardClass:"action", name:"冷靜應對", speedValue:10, note:"本動 QTE 容錯 +50%", qteForgive:0.5, color:"yellow" },
  smoothOp:      { type:"smoothOp",      cardClass:"action", name:"賽車節奏", speedValue:20, note:"若前一行動有結算指令效果、此牌結算加速度為 40", smoothOperator:true, color:"black" },
  fuelMaster:    { type:"fuelMaster",    cardClass:"action", name:"Push! Push!", speedValue:10, note:"本回合所有加速牌 +10 速度", effect:"cardBonusThisRound", value:10, color:"red" },
  mistake:       { type:"mistake",       cardClass:"action", name:"失誤",     speedValue:0,  note:"無效果（由彎道 QTE 失敗加入牌庫）", color:"basic" },
  standard:      { type:"standard",      cardClass:"action", name:"標準指令", speedValue:15, note:"排位賽配發、無特效", color:"basic" },
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
export const STAGE2_TEAM_CARDS = {
  // === 裝備類（trigger: equip）— 選了立即生效、不進牌庫 ===
  newTireWarm:      { type:"newTireWarm",      cardClass:"team", name:"暖胎電熱絲",   note:"啟動時 -1 輪胎；之後每回合結算後保留 +10 速度",     effect:"keepSpeed",           value:10, costOnEquip:{ tire:1 }, trigger:"equip", persistence:"permanent",  persistenceLabel:"永久",      color:"team" },
  bigData:          { type:"bigData",          cardClass:"team", name:"大數據預測",   note:"預告升級：顯示對手下一招的具體內容",              effect:"showOpponent",        value:1,                          trigger:"equip", persistence:"permanent",  persistenceLabel:"永久",      color:"team" },
  backup:           { type:"backup",           cardClass:"team", name:"後援車隊",     note:"裝備後生效；防守失敗時不掉名次，觸發一次後消失",   effect:"saveOnDefeat",        value:1,                          trigger:"equip", persistence:"oneShot",    persistenceLabel:"觸發後棄",  color:"team" },
  patch:            { type:"patch",            cardClass:"team", name:"補丁",         note:"撞坑時不扣胎、不降速(一次)",                   effect:"savePothole",         value:1,                          trigger:"equip", persistence:"oneShot",    persistenceLabel:"觸發後棄",  color:"team" },
  tirePreservation: { type:"tirePreservation", cardClass:"team", name:"保胎策略",     note:"所有指令牌 -10 速度；無視每回合第 1 次輪胎消耗",effect:"tirePreserve",        value:1,                          trigger:"equip", persistence:"permanent",  persistenceLabel:"永久",      color:"team" },
  // === 打出類（trigger: play）— 進牌庫、需要打出才生效 ===
  rhythmCoach:      { type:"rhythmCoach",      cardClass:"team", name:"節奏教練",     note:"本回合內、連續結算指令牌：第 2 張 +10、第 3 張 +20", effect:"comboBonusThisRound", value:10,                         trigger:"play",  persistence:"thisRound",  persistenceLabel:"本回合",    color:"team" },
};
export const STAGE2_ALL_CARDS = { ...STAGE2_COMMAND_CARDS, ...STAGE2_TEAM_CARDS };

// ═══════════════════════════════════════════════════════════════════════
// ─── 霓虹大獎賽週末（聯賽 demo）────────────────────────────────────────
// 以下為「賽事週末」模式新增的純資料：pack 車手、排位賽參數、衝刺賽兌換。
// ═══════════════════════════════════════════════════════════════════════

// ─── 大隊人馬（pack 車手）────────────────────────────────────────────
// 填充起跑格的 generic 人類車手：性格淡、強度浮動、排位裡先被刷掉的那群。
// （日後 AI 取代事件裡、最先被換掉的人類也是他們。）
// 行為刻意簡單：自顧自跑線、偶爾小加速 — 正賽 1v1 時是「路過的流量」。
export const PACK_DRIVERS = {
  D1: {
    id: "D1", name: "小路", speed: 46, chaserSpeed: 42, focus: 0,
    behaviors: [
      { id:"d1-weak", cooldown: 1, weight: "weak", action: "moveSmart", strategy: "bestForSelf" },
    ],
    flavor: "大隊人馬 — 新秀車手、照本宣科地跑線",
  },
  D2: {
    id: "D2", name: "阿岩", speed: 44, chaserSpeed: 42, focus: 0,
    behaviors: [
      { id:"d2-weak", cooldown: 2, weight: "weak", action: "moveSmart", strategy: "bestForSelf", boostAfter: 5 },
    ],
    flavor: "大隊人馬 — 老將、穩但慢",
  },
  D3: {
    id: "D3", name: "千野", speed: 42, chaserSpeed: 40, focus: 0,
    behaviors: [
      { id:"d3-weak", cooldown: 2, weight: "weak", action: "moveAdjacent" },
    ],
    flavor: "大隊人馬 — 替補車手、跑線飄忽",
  },
  D4: {
    id: "D4", name: "莫克", speed: 40, chaserSpeed: 38, focus: 0,
    behaviors: [
      { id:"d4-weak", cooldown: 2, weight: "weak", action: "moveSmart", strategy: "bestForSelf" },
    ],
    flavor: "大隊人馬 — 靠贊助擠進來的散戶車手",
  },
};
// 併入對手總表：引擎 applyOpponentToApp / focus map 直接吃得到
Object.assign(STAGE2_OPPONENTS, PACK_DRIVERS);

// ─── 週末起跑名單（9 台）──────────────────────────────────────────────
// qualiBase / qualiJitter：排位賽每賽段 AI 產出的 pace（base ± jitter 均勻分布）
// 名牌對手強而穩、pack 弱而飄。NCC-7 不參加排位/衝刺、只在正賽空降。
export const WEEKEND_ROSTER = [
  { id: "PLAYER", isPlayer: true },
  { id: "A",  qualiBase: 22, qualiJitter: 6 },
  { id: "B",  qualiBase: 20, qualiJitter: 6 },
  { id: "C",  qualiBase: 19, qualiJitter: 6 },
  { id: "P",  qualiBase: 15, qualiJitter: 5 },
  { id: "D1", qualiBase: 16, qualiJitter: 7 },
  { id: "D2", qualiBase: 14, qualiJitter: 7 },
  { id: "D3", qualiBase: 13, qualiJitter: 6 },
  { id: "D4", qualiBase: 12, qualiJitter: 6 },
];

// ─── 排位賽（輕量計分淘汰）────────────────────────────────────────────
// 結構：3 圈、每圈 3 賽段。每賽段玩家從固定卡池挑 1 張打出（整場共用、不補牌），
// 速度整場累積、不重置；每跑完一圈刷掉累積最低 3 台、起跑格鎖死。
// 卡池 12 張、全場只打 9 張 → 「強牌何時花」就是排位的取捨。
export const QUALI_CONFIG = {
  laps: 3,
  segmentsPerLap: 7,
  cutPerLap: 3,
  segmentNames: ["直線段", "彎道段", "霓虹街區"],
};
// 排位實跑賽段池（含災害段；index 對應 STAGE2_CIRCUITS）— 每場洗牌、每張牌跑 1 段。
//   0=c1直線 1=c2彎 2=c3直 3=c4急彎 4=c8紅綠燈 5=c7坑洞 6=c6油污
export const QUALI_CIRCUIT_POOL = [0,1,2,3,4,5,6];
// 基礎牌庫的牌型清單 — 必須與 game.js makeStage2InitialDeck 的內容一致（順序不拘）。
// 排位賽用它＋玩家獎勵牌生成指令包（取速度值；失誤牌不進池）。
export const BASE_DECK_TYPES = ["drag", "tailwind", "tailwind", "turbo", "turbo", "tailwind", "drag", "mistake"];
// 排位指令包設定：固定 12 張、不足以標準指令補滿（牌庫超過 12 張時、日後改出選牌介面）
export const QUALI_POOL_SIZE = 12;
export const QUALI_FILLER_CARD = { name: "標準指令", value: 15 };

// （保留作參考／退路：原固定中性池。現行排位池改由玩家牌庫生成、不再使用這份。）
export const QUALI_PLAYER_POOL = [
  { name: "氮氣噴射",   value: 60 },
  { name: "渦輪增壓",   value: 30 },
  { name: "渦輪增壓",   value: 30 },
  { name: "重燃引擎",   value: 25 },
  { name: "加速",       value: 20 },
  { name: "加速",       value: 20 },
  { name: "風阻減免",   value: 15 },
  { name: "風阻減免",   value: 15 },
  { name: "冷靜應對",   value: 10 },
  { name: "冷靜應對",   value: 10 },
  { name: "保守巡航",   value: 5  },
  { name: "保守巡航",   value: 5  },
];

// ─── 衝刺賽兌換（buff ＋ 獎勵牌）──────────────────────────────────────
// buff 全部復用引擎既有效果、不發明新機制：
//   warmTires → keepSpeed（暖胎電熱絲）
//   momentum  → 每回合開局自帶 1 格穩定區（穩定區每回合歸零、buff 提供地板值）
//   intel     → showOpponent（大數據預測）
export const SPRINT_BUFFS = [
  { id: "warmTires", name: "暖胎完成", desc: "正賽每回合結算後保留 +10 速度" },
  { id: "momentum",  name: "氣勢如虹", desc: "正賽每回合開局自帶 1 格穩定區" },
  { id: "intel",     name: "賽前情報", desc: "正賽全程顯示對手下一招的具體內容" },
];
// 衝刺名次 → 兌換檔位：
//   第 1 名     → buff 三選一 ＋ 強牌池三選一
//   第 2–3 名   → buff 三選一 ＋ 普通池三選一
//   第 4–6 名   → 普通池三選一
//   第 7 名以後 → 空手進正賽
export const SPRINT_REWARD_POOL_STRONG = ["nitro", "turbo", "drift", "laneRhythm", "smoothOp"];
export const SPRINT_REWARD_POOL_NORMAL = ["tailwind", "drag", "chill", "reignite", "fuelMaster"];
