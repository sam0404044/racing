/**
 * Final Driver — Prototype v0.5
 * 核心架構：多道 + 動力 + 兩類牌 + 對手速度門檻 + 教學關卡
 * 沿用 Sam 版本的 QTE / 視覺 / 音樂系統
 *
 * Mode 流程：
 *   start-ready
 *   → stage-1-intro → tutorial-play → (手牌完) → tutorial-overtake-qte → rhythm-formal → result → stage-1-clear
 *   → stage-2-intro → tutorial-play → rhythm-formal (forced QTE) → result → stage-2-clear
 *   → stage-3-intro → tutorial-play → (pass) → defense → defense-result → stage-3-clear
 *   → stage-4-intro → tutorial-play → (full system) → ...
 */

function initQteTest() {
  const root = document.querySelector("#qteTestRoot");
  if (root) CanvasQteTest.start(root);
}

const CanvasQteTest = (() => {
  // ─── 音樂 ────────────────────────────────────────────────────────────────
  const NORMAL_STAGE_BGM_SRC = "../assets/BGM/001.mp3";
  const BLIND_DESERT_CG_SRC  = "../assets/blind-card-desert-boss.png";
  const BLIND_DESERT_BGM_SRC = "../assets/BGM/BOSS.mp3";
  const BOSS_ENTRANCE_LAYER_SRCS = [
    "../assets/BOSS/boss-intro-red-banner.png",
    "../assets/BOSS/boss-intro-title-code.png",
    "../assets/BOSS/boss-intro-quote-panel.png",
    "../assets/BOSS/boss-intro-sand-sweep.png",
    "../assets/BOSS/boss-intro-bottom-panel.png",
    "../assets/BOSS/boss-intro-stats-bars.png",
    "../assets/BOSS/boss-intro-mask-emblem.png",
    "../assets/BOSS/boss-intro-portrait.png",
  ];
  const bossCgImage = new Image();
  bossCgImage.src = BLIND_DESERT_CG_SRC;
  const bossEntranceLayers = BOSS_ENTRANCE_LAYER_SRCS.map(src => {
    const img = new Image();
    img.src = src;
    return img;
  });
  function smooth01(v) {
    const t = Math.max(0, Math.min(1, v));
    return t * t * (3 - 2 * t);
  }
  function drawImageInRect(img, x, y, w, h, alpha = 1, mode = "contain") {
    if (!img || !img.complete || !(img.naturalWidth || img.width)) return;
    const ctx = app.ctx;
    const iw = img.naturalWidth || img.width || 16;
    const ih = img.naturalHeight || img.height || 9;
    const scale = mode === "cover" ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, alpha));
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
  }
  const normalBgm = new Audio(NORMAL_STAGE_BGM_SRC);
  normalBgm.loop = true; normalBgm.preload = "auto"; normalBgm.volume = 0.58;
  const bossBgm = new Audio(BLIND_DESERT_BGM_SRC);
  bossBgm.loop = true; bossBgm.preload = "auto"; bossBgm.volume = 0.72;
  function bindBgmLoopFallback(a) {
    a.addEventListener("ended", () => { if (a.loop) { a.currentTime = 0; a.play().catch(()=>{}); } });
  }
  bindBgmLoopFallback(normalBgm);
  bindBgmLoopFallback(bossBgm);
  function playNormalBgm() { const p=normalBgm.play(); if(p) p.catch(()=>{ app.normalBgmPending=true; }); }
  function stopNormalBgm() { normalBgm.pause(); normalBgm.currentTime=0; }
  function playBossBgm()   { stopNormalBgm(); const p=bossBgm.play(); if(p) p.catch(()=>{}); }
  function stopBossBgm()   { bossBgm.pause(); bossBgm.currentTime=0; }

  // ─── QTE 常數 ─────────────────────────────────────────────────────────────
  const RHYTHM_DURATIONS      = [1150, 1150, 1150, 1150, 1800];
  const RHYTHM_BEAT_ERROR_PERFECT  = 0.05;
  const RHYTHM_BEAT_ERROR_GOOD     = 0.12;
  const RHYTHM_FORMAL_EASY_PERFECT = 0.42;
  const RHYTHM_FORMAL_EASY_GOOD    = 0.72;
  const RHYTHM_SCATTER_MIN_CENTER_DIST = 132;
  const RHYTHM_OUTER_R   = 48;
  const RHYTHM_UI_AVOID_PAD = 24;

  // ─── 牌型定義 ─────────────────────────────────────────────────────────────
  const CARD_TYPES = {
    accel:       { type:"accel",       cardClass:"action", name:"加速",   speedValue:20, note:"速度 +20" },
    hyper_accel: { type:"hyper_accel", cardClass:"action", name:"超加速", speedValue:40, tireCost:1, note:"速度 +40、消耗 1 胎" },
    mistake:     { type:"mistake",     cardClass:"action", name:"失誤",   speedValue:0, note:"無效果" },
  };

  // ─── 教學關卡定義 ──────────────────────────────────────────────────────────
  const STAGES = [
    {
      id: "stage-1",
      title: "關卡 1：認識打牌與換道",
      lanes: 3,
      playerLane: 1,
      opponentLane: 1,
      opponentSpeed: 30,
      noDefense: true,  // 教學關：不進防守 QTE
      deal: "dealStage1",
      opponentActions: [],
      laneBonus: null,
      laneBonuses: null,
      intro: [],
      goal: "換道後超車成功",
    },
    {
      id: "stage-2",
      title: "關卡 2：認識 QTE",
      lanes: 1,
      playerLane: 0,
      opponentLane: 0,
      opponentSpeed: 50,
      noDefense: true,  // 教學關：不進防守 QTE
      roadWidthScale: 0.42,  // 賽道實際寬度縮小到 42%（原本是 1.0）
      deal: "dealStage2",
      opponentActions: [],
      laneBonus: null,
      laneBonuses: null,
      intro: [],   // overlay step 0 負責說明
      goal: "QTE 超車成功",
    },
    {
      id: "stage-3",
      title: "關卡 3：賽道差異與對手行動",
      lanes: 2,
      playerLane: 0,    // 內彎（左道）— 速度高但 QTE 難
      opponentLane: 1,  // 外彎（右道）— 對手在易超車側
      opponentSpeed: 40,
      noDefense: true,  // 教學關：不進防守 QTE
      bendCurve: 0.18,  // 賽道彎度（正值=遠方向左彎、負值=向右彎）
      deal: "dealStage3",
      // 對手反應：第三關用教學 step 直接觸發（依玩家動作），不用通用排程
      opponentActions: [],
      laneBonus: null,
      // 每道各自的加成（speedMult + QTE 難度）
      laneBonuses: [
        { lane: 0, speedMult: 1.25, qteDiff: "hard",   label: "內彎 ×1.25 / QTE 難" },
        { lane: 1, speedMult: 0.9, qteDiff: "easy",  label: "外彎 ×0.9 / QTE 易" },
      ],
      intro: [],
      goal: "利用賽道差異超車",
    },
    {
      id: "stage-4",
      title: "關卡 4：認識防守",
      lanes: 3,
      playerLane: 1,
      opponentLane: 0,
      opponentSpeed: 80,
      chaserSpeed: 30,  // 後車速度；玩家失誤牌打不出速度，會被追上
      deal: "dealStage4",
      opponentActions: [],
      laneBonus: null,
      laneBonuses: null,
      intro: [],   // overlay step 自己說明
      goal: "防守成功",
    },
    // ─── 沙盒：機制驗證場（沿用第五關架構，已拿掉沙暴與 Boss）─────────────────
    {
      id: "stage-5",
      title: "沙盒：機制驗證場",
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
      goal: "登頂第 1 名並擊敗 Boss",
    },
  ];

  // ─── 第五關：對手陣容定義 ───────────────────────────────────────────────
  // ─── 對手行為「冷卻」系統 ──────────────────────────────────────────────
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
  // 註：保留向下相容的 actions 欄位（onActionN/onCardN）給教學關用
  const STAGE5_OPPONENTS = {
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
  const STAGE5_CIRCUITS = [
    {
      id:"c1", name:"直線段", icon:"🛣", lanes:2, bendCurve:0, roadWidthScale:1.0,
      type:"straight",
      laneBonuses:[
        { lane:0, add:10,  mult:1,    label:"順風道 +10" },
        { lane:1, add:-10, mult:1,    label:"逆風道 -10" },
      ],
      sandLevel:0, hint:"順風 vs 逆風，選道是博弈",
    },
    {
      id:"c2", name:"彎道段", icon:"↩", lanes:2, bendCurve:0.18, roadWidthScale:1.0,
      type:"bend",
      laneBonuses:[
        { lane:0, add:0, mult:1.25, speedLimit:75, qteDiff:"hard",  label:"內彎 ×1.25 | 限速 75" },
        { lane:1, add:0, mult:0.9,  speedLimit:105, qteDiff:"easy",  label:"外彎 ×0.9 | 限速 105" },
      ],
      sandLevel:0, hint:"內彎快但限速低，外彎慢但寬鬆",
    },
    {
      id:"c3", name:"直線段", icon:"🛣", lanes:3, bendCurve:0, roadWidthScale:1.0,
      type:"straight",
      laneBonuses:[
        { lane:0, add:0,  mult:1,   label:"標準道" },
        { lane:1, add:10,  mult:1,   label:"順風道 +10" },
        { lane:2, add:-10, mult:1,   label:"逆風道 -10" },
      ],
      sandLevel:0, hint:"中間有順風道",
    },
    {
      id:"c4", name:"急彎段", icon:"↪", lanes:2, bendCurve:0.28, roadWidthScale:1.0,
      type:"bend",
      laneBonuses:[
        { lane:0, add:0, mult:1.3,  speedLimit:60, qteDiff:"hard",  label:"急內彎 ×1.3 | 限速 60" },
        { lane:1, add:0, mult:0.85, speedLimit:90, qteDiff:"easy",  label:"急外彎 ×0.85 | 限速 90" },
      ],
      sandLevel:0, hint:"急彎限速更低，高速超車必須換道",
    },
    // ─── c7 坑洞段 ─────────────────────────────────────────────────
    // 三道 add 都 +5，但進關時隨機抽一道有坑洞（玩家可見）。
    // 走進坑洞道結算 -1 輪胎；坑洞位置存在 app.stage5.potholeLanes（陣列，2 道有坑、1 道安全）。
    {
      id:"c7", name:"坑洞段", icon:"🕳", lanes:3, bendCurve:0.1, roadWidthScale:1.0,
      type:"straight",
      randomPothole: true,
      laneBonuses:[
        { lane:0, add:5, mult:1, label:"道 0 +5" },
        { lane:1, add:5, mult:1, label:"道 1 +5" },
        { lane:2, add:5, mult:1, label:"道 2 +5" },
      ],
      sandLevel:0, hint:"三道都 +5，但有一道藏坑（可見）",
    },
    // ─── c6 油污段 ─────────────────────────────────────────────────
    // 中央道強制彎道 QTE：踏入即觸發（不看速度）；失敗 -1 胎 + 1 失誤牌 + 滑到鄰道。
    // 油污中央道 QTE 難度 +1 級（只有踏進中央時、QTE 才變難）。
    {
      id:"c6", name:"油污段", icon:"🛢", lanes:3, bendCurve:0, roadWidthScale:1.0,
      type:"straight",
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
      sandLevel:0, hint:"中央 +10 但強制彎道 QTE、難度 +1 級",
    },
    // ─── c8 紅綠燈干擾路段 ────────────────────────────────────────────
    // 電磁場干擾路面：三道 add 從機率分布獨立抽取，每次進入 c8 都重抽。
    // 引擎在 applyCircuit 時把 laneBonusDistribution 解析成實際的 laneBonuses。
    // 預設未揭曉顯示「?」，玩家駛過某道後該道在這圈 c8 內永遠揭曉。
    {
      id:"c8", name:"紅綠燈干擾路段", icon:"🚦", lanes:3, bendCurve:0, roadWidthScale:1.0,
      type:"straight",
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
      sandLevel:0, hint:"紅綠燈電磁干擾——三道加成隱藏，駛過才知道",
    },
  ];
  // 一般循環的「賽段池」（c1-c4 + c7 + c8）— 每次開局會隨機洗牌一次，
  // 結果存在 app.stage5.circuitOrder，之後整局都沿這個固定順序循環。
  // 一般循環的「賽段池」（c1-c4 + c7 + c6 + c8）— 每次開局會隨機洗牌一次，
  // 結果存在 app.stage5.circuitOrder，之後整局都沿這個固定順序循環。
  // 注意：array index 跟 id 不對應（id 是字串、index 只是位置）。
  //   0=c1, 1=c2, 2=c3, 3=c4, 4=c7, 5=c6, 6=c8
  const STAGE5_NORMAL_CIRCUITS_POOL = [0,1,2,3,4,5,6];
  // 沙盒：無 Boss 戰賽段
  const STAGE5_BOSS_CIRCUITS = [];

  // ─── 沙盒：牌池定義（無 cost，唯一限制是手牌數量）────────────────────────
  // ─── 第五關卡池（v0.9 重設計） ─────────────────────────────────────────
  // 指令牌：拖到自己道上打 → +speedValue（玩家動作）；可選效果：tireCost、canChangeLane、qteOnPlay
  const STAGE5_COMMAND_CARDS = {
    turbo:         { type:"turbo",         cardClass:"action", name:"渦輪增壓", speedValue:30, note:"" },
    tailwind:      { type:"tailwind",      cardClass:"action", name:"加速",     speedValue:20, note:"" },
    drag:          { type:"drag",          cardClass:"action", name:"風阻減免", speedValue:15, note:"" },
    laneRhythm:    { type:"laneRhythm",    cardClass:"action", name:"換道節奏", speedValue:15, tireCost:1, note:"打完選道換 / 消耗 1 胎", canChangeLane:true },
    nitro:         { type:"nitro",         cardClass:"action", name:"氮氣噴射", speedValue:60, tireCost:1, note:"消耗 1 胎" },
    reignite:      { type:"reignite",      cardClass:"action", name:"重燃引擎", speedValue:25, note:"下回合手牌 +1", drawNextHand:1 },
    drift:         { type:"drift",         cardClass:"action", name:"甩尾過彎", speedValue:0,  note:"僅彎道：必觸 QTE，依結果調整賽道加成（成功 +60 / Good +30 / Miss -10）", driftQte:true, requireBend:true },
    chill:         { type:"chill",         cardClass:"action", name:"冷靜應對", speedValue:10, note:"本動 QTE 容錯 +50%", qteForgive:0.5 },
    smoothOp:      { type:"smoothOp",      cardClass:"action", name:"賽車節奏", speedValue:20, note:"前一動作也是指令牌 → +40", smoothOperator:true },
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
  const STAGE5_TEAM_CARDS = {
    // === 裝備類（trigger: equip）— 選了立即生效、不進牌庫 ===
    newTireWarm:      { type:"newTireWarm",      cardClass:"team", name:"暖胎電熱絲",   note:"啟動時 -1 輪胎；之後每回合結算後保留 +10 速度",     effect:"keepSpeed",           value:10, costOnEquip:{ tire:1 }, trigger:"equip", persistence:"permanent",  persistenceLabel:"永久" },
    bigData:          { type:"bigData",          cardClass:"team", name:"大數據預測",   note:"預告升級：顯示對手下一招的具體內容",              effect:"showOpponent",        value:1,                          trigger:"equip", persistence:"permanent",  persistenceLabel:"永久" },
    backup:           { type:"backup",           cardClass:"team", name:"後援車隊",     note:"防守失敗時不掉名次（一次）",                     effect:"saveOnDefeat",        value:1,                          trigger:"equip", persistence:"oneShot",    persistenceLabel:"觸發後棄" },
    patch:            { type:"patch",            cardClass:"team", name:"補丁",         note:"撞坑時不扣胎、不降速（一次）",                   effect:"savePothole",         value:1,                          trigger:"equip", persistence:"oneShot",    persistenceLabel:"觸發後棄" },
    tirePreservation: { type:"tirePreservation", cardClass:"team", name:"保胎策略",     note:"所有指令牌 -10 速度；無視每回合第 1 次輪胎消耗",effect:"tirePreserve",        value:1,                          trigger:"equip", persistence:"permanent",  persistenceLabel:"永久" },
    // === 打出類（trigger: play）— 進牌庫、需要打出才生效 ===
    fuelMaster:       { type:"fuelMaster",       cardClass:"team", name:"燃料管理大師", note:"本回合內、所有指令牌 +5 速度",                   effect:"cardBonusThisRound",  value:5,                          trigger:"play",  persistence:"thisRound",  persistenceLabel:"本回合" },
    rhythmCoach:      { type:"rhythmCoach",      cardClass:"team", name:"節奏教練",     note:"本回合內、連續同名指令牌：第 2 張 +10、第 3 張 +20", effect:"comboBonusThisRound", value:10,                         trigger:"play",  persistence:"thisRound",  persistenceLabel:"本回合" },
  };
  const STAGE5_ALL_CARDS = { ...STAGE5_COMMAND_CARDS, ...STAGE5_TEAM_CARDS };

  // ─── App 狀態 ──────────────────────────────────────────────────────────────
  const app = {
    root: null, canvas: null, ctx: null, dpr: 1, w: 1280, h: 720,
    mode: "start-ready",

    // 回合狀態
    stageIndex: 0,
    playerLane: 1,
    playerLaneVisual: 1,    // 視覺用（lerp 中間值，用於絲滑移道動畫）
    opponentLane: 0,
    opponentLaneVisual: 0,  // 對手視覺道（未來對手移道也能有動畫）
    laneCount: 3,
    playerSpeed: 0,         // 玩家速度（跟著車子走）
    opponentSpeed: 40,      // 對手當前速度（每動結算更新、boost 直接加）
    tires: 5,               // 輪胎層數（血量）
    tiresMax: 5,
    cardsPlayedThisRound: 0,
    opponentActionsThisStage: [],
    // 新格式：對手行為冷卻系統（沙盒用）
    opponentBehaviors: null,            // [{ id, cooldown, weight, action, ... }] | null
    opponentBehaviorLastTriggered: null, // { [behaviorId]: actionClock }
    opponentTurnAnim: null,             // { startTime, endTime, behavior } | null — 對手回合過場
    opponentBoostFlash: null,           // { startTime, until } | null — 加速頻閃計時
    opponentAuraBypassed: false,        // B 清道夫強招：當下動作對手豁免自己光環
    opponentAbsBonusActive: false,      // B 清道夫強招：本動結算用 abs(差) 取代一般結算

    // 玩家動作待結算（新流程：玩家動作前半 → 對手過場 → 動作後半結算）
    //   { kind: "lane" | "card" | "team", card, laneCost, lanesCrossed } | null
    //   - lane: 換道、扣 laneCost
    //   - card: 打牌到本道、加 cardValue
    //   - team: 車隊牌、無速度效果
    pendingAction: null,
    // 玩家上一個動作開始前所在的道（對手 AI 用：對手目標 = 這條道）
    // 設計：對手在玩家動作前「預測」目標、不追真實位置 → 玩家可換道閃過
    // 每個玩家動作開始時更新（換道前先記）
    playerLaneBeforeAction: 0,
    // 第一關步驟教學
    // 0=卡牌介紹(全黑)  1=介紹動力(HUD亮)  2=介紹速度(HUD亮)
    // 3=介紹賽道  4=三道亮+引導打牌
    // 5=對手警告  6=等待換道  7=換道後加速
    // 8=速度確認說明(全黑)  9=三道亮+超車按鈕
    tutorialStep: 0,
    tutorialLaneBeforeSwitch: -1,

    // 手牌 / 牌庫
    hand: [],
    deck: [],
    drag: null,
    mouse: { x: 0, y: 0 },
    zones: {},

    // QTE 狀態（沿用 Sam）
    qteStart: 0,
    qteCircleStarts: [],
    qteClicked: new Set(),
    qteResults: {},
    qteDismissAt: {},
    qteTapPending: {},
    qteFinalized: {},
    qteResolveAt: 0,
    qteScatterPos: null,
    qteKeys: [],        // 每個圓圈對應的按鍵 ['q','w','e','r',...]

    // 防守 QTE 狀態（沿用 Sam）
    defenseStart: 0,
    defenseProgress: 0,
    safeCenter: 50,
    safeTarget: 50,
    nextSafeShift: 0,
    defenseSucceeded: false,

    // UI
    message: "",
    rank: 4,
    rankTotal: 4,
    winOverlay: null,
    winReplayTimer: 0,
    normalBgmPending: false,

    // 教學
    stageIntroAck: false,
    overtakeQteTutorialSeen: false,
    defenseQteTutorialSeen: false,
    qteTeachPage: 0,

    // 對手行動視覺提示
    opponentActionFx: null,  // { label, until }

    // 超車過場動畫
    overtakeAnim: null,  // { startTime, phase } phase: "approach"→"pass"→"recede"

    // 賽道加成
    laneBonus: null,  // { lane, speedMult, label } | null（舊格式，向下相容）
    laneBonuses: null, // [{ lane, speedMult, qteDiff, label }] | null（新格式，每道各自加成）

    // 賽道寬度比例（1.0 = 預設寬，<1 = 較窄）
    roadWidthScale: 1.0,

    // ─── 第五關專用狀態 ─────────────────────────────────────────────────────
    stage5: null,
    /* stage5 結構（loadStage(4) 時建立）：
       {
         ahead: ["BOSS","A","B","C"],        // 前方對手陣容（含 boss，永遠是第 0 位）
         passed: [],                          // 已超過的對手（不會回來追）
         currentOpponentId: "A" | null,       // 當前對手（前方）；null 表示要重抽
         pinnedNextOpponentId: null,          // 「剛超過你」的指定對手（被反超後填）
         chaserId: null,                       // 當前後方追車對手 id；null=無後車
         circuitIndex: 0,                      // 賽道圈索引（0..4）
         circuitJustChanged: false,            // 切賽道後第一回合的 flag
         potholeLanes: null,                   // c7 坑洞段：本次抽到的坑洞道陣列（如 [0,2] 或 null）
         deckPermanent: [],                    // 玩家累積牌庫（永久，從三選一加入）
         teamCardsActive: [],                  // 場上車隊牌
         bossFocus: 3,                         // Boss 專注值
         bossFocusMax: 3,
         bossBroken: false,                    // Boss 進破綻狀態
         bossStage: false,                     // 是否在 Boss 戰中
         rewardOptions: [],                    // 三選一卡選項
         rewardPickAnim: null,
         rewardSlotHover: -1,
         tailwindActive: 0,                    // 順風 buff：下張 cost-1
         penaltyNextHand: 0,                   // 孤注一擲：下回合手牌減少
         blindPlaysRemaining: 0,               // Boss 戰：本回合還剩盲牌張數
         seenIntro: false,                     // 是否看過第五關開場
       }
    */
  };

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

  function canAfford(card) { return true; }   // 沙盒：無 cost 限制
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

  // ─── 玩家速度結算（兩階段）──────────────────────────────────────────────
  // 步驟 1「玩家行動」：純加減速到 playerSpeed，不套賽道加成
  //   - 換道 delta = -laneCost
  //   - 打牌 delta = +cardValue
  //   - 步驟 3「檢查尾流」也用這函式（同道則 +30）
  function applyPlayerActionDelta(delta) {
    app.playerSpeed = app.playerSpeed + delta;
    if (app.playerSpeed < 0) app.playerSpeed = 0;
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
    app.playerSpeed = Math.floor((app.playerSpeed + add) * mult);
    if (app.playerSpeed < 0) app.playerSpeed = 0;
  }

  // 舊函式（保留給教學關用）：行動 + 賽道一次結算
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
      // 用完旗標 → 重置（一次性、強招發動那動有效）
      app.opponentAbsBonusActive = false;
    } else {
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
          label: `對手在油污失控！滑到第 ${newLane + 1} 道`,
          until: performance.now() + 3500,
        };
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

  // 沙盒：不同道 + 玩家速度 > 對手速度 → 可按超車
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
    const easy = (app.stageIndex === 3); // 關卡4（index 3）是教學防守
    return {
      safeWidth:    easy ? 32 : 28,   // 安全區更寬
      perfectWidth: easy ? 10 : 8,    // 完美區也更寬
      shiftMin:     easy ? 500: 400,  // 移動間隔更長（移得慢）
      shiftMax:     easy ? 700: 550,
      lerp:         easy ? 0.06: 0.07, // lerp 更小 = 滑動更慢
      missPenalty:  0.05,              // 掉分更慢
    };
  }

  // ─── 發牌 ──────────────────────────────────────────────────────────────────
  function makeCard(type, suffix) {
    // 先查教學關 CARD_TYPES、找不到再查第 5 關 STAGE5_ALL_CARDS
    const def = CARD_TYPES[type] ?? STAGE5_ALL_CARDS[type];
    if (!def) {
      console.warn(`[makeCard] unknown card type: ${type}`);
      return { type, name: `[?] ${type}`, speedValue: 0, cardClass: "action", id: `${type}-${suffix}` };
    }
    return { ...def, id: `${type}-${suffix}` };
  }

  function dealStage1() {
    // 關卡1：3張加速，對手同道，要換道才能超車
    app.hand = [
      makeCard("accel", "s1-0"),
      makeCard("accel", "s1-1"),
      makeCard("accel", "s1-2"),
    ];
  }

  function dealStage1Bonus() {
    // 不再使用（關卡1一次給3張）
  }

  function dealStage2() {
    // 關卡2：純加速，同道強制 QTE（速度夠但同道）
    app.hand = [
      makeCard("accel", "s2-0"),
      makeCard("accel", "s2-1"),
      makeCard("accel", "s2-2"),
      makeCard("accel", "s2-3"),
      makeCard("accel", "s2-4"),
    ];
  }

  function dealStage3() {
    // 關卡3：賽道差異 + 對手行動
    // 加速 cost 0，換道不耗動力 → 動作數量主要受手牌張數限制
    // 超加速 cost 2 是唯一會花動力的牌，讓選擇有取捨
    app.hand = [
      makeCard("accel", "s3-0"),
      makeCard("accel", "s3-1"),
      makeCard("accel", "s3-2"),
      makeCard("hyper_accel", "s3-3"),
    ];
  }

  function dealStage4() {
    // 關卡4：全失誤，速度永遠不夠，強制 Pass
    app.hand = [
      makeCard("mistake", "s4-0"),
      makeCard("mistake", "s4-1"),
      makeCard("mistake", "s4-2"),
      makeCard("mistake", "s4-3"),
      makeCard("mistake", "s4-4"),
    ];
  }

  // ─── 第五關支援函式 ────────────────────────────────────────────────────────
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
  // 沙盒起始牌庫：加速 + 再加速（無失誤牌；失誤牌只從 QTE 懲罰取得）
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
    assignSandObscuredCards();
  }
  // 依當前賽段沙暴強度決定哪幾張手牌變盲牌（整張卡看不到，用 id 鎖定，整回合不變）
  // c1 (無沙暴) — 0 張
  // c2 (狹窄) — 固定隨機 1 張
  // c3 (彎道) — 50%（無條件捨去）
  // c4 (沙暴猛烈) — 70%（無條件捨去）
  // Boss 戰 (b1/b2) — 沿用 blindPlaysRemaining 機制，這裡不處理
  function assignSandObscuredCards() {
    const s5 = app.stage5;
    if (!s5) return;
    // 沙盒：無沙暴，永遠空盲牌
    s5.blindCardIds = new Set();
    s5.obscuredCardIds = new Set();
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
    if (s5.bossStage) {
      // Boss 循環
      const curBossIdx = STAGE5_BOSS_CIRCUITS.indexOf(s5.circuitIndex);
      const nextBossIdx = (curBossIdx + 1) % STAGE5_BOSS_CIRCUITS.length;
      return STAGE5_CIRCUITS[STAGE5_BOSS_CIRCUITS[nextBossIdx]];
    }
    // 一般循環（依本局洗牌後的順序）
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
      const laneName = (circ.laneNames && circ.laneNames[i]) || `道 ${i}`;
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
    if (s5.bossStage) {
      const curBossIdx = STAGE5_BOSS_CIRCUITS.indexOf(s5.circuitIndex);
      const nextBossIdx = (curBossIdx + 1) % STAGE5_BOSS_CIRCUITS.length;
      s5.circuitIndex = STAGE5_BOSS_CIRCUITS[nextBossIdx];
      applyCircuit(STAGE5_CIRCUITS[s5.circuitIndex]);
      s5.circuitJustChanged = true;
      return;
    }
    const order = s5.circuitOrder && s5.circuitOrder.length ? s5.circuitOrder : STAGE5_NORMAL_CIRCUITS_POOL;
    const curIdx = order.indexOf(s5.circuitIndex);
    const nextIdx = curIdx >= 0 ? (curIdx + 1) % order.length : 0;
    s5.circuitIndex = order[nextIdx];
    applyCircuit(STAGE5_CIRCUITS[s5.circuitIndex]);
    s5.circuitJustChanged = true;
  }
  // 每打一張牌切換賽段（沙盒核心機制）
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
    // 這保證 endBendQte 內 getLaneBonusFor(playerLane) 拿到的是當前段（c6 lane 1）、不是下一段
    if (app.mode === "bend-qte") {
      app.stage5.pendingCircuitAdvance = true;
      return;
    }
    advanceCircuitToNextSegment();
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
    }
    // 對手判定（速度 / 2）
    let oppBefore = null, oppAfter = null;
    if (oppHit && !oppSafe) {
      oppBefore = app.opponentSpeed;
      app.opponentSpeed = Math.floor(oppBefore / 2);
      oppAfter = app.opponentSpeed;
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
      triggerBendQTE();
      return;
    }
    const limit = currentLaneSpeedLimit();
    if (limit === null) return;
    if (currentLaneSpeed() > limit) triggerBendQTE();
  }
  // 彎道 QTE 觸發（速度越快箭頭越多越快）
  function triggerBendQTE() {
    const step = speedTierStep(app.playerSpeed);
    const baseSecs = 6;
    const secs = Math.max(2, baseSecs * Math.pow(0.90, step));
    app.mode = "bend-qte";
    app.bendQteArrows   = generateBendArrows(step);
    app.bendQteInput    = [];
    app.bendQteFailed   = false;
    app.bendQteDeadline = performance.now() + secs * 1000;
    app.bendQteTotalSecs = secs;
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
    // 前方候選（沙盒：已無 BOSS）
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
    // 舊格式（教學關用）：直接拷貝 actions
    app.opponentActionsThisStage = (opp.actions || []).map(a => ({...a}));
    // 新格式（沙盒用）：拷貝 behaviors，並初始化每個 behavior 的「上次觸發」標記
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
  // 初始化沙盒狀態
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
      bossFocus: null,
      bossFocusMax: null,
      bossBroken: false,
      bossStage: false,
      rewardOptions: [],
      rewardPickAnim: null,
      rewardSlotHover: -1,
      penaltyNextHand: 0,
      blindPlaysRemaining: 0,
      slipstreamUsed: false,
      opponentFocusMap: {},   // { "A": 1, "B": 2, ... } 各對手剩餘專注度  // 尾流：本回合是否已觸發過
      seenIntro: false,
      tutorialPage: 0,
      rewardTutorialSeen: false,
      passTutorialSeen: false,
      obscuredCardIds: new Set(),
      blindCardIds: new Set(),
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
    // 第五關走完全不同的初始化流程
    if (stage.isStage5) {
      initStage5State();
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
      app.tutorialStep = 99;  // 標記非教學
      app.stageIntroAck = false;
      app.drag = null;
      app.message = "";
      // 套用第一段賽道（已在 initStage5State 做）
      applyOpponentToApp(app.stage5.currentOpponentId);
      // 教學旗標都標記已看過（避免跳教學頁）
      app.overtakeQteTutorialSeen = true;
      app.defenseQteTutorialSeen = true;
      // 開場 intro modal
      app.mode = "stage-5-intro";
      // 還沒發手牌 — 等玩家按下「開始」才發
      app.hand = [];
      return;
    }
    app.playerLane = stage.playerLane;
    app.playerLaneVisual = stage.playerLane;
    app.opponentLane = stage.opponentLane;
    app.opponentLaneVisual = stage.opponentLane;
    app.opponentSpeed = stage.opponentSpeed;
    app.chaserSpeed = stage.chaserSpeed ?? null;
    app.chaserTargetLane = null;
    app.chaserVisualLane = null;
    app.chaserLastActCount = -1;
    app.noDefense = stage.noDefense ?? false;
    app.bendCurve = stage.bendCurve ?? 0;
    app.laneBonus = stage.laneBonus ?? null;
    app.laneBonuses = stage.laneBonuses ?? null;
    app.roadWidthScale = stage.roadWidthScale ?? 1.0;
    app.playerSpeed = 0;
    initLanes(stage.lanes);
    app.tires = app.tiresMax;
    app.cardsPlayedThisRound = 0;
    app.actionsThisRound = 0;
    app.opponentActionsThisStage = [...(stage.opponentActions ?? [])];
    app.stageIntroAck = false;
    app.tutorialStep = 0;
    app.tutorialLaneBeforeSwitch = -1;
    app.drag = null;
    const dealers = { dealStage1, dealStage2, dealStage3, dealStage4 };
    const dealFn = stage.deal;
    if (dealers[dealFn]) dealers[dealFn]();
    // 關卡1：教學模式；關卡2/3/4：playing + overlay；其他：一般 intro
    if (idx === 0) app.mode = "tutorial-stage1";
    else if (idx === 1) app.mode = "playing";  // 關卡2 QTE 教學
    else if (idx === 2) app.mode = "playing";  // 關卡3 賽道差異
    else if (idx === 3) app.mode = "playing";  // 關卡4 防守 + Pass 教學
    else app.mode = `stage-${idx+1}-intro`;
  }

  // ─── Reset ─────────────────────────────────────────────────────────────────
  function reset() {
    stopNormalBgm();
    stopBossBgm();
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
    app.tutorialStep = 0;
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
    app.overtakeQteTutorialSeen = false;
    app.defenseQteTutorialSeen = false;
    app.qteTeachPage = 0;
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
      triggerOpponentActions();
      checkAutoPrompt();
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
        } else {
          spendTire(card.tireCost);
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
      // fuelMaster：本回合內所有指令牌 +5
      const hasFuelMaster = s5.teamCardsActive.some(c => c.effect === "cardBonusThisRound");
      if (hasFuelMaster) cardSpd += 5;
      // rhythmCoach：連續同名指令牌 +10 / +20
      const hasRhythmCoach = s5.teamCardsActive.some(c => c.effect === "comboBonusThisRound");
      if (hasRhythmCoach) {
        // 計算「本回合連續同名打的張數」（含當前這張）
        const lastSameNameStreak = (s5.lastCardType === card.type)
          ? (s5.lastCardSameStreak || 1) + 1
          : 1;
        s5.lastCardType = card.type;
        s5.lastCardSameStreak = lastSameNameStreak;
        if (lastSameNameStreak === 2) cardSpd += 10;
        else if (lastSameNameStreak >= 3) cardSpd += 20;
      } else {
        // 沒裝 rhythmCoach 也要記錄、玩家可能後續再裝
        s5.lastCardType = card.type;
        s5.lastCardSameStreak = (s5.lastCardType === card.type) ? (s5.lastCardSameStreak || 1) + 1 : 1;
      }
      // tirePreserve：所有指令牌 -10 速度
      const hasTirePreserveActive = s5.teamCardsActive.some(c => c.effect === "tirePreserve");
      if (hasTirePreserveActive) cardSpd -= 10;
      // smoothOperator（賽車節奏）：若前一動作也是指令牌（不論種類） → 額外 +20（總共 +40）
      if (card.smoothOperator && s5.lastActionWasCard) {
        cardSpd += 20;
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

    triggerOpponentActions();
    checkAutoPrompt();
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
    } else if (pa.wasSameLane && app.playerLane !== app.opponentLane) {
      // 玩家步驟 1 結束時同道、但對手切走 → 嘲諷
      showOpponentTaunt();
    }
    // 步驟 4：賽道結算 + 限速 + 切段
    advanceCircuitOnCard();
    app.pendingAction = null;
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
    if (app.mode !== "playing" && app.mode !== "tutorial-stage1" &&
        app.mode !== "stage5-corner-pick-lane") {
      return;
    }
    // B 強招「豁免」只到下次玩家動作觸發對手回合為止 → 進入時重置
    app.opponentAuraBypassed = false;
    // ─── 新格式：冷卻系統（沙盒對手用 behaviors）────────────────────────
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
    // ─── 舊格式：時序消費（教學關用，立即生效，不過場）──────────────────
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
    const oppLaneNum = app.opponentLane + 1;
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
      label = `對手駐守第 ${oppLaneNum} 道（光環抵消）→ 速度 ${display}`;
    } else if (isBend && speedLimit != null && cur > speedLimit) {
      label = `對手駐守第 ${oppLaneNum} 道（彎道速限 ${speedLimit}）→ 速度 ${display}`;
    } else if (isBend) {
      label = `對手駐守第 ${oppLaneNum} 道（彎道）→ 速度 ${display}`;
    } else if (add !== 0) {
      const sign = add > 0 ? "+" : "";
      label = `對手駐守第 ${oppLaneNum} 道 ${sign}${add} → 速度 ${display}`;
    } else {
      label = `對手駐守第 ${oppLaneNum} 道 → 速度 ${display}`;
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
      // 過場結束 → 執行玩家動作後半（行動結算 + 賽道結算 + 切段）
      app.opponentTurnAnim = null;
      app.mode = "playing";
      finishPlayerAction();
      // 過場結束後再檢查自動 prompt（手牌空、動力空等）
      checkAutoPrompt();
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
        // 沙盒：用「玩家上動作前的道」（教學關沒這欄位、fallback 用 playerLane）
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
            label: `對手切到第 ${app.opponentLane + 1} 道${intentTag}，並加速！速度 ${app.opponentSpeed}`,
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
            label: `對手切到第 ${app.opponentLane + 1} 道${intentTag}${auraTag}，並加速！速度 ${app.opponentSpeed}`,
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
      label: `對手切到第 ${newLane + 1} 道${intentTag}${auraTag} → 速度 ${newDisplay}`,
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
    // 沙盒：所有超車都要 QTE
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
    setTimeout(() => {
      app.mode = "rhythm-formal";
      resetRhythmState();
    }, 1500);
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
    // 若 noDefense（教學關）→ 不進防守、直接顯示「未超車」
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
    // 沙盒：超車條件是「不同道 AND 速度 > 對手」、條件成立才進 QTE
    // shouldForceQTE 已不存在（同道強制 QTE 已廢棄）
    if (canDirectOvertake()) {
      doOvertake();
    }
    // 否則按鈕應該已 disabled、不做任何事
  }

  function pressPass() {
    // 第四關 step 3：按 Pass 不直接觸發 doPass，先進 step 4 教學說明
    if (app.stageIndex === 3 && app.tutorialStep === 3) {
      app.tutorialStep = 4;
      return;
    }
    doPass();
  }

  function clearLaneAfterOvertake() {
    app.playerSpeed = 0;
    app.energy = app.energyMax;
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
    // 沙盒：直接進三選一，不走教學
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
      // 舊版 energyMaxPlus 機制保留（沒在用、但不主動清理）
      if (picked.effect === "energyMaxPlus") {
        app.energyMax += (picked.value || 0);
        app.energy = Math.min(app.energyMax, app.energy + (picked.value || 0));
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
    // 沙盒：移除 energyMaxPlus（無動力系統）
  }
  // 開始一個新回合（換對手、發牌、清狀態）
  function stage5StartNewRound() {
    const s5 = app.stage5;
    if (!s5) return;
    // 清掉上回合可能殘留的超車動畫（避免新回合對手車卡在畫面外）
    app.overtakePassAnim = null;
    // 沙盒：所有對手都超過 → 通關
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
    // 3. 後車邏輯：最後一名（沙盒共 4 名 → rank 4）無後車；否則從 passed 抽
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
    // 6. 沙盒：無 Boss 盲牌
    s5.blindPlaysRemaining = 0;
    // 7. circuitJustChanged 在這回合 reset
    s5.circuitJustChanged = false;
    // 8. 進 playing
    app.mode = "playing";
    // 9. 回合開始就和對手同道 → 立刻給尾流
    checkSlipstream();
  }
  // 玩家超車成功
  function stage5OnOvertakeSuccess() {
    const s5 = app.stage5;
    if (!s5) return;
    const oppId = s5.currentOpponentId;
    if (s5.bossStage) return;  // 沙盒：無 Boss 戰

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
  // 排名洗牌：前方非 Boss 對手洗（玩家「前一名」固定不動）+ 後方對手洗
  function shuffleStage5Ranks() {
    const s5 = app.stage5;
    if (!s5) return;
    // 前方：Boss 固定在 index 0、ahead 最後一個（玩家前一名）固定不動、中間部分洗牌
    //   ahead 結構：[BOSS?, ..., 玩家前一名]
    //   要洗的範圍：除了 BOSS 跟最後一個之外的中間部分
    const boss = s5.ahead.filter(id => id === "BOSS");
    const aheadNonBoss = s5.ahead.filter(id => id !== "BOSS");
    if (aheadNonBoss.length >= 2) {
      // 把最後一個（玩家前一名）取出
      const fixedFront = aheadNonBoss[aheadNonBoss.length - 1];
      const shufflePool = aheadNonBoss.slice(0, aheadNonBoss.length - 1);
      // 洗中間（遠方的名次可以亂跳）
      for (let i = shufflePool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shufflePool[i], shufflePool[j]] = [shufflePool[j], shufflePool[i]];
      }
      s5.ahead = [...boss, ...shufflePool, fixedFront];
    } else {
      // 只剩 1 個或 0 個前方對手、不需洗
      s5.ahead = [...boss, ...aheadNonBoss];
    }
    // 後方對手洗牌（後方名次混亂可接受）
    for (let i = s5.passed.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [s5.passed[i], s5.passed[j]] = [s5.passed[j], s5.passed[i]];
    }
    // chaserId 也重抽（從新後方陣容隨機）
    // 但若已被 pinnedNextOpponentId 鎖定就不動（這保留「剛超過你必追」的規則）
    if (!s5.pinnedNextOpponentId && s5.passed.length > 0) {
      const candidates = s5.passed.filter(id => id !== "BOSS");
      if (candidates.length > 0) {
        s5.chaserId = candidates[Math.floor(Math.random()*candidates.length)];
      }
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
  // 進 Boss 戰（沙盒：保留為 no-op 以防殘留呼叫）
  function stage5EnterBossStage() {
    // 沙盒不使用 Boss 戰
    return;
  }
  // 通關第五關 = 整個遊戲勝利
  function stage5OnGameWin() {
    app.mode = "all-clear";
    try { stopBossBgm(); } catch(e){}
  }
  // 跑完設定的最大回合數 = 越過終點線、依當前名次結束
  function stage5OnFinishLineReached() {
    app.mode = "stage5-finish-line";
    try { stopBossBgm(); } catch(e){}
  }
  // 棄掉「名次上升時棄」的車隊牌
  function discardOnRankUp() {
    const s5 = app.stage5;
    if (!s5) return;
    s5.teamCardsActive = s5.teamCardsActive.filter(c => c.persistence !== "untilRankUp");
  }

  // ─── 防守 ──────────────────────────────────────────────────────────────────
  function startDefense() {
    if (!app.defenseQteTutorialSeen && app.stageIndex === 3) {
      app.qteTeachPage = 0;
      app.mode = "tutorial-defense-qte";
      return;
    }
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
    setTimeout(() => {
      app.mode = "defense";
      app.defenseStart = performance.now();
      app.defenseProgress = 0;
      app.defenseSucceeded = false;
      app.safeCenter = 50;
      app.safeTarget = 50;
      app.nextSafeShift = performance.now() + 300;
    }, 1500);
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
    app.qteScatterPos = (app.stageIndex > 0) ? generateScatterPositions() : null;
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
      // 不進防守的關卡（教學關）：QTE 失敗 → 直接顯示「超車失敗」
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
      let dropped = false;
      for (let i = 0; i < app.laneCount; i++) {
        const zone = app.zones.lanes && app.zones.lanes[i];
        if (zone && zone.droppable && inRect(p, zone)) {
          playCardToLane(app.drag.from, i);
          dropped = true;
          break;
        }
      }
      app.drag = null;
    });

    app.canvas.addEventListener("touchend", e => {
      if (!app.drag) return;
      const t = e.changedTouches[0];
      const p = { x: t.clientX - app.canvas.getBoundingClientRect().left, y: t.clientY - app.canvas.getBoundingClientRect().top };
      let dropped = false;
      for (let i = 0; i < app.laneCount; i++) {
        const zone = app.zones.lanes && app.zones.lanes[i];
        if (zone && zone.droppable && inRect(p, zone)) {
          playCardToLane(app.drag.from, i);
          dropped = true;
          break;
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
    const rect = app.canvas.getBoundingClientRect();
    if (e.touches && e.touches[0]) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function canDragCards() {
    return app.mode === "playing" || app.mode === "tutorial-stage1";
  }

  // ─── 按鈕處理 ──────────────────────────────────────────────────────────────
  function handleButton(id) {
    // 開始遊戲 → 沙盒測試（沿用第五關初始化路徑）
    if (id === "start-game") {
      playNormalBgm();
      loadStage(4);
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
    // 沙盒：debug 跳關按鈕也指向沙盒
    if (id === "debug-jump-stage5") {
      playNormalBgm();
      loadStage(4);
      return;
    }
    // ─── 第五關 ───────────────────────────────────────────────────────
    // 開場 intro 確認
    if (id === "stage5-intro-next" && app.mode === "stage-5-intro") {
      // 沙盒：無新手教學，直接開始
      stage5StartNewRound();
      return;
    }
    if (id === "stage5-intro-ok" && app.mode === "stage-5-intro") {
      stage5StartNewRound();
      return;
    }
    if (id === "stage5-reward-tutorial-ok" && app.mode === "stage5-reward-tutorial") {
      const s5 = app.stage5;
      if (s5) s5.rewardTutorialSeen = true;
      app.mode = "stage5-reward";
      return;
    }
    if (id === "stage5-pass-tutorial-ok" && app.mode === "stage5-pass-tutorial") {
      const s5 = app.stage5;
      if (s5) s5.passTutorialSeen = true;
      // 教學頁結束 → 真的執行 Pass
      stage5DoPassActual();
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
    // 沙盒：Boss 模式已移除，下列按鈕保留但不會觸發
    if (id === "stage5-boss-continue" && app.mode === "stage5-boss-hit") {
      stage5StartNewRound();
      return;
    }
    if (id === "stage5-boss-intro-ok" && (app.mode === "stage5-boss-intro" || app.mode === "stage5-boss-tutorial")) {
      app.mode = "playing";
      return;
    }
    // 第一關步驟教學按鈕（tutorial-step-next 通用推進）
    if (id === "tutorial-step-next" && (app.mode === "tutorial-stage1" || app.mode === "playing")) {
      app.tutorialStep += 1;
      return;
    }
    // 第三關 step 5 → 6（對手警告 → 自由打牌）
    if (id === "tutorial-stage3-step6" && app.mode === "playing") {
      app.tutorialStep = 6;
      return;
    }
    // 第四關 step 4 → 觸發 doPass（進防守教學頁/防守 QTE）
    if (id === "tutorial-stage4-defense" && app.mode === "playing") {
      doPass();
      return;
    }
    // 第四關 step 5 → 6（再來一回合：換手牌 + 動力 + 對手追過來 + 進自由打牌）
    if (id === "tutorial-stage4-replay" && app.mode === "playing") {
      // 給「1 超加速 + 1 失誤 + 3 加速」共 5 張
      app.hand = [
        makeCard("hyper_accel", "s4r-hyper"),
        makeCard("mistake",     "s4r-mis"),
        makeCard("accel",       "s4r-a0"),
        makeCard("accel",       "s4r-a1"),
        makeCard("accel",       "s4r-a2"),
      ];
      app.energy = app.energyMax;
      app.cardsPlayedThisRound = 0;
      app.actionsThisRound = 0;
      // 第二回合對手降速到 30（原本 80）；之後依玩家動作數會反擊 +20
      app.opponentSpeed = 30;
      // 排對手行動：玩家第 1 個動作後追過來、第 3 個動作後反擊 +20 速
      app.opponentActionsThisStage = [
        { onActionN: 1, action: "moveTo", target: "playerLane" },
        { onActionN: 3, action: "boost",  amount: 20 },
      ];
      app.tutorialStep = 6;
      return;
    }
    if (id === "tutorial-step-switch" && app.mode === "tutorial-stage1" && app.tutorialStep === 5) {
      // 對手警告確認 → 記錄換道前的道，進入等待換道
      app.tutorialLaneBeforeSwitch = app.playerLane;
      app.tutorialStep = 6;
      return;
    }
    // 關卡介紹確認
    if (id === "stage-intro-ok") {
      app.stageIntroAck = true;
      app.mode = "playing";
      return;
    }
    // 打牌階段
    if (id === "btn-overtake" && (app.mode === "playing" || app.mode === "tutorial-stage1")) {
      if (canDirectOvertake()) pressOvertake();
      return;
    }
    if (id === "btn-pass" && app.mode === "playing") {
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
    // 超車結果
    if (id === "next-stage" && app.mode === "result") {
      const next = app.stageIndex + 1;
      if (next < STAGES.length) {
        loadStage(next);
      } else {
        app.mode = "all-clear";
      }
      return;
    }
    // 重玩本關
    if (id === "retry-stage" && app.mode === "result") {
      loadStage(app.stageIndex);
      return;
    }
    // 防守結果
    if (id === "defense-result-ok") {
      // 第四關特殊：第一次防守結束後 → 回到 playing 模式進 step 5（教學再一回合）
      // 但 step 5 之後（玩家自由發揮過了）就走標準流程進下一關
      if (app.stageIndex === 3 && app.tutorialStep < 5) {
        app.tutorialStep = 5;
        app.mode = "playing";
        app.hand = [];
        app.energy = 0;
        app.cardsPlayedThisRound = 0;
        app.actionsThisRound = 0;
        return;
      }
      const next = app.stageIndex + 1;
      if (next < STAGES.length) {
        loadStage(next);
      } else {
        app.mode = "all-clear";
      }
      return;
    }
    // QTE 教學
    if (id === "qte-tutorial-next") { app.qteTeachPage += 1; return; }
    if (id === "qte-tutorial-stage2-start") {
      // 關卡2 QTE 說明確認 → 直接進 QTE
      app.overtakeQteTutorialSeen = true;
      doOvertakeQTE();
      return;
    }
    if (id === "qte-tutorial-start-overtake") {
      app.overtakeQteTutorialSeen = true;
      app.qteTeachPage = 0;
      doOvertakeQTE();
      return;
    }
    if (id === "qte-tutorial-start-defense") {
      app.defenseQteTutorialSeen = true;
      app.qteTeachPage = 0;
      beginDefenseSequence();
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

    // 第一關步驟推進
    if (app.mode === "tutorial-stage1") {
      const s = app.tutorialStep;
      // step 4：打了第一張牌 → step 5 對手警告
      if (s === 4 && app.cardsPlayedThisRound >= 1) {
        app.tutorialStep = 5;
      }
      // step 6：偵測到玩家實際換道完成 → step 7 加速
      if (s === 6 && app.tutorialLaneBeforeSwitch >= 0 && app.playerLane !== app.tutorialLaneBeforeSwitch) {
        app.tutorialStep = 7;
      }
      // step 7：手牌空了 → step 8 速度確認
      if (s === 7 && app.hand.length === 0) {
        app.tutorialStep = 8;
      }
    }

    // 第二關步驟推進（QTE 教學，stageIndex 1）
    // step 0：全黑說明（由按鈕推進到 step 1）
    // step 1：正常打牌，打不動了（手牌空 或 動力不夠任何一張）→ step 2 QTE 前說明
    if (app.stageIndex === 1 && app.mode === "playing") {
      const s = app.tutorialStep;
      if (s === 1 && (app.hand.length === 0 || !canAffordAny())) {
        app.tutorialStep = 2; // 手牌打完或動力光了 → QTE 說明
      }
    }

    // 第三關步驟推進（賽道差異，stageIndex 2）
    // step 0：全黑「彎道到了」
    // step 1：兩道差異（金/藍框）
    // step 2：速度差別（基礎 vs 此道速度）— 新
    // step 3：對手會反應 + 倒數圖示
    // step 4：自由打牌 1，做了 2 個動作 → 對手追過來、進 step 5
    // step 5：對手警告，按按鈕推進到 step 6
    // step 6：自由打牌 2，打不動了 → step 7
    // step 7：超車引導
    if (app.stageIndex === 2 && app.mode === "playing") {
      const s = app.tutorialStep;
      if (s === 4 && (app.actionsThisRound ?? 0) >= 1) {
        // 對手追過來：移動到玩家當前道
        const prevLane = app.opponentLane;
        app.opponentLane = app.playerLane;
        if (app.opponentLane !== prevLane) {
          app.opponentActionFx = {
            label: `對手追到第 ${app.opponentLane + 1} 道！`,
            until: performance.now() + 3600,
          };
        }
        app.tutorialStep = 5;
      }
      if (s === 6 && (app.hand.length === 0 || !canAffordAny())) {
        app.tutorialStep = 7;
      }
    }

    // 第四關步驟推進（防守 + Pass 教學，stageIndex 3）
    // step 0：全黑「終點將近，但這手牌很糟」
    // step 1：自由試打，打不動了 → step 2
    // step 2：全黑「無法超車。介紹 Pass」
    // step 3：高亮 Pass 按鈕，玩家按 Pass → 進 step 4（doPass 邏輯接管）
    // step 4：Pass 後說明後車追擊（由 doPass 觸發）
    // step 5+：防守 QTE 教學頁、防守 QTE 本身、結果（沿用既有系統）
    if (app.stageIndex === 3 && app.mode === "playing") {
      const s = app.tutorialStep;
      if (s === 1 && (app.hand.length === 0 || !canAffordAny())) {
        app.tutorialStep = 2;
      }
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

    // 背景：永遠畫賽道
    drawRace(time);

    const m = app.mode;

    // 模糊背景 modal 層
    if (m === "start-ready" || m === "rules" || m.includes("intro") || m === "tutorial-overtake-qte" || m === "tutorial-defense-qte"
        || m === "stage5-reward" || m === "stage5-boss-hit") {
      drawModalBackdrop(time);
    }

    if (m === "start-ready")              { drawStartModal(); drawExpressionDock(time); return; }
    if (m === "rules")                    { drawRulesModal(time); drawExpressionDock(time); return; }
    if (m === "stage-5-intro")            { drawStage5IntroModal(time); drawExpressionDock(time); return; }
    if (m === "stage5-boss-intro")        { drawStage5BossIntroModal(time); drawExpressionDock(time); return; }
    if (m === "stage5-boss-tutorial")     { drawStage5BossTutorialModal(time); drawExpressionDock(time); return; }
    if (m === "stage5-reward-tutorial")   { drawStage5RewardTutorialModal(time); drawExpressionDock(time); return; }
    if (m === "stage5-pass-tutorial")     { drawStage5PassTutorialModal(time); drawExpressionDock(time); return; }
    if (m === "stage5-corner-pick-lane")  { drawStage5CornerLanePick(time); drawExpressionDock(time); return; }
    if (m.includes("-intro"))             { drawStageIntro(time); drawExpressionDock(time); return; }
    if (m === "tutorial-overtake-qte")    { drawQteTeachModal(true); drawExpressionDock(time); return; }
    if (m === "tutorial-defense-qte")     { drawQteTeachModal(false); drawExpressionDock(time); return; }

    // HUD 常駐
    drawHud(time);
    // 第五關常駐：右上角下一賽段預告 + 賽況面板
    if (isStage5() && (m === "playing" || m === "prompt-overtake-or-pass" || m === "stage5-overtake-result"
                       || m === "stage5-no-overtake" || m === "stage5-defense-result" || m === "stage5-reward"
                       || m === "bend-qte" || m === "bend-qte-result" || m.startsWith("splash") || isRhythmMode() || m === "defense")) {
      drawStage5SandOverlay(time);
      if (isStage5()) drawSpeedLimitAR(time);
      drawStage5SidePanel(time);
      drawStage5NextCircuit(time);
    }

    if (m === "tutorial-stage1") {
      drawLanes(time);
      drawHand(time);
      drawTutorialStage1Overlay(time);
    }

    if (m === "playing" || m === "prompt-overtake-or-pass") {
      drawLanes(time);
      drawHand(time);
      if (m === "prompt-overtake-or-pass") drawPromptModal();
      if (app.stageIndex === 1) drawTutorialStage2QteOverlay(time);
      if (app.stageIndex === 2) drawTutorialStage2Overlay(time);
      if (app.stageIndex === 3) drawTutorialStage4Overlay(time);
    }

    if (m === "bend-qte") { drawLanes(time); drawBendQte(time); }
    if (m === "bend-qte-result") { drawLanes(time); drawBendQteResult(); }

    if (m.startsWith("splash")) drawSplash();
    // 超車 QTE / 防守 QTE：賽道當背景、QTE UI 疊上去
    // 賽道本身在 QTE 模式下會「整體左右擺動」（見 drawLanes 內 cameraShakeX）
    if (isRhythmMode()) { drawLanes(time); drawRhythm(time); }
    if (m === "defense") { drawLanes(time); drawDefense(); }

    if (m === "result") drawResultModal();
    if (m === "defense-result") drawDefenseResultModal();
    if (m === "all-clear") drawAllClear();
    if (m === "stage5-tire-out") drawStage5TireOutModal();
    if (m === "stage5-finish-line") drawStage5FinishLineModal();
    // 第五關專屬結算
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

        // 收集懸停道的 previewLines（重算一次，因為已在 drawLanes 裡算過）
        // 車隊牌不參與預覽（直接結算、不影響速度）
        const isDragTeamCard = app.drag.card?.cardClass === "team";
        let hoverLines = [];
        let hoverLane = -1;
        if (!isDragTeamCard) {
          for (let li = 0; li < laneCount2; li++) {
          const lx = baseX2 + li * (laneW2 + gap2);
          if (inRect({ x: dragCx, y: dragCy }, { x: lx, y: baseY3, w: laneW2, h: laneH2 })) {
            hoverLane = li;
            const b = getLaneBonusFor(li);
            const add = b?.add ?? 0; const mult = b?.mult ?? 1;
            if (li === app.playerLane) {
              const cardSpd = app.drag.card.speedValue ?? 0;
              const previewSpd = Math.floor((app.playerSpeed + cardSpd + add) * mult);
              // 順序：行動 → 道路加法 → 道路乘法
              if (cardSpd !== 0) hoverLines.push({ left: `+${cardSpd} 行動（${app.drag.card.name}）`, color: "rgba(140,255,160,0.95)" });
              if (add !== 0) hoverLines.push({ left: `${add > 0 ? "+" : ""}${add} 道路（${b?.label?.replace(/ [+-]?\d.*$/, "") ?? "道路加成"}）`, color: add > 0 ? "rgba(255,210,60,0.95)" : "rgba(140,200,220,0.95)" });
              if (mult !== 1) hoverLines.push({ left: `×${mult} 道路（${b?.label?.split(" ")[0] ?? "彎道"}）`, color: "rgba(255,180,80,0.95)" });
              // 清道夫光環：在他所在道上、加成被抹除 → 給玩家警告
              if (b?._auraSuppressed) {
                hoverLines.push({ left: "⚠ 清道夫光環：加成失效", color: "rgba(255,140,200,0.95)" });
              }
              if (b?.speedLimit != null && previewSpd > b.speedLimit) {
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
            break;
          }
        }
        }  // end if (!isDragTeamCard)

        if (hoverLines.length > 0) {
          const tipCx = app.drag.x + app.drag.w/2;
          const lineH  = 20;
          const tipH   = hoverLines.length * lineH + 16;
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
          hoverLines.forEach((line, idx) => {
            const y2 = tipY + 14 + idx * lineH;
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
    // 沙盒：永遠用教學關卡的城市天際線背景
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
  }


  // ─── HUD ───────────────────────────────────────────────────────────────────
  function statusHudRect() {
    return { x: app.w - 300, y: app.h - 196 - 24, w: 276, h: 196 };
  }

  function drawHud(time) {
    const s = statusHudRect();
    panel(s.x, s.y, s.w, s.h, "rgba(8,18,32,0.88)", "rgba(105,164,224,0.50)");
    const ctx = app.ctx;
    const hr = y => {
      ctx.save(); ctx.strokeStyle="rgba(105,164,224,0.18)"; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(s.x+16,y); ctx.lineTo(s.x+s.w-16,y); ctx.stroke(); ctx.restore();
    };

    // 名次
    text("名次", s.x+20, s.y+32, 13, "rgba(160,190,230,0.65)", "700");
    text(`${app.rank} / ${app.rankTotal}`, s.x+s.w-20, s.y+32, 15, "rgba(214,228,255,0.95)", "900", "right");
    hr(s.y+46);

    // 輪胎（血量）顯示
    text("輪胎", s.x+20, s.y+72, 13, "rgba(200,230,255,0.65)", "700");
    for (let i=0; i<app.tiresMax; i++) {
      const alive = i < app.tires;
      roundPanel(s.x+76+i*26, s.y+57, 22, 22, 4,
        alive ? "rgba(255,100,80,0.85)" : "rgba(30,40,60,0.5)",
        alive ? "rgba(255,150,120,0.6)" : "rgba(80,100,130,0.25)", 1.5);
      if (alive) text("●", s.x+76+i*26+11, s.y+72, 12, "rgba(255,220,210,0.95)", "900", "center");
    }
    hr(s.y+92);

    // 玩家速度 — 顯示「當前道顯示速度」
    const laneSpd = currentLaneSpeed();
    const laneBonus = getLaneBonusFor(app.playerLane);
    text("速度", s.x+20, s.y+116, 13, "rgba(100,200,255,0.7)", "700");
    if (laneBonus) {
      text(laneBonus.label || "", s.x+20, s.y+125, 9, "rgba(100,200,255,0.55)", "600");
    }
    text(`${laneSpd}`, s.x+s.w-20, s.y+120, 28, "rgba(120,220,255,0.95)", "900", "right");
    hr(s.y+140);

    // 對手區（對手名 + 專注度 + 速度 + 下動預測）
    const oppSpd = opponentDisplaySpeed();
    const opp = isStage5() ? currentOpponent() : null;
    // 「現在真的可超車」= 不同道 + 自己速度高於對手 + 專注度=0
    const s5 = app.stage5;
    const focusMax = opp ? (opp.focus ?? 0) : 0;
    const focusCur = (opp && s5) ? (s5.opponentFocusMap?.[opp.id] ?? 0) : 0;
    const focusBroken = opp && (focusMax === 0 || focusCur === 0);
    const speedEnough = opp && (laneSpd > oppSpd);
    const differentLane = opp && (app.playerLane !== app.opponentLane);
    const canOvertakeNow = focusBroken && speedEnough && differentLane;
    // 左上：對手名（沒對手時顯示通用「對手速度」）
    const nameStr = opp?.name || "對手速度";
    const nameColor = canOvertakeNow ? "rgba(120,255,160,0.95)" : "rgba(255,160,160,0.85)";
    text(nameStr, s.x+20, s.y+160, 13, nameColor, "800");
    // 對手名右側：專注度點點（緊貼名字後）
    if (opp) {
      ctx.save();
      ctx.font = "800 13px system-ui, sans-serif";
      const nameW = ctx.measureText(nameStr).width;
      ctx.restore();
      if (focusMax > 0) {
        for (let i = 0; i < focusMax; i++) {
          const alive = i < focusCur;
          const dotX = s.x+20 + nameW + 8 + i * 12;
          ctx.fillStyle = alive ? "rgba(255,170,70,0.95)" : "rgba(80,60,40,0.5)";
          ctx.beginPath();
          ctx.arc(dotX, s.y+156, 4, 0, Math.PI*2);
          ctx.fill();
        }
      }
      // 真正可超車（含速度條件）：用「!」當小驚嘆
      if (canOvertakeNow) {
        text("!", s.x+20 + nameW + 8, s.y+160, 14, "rgba(120,255,160,0.95)", "900");
      }
    }
    // 右側大字速度
    const spdColor = canOvertakeNow ? "rgba(140,255,180,0.95)" : "rgba(255,150,150,0.95)";
    text(`${oppSpd}`, s.x+s.w-20, s.y+164, 26, spdColor, "900", "right");
    // 下動預測（小字、在大字下方）
    if (opp) {
      const nextOppSpd = applyOpponentBonus(oppSpd, app.opponentLane, app.opponentAuraBypassed);
      const delta = nextOppSpd - oppSpd;
      const arrowColor = delta > 0 ? "rgba(255,150,140,0.95)"
                       : delta < 0 ? "rgba(140,230,170,0.95)"
                       :             "rgba(180,200,220,0.6)";
      const deltaStr = delta > 0 ? `+${delta}` : `${delta}`;
      const predictStr = delta === 0 ? `下動 → ${nextOppSpd}`
                                     : `下動 → ${nextOppSpd}（${deltaStr}）`;
      text(predictStr, s.x+s.w-20, s.y+184, 11, arrowColor, "800", "right");
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

    // 第一關教學：哪些道可以接受拖牌
    const isTutorial1 = app.mode === "tutorial-stage1";
    const isStage3Tutorial = app.stageIndex === 2 && app.mode === "playing";
    const isStage4Tutorial = app.stageIndex === 3 && app.mode === "playing";
    const step = app.tutorialStep;
    const canDropToLane = (i) => {
      if (isStage4Tutorial) {
        // 第四關：step 1 / step 6 才允許拖牌（自由試打 / 自由發揮），其他 step 都鎖
        if (step === 1) return true;
        if (step === 6) return true;
        return false;
      }
      if (isStage3Tutorial) {
        // 第三關：step 0/1/2/3/5/7 教學期不能拖；4/6 自由打牌
        if (step === 4 || step === 6) return true;
        return false;
      }
      if (!isTutorial1) return true;
      if (step === 0) return false;   // 全黑介紹期：不接受拖牌
      if (step === 1) return false;   // 介紹動力：不接受拖牌
      if (step === 2) return false;   // 介紹速度：不接受拖牌
      if (step === 3) return false;   // 介紹換道：不接受拖牌
      if (step === 4) return i === app.playerLane;   // 只能打到自己道
      if (step === 5) return false;   // 對手警告：等玩家確認
      if (step === 6) return i !== app.playerLane;   // 只能換道
      if (step === 7) return i === app.playerLane;   // 只能打到新道
      if (step === 8) return false;   // 速度確認說明：不接受拖牌
      if (step === 9) return false;   // 超車階段不接受拖牌
      return false;
    };

    app.zones.lanes = [];

    for (let i=0; i<laneCount; i++) {
      const x = baseX + i*(laneW+gap);
      const y = baseY;
      const droppable = canDropToLane(i);
      // zone 永遠存在（供 overlay spotlight 用），droppable 決定是否接受拖牌
      app.zones.lanes[i] = { x, y, w: laneW, h: laneH, droppable };

      const isPlayer   = i === app.playerLane;
      const isOpponent = i === app.opponentLane;
      const isBoth     = isPlayer && isOpponent;
      const bonusData  = getLaneBonusFor(i);
      const hasBonus   = !!bonusData;

      // c8 紅綠燈干擾：未揭曉狀態判斷
      const curCirc = currentCircuit();
      const c8HideMode = !!(curCirc && curCirc.hideLaneBonusUntilVisited);
      const c8LaneColor = c8HideMode && curCirc.laneColors ? curCirc.laneColors[i] : null;
      const c8Revealed  = c8HideMode && app.stage5 && app.stage5.revealedC8Lanes && app.stage5.revealedC8Lanes.has(i);
      const c8Hidden    = c8HideMode && !c8Revealed;

      let borderColor = "rgba(60,80,110,0.35)";
      if (isBoth)          borderColor = "rgba(255,80,80,0.95)";
      else if (isPlayer)   borderColor = "rgba(100,200,255,0.9)";
      else if (isOpponent) borderColor = "rgba(255,100,100,0.55)";
      if (hasBonus && !c8Hidden) {
        const isPos = (bonusData.add ?? 0) > 0 || (bonusData.mult ?? 1) > 1;
        borderColor = isPos ? "rgba(255,210,60,0.9)" : "rgba(140,180,200,0.7)";
      }
      // c8：揭曉前用紅黃綠道主題色（玩家/對手在的道仍優先顯示原來邊框，避免失去資訊）
      if (c8HideMode && c8LaneColor && !isPlayer && !isOpponent) {
        borderColor = c8LaneColor;
      }

      // 教學中不可互動的道格子半透明
      const alpha = (isTutorial1 && !droppable && !isPlayer && !isOpponent) ? 0.35 : 1;
      const ctx = app.ctx;
      ctx.save(); ctx.globalAlpha = alpha;

      let bgColor = "rgba(10,18,32,0.72)";
      if (isPlayer) bgColor = "rgba(12,28,52,0.88)";
      if (hasBonus && !c8Hidden && ((bonusData.add ?? 0) > 0 || (bonusData.mult ?? 1) > 1)) bgColor = "rgba(28,22,8,0.88)";
      panel(x, y, laneW, laneH, bgColor, borderColor, !isPlayer);

      // c7 坑洞段 / c6 油污段的 sprite 已移到 drawRace 內畫在賽道路面上
      // （這裡道格只有 label、不畫 sprite）

      // 加成標籤：顯示在格子上方（格子外），字放大
      {
        const bd = bonusData;
        let bonusStr, bonusCol;
        if (c8Hidden) {
          // c8 未揭曉：顯示道名 + "?"
          const laneName = (curCirc.laneNames && curCirc.laneNames[i]) || `道 ${i}`;
          bonusStr = `${laneName} ?`;
          bonusCol = c8LaneColor || "rgba(255,255,255,0.85)";
        } else if (bd) {
          // label 已含所有資訊（如「內彎 ×1.25｜限速 5」），直接用
          bonusStr = bd.label ?? "道路加成";
          const isPos = (bd.add ?? 0) > 0 || (bd.mult ?? 1) > 1;
          bonusCol = isPos ? "rgba(255,210,60,0.95)" : "rgba(140,200,220,0.9)";
          // c8 揭曉後也用紅黃綠道顏色（保留 add 數字、但用道色強化視覺）
          if (c8HideMode && c8LaneColor) bonusCol = c8LaneColor;
          // 光環抵消：加上刪除線視覺 + 警告色
          if (bd._auraSuppressed) {
            bonusCol = "rgba(255,140,200,0.85)";
          }
        } else {
          bonusStr = "無加成";
          bonusCol = "rgba(120,130,150,0.55)";
        }
        text("★ " + bonusStr, x + laneW/2, y - 10, 13, bonusCol, "800", "center");
        // 警告堆疊：從 y - 26 往上每行 -16
        let warnY = y - 26;
        // 光環抵消
        if (bd?._auraSuppressed) {
          text("⚠ 光環抵消", x + laneW/2, warnY, 11, "rgba(255,140,200,0.95)", "800", "center");
          warnY -= 16;
        }
        // c6 油污：當道 QTE 難度提升
        const qteOffset = (bd && typeof bd.qteDifficultyOffset === "number") ? bd.qteDifficultyOffset : 0;
        if (qteOffset > 0) {
          text(`⚠ QTE 難度 +${qteOffset} 級`, x + laneW/2, warnY, 11, "rgba(255,180,120,0.95)", "800", "center");
          warnY -= 16;
        }
        // c7 坑洞警告
        if (app.stage5?.potholeLanes?.includes(i)) {
          const auraSafe = isOpponentAuraActive() && app.opponentLane === i;
          if (auraSafe) {
            text("🛡️ 坑洞：光環抵消", x + laneW/2, warnY, 11, "rgba(180,255,200,0.95)", "800", "center");
          } else {
            text("⚠ 撞坑！-1 輪胎", x + laneW/2, warnY, 11, "rgba(255,100,80,0.95)", "800", "center");
          }
          warnY -= 16;
        }
        // c6 油污警告
        if (bd?.forceCornerQte) {
          text("⚠ 油污：強制 QTE", x + laneW/2, warnY, 11, "rgba(255,160,100,0.95)", "800", "center");
          warnY -= 16;
        }
      }

      // 道名 + 對手標記（頂部一行）
      const laneNames3 = ["左道", "中道", "右道"];
      const laneNames2 = ["內彎", "外彎"];
      let label = (laneCount === 2 ? laneNames2[i] : laneNames3[i]) ?? `道 ${i+1}`;
      if (isBoth)          label = "⚡ 對撞！";
      else if (isPlayer)   label += " 【你】";
      else if (isOpponent) label += " 【對手】";
      const labelColor = isPlayer ? "rgba(120,210,255,0.95)"
                       : isOpponent ? "rgba(255,130,130,0.85)"
                       : "rgba(150,160,180,0.7)";
      text(label, x+laneW/2, y+22, 14, labelColor, "800", "center");
      // 格子內不再重複顯示加成小字

      // ── 速度顯示 ──────────────────────────────────────────────────────────
      // 靜態：所有道都顯示當前 playerSpeed（加成在行動時才結算，不是持續狀態）
      // 拖牌懸停時：
      //   拖到當前道 → 預覽「打牌」= playerSpeed + cardSpeed + 當前道加成
      //   拖到其他道 → 預覽「換道」= playerSpeed - 1（換道）+ 尾流（若同道）+ 新道加成
      //                             （牌被棄掉，cardSpeed 不計入）
      let previewSpeed = app.playerSpeed;
      let isPreview = false;
      let previewLines = [];  // 分項列表，每項 { label, color }

      if (app.drag) {
        // 車隊牌不參與速度預覽（拖到任何道都直接結算、不影響本動速度）
        const isDragTeamCard = app.drag.card?.cardClass === "team";
        const dragCx = app.drag.x + app.drag.w/2;
        const dragCy = app.drag.y + app.drag.h/2;
        const hovering = !isDragTeamCard && inRect({ x: dragCx, y: dragCy }, { x, y, w: laneW, h: laneH });
        if (hovering) {
          isPreview = true;
          const b = getLaneBonusFor(i);
          // c8 未揭曉道：預覽時不洩漏 add（玩家還不知道這道的加成）
          const add = c8Hidden ? 0 : (b?.add ?? 0);
          const mult = c8Hidden ? 1 : (b?.mult ?? 1);
          if (i === app.playerLane) {
            // 打牌
            const cardSpd = app.drag.card.speedValue ?? 0;
            // 尾流（如果玩家當前道 == 對手當前道、且本回合未用過）
            const slipBonus = canGetSlipstreamAtLane(i) ? 30 : 0;
            previewSpeed = Math.floor((app.playerSpeed + cardSpd + slipBonus + add) * mult);
            if (cardSpd !== 0) previewLines.push({ label: `${app.drag.card.name} +${cardSpd}`, color: "rgba(140,255,160,0.9)" });
            if (slipBonus) previewLines.push({ label: "+30 尾流", color: "rgba(100,255,200,0.95)" });
            if (c8Hidden) {
              previewLines.push({ label: "紅綠燈干擾 ?", color: c8LaneColor || "rgba(255,200,255,0.9)" });
            } else {
              if (add !== 0) previewLines.push({ label: `${b?.label ?? (add > 0 ? "+" : "") + add + " 道路加成"}`, color: add > 0 ? "rgba(255,210,60,0.9)" : "rgba(140,200,220,0.9)" });
              if (mult !== 1) previewLines.push({ label: `×${mult} 彎道加乘`, color: mult > 1 ? "rgba(255,210,60,0.9)" : "rgba(140,200,220,0.9)" });
              if (b?._auraSuppressed) previewLines.push({ label: "⚠ 光環抵消", color: "rgba(255,140,200,0.95)" });
            }
            if (b?.forceCornerQte) previewLines.push({ label: "⚠ 強制彎道 QTE", color: "rgba(255,150,100,0.95)" });
          } else if (droppable && app.playerSpeed > 0) {
            // 換道（依跨道數扣速）
            const slipBonus = canGetSlipstreamAtLane(i) ? 30 : 0;
            const lanesCrossed = Math.abs(i - app.playerLane);
            const laneCost = laneChangeCost(lanesCrossed);
            previewSpeed = Math.floor((app.playerSpeed - laneCost + slipBonus + add) * mult);
            previewLines.push({ label: `-${laneCost} 換道(${lanesCrossed} 道)`, color: "rgba(255,180,100,0.9)" });
            if (slipBonus) previewLines.push({ label: "+30 尾流", color: "rgba(100,255,200,0.95)" });
            if (c8Hidden) {
              previewLines.push({ label: "紅綠燈干擾 ?", color: c8LaneColor || "rgba(255,200,255,0.9)" });
            } else {
              if (add !== 0) previewLines.push({ label: `${b?.label ?? (add > 0 ? "+" : "") + add + " 道路加成"}`, color: add > 0 ? "rgba(255,210,60,0.9)" : "rgba(140,200,220,0.9)" });
              if (mult !== 1) previewLines.push({ label: `×${mult} 彎道加乘`, color: mult > 1 ? "rgba(255,210,60,0.9)" : "rgba(140,200,220,0.9)" });
              if (b?._auraSuppressed) previewLines.push({ label: "⚠ 光環抵消", color: "rgba(255,140,200,0.95)" });
            }
            if (b?.forceCornerQte) previewLines.push({ label: "⚠ 切進強制彎道 QTE", color: "rgba(255,150,100,0.95)" });
          } else {
            isPreview = false;
          }
        }
      }

      const displaySpeed = previewSpeed;
      const bonusData2  = getLaneBonusFor(i);
      const speedLimit  = bonusData2?.speedLimit ?? null;
      const overLimit   = speedLimit !== null && displaySpeed > speedLimit;
      const numberY = y + 68;
      const labelY  = numberY + 26;

      const baseNumColor = isBoth   ? "rgba(255,140,140,0.95)"
                        : isPlayer  ? (overLimit ? "rgba(255,100,80,0.95)" : "rgba(255,230,100,0.95)")
                        :             "rgba(150,165,190,0.55)";
      const numColor = isPreview
        ? (overLimit ? "rgba(255,140,100,0.98)"
                     : (i === app.playerLane ? "rgba(140,255,160,0.98)" : "rgba(255,220,100,0.98)"))
        : baseNumColor;
      const subColor = isPlayer ? "rgba(220,200,140,0.78)" : "rgba(140,150,170,0.5)";

      text(`${displaySpeed}`, x+laneW/2, numberY, 36, numColor, "900", "center");

      const speedLabel = isPreview
        ? (overLimit ? `⚠ 彎道 QTE！限 ${speedLimit}` : "行動預覽")
        : overLimit ? `速度 ⚠限${speedLimit}` : "速度";
      text(speedLabel, x+laneW/2, labelY, 11,
        isPreview ? numColor : overLimit ? "rgba(255,150,80,0.85)" : subColor, "700", "center");

      // 換道提示：懸停在非當前道時，只加亮格子邊框，文字跟著牌走（在牌上方顯示）
      if (app.drag && i !== app.playerLane && droppable) {
        const dragCx = app.drag.x + app.drag.w/2;
        const dragCy = app.drag.y + app.drag.h/2;
        const hovering = inRect({ x: dragCx, y: dragCy }, { x, y, w: laneW, h: laneH });
        if (hovering) {
          panel(x, y, laneW, laneH, "rgba(255,200,80,0.15)", "rgba(255,200,80,0.9)", true);
        } else {
          text("拖到此處 ‧ 換道", x+laneW/2, y+laneH-18, 11, "rgba(180,170,130,0.62)", "700", "center");
        }
      }

      ctx.restore();
    }

    // 超車按鈕 + Pass 按鈕：放在右側並排
    const btnY = baseY;
    const canOv = canDirectOvertake();

    // 關卡2 整段是 QTE 教學，超車流程交給 overlay 的「開始 QTE！」按鈕，
    // 底下這組超車/Pass 按鈕一律不出現，避免干擾教學節奏
    const isStage2Tutorial = app.stageIndex === 1;
    // 第三關：step 7 才出現超車按鈕
    const isStage3OvertakeStep = isStage3Tutorial && step === 7;
    const isStage3OtherStep    = isStage3Tutorial && step !== 7;
    // 第四關：step 1~5 不出超車按鈕；step 6 自由發揮、按鈕正常出現
    const isStage4FreeStep = isStage4Tutorial && step === 6;
    const isStage4PassStep = isStage4Tutorial && step === 3;

    // 「自由打牌」階段：玩家正在打牌的關卡狀態（不管手牌剩幾張）
    // 在這個階段，超車按鈕跟 Pass 按鈕都要永遠存在（讓玩家看到選項）
    // - 一般關卡（playing）：永遠顯示
    // - 教學關卡：只在指定 step 顯示（避免干擾教學節奏）
    const isFreePlayPhase =
      ((app.mode === "playing" || app.mode === "prompt-overtake-or-pass") && !isStage2Tutorial && !isStage3Tutorial && !isStage4Tutorial)
      || isStage3OvertakeStep
      || isStage4FreeStep;

    // 教學 step 9：第一關超車按鈕直接顯示
    const showOvertakeTutorial = isTutorial1 && step === 9;

    if (isFreePlayPhase || showOvertakeTutorial) {
      const laneSpd = currentLaneSpeed();
      const sameLane = app.playerLane === app.opponentLane;
      const lbl = sameLane ? "先換道才能超車"
                : canDirectOvertake() ? "✓ 超車 QTE"
                : `超車（差 ${app.opponentSpeed - laneSpd}）`;
      button("btn-overtake", lbl, app.w - 300, btnY, 130, 40,
        !canDirectOvertake(),
        canDirectOvertake() ? "start" : "primary");
    }

    // Pass 按鈕：自由打牌階段永遠顯示；教學特殊 step（如第四關 step 3）也顯示
    if (isFreePlayPhase || isStage4PassStep) {
      button("btn-pass", "Pass →", app.w - 160, btnY, 120, 40, false, "gray");
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

      // 計算內容寬度（剩餘動數 + 「動後 」+ icons）
      ctx.save();
      ctx.font = "900 18px system-ui, sans-serif";
      const remainW = ctx.measureText(`${hint.remaining}`).width;
      ctx.font = "700 10px system-ui, sans-serif";
      const dongW = ctx.measureText("動後 ").width;
      ctx.font = "900 20px system-ui, sans-serif";
      const iconW = 24;  // 每個 icon 間距
      const iconsW = icons.length * iconW;
      ctx.restore();
      const gap = 4;
      const totalW = remainW + 4 + dongW + iconsW;

      // 從中心算起點
      const cx = plateX + plateW / 2;
      let cursorX = cx - totalW / 2;

      // 剩餘動數
      text(`${hint.remaining}`, cursorX, hintY + 20, 18,
        isStrong2 ? "rgba(255,200,200,0.95)" : "rgba(255,220,140,0.95)", "900", "left");
      cursorX += remainW + 4;

      // 「動後 」
      text("動後", cursorX, hintY + 22, 10,
        "rgba(220,240,255,0.7)", "700", "left");
      cursorX += dongW;

      // icons + 記錄 rect 用於 tooltip hit-test
      const iconRects = [];
      for (const ic of icons) {
        const isIntentIcon = (ic === "⛔" || ic === "💨" || ic === "❓" || ic === "❗");
        const col = isIntentIcon ? intentColor : "#ffffff";
        text(ic, cursorX, hintY + 24, 20, col, "900", "left");
        // hit-test rect（含一點 padding）
        iconRects.push({
          x: cursorX - 2, y: hintY + 6,
          w: iconW, h: 24,
          icon: ic,
          intent: hint.intent,
        });
        cursorX += iconW;
      }
      // 儲存 iconRects 給 tooltip 偵測用
      app._opponentHintIconRects = iconRects;

      // bigData（大數據預測）：full mode 下顯示具體招式描述
      // label 由 computeOpponentNextActionHint(full) 產生（如「切到你道+加速」）
      if (hint.label) {
        text(hint.label, cursorX + 4, hintY + 22, 10, "rgba(180,230,255,0.95)", "700", "left");
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
    ctx.font = "900 13px system-ui, sans-serif";
    const titleW = ctx.measureText(title).width;
    ctx.font = "600 11px system-ui, sans-serif";
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
      // 舊格式（教學關）
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
    if (!oppImmuneToHazards && (hasPotholes || hasForceQte) && (intent === "block" || intent === "flee")) {
      // 預測對手會落在哪一道
      let targetLane = null;
      if (nextAct.action === "moveTo") {
        if (nextAct.target === "playerLane") targetLane = playerRef;
        else if (typeof nextAct.target === "number") targetLane = nextAct.target;
      } else if (nextAct.action === "moveSmart") {
        // moveSmart 在「有災害的賽段」全面降級：AI 選道空間被災害道影響、不再純粹照 strategy 走
        //   - 坑洞賽段：選道空間被坑洞排除、可能被擠到玩家道（block）或被迫離開玩家道（flee）
        //   - 油污賽段：AI 用期望值評估、可能選到油污道、50% 滑開實際落點不確定
        //   - bestForSelf：本來就是 unknown、不會走到這分支
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
    return { remaining, weight: nextWeight, action: nextAct.action, icons, label, hasMove, hasSpecial, intent };
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
      // ─── 舊格式：時序消費（教學關用）────────────────────────────────
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
    // 沙盒：對手車頭已有預告 UI（drawOpponentNextActionHint），HUD 不重複
    if (app.opponentBehaviors && app.opponentBehaviorLastTriggered) return;
    // 第三關特殊：用教學 step 偽造倒數（對手在 step 4 玩家做完 2 個動作時追過來）
    let remaining = null;
    let nextWeight = null;  // "weak" | "medium" | "strong" | null（舊格式）
    if (app.stageIndex === 2) {
      const s = app.tutorialStep;
      if (s >= 0 && s <= 4) {
        // 還沒追：剩餘動作 = 1 - 已做的動作（夾 0~1）
        remaining = Math.max(0, 1 - (app.actionsThisRound ?? 0));
      } else {
        return; // step 5 以後，對手已追過來，不再顯示
      }
    } else if (app.opponentBehaviors && app.opponentBehaviorLastTriggered) {
      // ─── 新格式：冷卻系統 ─────────────────────────────────────────────
      // 找下一個會觸發的 behavior（剩餘 cooldown 最短的）
      const actN = app.actionsThisRound ?? 0;
      let minRem = Infinity;
      let pickedBehavior = null;
      for (const b of app.opponentBehaviors) {
        const lastAt = app.opponentBehaviorLastTriggered[b.id] ?? -Infinity;
        const rem = Math.max(0, b.cooldown - (actN - lastAt));
        // 若 rem == 0，表示「下一動就會觸發」，採用 weight 較強的那個（同 trigger 邏輯）
        if (rem < minRem) {
          minRem = rem;
          pickedBehavior = b;
        } else if (rem === minRem && pickedBehavior) {
          const weightRank = { strong: 3, medium: 2, weak: 1 };
          if ((weightRank[b.weight] || 0) > (weightRank[pickedBehavior.weight] || 0)) {
            pickedBehavior = b;
          }
        }
      }
      if (minRem === Infinity) return;
      remaining = minRem;
      nextWeight = pickedBehavior?.weight ?? null;
    } else {
      // ─── 舊格式：時序消費（教學關用）──────────────────────────────────
      const actions = app.opponentActionsThisStage || [];
      if (actions.length === 0) return;
      const cardN = app.cardsPlayedThisRound;
      const actN  = app.actionsThisRound ?? 0;
      let minRem = Infinity;
      for (const a of actions) {
        if (a.onCardN != null)
          minRem = Math.min(minRem, Math.max(0, a.onCardN - cardN));
        if (a.onActionN != null)
          minRem = Math.min(minRem, Math.max(0, a.onActionN - actN));
      }
      if (minRem === Infinity) return;
      remaining = minRem;
    }

    const ctx = app.ctx;
    const size = 72;
    const cx = x + size / 2;
    const cy = y + size / 2;
    const pulse = 0.7 + Math.sin(time * 0.008) * 0.3;
    const isImminent = remaining <= 1;
    const isStrong = nextWeight === "strong";

    // 背景圓
    ctx.save();
    if (isImminent || isStrong) {
      ctx.shadowColor = `rgba(255,80,80,${pulse * 0.6})`;
      ctx.shadowBlur = isStrong ? 20 : 16;
    }
    ctx.beginPath(); ctx.arc(cx, cy, size/2, 0, Math.PI*2);
    ctx.fillStyle = (isImminent || isStrong)
      ? `rgba(60,12,12,0.95)`
      : "rgba(12,20,36,0.92)";
    ctx.fill();
    ctx.strokeStyle = (isImminent || isStrong)
      ? `rgba(255,80,80,${0.8 + pulse * 0.2})`
      : "rgba(255,180,60,0.7)";
    ctx.lineWidth = isStrong ? 3 : 2.5;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();

    // 倒數數字（大）
    text(`${remaining}`, cx, cy + 10, 28,
      (isImminent || isStrong) ? `rgba(255,100,100,${0.9+pulse*0.1})` : "rgba(255,200,60,0.95)",
      "900", "center");

    // 上方小字（強招時顯示「強招」）
    const topLabel = isStrong ? "對手強招" : "對手行動";
    text(topLabel, cx, cy - 24, 10,
      isStrong ? `rgba(255,160,160,${0.9})` : "rgba(200,200,200,0.75)",
      "800", "center");

    // 下方小字
    text(remaining === 0 ? "即將觸發！" : "個動作後", cx, cy + 28, 10,
      (isImminent || isStrong) ? "rgba(255,140,140,0.9)" : "rgba(180,180,180,0.65)",
      "700", "center");

    // 立即觸發時 / 強招時加閃爍外圈
    if (isImminent || isStrong) {
      ctx.save();
      ctx.globalAlpha = pulse * (isStrong ? 0.5 : 0.4);
      ctx.beginPath(); ctx.arc(cx, cy, size/2 + 8, 0, Math.PI*2);
      ctx.strokeStyle = "rgba(255,80,80,0.9)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  // ─── 手牌 ──────────────────────────────────────────────────────────────────
  function drawHand(time) {
    const cardW=122, cardH=164, gap=10;
    const total = app.hand.length*cardW + Math.max(0,app.hand.length-1)*gap;
    const x = app.w/2 - total/2;
    const y = app.h - 190;
    app.zones.cards = [];
    app.hand.forEach((card, i) => {
      if (app.drag && app.drag.card.id === card.id) return;
      const rect = { x: x+i*(cardW+gap), y, w: cardW, h: cardH };
      app.zones.cards.push({ card, index: i, rect });
      drawCard(card, rect.x, rect.y, rect.w, rect.h, false);
    });
  }

  // ─── 卡牌繪製（簡化版，保留 Sam 的圖示風格）──────────────────────────────
  function drawCard(card, x, y, w, h, dragging) {
    const ctx = app.ctx;
    const isTactic = card.cardClass === "tactic";
    const isTeam = card.cardClass === "team";
    // 盲牌：c2/c3/c4 隨機鎖定的盲牌，或 Boss 戰中未打完的盲牌張數
    const isBlind = isStage5BlindCard(card);

    const bg    = dragging   ? "rgba(14,28,50,0.98)"
                : isBlind    ? "rgba(48,32,12,0.96)"
                : isTactic   ? "rgba(28,18,8,0.96)"
                : isTeam     ? "rgba(14,32,22,0.96)"
                :              "rgba(14,28,50,0.96)";
    const border = isBlind   ? "rgba(220,160,60,0.75)"
                : isTactic   ? "rgba(255,180,60,0.75)"
                : isTeam     ? "rgba(120,220,160,0.75)"
                :               "rgba(105,164,224,0.55)";
    roundPanel(x, y, w, h, 10, bg, border, dragging ? 2.5 : 2);

    if (isBlind) {
      // 盲牌：只畫「?」+ 厚沙塵覆蓋
      drawCardSandStorm(x, y, w, h, 1.0);
      text("?", x+w/2, y+h*0.58, 64, "#ffd28a", "1000", "center");
      text("盲牌", x+w/2, y+h-24, 12, "rgba(255,220,160,0.85)", "800", "center");
      return;
    }

    // 卡牌類型標籤
    const typeLabel = isTactic ? "戰術" : isTeam ? "車隊" : "動作";
    const typeColor = isTactic ? "rgba(255,180,60,0.8)"
                    : isTeam   ? "rgba(120,220,160,0.85)"
                    :            "rgba(100,180,255,0.7)";
    text(typeLabel, x+w/2, y+16, 10, typeColor, "700", "center");

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
      text(tagText, x + w - tagW/2 - 4, y + 15, tagFs, "rgba(220,255,235,0.95)", "800", "center");
    }

    // 卡名
    text(card.name, x+w/2, y+42, 15, "#e8f0ff", "900", "center");

    // 輪胎消耗標記（只有超加速有 tireCost）
    if (card.tireCost) {
      roundPanel(x+w-26, y+4, 22, 22, 5, "rgba(60,10,10,0.9)", "rgba(255,80,60,0.7)", 1.5);
      text("🔴", x+w-15, y+19, 11, "#ff8060", "900", "center");
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
      text(speedStr, x+w/2, y+h*0.58, 44, speedColor, "1000", "center");
      // 被修飾時、在數字右側畫小三角當「被動過」的提示
      if (_eff.modified) {
        const arrow = _eff.delta > 0 ? "▲" : "▼";
        const arrowCol = _eff.delta > 0 ? "rgba(140,255,160,0.85)" : "rgba(255,170,170,0.85)";
        text(arrow, x+w*0.86, y+h*0.46, 12, arrowCol, "900", "center");
      }
    } else if (typeof card.speedValue === "number" && card.cardClass === "action") {
      // speedValue=0（如 drift）：用較小的圖示、留空間給長 note
      drawCardCenterIcon(card, x+w/2, y+h*0.42, 32);
    } else {
      // 車隊牌：用圖示
      drawCardCenterIcon(card, x+w/2, y+h*0.42, 32);
    }

    // 效果描述（v0.9：只寫速度以外的效果、若 note 為空就略過、文字太多自動換行+縮字）
    if (card.note) {
      let noteFontSize = 11;
      let lineH = 14;
      // 先用 11px 試排，行數多就縮到 9px / 10px、確保不會撞到中央大字
      let noteLines = wrapTextLines(card.note, w - 16, noteFontSize);
      if (noteLines.length >= 3) {
        noteFontSize = 9;
        lineH = 12;
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

  // 判斷此卡的 cost 此刻是否被沙暴遮蔽（固定 N 張，整回合穩定）
  function isCostObscuredNow(card) {
    if (!isStage5() || !app.stage5 || !app.stage5.obscuredCardIds) return false;
    if (!card || !card.id) return false;
    return app.stage5.obscuredCardIds.has(card.id);
  }
  // 簡易字串 hash → 0~1
  function hashStr(s) {
    let h = 0;
    for (let i=0; i<s.length; i++) h = ((h<<5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h) % 1000 / 1000;
  }
  // 畫 cost 區域的沙塵遮蔽（小塊 Sam 風格筆觸）
  function drawCostSandObscure(x, y, w, h) {
    const ctx = app.ctx;
    const t = performance.now();
    ctx.save();
    // 截到 cost 區域
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    // 厚實的橘黃底（夠不透明，明顯遮住 cost 數字）
    ctx.fillStyle = "rgba(140, 90, 30, 0.98)";
    ctx.fillRect(x, y, w, h);
    // 二層加深
    ctx.fillStyle = "rgba(80, 50, 20, 0.55)";
    ctx.fillRect(x, y, w, h);
    // 斜飄沙塵線條
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 8; i++) {
      const px = x + ((i * 13 + t * 0.06) % (w + 30)) - 15;
      const py = y + (i * 7) % h;
      const len = 18 + (i % 3) * 8;
      ctx.strokeStyle = `rgba(255, 230, 160, ${0.35 + (i % 3) * 0.1})`;
      ctx.lineWidth = 1 + (i % 2);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + len, py - 6);
      ctx.stroke();
    }
    ctx.restore();
  }
  // 卡片全面沙塵覆蓋（盲牌用）
  function drawCardSandStorm(x, y, w, h, intensity) {
    const ctx = app.ctx;
    const t = performance.now();
    ctx.save();
    // 截到卡片區域
    ctx.beginPath();
    roundedRectPath(ctx, x+2, y+2, w-4, h-4, 8);
    ctx.clip();
    // 沙塵主底
    const g = ctx.createLinearGradient(x, y, x, y+h);
    g.addColorStop(0, "rgba(140, 90, 30, 0.85)");
    g.addColorStop(0.5, "rgba(180, 120, 50, 0.92)");
    g.addColorStop(1, "rgba(100, 60, 25, 0.85)");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    // 斜飄沙塵筆觸（多層）
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 36; i++) {
      const px = x + ((i * 21 + t * 0.12) % (w + 60)) - 30;
      const py = y + (i * 11 + t * 0.06) % h;
      const len = 30 + (i % 4) * 14;
      ctx.strokeStyle = `rgba(255, 220, 140, ${0.18 + (i % 4) * 0.08})`;
      ctx.lineWidth = 1 + (i % 2);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + len, py - 10);
      ctx.stroke();
    }
    ctx.restore();
  }
  // 圓角矩形 path（給 clip 用）
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
  // 沙盒：無沙暴、無盲牌機制
  function isStage5BlindCard(card) {
    return false;
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


  // ─── 第一關步驟教學 Overlay ────────────────────────────────────────────────
  function drawTutorialStage1Overlay(time) {
    const step = app.tutorialStep;
    const ctx = app.ctx;
    const pulse = 0.7 + Math.sin(time * 0.005) * 0.3;
    const lanes = app.zones.lanes || [];

    // 收集「不需要變暗」的區域
    const brightZones = [];
    const addBright = (zone, pad=10) => {
      if (!zone) return;
      brightZones.push({ x: zone.x-pad, y: zone.y-pad, w: zone.w+pad*2, h: zone.h+pad*2 });
    };

    // step 0-3：全黑（只有中間對話框），不亮任何東西
    // step 1-2：HUD 亮
    if (step >= 1 && step <= 2) {
      const hud = statusHudRect();
      addBright(hud, 4);
    }
    // step 3（換道說明）→ 移到 step 6，這裡直接跳到介紹賽道
    // step 4：三道 + 手牌亮
    if (step === 4) {
      lanes.forEach(z => addBright(z));
      addBright({ x: 0, y: app.h-216, w: app.w, h: 220 }, 0); // 手牌也亮
    }
    // step 5：玩家道亮 + 手牌亮
    if (step === 5) {
      addBright(lanes[app.playerLane]);
      addBright({ x: 0, y: app.h-216, w: app.w, h: 220 }, 0);
    }
    // step 6：玩家道 + 空道 + 手牌亮
    if (step === 6) {
      addBright(lanes[app.playerLane]);
      const ei = [0,1,2].find(i => i !== app.playerLane) ?? 0;
      addBright(lanes[ei]);
      addBright({ x: 0, y: app.h-216, w: app.w, h: 220 }, 0);
    }
    // step 7：玩家新道 + 手牌亮
    if (step === 7) {
      lanes.forEach(z => addBright(z));
      addBright({ x: 0, y: app.h-216, w: app.w, h: 220 }, 0);
    }
    // step 8：速度確認說明，全黑（只有中間對話框）
    // step 9：三道全亮 + 右側超車按鈕區域亮
    if (step === 9) {
      lanes.forEach(z => addBright(z));
      const firstLane = lanes[0] || lanes[1];
      if (firstLane) {
        addBright({ x: app.w-316, y: firstLane.y, w: 156, h: 46 }, 6);
      }
    }

    // 用 clip 路徑把亮區域排除，其餘填黑
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, app.w, app.h);
    // 從整個畫面減去亮區域（evenodd 填充規則）
    for (const z of brightZones) {
      const r = 12;
      ctx.moveTo(z.x+r, z.y);
      ctx.lineTo(z.x+z.w-r, z.y);
      ctx.quadraticCurveTo(z.x+z.w, z.y, z.x+z.w, z.y+r);
      ctx.lineTo(z.x+z.w, z.y+z.h-r);
      ctx.quadraticCurveTo(z.x+z.w, z.y+z.h, z.x+z.w-r, z.y+z.h);
      ctx.lineTo(z.x+r, z.y+z.h);
      ctx.quadraticCurveTo(z.x, z.y+z.h, z.x, z.y+z.h-r);
      ctx.lineTo(z.x, z.y+r);
      ctx.quadraticCurveTo(z.x, z.y, z.x+r, z.y);
      ctx.closePath();
    }
    ctx.fillStyle = "rgba(0,0,0,0.80)";
    ctx.fill("evenodd");
    ctx.restore();

    // ─ Step 0：卡牌介紹（全黑，中間對話框）────────────────────────────────────
    if (step === 0) {
      const bw = 520, bh = 300;
      const bx = app.w/2 - bw/2, by = app.h/2 - bh/2;
      roundPanel(bx, by, bw, bh, 14, "rgba(6,14,28,0.97)", "rgba(105,164,224,0.55)", 2);
      text("這是一張卡牌", app.w/2, by+30, 14, "rgba(160,190,230,0.8)", "700", "center");
      // 示意加速牌（置中，與標題有間距）
      const cw = 110, ch = 148, cx2 = app.w/2 - cw/2, cy2 = by + 50;
      roundPanel(cx2, cy2, cw, ch, 8, "rgba(14,28,50,0.96)", "rgba(105,164,224,0.55)", 2);
      text("動作", app.w/2, cy2+16, 10, "rgba(100,180,255,0.7)", "700", "center");
      text("加速", app.w/2, cy2+38, 15, "#e8f0ff", "900", "center");
      roundPanel(cx2+cw-24, cy2+5, 20, 20, 4, "rgba(20,30,50,0.9)", "rgba(255,200,60,0.6)", 1.5);
      text("0", cx2+cw-14, cy2+19, 12, "#ffe080", "900", "center");
      // 閃電圖示（簡單畫）
      const iconCx = app.w/2, iconCy = cy2 + 95;
      ctx.save(); ctx.translate(iconCx, iconCy);
      const g = ctx.createLinearGradient(-10,-16,10,16);
      g.addColorStop(0,"#fdba74"); g.addColorStop(0.5,"#ea580c"); g.addColorStop(1,"#9a3412");
      ctx.beginPath();
      ctx.moveTo(4,-16); ctx.lineTo(-8,2); ctx.lineTo(0,2);
      ctx.lineTo(-4,16); ctx.lineTo(8,-2); ctx.lineTo(0,-2);
      ctx.closePath(); ctx.fillStyle=g; ctx.fill();
      ctx.restore();
      text("速度 +20", app.w/2, cy2+ch-10, 11, "rgba(200,220,255,0.75)", "700", "center");
      // 說明文字與卡牌之間留空白
      const descY = cy2 + ch + 20;
      text("右上角的 ⚡ 是動力，部分牌需要消耗動力才能打。", app.w/2, descY, 13, "rgba(200,220,255,0.9)", "700", "center");
      text("這張加速牌 cost 為 0，可以盡情打出。", app.w/2, descY+22, 13, "rgba(180,200,255,0.75)", "700", "center");
      button("tutorial-step-next", "下一步 →", app.w/2-66, by+bh-16, 132, 36);
      return;
    }

    // ─ Step 1：介紹動力（HUD 亮）──────────────────────────────────────────────
    if (step === 1) {
      const hud = statusHudRect();
      const tipW = 300, tipH = 70;
      // HUD 在右下角：提示框放在 HUD 上方
      const tipX = Math.min(app.w - tipW - 16, hud.x);
      const tipY = hud.y - tipH - 16;
      roundPanel(tipX, tipY, tipW, tipH, 12, "rgba(6,14,28,0.97)", "rgba(255,200,60,0.6)", 1.5);
      text("⚡ 動力", tipX+tipW/2, tipY+24, 15, "rgba(255,230,120,0.97)", "900", "center");
      text("打牌的費用，每回合自動回滿。", tipX+tipW/2, tipY+50, 13, "rgba(200,220,255,0.85)", "700", "center");
      // 從提示框底部指向 HUD「動力」那一行（hud.y + 60 附近）
      ctx.save(); ctx.globalAlpha = pulse;
      ctx.strokeStyle = "rgba(255,200,60,0.8)"; ctx.lineWidth = 2; ctx.setLineDash([5,4]);
      ctx.beginPath(); ctx.moveTo(tipX+tipW/2, tipY+tipH); ctx.lineTo(hud.x+hud.w/2, hud.y+72); ctx.stroke();
      ctx.setLineDash([]); ctx.restore();
      button("tutorial-step-next", "了解 →", tipX+tipW/2-54, tipY-44, 108, 34);
      return;
    }

    // ─ Step 2：介紹速度（HUD 亮）──────────────────────────────────────────────
    if (step === 2) {
      const hud = statusHudRect();
      const tipW = 320, tipH = 70;
      const tipX = Math.min(app.w - tipW - 16, hud.x - 24);
      const tipY = hud.y - tipH - 16;
      roundPanel(tipX, tipY, tipW, tipH, 12, "rgba(6,14,28,0.97)", "rgba(100,200,255,0.6)", 1.5);
      text("基礎速度 vs 對手速度", tipX+tipW/2, tipY+24, 15, "rgba(120,220,255,0.97)", "900", "center");
      text("你的速度要超過對手速度才能超車！", tipX+tipW/2, tipY+50, 13, "rgba(200,220,255,0.85)", "700", "center");
      // 指向 HUD「基礎速度」那一行
      ctx.save(); ctx.globalAlpha = pulse;
      ctx.strokeStyle = "rgba(100,200,255,0.8)"; ctx.lineWidth = 2; ctx.setLineDash([5,4]);
      ctx.beginPath(); ctx.moveTo(tipX+tipW/2, tipY+tipH); ctx.lineTo(hud.x+hud.w/2, hud.y+130); ctx.stroke();
      ctx.setLineDash([]); ctx.restore();
      button("tutorial-step-next", "了解 →", tipX+tipW/2-54, tipY-44, 108, 34);
      return;
    }

    // ─ Step 3：介紹賽道（全黑，中間對話框）──────────────────────────────────
    if (step === 3) {
      const bw = 480, bh = 160;
      const bx = app.w/2 - bw/2, by = app.h/2 - bh/2;
      roundPanel(bx, by, bw, bh, 14, "rgba(6,14,28,0.97)", "rgba(105,164,224,0.55)", 2);
      text("接下來認識賽道", app.w/2, by+34, 16, "#dfeeff", "900", "center");
      text("賽道有多條道，你和對手各在一條道上。", app.w/2, by+66, 14, "rgba(200,220,255,0.9)", "700", "center");
      text("打牌到你所在的道可以累積速度。", app.w/2, by+90, 14, "rgba(200,220,255,0.9)", "700", "center");
      button("tutorial-step-next", "開始！", app.w/2-66, by+bh-16, 132, 36, false, "start");
      return;
    }

    // ─ Step 4：引導打牌（三道亮）────────────────────────────────────────────
    if (step === 4) {
      const pz = lanes[app.playerLane];
      if (pz) {
        const tipW = 260, tipH = 44;
        const tipX = pz.x > app.w/2 ? pz.x - tipW - 16 : pz.x + pz.w + 16;
        const tipY = pz.y + (pz.h - tipH) / 2;
        roundPanel(tipX, tipY, tipW, tipH, 12, "rgba(6,14,28,0.97)", "rgba(100,180,255,0.55)", 1.5);
        text("把牌拖到你的道累積速度！", tipX+tipW/2, tipY+28, 14, "rgba(200,220,255,0.97)", "800", "center");
        const cx = pz.x + pz.w/2;
        ctx.save(); ctx.globalAlpha = pulse;
        ctx.strokeStyle = "rgba(100,200,255,0.8)"; ctx.lineWidth = 2; ctx.setLineDash([6,4]);
        ctx.beginPath(); ctx.moveTo(cx, app.h-210); ctx.lineTo(cx, pz.y+pz.h+4); ctx.stroke();
        ctx.setLineDash([]); ctx.restore();
        text("▲", cx, pz.y+pz.h+18+Math.sin(time*0.007)*4, 18, `rgba(100,200,255,${pulse})`, "900", "center");
      }
      return;
    }

    // ─ Step 5：對手警告（同道閃紅）──────────────────────────────────────────
    if (step === 5) {
      const pz = lanes[app.playerLane];
      if (pz) {
        ctx.save();
        ctx.strokeStyle = `rgba(255,60,60,${0.75+pulse*0.25})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect(pz.x-5, pz.y-5, pz.w+10, pz.h+10, 14); ctx.stroke();
        ctx.restore();
        const tipW = 260, tipH = 68;
        const tipX = pz.x > app.w/2 ? pz.x - tipW - 16 : pz.x + pz.w + 16;
        const tipY = pz.y + (pz.h - tipH) / 2;
        roundPanel(tipX, tipY, tipW, tipH, 12, "rgba(20,6,6,0.97)", "rgba(255,80,80,0.65)", 2);
        text("⚠ 對手在同一條道！", tipX+tipW/2, tipY+22, 14, "rgba(255,160,140,0.98)", "900", "center");
        text("換到空道才能超車！", tipX+tipW/2, tipY+44, 14, "rgba(255,160,140,0.98)", "800", "center");
        button("tutorial-step-switch", "知道了，換道！", tipX+tipW/2-72, tipY+tipH+10, 144, 34);
      }
      return;
    }

    // ─ Step 6：等待換道（加上換道說明）─────────────────────────────────────
    if (step === 6) {
      const emptyIdx = [0,1,2].find(i => i !== app.playerLane) ?? 0;
      const ez = lanes[emptyIdx];
      if (ez) {
        const tipW = 280, tipH = 68;
        const tipX = emptyIdx === 0 ? ez.x - tipW - 16 : ez.x + ez.w + 16;
        const safeX = Math.max(8, Math.min(app.w-tipW-8, tipX));
        const tipY = ez.y + (ez.h - tipH) / 2;
        roundPanel(safeX, tipY, tipW, tipH, 12, "rgba(6,14,28,0.97)", "rgba(255,200,60,0.55)", 1.5);
        text("把牌拖到這裡換道！", safeX+tipW/2, tipY+22, 14, "rgba(255,230,160,0.98)", "800", "center");
        text("換道只要棄一張牌，不耗動力。", safeX+tipW/2, tipY+44, 12, "rgba(200,200,160,0.75)", "700", "center");
        const cx = ez.x + ez.w/2;
        ctx.save(); ctx.globalAlpha = pulse;
        ctx.strokeStyle = "rgba(255,200,80,0.8)"; ctx.lineWidth = 2; ctx.setLineDash([6,4]);
        ctx.beginPath(); ctx.moveTo(cx, app.h-210); ctx.lineTo(cx, ez.y+ez.h+4); ctx.stroke();
        ctx.setLineDash([]); ctx.restore();
        text("▲", cx, ez.y+ez.h+18+Math.sin(time*0.007)*4, 18, `rgba(255,200,80,${pulse})`, "900", "center");
      }
      return;
    }

    // ─ Step 7：換道後加速 ────────────────────────────────────────────────────
    if (step === 7) {
      const pz = lanes[app.playerLane];
      if (pz) {
        const tipW = 260, tipH = 44;
        const tipX = pz.x > app.w/2 ? pz.x - tipW - 16 : pz.x + pz.w + 16;
        const tipY = pz.y + (pz.h - tipH) / 2;
        roundPanel(tipX, tipY, tipW, tipH, 12, "rgba(6,14,28,0.97)", "rgba(100,180,255,0.55)", 1.5);
        text("換道成功！繼續打牌加速！", tipX+tipW/2, tipY+28, 14, "rgba(200,220,255,0.98)", "800", "center");
        const cx = pz.x + pz.w/2;
        ctx.save(); ctx.globalAlpha = pulse;
        ctx.strokeStyle = "rgba(100,200,255,0.8)"; ctx.lineWidth = 2; ctx.setLineDash([6,4]);
        ctx.beginPath(); ctx.moveTo(cx, app.h-210); ctx.lineTo(cx, pz.y+pz.h+4); ctx.stroke();
        ctx.setLineDash([]); ctx.restore();
        text("▲", cx, pz.y+pz.h+18+Math.sin(time*0.007)*4, 18, `rgba(100,200,255,${pulse})`, "900", "center");
      }
      return;
    }

    // ─ Step 8：速度確認說明（全黑，中間對話框）─────────────────────────────
    if (step === 8) {
      const bw = 480, bh = 180;
      const bx = app.w/2 - bw/2, by = app.h/2 - bh/2;
      roundPanel(bx, by, bw, bh, 14, "rgba(6,14,28,0.97)", "rgba(100,255,120,0.55)", 2);
      text("你的速度已超過對手！", app.w/2, by+42, 20, "#a0ffb0", "900", "center");
      // 速度對比
      const midY = by + 90;
      roundPanel(bx+40, midY-20, 160, 44, 8, "rgba(12,28,52,0.9)", "rgba(100,200,255,0.5)", 1.5);
      text("你的速度", bx+40+80, midY-4, 12, "rgba(120,200,255,0.8)", "700", "center");
      text(`${app.playerSpeed}`, bx+40+80, midY+20, 22, "rgba(120,220,255,0.97)", "900", "center");
      text("VS", app.w/2, midY+10, 16, "rgba(200,200,200,0.6)", "700", "center");
      roundPanel(bx+bw-200, midY-20, 160, 44, 8, "rgba(30,10,10,0.9)", "rgba(255,100,100,0.5)", 1.5);
      text("對手速度", bx+bw-200+80, midY-4, 12, "rgba(255,130,130,0.8)", "700", "center");
      text(`${app.opponentSpeed}`, bx+bw-200+80, midY+20, 22, "rgba(255,150,150,0.97)", "900", "center");
      text("現在可以超車了！", app.w/2, by+bh-42, 14, "rgba(200,220,255,0.9)", "700", "center");
      button("tutorial-step-next", "超車！→", app.w/2-66, by+bh-14, 132, 36, false, "start");
      return;
    }

    // ─ Step 9：超車按鈕 ──────────────────────────────────────────────────────
    if (step === 9) {
      const pz = lanes[app.playerLane];
      const btnY = pz ? pz.y : app.h - 430;
      const tipW = 220, tipH = 40;
      const tipX = app.w - 310;
      roundPanel(tipX, btnY - tipH - 10, tipW, tipH, 10,
        "rgba(6,14,28,0.97)", "rgba(100,255,120,0.55)", 1.5);
      text("按下超車！", tipX + tipW/2, btnY - tipH - 10 + 26, 13,
        "rgba(180,255,200,0.98)", "800", "center");
      return;
    }
  }
  // ─── 第二關 QTE 教學 Overlay ───────────────────────────────────────────────
  // step 0：全黑，場景說明（進入 playing 後顯示）
  // step 1：正常打牌（無遮罩），手牌打完自動到 step 2
  // step 2：全黑，QTE 說明，按鈕觸發 QTE
  function drawTutorialStage2QteOverlay(time) {
    const step = app.tutorialStep;
    const ctx = app.ctx;

    // step 0：全黑說明
    if (step === 0) {
      ctx.fillStyle = "rgba(0,0,0,0.88)";
      ctx.fillRect(0, 0, app.w, app.h);
      const bw = 540, bh = 200;
      const bx = app.w/2 - bw/2, by = app.h/2 - bh/2;
      roundPanel(bx, by, bw, bh, 14, "rgba(6,14,28,0.97)", "rgba(105,164,224,0.55)", 2);
      text("關卡 2", app.w/2, by+34, 14, "rgba(160,190,230,0.8)", "700", "center");
      text("此賽道特別狹窄，只剩一條道！", app.w/2, by+68, 20, "#dfeeff", "900", "center");
      text("對手就在你前方，同道無法直接超車。", app.w/2, by+102, 15, "rgba(200,220,255,0.9)", "700", "center");
      text("先打牌累積速度，然後靠 QTE 極限超車！", app.w/2, by+126, 15, "rgba(200,220,255,0.9)", "700", "center");
      button("tutorial-step-next", "了解 →", app.w/2-66, by+bh-16, 132, 36, false, "start");
      return;
    }

    // step 1：打牌（不加遮罩，讓玩家自由打）
    if (step === 1) {
      // 只加一個小提示
      const lanes = app.zones.lanes || [];
      const pz = lanes[app.playerLane];
      if (pz && app.hand.length > 0) {
        const tipW = 240, tipH = 40;
        const tipX = pz.x + (pz.w - tipW) / 2;
        const tipY = pz.y - tipH - 12;
        roundPanel(tipX, tipY, tipW, tipH, 10, "rgba(6,14,28,0.92)", "rgba(100,180,255,0.45)", 1.5);
        text("打牌累積速度！", tipX+tipW/2, tipY+26, 14, "rgba(200,220,255,0.9)", "800", "center");
      }
      return;
    }

    // step 2：全黑，QTE 說明
    if (step === 2) {
      ctx.fillStyle = "rgba(0,0,0,0.92)";
      ctx.fillRect(0, 0, app.w, app.h);
      const bw = 600, bh = 280;
      const bx = app.w/2 - bw/2, by = app.h/2 - bh/2;
      roundPanel(bx, by, bw, bh, 14, "rgba(6,14,28,0.97)", "rgba(255,217,79,0.55)", 2);
      text("速度夠了！", app.w/2, by+40, 22, "#ffd94f", "900", "center");
      text("但同道超車十分驚險，", app.w/2, by+76, 16, "#dfeeff", "700", "center");
      text("在毫釐的差距中需要靠 QTE 才能極限超車。", app.w/2, by+100, 16, "#dfeeff", "700", "center");
      // QWER 示意圖
      const kbY = by + 148;
      text("圓圈出現時，按下圓圈內顯示的按鍵：", app.w/2, kbY, 14, "rgba(200,220,255,0.9)", "700", "center");
      const keys = ['Q','W','E','R'];
      keys.forEach((k, i) => {
        const kx = app.w/2 - 66 + i * 44;
        roundPanel(kx-16, kbY+14, 32, 32, 7, "rgba(20,30,50,0.9)", "rgba(255,217,79,0.7)", 2);
        text(k, kx, kbY+34, 18, "rgba(255,217,79,0.95)", "900", "center");
      });
      text("按對了算 Perfect，按錯了算 Miss。", app.w/2, kbY+62, 13, "rgba(180,180,180,0.8)", "700", "center");
      button("qte-tutorial-stage2-start", "開始極限超車 QTE！", app.w/2-110, by+bh-16, 220, 40, false, "start");
      return;
    }
  }

  // ─── 第三關教學 Overlay ────────────────────────────────────────────────────
  // step 0：全黑，關卡說明
  // step 1：左道亮 + 倒數圖示亮，介紹賽道加成和對手倒數
  // step 2：三道 + 手牌 + 倒數亮，引導打牌（打第2張觸發對手移動）
  // step 3：對手移動警告（自動，不需要按鈕）
  // step 4：手牌打完 → 超車
  function drawTutorialStage2Overlay(time) {
    const step = app.tutorialStep;
    const ctx = app.ctx;
    const pulse = 0.7 + Math.sin(time * 0.005) * 0.3;
    const lanes = app.zones.lanes || [];

    // 計算倒數圖示位置（和 drawLanes 一致）
    const laneCount = app.laneCount;
    const laneW = Math.min(240, (app.w - 320) / laneCount - 12);
    const laneH = 170;
    const gap = 14;
    const totalW = laneCount * laneW + (laneCount-1) * gap;
    const baseX = (app.w - totalW) / 2;
    const baseY = app.h - 190 - laneH - 30;
    const counterX = baseX + totalW + 16;
    const counterY = baseY;
    const counterRect = { x: counterX, y: counterY, w: 72, h: 72 };

    // 亮區
    const brightZones = [];
    const addBright = (zone, pad=10) => {
      if (!zone) return;
      brightZones.push({ x:zone.x-pad, y:zone.y-pad, w:zone.w+pad*2, h:zone.h+pad*2 });
    };

    // 哪些 step 用 spotlight 遮罩（其他 step 不畫遮罩，玩家自由操作）
    const isSpotlight = step === 1 || step === 2 || step === 3;
    if (step === 1) {
      // step 1：聚光兩條道
      lanes.forEach(z => addBright(z));
    } else if (step === 2) {
      // step 2：聚光兩道（看數字差別）+ HUD（看「基礎速度」）
      lanes.forEach(z => addBright(z));
      addBright(statusHudRect(), 6);
    } else if (step === 3) {
      // step 3：聚光倒數圖示
      addBright(counterRect, 8);
    }

    // 畫遮罩（spotlight）
    if (isSpotlight) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, app.w, app.h);
      for (const z of brightZones) {
        const r = 12;
        ctx.moveTo(z.x+r, z.y);
        ctx.lineTo(z.x+z.w-r, z.y);
        ctx.quadraticCurveTo(z.x+z.w, z.y, z.x+z.w, z.y+r);
        ctx.lineTo(z.x+z.w, z.y+z.h-r);
        ctx.quadraticCurveTo(z.x+z.w, z.y+z.h, z.x+z.w-r, z.y+z.h);
        ctx.lineTo(z.x+r, z.y+z.h);
        ctx.quadraticCurveTo(z.x, z.y+z.h, z.x, z.y+z.h-r);
        ctx.lineTo(z.x, z.y+r);
        ctx.quadraticCurveTo(z.x, z.y, z.x+r, z.y);
        ctx.closePath();
      }
      ctx.fillStyle = "rgba(0,0,0,0.78)";
      ctx.fill("evenodd");
      ctx.restore();
    }

    // ─ Step 0：關卡簡介（全黑） ─────────────────────────────────────────────
    if (step === 0) {
      ctx.fillStyle = "rgba(0,0,0,0.88)";
      ctx.fillRect(0, 0, app.w, app.h);
      const bw = 540, bh = 200;
      const bx = app.w/2 - bw/2, by = app.h/2 - bh/2;
      roundPanel(bx, by, bw, bh, 14, "rgba(6,14,28,0.97)", "rgba(255,200,60,0.55)", 2);
      text("關卡 3", app.w/2, by+34, 14, "rgba(255,200,60,0.8)", "700", "center");
      text("彎道！", app.w/2, by+74, 24, "#dfeeff", "900", "center");
      text("這條彎道有內彎與外彎兩道，", app.w/2, by+114, 15, "rgba(200,220,255,0.9)", "700", "center");
      text("內彎速度快但更狹窄，競爭激烈。", app.w/2, by+136, 15, "rgba(200,220,255,0.9)", "700", "center");
      text("對手也不會傻傻地讓你過彎，會逼近並阻擋你。", app.w/2, by+162, 13, "rgba(180,180,220,0.78)", "700", "center");
      button("tutorial-step-next", "下一步 →", app.w/2-66, by+bh-16, 132, 36, false, "start");
      return;
    }

    // ─ Step 1：兩道差異 ─────────────────────────────────────────────────────
    if (step === 1) {
      // 內彎（左道，index 0）金色框
      const iz = lanes[0];
      if (iz) {
        ctx.save();
        ctx.strokeStyle = `rgba(255,200,60,${0.7+pulse*0.3})`;
        ctx.lineWidth = 3; ctx.setLineDash([6,4]);
        ctx.beginPath(); ctx.roundRect(iz.x-4, iz.y-4, iz.w+8, iz.h+8, 13); ctx.stroke();
        ctx.setLineDash([]); ctx.restore();
        const tipW = 230, tipH = 78;
        const tipY = iz.y + (iz.h - tipH) / 2;
        const tipX = Math.max(8, iz.x - tipW - 14);
        roundPanel(tipX, tipY, tipW, tipH, 12, "rgba(28,20,4,0.97)", "rgba(255,200,60,0.6)", 1.5);
        text("★ 內彎", tipX+tipW/2, tipY+22, 14, "rgba(255,220,100,0.98)", "900", "center");
        text("速度 ×1.25", tipX+tipW/2, tipY+44, 13, "rgba(255,210,120,0.92)", "800", "center");
        text("但 QTE 較難", tipX+tipW/2, tipY+64, 12, "rgba(200,180,120,0.85)", "700", "center");
      }
      // 外彎（右道，index 1）藍色框
      const oz2 = lanes[1];
      if (oz2) {
        ctx.save();
        ctx.strokeStyle = `rgba(140,200,220,${0.7+pulse*0.3})`;
        ctx.lineWidth = 3; ctx.setLineDash([6,4]);
        ctx.beginPath(); ctx.roundRect(oz2.x-4, oz2.y-4, oz2.w+8, oz2.h+8, 13); ctx.stroke();
        ctx.setLineDash([]); ctx.restore();
        const tipW = 230, tipH = 78;
        const tipY = oz2.y + (oz2.h - tipH) / 2;
        const tipX = Math.min(app.w-tipW-8, oz2.x + oz2.w + 14);
        roundPanel(tipX, tipY, tipW, tipH, 12, "rgba(4,20,28,0.97)", "rgba(140,200,220,0.6)", 1.5);
        text("◎ 外彎", tipX+tipW/2, tipY+22, 14, "rgba(140,220,240,0.98)", "900", "center");
        text("速度 ×0.9", tipX+tipW/2, tipY+44, 13, "rgba(160,220,230,0.92)", "800", "center");
        text("但 QTE 較簡單", tipX+tipW/2, tipY+64, 12, "rgba(140,200,200,0.85)", "700", "center");
      }
      // 中央底部「了解」按鈕
      const btnW = 132, btnH = 36;
      button("tutorial-step-next", "了解 →", app.w/2-btnW/2, app.h-btnH-32, btnW, btnH, false, "start");
      return;
    }

    // ─ Step 2：兩種速度數字（基礎速度 vs 此道速度） ─────────────────────────
    if (step === 2) {
      const bw = 580, bh = 200;
      // 對話框下移到畫面上半邊（HUD 在右下角、道路在中下，避免擋住要看的東西）
      const bx = app.w/2 - bw/2, by = app.h * 0.04;
      roundPanel(bx, by, bw, bh, 14, "rgba(6,14,28,0.97)", "rgba(255,217,79,0.6)", 2);
      text("看仔細：兩種速度", app.w/2, by+34, 18, "rgba(255,230,140,0.98)", "900", "center");
      text("右下角的「基礎速度」是你打牌累積的數字。", app.w/2, by+74, 14, "rgba(220,230,255,0.92)", "700", "center");
      text("道路上的「此道速度」是套上加成後的實際數字。", app.w/2, by+98, 14, "rgba(220,230,255,0.92)", "700", "center");
      text("超車時看的是「此道速度」。", app.w/2, by+138, 15, "rgba(255,230,140,0.98)", "900", "center");
      const btnW2 = 132, btnH2 = 36;
      button("tutorial-step-next", "了解 →", app.w/2-btnW2/2, by+bh-btnH2/2-2, btnW2, btnH2, false, "start");
      return;
    }

    // ─ Step 3：對手會反應（聚光倒數圖示） ────────────────────────────────────
    if (step === 3) {
      const tipW = 280, tipH = 96;
      // 倒數圖示在右上角，提示框放在它左邊
      const tipX = Math.max(8, counterX - tipW - 16);
      const tipY = counterY + (72 - tipH) / 2;
      roundPanel(tipX, tipY, tipW, tipH, 12, "rgba(20,12,4,0.97)", "rgba(255,180,60,0.6)", 1.5);
      text("對手會反應！", tipX+tipW/2, tipY+24, 16, "rgba(255,210,120,0.98)", "900", "center");
      text("這個倒數圖示告訴你", tipX+tipW/2, tipY+48, 12, "rgba(220,200,160,0.88)", "700", "center");
      text("再幾個動作後對手會動。", tipX+tipW/2, tipY+66, 12, "rgba(220,200,160,0.88)", "700", "center");
      text("換道、打牌都算「動作」。", tipX+tipW/2, tipY+84, 11, "rgba(200,180,140,0.7)", "700", "center");
      // 從提示指向倒數圖示
      ctx.save(); ctx.globalAlpha = pulse;
      ctx.strokeStyle = "rgba(255,200,80,0.85)"; ctx.lineWidth = 2; ctx.setLineDash([5,4]);
      ctx.beginPath(); ctx.moveTo(tipX+tipW, tipY+tipH/2); ctx.lineTo(counterX-4, counterY+36); ctx.stroke();
      ctx.setLineDash([]); ctx.restore();
      // 中央底部「了解」按鈕
      const btnW = 132, btnH = 36;
      button("tutorial-step-next", "了解 →", app.w/2-btnW/2, app.h-btnH-32, btnW, btnH, false, "start");
      return;
    }

    // ─ Step 4：自由打牌 1（小提示，等玩家做 2 個動作） ──────────────────────
    if (step === 4) {
      const tipW = 320, tipH = 56;
      const tipX = app.w/2 - tipW/2;
      const firstLane = lanes[0];
      const tipY = firstLane ? firstLane.y - tipH - 12 : app.h * 0.3;
      roundPanel(tipX, tipY, tipW, tipH, 12, "rgba(6,14,28,0.92)", "rgba(255,200,60,0.5)", 1.5);
      text("試試看打牌、換道...", tipX+tipW/2, tipY+24, 14, "rgba(255,230,160,0.95)", "900", "center");
      text("（注意右邊圓圈的倒數，對方好像嘗試要做些甚麼...）", tipX+tipW/2, tipY+44, 11, "rgba(200,200,160,0.7)", "700", "center");
      return;
    }

    // ─ Step 5：對手追過來警告 ───────────────────────────────────────────────
    if (step === 5) {
      const oz = lanes[app.opponentLane];
      if (oz) {
        ctx.save();
        ctx.strokeStyle = `rgba(255,60,60,${0.75+pulse*0.25})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect(oz.x-5, oz.y-5, oz.w+10, oz.h+10, 14); ctx.stroke();
        ctx.restore();
        text("!", oz.x+oz.w/2, oz.y+oz.h/2, 44, `rgba(255,80,80,${0.85+pulse*0.15})`, "900", "center");

        const tipW = 300, tipH = 96;
        const tipX = oz.x > app.w/2 ? oz.x - tipW - 14 : oz.x + oz.w + 14;
        const safeX = Math.max(8, Math.min(app.w-tipW-8, tipX));
        const tipY = oz.y + (oz.h - tipH) / 2;
        roundPanel(safeX, tipY, tipW, tipH, 12, "rgba(20,6,6,0.97)", "rgba(255,80,80,0.65)", 2);
        text("對手追過來了！", safeX+tipW/2, tipY+24, 16, "rgba(255,160,140,0.98)", "900", "center");
        text("同道對撞要靠 QTE 才能超車。", safeX+tipW/2, tipY+50, 13, "rgba(220,160,140,0.88)", "700", "center");
        text("你想冒險，還是換道避開？", safeX+tipW/2, tipY+72, 13, "rgba(220,160,140,0.88)", "700", "center");
        button("tutorial-stage3-step6", "繼續", safeX+tipW/2-54, tipY+tipH+10, 108, 34, false, "start");
      }
      return;
    }

    // ─ Step 6：自由打牌 2（沒提示，自由發揮） ─────────────────────────────────
    if (step === 6) {
      const tipW = 260, tipH = 40;
      const tipX = app.w/2 - tipW/2;
      const firstLane = lanes[0];
      const tipY = firstLane ? firstLane.y - tipH - 12 : app.h * 0.3;
      roundPanel(tipX, tipY, tipW, tipH, 10, "rgba(6,14,28,0.88)", "rgba(180,200,255,0.4)", 1.5);
      text("打完手上的牌，再決定怎麼超車", tipX+tipW/2, tipY+24, 13, "rgba(200,220,255,0.88)", "800", "center");
      return;
    }

    // ─ Step 7：超車按鈕引導（依當前道顯示） ─────────────────────────────────
    if (step === 7) {
      const pz = lanes[app.playerLane];
      const btnY2 = pz ? pz.y : baseY;
      const isInner = app.playerLane === 0;
      const isSameLane = app.playerLane === app.opponentLane;
      const tipW = 260, tipH = 60;
      const tipX = app.w - 310 - (tipW - 200) / 2;  // 對齊到超車按鈕上方
      const safeX = Math.max(8, Math.min(app.w-tipW-8, tipX));
      const tipY = btnY2 - tipH - 14;
      const accent = isSameLane ? "rgba(255,80,80,0.65)" : "rgba(100,255,120,0.55)";
      roundPanel(safeX, tipY, tipW, tipH, 10, "rgba(6,14,28,0.97)", accent, 1.5);
      const line1 = isSameLane
        ? (isInner ? "你在內彎、對手同道" : "你在外彎、對手同道")
        : (isInner ? "你在內彎，速度高" : "你在外彎，QTE 簡單");
      const line2 = isSameLane ? "QTE 超車！" : "可直接超車！";
      text(line1, safeX+tipW/2, tipY+24, 13, "rgba(220,230,255,0.95)", "800", "center");
      text(line2, safeX+tipW/2, tipY+44, 14, isSameLane ? "rgba(255,180,160,0.98)" : "rgba(180,255,200,0.98)", "900", "center");
      return;
    }
  }

  // ─── 第四關教學 overlay：Pass + 防守 ─────────────────────────────────────
  // step 0：全黑「終點將近，但這手牌很糟」
  // step 1：自由試打，聚光手牌 + 玩家道
  // step 2：全黑「打不出速度，無法超車」+ 介紹 Pass
  // step 3：高亮 Pass 按鈕
  // step 4：Pass 後說明「速度低於後車、被追上！」+ 進防守
  function drawTutorialStage4Overlay(time) {
    const step = app.tutorialStep;
    const ctx = app.ctx;
    const pulse = 0.7 + Math.sin(time * 0.005) * 0.3;
    const lanes = app.zones.lanes || [];

    // 計算 Pass 按鈕位置（和 drawLanes 一致）
    const laneCount = app.laneCount;
    const laneW = Math.min(240, (app.w - 320) / laneCount - 12);
    const laneH = 170;
    const gap = 14;
    const totalW = laneCount * laneW + (laneCount-1) * gap;
    const baseY = app.h - 190 - laneH - 30;
    const passBtnRect = { x: app.w - 160, y: baseY, w: 120, h: 40 };

    // 亮區
    const brightZones = [];
    const addBright = (zone, pad=10) => {
      if (!zone) return;
      brightZones.push({ x:zone.x-pad, y:zone.y-pad, w:zone.w+pad*2, h:zone.h+pad*2 });
    };

    // 哪些 step 用 spotlight（其他 step 全黑或全亮）
    const isSpotlight = step === 1 || step === 3;
    if (step === 1) {
      // 聚光：玩家道 + 手牌區
      addBright(lanes[app.playerLane]);
      addBright({ x: 0, y: app.h-216, w: app.w, h: 220 }, 0);
    } else if (step === 3) {
      // 聚光：Pass 按鈕
      addBright(passBtnRect, 8);
    }

    if (isSpotlight) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, app.w, app.h);
      for (const z of brightZones) {
        const r = 12;
        ctx.moveTo(z.x+r, z.y);
        ctx.lineTo(z.x+z.w-r, z.y);
        ctx.quadraticCurveTo(z.x+z.w, z.y, z.x+z.w, z.y+r);
        ctx.lineTo(z.x+z.w, z.y+z.h-r);
        ctx.quadraticCurveTo(z.x+z.w, z.y+z.h, z.x+z.w-r, z.y+z.h);
        ctx.lineTo(z.x+r, z.y+z.h);
        ctx.quadraticCurveTo(z.x, z.y+z.h, z.x, z.y+z.h-r);
        ctx.lineTo(z.x, z.y+r);
        ctx.quadraticCurveTo(z.x, z.y, z.x+r, z.y);
        ctx.closePath();
      }
      ctx.fillStyle = "rgba(0,0,0,0.78)";
      ctx.fill("evenodd");
      ctx.restore();
    }

    // ─ Step 0：開場（全黑） ────────────────────────────────────────────────
    if (step === 0) {
      ctx.fillStyle = "rgba(0,0,0,0.88)";
      ctx.fillRect(0, 0, app.w, app.h);
      const bw = 540, bh = 220;
      const bx = app.w/2 - bw/2, by = app.h/2 - bh/2;
      roundPanel(bx, by, bw, bh, 14, "rgba(6,14,28,0.97)", "rgba(105,164,224,0.55)", 2);
      text("關卡 4", app.w/2, by+34, 14, "rgba(160,190,230,0.8)", "700", "center");
      text("終點將近，但⋯", app.w/2, by+74, 24, "#dfeeff", "900", "center");
      text("這手牌怎麼怪怪的？", app.w/2, by+118, 16, "rgba(200,220,255,0.9)", "700", "center");
      text("試打看看會發生什麼。", app.w/2, by+148, 14, "rgba(180,200,230,0.78)", "700", "center");
      button("tutorial-step-next", "下一步 →", app.w/2-66, by+bh-16, 132, 36, false, "start");
      return;
    }

    // ─ Step 1：自由試打 ─────────────────────────────────────────────────────
    if (step === 1) {
      const tipW = 320, tipH = 56;
      const tipX = app.w/2 - tipW/2;
      const firstLane = lanes[0];
      const tipY = firstLane ? firstLane.y - tipH - 12 : app.h * 0.3;
      roundPanel(tipX, tipY, tipW, tipH, 12, "rgba(6,14,28,0.92)", "rgba(180,200,255,0.5)", 1.5);
      text("把牌打打看，看會怎樣", tipX+tipW/2, tipY+24, 14, "rgba(220,230,255,0.92)", "900", "center");
      text("（注意速度有沒有增加）", tipX+tipW/2, tipY+44, 11, "rgba(180,200,220,0.7)", "700", "center");
      return;
    }

    // ─ Step 2：說明 Pass（全黑） ────────────────────────────────────────────
    if (step === 2) {
      ctx.fillStyle = "rgba(0,0,0,0.88)";
      ctx.fillRect(0, 0, app.w, app.h);
      const bw = 580, bh = 240;
      const bx = app.w/2 - bw/2, by = app.h/2 - bh/2;
      roundPanel(bx, by, bw, bh, 14, "rgba(6,14,28,0.97)", "rgba(255,180,80,0.55)", 2);
      text("失誤牌沒效果", app.w/2, by+34, 14, "rgba(255,180,80,0.85)", "700", "center");
      text("速度根本不夠超車。", app.w/2, by+74, 22, "#ffd9a0", "900", "center");
      text("這時候你可以選擇——", app.w/2, by+118, 14, "rgba(220,220,255,0.85)", "700", "center");
      text("Pass：不超車、結束這回合", app.w/2, by+150, 18, "rgba(255,210,140,0.98)", "900", "center");
      text("但不超車不代表沒事⋯", app.w/2, by+184, 13, "rgba(200,200,220,0.7)", "700", "center");
      button("tutorial-step-next", "了解 →", app.w/2-66, by+bh-16, 132, 36, false, "start");
      return;
    }

    // ─ Step 3：高亮 Pass 按鈕 ─────────────────────────────────────────────────
    if (step === 3) {
      // 提示框放在 Pass 按鈕上方
      const tipW = 240, tipH = 60;
      const tipX = passBtnRect.x + passBtnRect.w/2 - tipW/2;
      const safeX = Math.max(8, Math.min(app.w-tipW-8, tipX));
      const tipY = passBtnRect.y - tipH - 14;
      roundPanel(safeX, tipY, tipW, tipH, 10, "rgba(6,14,28,0.97)", "rgba(255,180,80,0.65)", 1.5);
      text("按下 Pass 結束回合", safeX+tipW/2, tipY+24, 14, "rgba(255,210,140,0.98)", "900", "center");
      text("看看會發生什麼事", safeX+tipW/2, tipY+44, 12, "rgba(220,200,160,0.85)", "700", "center");
      // 從提示框指向按鈕
      ctx.save(); ctx.globalAlpha = pulse;
      ctx.strokeStyle = "rgba(255,200,80,0.85)"; ctx.lineWidth = 2; ctx.setLineDash([5,4]);
      ctx.beginPath();
      ctx.moveTo(safeX+tipW/2, tipY+tipH);
      ctx.lineTo(passBtnRect.x+passBtnRect.w/2, passBtnRect.y-4);
      ctx.stroke();
      ctx.setLineDash([]); ctx.restore();
      return;
    }

    // ─ Step 4：說明後車追擊 + 進防守（全黑） ─────────────────────────────────
    if (step === 4) {
      ctx.fillStyle = "rgba(0,0,0,0.88)";
      ctx.fillRect(0, 0, app.w, app.h);
      const bw = 580, bh = 260;
      const bx = app.w/2 - bw/2, by = app.h/2 - bh/2;
      roundPanel(bx, by, bw, bh, 14, "rgba(20,6,6,0.97)", "rgba(255,80,80,0.6)", 2);
      text("你的速度太低，後車追上了！", app.w/2, by+38, 22, "#ff9a90", "1000", "center");
      const playerSpd = currentLaneSpeed();
      const chaserSpd = app.chaserSpeed ?? 0;
      text(`此道速度 ${playerSpd}　vs　後車速度 ${chaserSpd}`, app.w/2, by+78, 16, "rgba(255,200,200,0.95)", "800", "center");
      text("接下來進入防守 QTE，", app.w/2, by+118, 14, "rgba(220,220,220,0.88)", "700", "center");
      text("守住名次別讓他超過去！", app.w/2, by+142, 14, "rgba(220,220,220,0.88)", "700", "center");
      button("tutorial-stage4-defense", "進入防守 →", app.w/2-90, by+bh-16, 180, 40, false, "start");
      return;
    }

    // ─ Step 5：總結 + 補手牌（全黑） ─────────────────────────────────────────
    if (step === 5) {
      ctx.fillStyle = "rgba(0,0,0,0.88)";
      ctx.fillRect(0, 0, app.w, app.h);
      const bw = 600, bh = 300;
      const bx = app.w/2 - bw/2, by = app.h/2 - bh/2;
      roundPanel(bx, by, bw, bh, 14, "rgba(6,14,28,0.97)", "rgba(105,164,224,0.55)", 2);
      text("恭喜完成教學！", app.w/2, by+44, 22, "#dfeeff", "1000", "center");
      text("• 速度不夠，就不能超車", app.w/2, by+92, 14, "rgba(220,230,255,0.92)", "700", "center");
      text("• Pass 後若速度低於後車，會被追上要防守", app.w/2, by+118, 14, "rgba(220,230,255,0.92)", "700", "center");
      text("再來一回合，這次自己決定。", app.w/2, by+170, 16, "rgba(255,230,140,0.98)", "900", "center");
      text("補滿手牌、動力回滿，", app.w/2, by+202, 13, "rgba(180,200,230,0.78)", "700", "center");
      text("不論你怎麼結束這回合，第四關就告一段落。", app.w/2, by+224, 13, "rgba(180,200,230,0.78)", "700", "center");
      button("tutorial-stage4-replay", "再來一回合 →", app.w/2-100, by+bh-16, 200, 40, false, "start");
      return;
    }

    // ─ Step 6：自由打牌 / 自由結束（無提示） ───────────────────────────────
    // 玩家可以自由打牌、超車（btn-overtake）或 Pass（btn-pass），任何結果都進 result
    // 不放遮罩、不放提示，讓玩家自由發揮
    if (step === 6) {
      // 不畫任何 overlay，按鈕由 drawLanes 正常處理
      return;
    }
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
    return { x: app.w/2-w/2, y: app.h/2-h/2, w, h };
  }

  function drawModalPanel(box, accent) {
    roundPanel(box.x, box.y, box.w, box.h, 14,
      "rgba(6,14,26,0.97)", accent ?? "rgba(105,164,224,0.55)", 2.5);
  }

  function drawStartModal() {
    const box = getCenteredModalBox(460, 388);
    drawModalPanel(box);
    const cx = box.x+box.w/2;
    text("最後車手", cx, box.y+62, 36, "#dfeeff", "900", "center");
    text("Final Driver — 沙盒測試", cx, box.y+88, 12, "rgba(150,180,220,0.55)", "700", "center");
    const ctx = app.ctx;
    ctx.save(); ctx.strokeStyle="rgba(120,170,220,0.3)"; ctx.lineWidth=1; ctx.setLineDash([5,5]);
    ctx.beginPath(); ctx.moveTo(box.x+40,box.y+102); ctx.lineTo(box.x+box.w-40,box.y+102); ctx.stroke();
    ctx.setLineDash([]); ctx.restore();
    text("你是車隊領隊，透過打牌以指揮車手", cx, box.y+140, 16, "#e8f0ff", "700", "center");
    text("駕駛賽車超過前車。", cx, box.y+164, 16, "#e8f0ff", "700", "center");
    button("start-game", "開始遊戲", cx-110, box.y+202, 220, 48, false, "start");
    button("open-rules", "遊戲規則", cx-110, box.y+260, 220, 38, false, "primary");
  }

  function drawStageIntro(time) {
    const stage = STAGES[app.stageIndex];
    if (!stage) return;
    const box = getCenteredModalBox(560, 420);
    drawModalPanel(box, "rgba(255,200,60,0.45)");
    const cx = box.x+box.w/2;
    text(`關卡 ${app.stageIndex+1} / ${STAGES.length}`, cx, box.y+46, 14, "rgba(255,200,60,0.8)", "700", "center");
    text(stage.title, cx, box.y+76, 22, "#dfeeff", "900", "center");
    const ctx = app.ctx;
    ctx.save(); ctx.strokeStyle="rgba(255,200,60,0.3)"; ctx.lineWidth=1; ctx.setLineDash([5,5]);
    ctx.beginPath(); ctx.moveTo(box.x+40,box.y+92); ctx.lineTo(box.x+box.w-40,box.y+92); ctx.stroke();
    ctx.setLineDash([]); ctx.restore();
    let y = box.y+118;
    for (const line of stage.intro) {
      if (line===null) { y+=6; continue; }
      text(line, cx, y, 16, "#e8f0ff", "700", "center");
      y+=22;
    }
    // 目標
    roundPanel(box.x+40, y+12, box.w-80, 38, 8, "rgba(20,40,20,0.6)", "rgba(100,220,120,0.5)", 1.5);
    text("目標："+stage.goal, cx, y+36, 14, "#a0ffb0", "800", "center");
    // 賽道資訊
    const infoY = y+68;
    text(`${stage.lanes} 條道　對手初速：${stage.opponentSpeed} pts　你的動力：${app.energyMax}`, cx, infoY, 12, "rgba(160,180,210,0.65)", "700", "center");
    button("stage-intro-ok", "開始", cx-90, box.y+box.h-68, 180, 48, false, "start");
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
    text("沒有手牌了！", cx, box.y + 46, 20, "#dfeeff", "900", "center");
    const spd = currentLaneSpeed();
    text(`速度 ${spd}　對手 ${opponentDisplaySpeed()}`, cx, box.y + 78, 14, "rgba(200,220,255,0.75)", "700", "center");
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
    text("沙盒測試完成！", app.w/2, app.h*0.38, 56, "#ffd94f", "1000", "center");
    text("Final Driver — 沙盒測試", app.w/2, app.h*0.52, 20, "rgba(200,220,255,0.8)", "700", "center");
    button("replay", "再玩一次", app.w/2-110, app.h*0.62, 220, 52, false, "start");
  }

  // ─── 第五關繪製 ────────────────────────────────────────────────────────────
  // AR 地面速限標線：只在彎道賽段、有速限的道顯示
  function drawSpeedLimitAR(time) {
    const circ = currentCircuit();
    if (!circ || circ.type !== "bend") return;
    const laneCount = app.laneCount || 2;
    const ctx = app.ctx;
    const h = app.h;
    const horizon = h * 0.38;

    for (let li = 0; li < laneCount; li++) {
      const b = getLaneBonusFor(li);
      if (!b || b.speedLimit == null) continue;
      const limit = b.speedLimit;
      const overSpeed = app.playerSpeed > limit && li === app.playerLane;

      // 路面更遠處（t=0.38 近端，t=0.22 遠端）
      const tNear = 0.30;
      const tFar  = 0.18;
      const yNear = horizon + (h - horizon) * tNear;
      const yFar  = horizon + (h - horizon) * tFar;

      const bNear = roadLaneBoundsAt(yNear);
      const bFar  = roadLaneBoundsAt(yFar);
      const laneWNear = (bNear.right - bNear.left) / laneCount;
      const laneWFar  = (bFar.right  - bFar.left)  / laneCount;
      const cxNear = bNear.left + laneWNear * (li + 0.5);
      const cxFar  = bFar.left  + laneWFar  * (li + 0.5);

      // 顏色
      const baseColor = overSpeed ? "rgba(255,70,70,0.95)"  : "rgba(60,255,140,0.95)";
      const glowColor = overSpeed ? "rgba(255,60,60,0.6)"   : "rgba(40,255,120,0.6)";
      const pulseFreq = overSpeed ? 0.008 : 0.0025;
      const pulse = 0.75 + Math.sin(time * pulseFreq) * 0.25;

      // 投影感：用 canvas transform 做梯形透視
      // 整個字一次畫，用 setTransform 把它壓扁並定位到路面
      // 近端寬，遠端窄 → xScale = laneWFar/laneWNear（頂部）到 1.0（底部）
      // 用一個中間值做整體 x 縮放，垂直方向壓縮 (yScale ≈ 0.28)
      const xScale = (laneWFar / laneWNear) * 0.9;
      const yScale = 0.28;
      const fontSize = 180;
      const textStr = `${limit}`;

      const cx = (cxNear + cxFar) / 2;
      const cy = (yNear + yFar) / 2;

      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 28;
      ctx.fillStyle = baseColor;
      ctx.font = `900 ${fontSize}px system-ui, "Microsoft JhengHei", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // setTransform(a, b, c, d, e, f): xScale, skewY, skewX, yScale, tx, ty
      ctx.setTransform(xScale, 0, 0, yScale, cx, cy);
      ctx.fillText(textStr, 0, 0);
      ctx.restore();
    }
  }
  // 沙漠背景（用 boss CG 圖 + 暗膜，沿用 Sam 沙暴版視覺基調）
  function drawStage5DesertBackground(time) {
    const ctx = app.ctx;
    const w = app.w, h = app.h;
    if (typeof bossCgImage !== "undefined" && bossCgImage && bossCgImage.complete && bossCgImage.naturalWidth > 0) {
      const iw = bossCgImage.naturalWidth;
      const ih = bossCgImage.naturalHeight;
      const scale = Math.max(w / iw, h / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      ctx.drawImage(bossCgImage, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else {
      // fallback: 沙漠漸層
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#07131a");
      bg.addColorStop(0.42, "#5f3b20");
      bg.addColorStop(1, "#140c08");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
    }
    // 暗膜（讓 UI 跟車子可讀）
    ctx.fillStyle = "rgba(5, 10, 16, 0.4)";
    ctx.fillRect(0, 0, w, h);
  }

  // 沙盒：無沙暴粒子層
  function drawStage5SandOverlay(time) {
    return;
  }

  // 第五關左側面板：當前對手 / 後車 / Boss 專注值 / 車隊牌
  function drawStage5SidePanel(time) {
    const s5 = app.stage5;
    if (!s5) return;
    const ctx = app.ctx;
    const x = 14;
    const y = 80;
    const w = 200;  // 拿掉對手區後內容變窄、縮寬讓畫面更乾淨
    let curY = y;
    // 估算面板高度：標題 34 + 名次標 22 + 4 列 × 30 + 後車警告 58 + 尾流 22 + 車隊牌
    const rankBlockH = 4 * 26 + 3 * 4;  // = 116
    const teamCardsH = s5.teamCardsActive.length > 0 ? 28 + s5.teamCardsActive.length * 26 : 0;
    const panelH = 16 + 34 + 22 + rankBlockH + 16 + teamCardsH + 80; // 含尾流/後車預留
    roundPanel(x, y, w, panelH, 12, "rgba(10,18,28,0.88)", "rgba(120,170,220,0.35)", 1.5);
    curY = y + 16;
    text("沙盒測試", x + 14, curY + 14, 17, "rgba(255,220,120,0.85)", "900");
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
    // 沙盒：無 Boss 專注值顯示
    if (false && s5.bossStage) {
      curY += 4;
      text(s5.bossBroken ? "Boss：破綻！" : `Boss 專注 ${s5.bossFocus}/${s5.bossFocusMax}`,
           x + 12, curY + 10, 12, s5.bossBroken ? "#ffe080" : "#ff9a6a", "900");
      curY += 18;
      // 專注值方塊
      const segGap = 4;
      const segW = (w - 24 - segGap*(s5.bossFocusMax-1)) / s5.bossFocusMax;
      for (let i=0; i<s5.bossFocusMax; i++) {
        const sx = x + 12 + i*(segW + segGap);
        const alive = i < s5.bossFocus;
        ctx.fillStyle = alive ? "rgba(220,120,60,0.85)" : "rgba(80,50,30,0.4)";
        ctx.fillRect(sx, curY, segW, 8);
      }
      curY += 16;
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
    // v0.9：沙盒無 cost 系統，不顯示 COST
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
    const laneRows = next?.laneBonuses ? next.laneBonuses.length : 1;
    const w = 300;
    const h = 56 + laneRows * 18 + 58;  // 內框 + 當前賽段行 + padding
    const x = app.w - w - 14;
    const y = 14;
    roundPanel(x, y, w, h, 14, "rgba(10,18,28,0.92)", "rgba(120,170,220,0.4)", 1.5);

    // ── 上：下一賽段（重點）────────────────────────────────────────────────
    if (next) {
      const nextHideBonus = !!next.hideLaneBonusUntilVisited;
      const laneRows = next.laneBonuses ? next.laneBonuses.length : (next.lanes || 1);
      const innerH = 56 + laneRows * 18 + 8;  // 依道路數動態計算
      roundPanel(x + 8, y + 8, w - 16, innerH, 10, "rgba(255,200,80,0.08)", "rgba(255,200,80,0.4)", 1.5);
      text("→ 下一賽段", x + 20, y + 24, 11, "rgba(255,200,80,0.8)", "800");
      text(`${next.icon} ${next.name}`, x + 20, y + 46, 22, "rgba(255,225,130,0.98)", "900");
      let lby = y + 68;
      if (nextHideBonus) {
        // c8：所有道顯示「?」，不洩漏（也不依賴上次的 laneBonuses）
        const lanes = next.lanes || (next.laneBonuses?.length ?? 3);
        for (let li = 0; li < lanes; li++) {
          const laneName = (next.laneNames && next.laneNames[li]) || `道 ${li}`;
          const color = (next.laneColors && next.laneColors[li]) || "rgba(220,230,255,0.85)";
          text(`${laneName}: ?`, x + 20, lby, 12, color, "700");
          lby += 18;
        }
      } else if (next.laneBonuses) {
        for (const lb of next.laneBonuses) {
          const laneName = lb.label.split(" ")[0];
          const limitStr = lb.speedLimit != null ? `  限速 ${lb.speedLimit}` : "";
          text(`道 ${lb.lane}：${laneName}${limitStr}`, x + 20, lby, 12, "rgba(220,230,255,0.85)", "700");
          lby += 18;
        }
      } else {
        text("直線道", x + 20, lby, 12, "rgba(220,230,255,0.85)", "700");
        lby += 18;
      }
      // 當前賽段留適當空白後顯示
      const cy = lby + 30;
      text("當前賽段", x + 20, cy, 10, "rgba(160,180,210,0.5)", "700");
      text(`${cur?.icon ?? ""} ${cur?.name ?? ""}`, x + 90, cy, 15, "rgba(180,200,230,0.75)", "800");
    } else if (cur) {
      text("當前賽段", x + 20, y + 30, 10, "rgba(160,180,210,0.5)", "700");
      text(`${cur.icon} ${cur.name}`, x + 90, y + 30, 15, "rgba(180,200,230,0.75)", "800");
    }
  }

  // 第五關開場 intro
  // 第五關開場：4 頁 spotlight 教學
  // 頁 0：名次面板（左上）— 玩家位置、前/後車
  // 頁 1：下一賽段預告（右上）— 賽道會循環
  // 頁 2：HUD（右下）— 動力、基礎速度、對手速度
  // 頁 3：手牌（下方）— 指令牌 vs 車隊牌差異 + 速度規則
  function drawStage5IntroModal(time) {
    const s5 = app.stage5;
    if (!s5) return;
    const ctx = app.ctx;
    if (s5.tutorialPage == null) s5.tutorialPage = 0;

    // 沙盒：直接顯示一個簡單的確認畫面，不走多頁 spotlight 教學
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
    text("沙盒測試", boxX + boxW/2, boxY + 40, 22, "#ffd980", "1000", "center");
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
    text(title, cx, box.y + 56, 30, titleColor, "1000", "center");
    // QTE 分數
    const scoreStr = app.qteScore != null
      ? `QTE ${app.qteScore} / ${app.qteScoreMax}（${Math.round(app.qteScore / app.qteScoreMax * 100)}%）`
      : "";
    if (scoreStr) text(scoreStr, cx, box.y + 88, 13, "rgba(200,220,255,0.8)", "700", "center");
    const opp = STAGE5_OPPONENTS[app.stage5?.passed[app.stage5.passed.length-1]];
    if (isSuccess) {
      if (opp) text(`超越了「${opp.name}」`, cx, box.y + 114, 13, "rgba(220,240,225,0.85)", "700", "center");
      text(`名次：${app.rank} / ${app.rankTotal}`, cx, box.y + 134, 13, "rgba(220,240,225,0.85)", "700", "center");
    } else {
      text(`名次：${app.rank} / ${app.rankTotal}`, cx, box.y + 114, 13, "rgba(220,220,220,0.75)", "700", "center");
    }
    // 懲罰/獎勵
    if (isPerfect) {
      text("✦ 滿分！移除 1 張失誤牌", cx, box.y + 162, 13, "rgba(255,220,100,0.95)", "800", "center");
    } else if (mistakeCount > 0) {
      const tireLine = !isSuccess ? "　扣 1 輪胎" : "";
      text(`⚠ 獲得 ${mistakeCount} 張失誤牌${tireLine}`, cx, box.y + 162, 13, "rgba(255,180,80,0.95)", "800", "center");
    } else if (!isSuccess) {
      text("扣 1 輪胎", cx, box.y + 162, 13, "rgba(255,150,130,0.9)", "800", "center");
    } else {
      text("無懲罰", cx, box.y + 162, 13, "rgba(160,200,160,0.7)", "700", "center");
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
    text("Pass", cx, box.y + 54, 28, "#a0b8e0", "900", "center");
    text("最後一名，無後車追擊", cx, box.y + 90, 13, "rgba(180,200,230,0.75)", "700", "center");
    button("stage5-next-round", "下一回合 →", cx - 100, box.y + box.h - 46, 200, 40, false, "primary");
  }

  // 防守結算
  function drawStage5DefenseResultModal() {
    const success = app.message === "防守成功！" || app.message === "後援車隊保住名次！";
    const box = getCenteredModalBox(420, 200);
    drawModalPanel(box, success ? "rgba(120,220,150,0.5)" : "rgba(255,120,120,0.5)");
    const cx = box.x + box.w/2;
    text(app.message || "防守結束", cx, box.y + 70, 26, success ? "#7be0a0" : "#ff8a8a", "900", "center");
    text(`名次：${app.rank} / ${app.rankTotal}`, cx, box.y + 110, 14, "rgba(220,240,225,0.85)", "700", "center");
    button("stage5-next-round", "下一回合 →", cx - 100, box.y + box.h - 56, 200, 42, false, success ? "start" : "primary");
  }

  // ─── 彎道 QTE（Helldivers 箭頭風格）──────────────────────────────────────
  function endBendQte(success) {
    let mistakeCount = 0;
    let slippedTo = null;  // c6 油污：失敗時位移的目標道
    if (!success) {
      // 失敗：扣 1 胎 + 1 張失誤牌進牌庫頂
      spendTire(1);
      mistakeCount = 1;
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
        text(`油污滑到第 ${r.slippedTo + 1} 道！`, cx, line, 13, "rgba(255,160,200,0.95)", "800", "center");
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
    text("✦ 三選一：成長與調整 ✦", cx, box.y + 50, 22, "#ffd980", "1000", "center");
    text("這場比賽中，你...", cx, box.y + 80, 13, "rgba(255,230,160,0.75)", "700", "center");
    // 三張卡
    const cardW = 180;
    const cardH = 300;
    const gap = 24;
    const totalW = cardW * 3 + gap * 2;
    const startX = cx - totalW/2;
    const cardY = box.y + 110;
    for (let i = 0; i < 3; i++) {
      const c = s5.rewardOptions[i];
      if (!c) continue;
      const cx0 = startX + i * (cardW + gap);
      const hov = (s5.rewardSlotHover === i);
      // 卡牌底
      const cardBg = hov ? "rgba(255,220,140,0.95)" : "rgba(245,235,210,0.95)";
      const cardBorder = c.cardClass === "team" ? "rgba(80,160,120,0.9)" : "rgba(200,100,40,0.9)";
      roundPanel(cx0, cardY, cardW, cardH, 14, cardBg, cardBorder, 2);
      // 類別
      const typeLabel = c.cardClass === "team" ? "車隊牌" : "指令牌";
      const typeColor = c.cardClass === "team" ? "#3a7a5a" : "#a85020";
      text(typeLabel, cx0 + cardW/2, cardY + 22, 11, typeColor, "800", "center");
      // 名字
      text(c.name, cx0 + cardW/2, cardY + 60, 18, "#2a2418", "900", "center");
      // v0.9：沙盒無 cost 系統，不顯示 COST
      // 中央大字速度（v0.9 UI；speedValue=0 或車隊牌不顯示）
      if (typeof c.speedValue === "number" && c.speedValue !== 0) {
        const sv = c.speedValue;
        const speedStr = sv > 0 ? `+${sv}` : `${sv}`;
        const speedColor = sv > 0 ? "#1a7a30" : "#a02030";
        text(speedStr, cx0 + cardW/2, cardY + 108, 38, speedColor, "1000", "center");
      }
      // 效果
      const lines = wrapTextLines(c.note || "", cardW - 24, 11);
      let ly = cardY + 148;
      for (const ln of lines) {
        text(ln, cx0 + cardW/2, ly, 11, "#3a3020", "700", "center");
        ly += 16;
      }
      // 持續時機 + 進場方式（車隊牌）
      if (c.cardClass === "team" && c.persistenceLabel) {
        const isInstant = c.persistence === "permanent";
        const instantLabel = isInstant ? "★ 選後直接進場" : "進牌庫，打出後生效";
        const lblColor = isInstant ? "rgba(180,120,60,0.95)" : "rgba(60,120,90,0.85)";
        text(`⌛ ${c.persistenceLabel}`, cx0 + cardW/2, cardY + cardH - 86, 10, "rgba(60,120,90,0.85)", "700", "center");
        text(instantLabel, cx0 + cardW/2, cardY + cardH - 70, 10, lblColor, "800", "center");
      }
      // 選擇按鈕 - 給足完整高度
      button(`stage5-reward-pick-${i}`, "選這張", cx0 + 14, cardY + cardH - 56, cardW - 28, 44, false, "start");
    }
    button("stage5-reward-skip", "略過（不拿）", cx - 90, box.y + box.h - 58, 180, 42, false, "gray");
  }

  // 簡易文字斷行
  function wrapTextLines(text, maxWidth, fontSize) {
    if (!text) return [];
    const ctx = app.ctx;
    ctx.save();
    ctx.font = `700 ${fontSize}px system-ui`;
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

  // Boss 戰擊中結算
  function drawStage5BossHitModal() {
    const s5 = app.stage5;
    if (!s5) return;
    const box = getCenteredModalBox(440, 200);
    drawModalPanel(box, s5.bossBroken ? "rgba(255,200,80,0.6)" : "rgba(255,140,80,0.5)");
    const cx = box.x + box.w/2;
    if (s5.bossBroken) {
      text("Boss 露出破綻！", cx, box.y + 70, 26, "#ffd94f", "1000", "center");
      text("下次超車成功 = 通關", cx, box.y + 108, 14, "rgba(255,230,160,0.9)", "800", "center");
    } else {
      text(`削減專注 — ${s5.bossFocus}/${s5.bossFocusMax}`, cx, box.y + 70, 22, "#ffb070", "900", "center");
      text("Boss 立刻反超回來", cx, box.y + 108, 13, "rgba(255,220,200,0.8)", "700", "center");
    }
    button("stage5-boss-continue", "繼續 →", cx - 90, box.y + box.h - 56, 180, 42, false, "primary");
  }

  // Boss 進場 intro
  // ─── Boss cut-in 多圖層動畫（沿用 Sam 沙暴 boss 視覺） ────────────────────
  const STAGE5_BOSS_CUTIN_DUR = 2400;

  // Boss 進場 cut-in（mode = stage5-boss-intro）
  function drawStage5BossIntroModal(time) {
    const s5 = app.stage5;
    if (!s5) return;
    if (!s5.bossCutinStart) s5.bossCutinStart = time;
    const age = time - s5.bossCutinStart;
    drawBossEntranceLayers(age, STAGE5_BOSS_CUTIN_DUR, time, 1);
    if (age >= STAGE5_BOSS_CUTIN_DUR) {
      s5.bossCutinStart = null;
      app.mode = "stage5-boss-tutorial";
    }
  }

  // 8 圖層繪製（檔案不在時走 fallback）
  function drawBossEntranceLayers(age, totalDur, time, fadeOut) {
    if (fadeOut == null) fadeOut = 1;
    const ctx = app.ctx;
    const w = app.w;
    const h = app.h;
    const settled = Math.max(0, Math.min(1, fadeOut));
    const tFn = n => smooth01((age - n) / 520);
    ctx.save();
    ctx.globalAlpha = settled;
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, "#030303");
    bg.addColorStop(0.46, "#100706");
    bg.addColorStop(1, "#27150b");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const banner = bossEntranceLayers[0];
    const quotePlate = bossEntranceLayers[2];
    const detailB = bossEntranceLayers[4];
    const mask = bossEntranceLayers[6];
    const portrait = bossEntranceLayers[7];
    const redIn = tFn(140);
    const titleIn = tFn(620);
    const portraitIn = tFn(820);
    const infoIn = tFn(1280);
    const shake = Math.sin(time * 0.006) * 2.5 * (1 - Math.min(1, age / totalDur));

    // 紅旗
    ctx.save();
    ctx.translate(-w * (1 - redIn) * 0.18 + shake, h * 0.02);
    ctx.rotate(-0.105);
    if (banner && banner.complete && banner.naturalWidth) {
      drawImageInRect(banner, -w * 0.14, h * 0.10, w * 1.30, h * 0.50, 0.98 * redIn, "cover");
    } else {
      ctx.fillStyle = "rgba(196, 24, 28, " + (0.85 * redIn) + ")";
      ctx.fillRect(-w * 0.14, h * 0.18, w * 1.30, h * 0.18);
    }
    ctx.restore();

    // 紅色條碼
    ctx.save();
    ctx.globalAlpha = 0.34 * tFn(420);
    ctx.fillStyle = "#d60d12";
    for (let i = 0; i < 8; i++) {
      const x = w * (0.03 + i * 0.135);
      ctx.fillRect(x, h * 0.22 + (i % 2) * 9, w * 0.055, 8);
    }
    ctx.restore();

    if (detailB && detailB.complete && detailB.naturalWidth) {
      drawImageInRect(detailB, w * 0.64, h * 0.17, w * 0.38, h * 0.42, 0.38 * infoIn, "contain");
    }
    if (mask && mask.complete && mask.naturalWidth) {
      drawImageInRect(mask, w * 0.71, h * 0.48, w * 0.24, h * 0.28, 0.58 * infoIn, "contain");
    }

    // 半身像 / fallback 用 boss CG
    if (portrait && portrait.complete && portrait.naturalWidth) {
      const px = w * (0.56 + (1 - portraitIn) * 0.08);
      const py = h * (0.00 + (1 - portraitIn) * 0.04);
      drawImageInRect(portrait, px, py, w * 0.46, h * 0.88, portraitIn, "contain");
    } else if (bossCgImage && bossCgImage.complete && bossCgImage.naturalWidth) {
      const px = w * (0.55 + (1 - portraitIn) * 0.08);
      const py = h * 0.05;
      drawImageInRect(bossCgImage, px, py, w * 0.45, h * 0.9, portraitIn * 0.95, "contain");
    }

    drawCutinSandParticles(w * 0.04, h * 0.04, w * 0.92, h * 0.84, settled, time);

    if (quotePlate && quotePlate.complete && quotePlate.naturalWidth) {
      drawImageInRect(quotePlate, w * 0.045, h * 0.435, w * 0.42, h * 0.18, infoIn, "contain");
    }

    drawBossEntranceTypography(titleIn, infoIn, time, settled);
    ctx.restore();
  }

  function drawCutinSandParticles(x, y, w, h, alpha, time) {
    const ctx = app.ctx;
    const t = time * 0.001;
    ctx.save();
    for (let i = 0; i < 180; i++) {
      const seed = (i + 1) * 41.733 + 881;
      const frc = n => n - Math.floor(n);
      const nx = frc(Math.sin(seed * 12.9898) * 43758.5453 + t * (0.045 + (i % 5) * 0.012));
      const ny = frc(Math.sin(seed * 78.233) * 23454.153 + t * (0.13 + (i % 7) * 0.035));
      const px = x + nx * w + Math.sin(t * 1.1 + seed) * 58;
      const py = y + ny * h + Math.cos(t * 0.9 + seed * 0.7) * 20;
      const fade = 120;
      let edgeA = 1;
      edgeA *= Math.min(1, Math.max(0, (px - x) / fade)) * Math.min(1, Math.max(0, (x + w - px) / fade));
      edgeA *= Math.min(1, Math.max(0, (py - y) / fade)) * Math.min(1, Math.max(0, (y + h - py) / fade));
      if (edgeA <= 0) continue;
      const r = (0.75 + (i % 5) * 0.28) * 1.25;
      ctx.globalAlpha = edgeA * 0.28 * alpha * (0.58 + (i % 4) * 0.12);
      ctx.fillStyle = i % 4 === 0 ? "#c9822e" : i % 4 === 1 ? "#e0a64d" : i % 4 === 2 ? "#f5c96c" : "#ffe09a";
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawBossEntranceTypography(titleIn, infoIn, time, fadeOut) {
    if (fadeOut == null) fadeOut = 1;
    const ctx = app.ctx;
    const w = app.w;
    const h = app.h;
    const fade = Math.max(0, Math.min(1, fadeOut));
    ctx.save();
    ctx.globalAlpha = titleIn * fade;
    ctx.fillStyle = "#e6edf2";
    ctx.font = '800 14px Consolas, "Microsoft JhengHei", monospace';
    ctx.textAlign = "left";
    ctx.fillText(">>> RACER INTRO", w * 0.045, h * 0.15);
    ctx.font = '1000 72px Impact, "Arial Black", "Microsoft JhengHei", sans-serif';
    ctx.shadowColor = "rgba(0,0,0,0.62)";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#fff4e8";
    ctx.fillText("沙暴領主", w * 0.045, h * 0.34);
    ctx.shadowBlur = 0;
    ctx.font = '900 28px Consolas, "Microsoft JhengHei", monospace';
    ctx.fillStyle = "#080808";
    ctx.fillText("CODE: 09", w * 0.05, h * 0.41);

    ctx.globalAlpha = infoIn * fade;
    const stripY = h * 0.73;
    ctx.fillStyle = "rgba(2,2,2,0.82)";
    ctx.fillRect(0, stripY, w, h * 0.20);
    ctx.strokeStyle = "rgba(238,32,34,0.78)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w * 0.38, stripY + 12);
    ctx.lineTo(w * 0.32, stripY + h * 0.20 - 12);
    ctx.stroke();
    ctx.font = '900 18px Consolas, "Microsoft JhengHei", monospace';
    ctx.fillStyle = "#ff272a";
    ctx.fillText("DRIVER", w * 0.43, stripY + 34);
    ctx.font = '1000 40px Impact, "Arial Black", sans-serif';
    ctx.fillStyle = "#fff1df";
    ctx.fillText("SAND VEIL", w * 0.43, stripY + 78);
    ctx.font = '900 19px Consolas, "Microsoft JhengHei", monospace';
    ctx.fillStyle = "#ff272a";
    ctx.fillText("CODE: 09", w * 0.62, stripY + 78);
    const labels = ["速度", "操控", "視野干擾", "耐久"];
    labels.forEach((label, i) => {
      const y = stripY + 112 + i * 24;
      ctx.font = '800 16px "Microsoft JhengHei", sans-serif';
      ctx.fillStyle = "#d8c7a8";
      ctx.fillText(label, w * 0.43, y);
      for (let j = 0; j < 10; j++) {
        ctx.fillStyle = j < 5 + ((i + 2) % 4) ? "#d91c21" : "rgba(98, 67, 50, 0.7)";
        ctx.fillRect(w * 0.49 + j * 18, y - 11, 13, 8);
      }
    });
    ctx.globalAlpha = titleIn * fade * (0.55 + Math.sin(time * 0.007) * 0.08);
    ctx.fillStyle = "#ff1d22";
    ctx.fillRect(w * 0.02, h * 0.08, w * 0.018, 5);
    ctx.fillRect(w * 0.045, h * 0.08, w * 0.018, 5);
    ctx.fillRect(w * 0.07, h * 0.08, w * 0.018, 5);
    ctx.restore();
  }

  // Boss 戰教學頁（cut-in 結束後出現，mode = stage5-boss-tutorial）
  // Spotlight 左上「Boss 專注值」區，配簡短說明 + 迎戰按鈕
  function drawStage5BossTutorialModal(time) {
    const s5 = app.stage5;
    if (!s5) return;
    const ctx = app.ctx;
    drawRace(time);
    drawHud(time);
    drawStage5SandOverlay(time);
    drawStage5SidePanel(time);
    drawStage5NextCircuit(time);
    drawHand(time);

    // Spotlight 左上面板（涵蓋專注值）
    const z = { x: 8, y: 74, w: 244, h: 360 };
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, app.w, app.h);
    const r = 12;
    ctx.moveTo(z.x+r, z.y);
    ctx.lineTo(z.x+z.w-r, z.y);
    ctx.quadraticCurveTo(z.x+z.w, z.y, z.x+z.w, z.y+r);
    ctx.lineTo(z.x+z.w, z.y+z.h-r);
    ctx.quadraticCurveTo(z.x+z.w, z.y+z.h, z.x+z.w-r, z.y+z.h);
    ctx.lineTo(z.x+r, z.y+z.h);
    ctx.quadraticCurveTo(z.x, z.y+z.h, z.x, z.y+z.h-r);
    ctx.lineTo(z.x, z.y+r);
    ctx.quadraticCurveTo(z.x, z.y, z.x+r, z.y);
    ctx.closePath();
    ctx.fillStyle = "rgba(0,0,0,0.82)";
    ctx.fill("evenodd");
    ctx.restore();
    const pulse = 0.5 + Math.sin(time * 0.005) * 0.5;
    ctx.save();
    ctx.strokeStyle = "rgba(255,150,80," + (0.7 + pulse * 0.3) + ")";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    ctx.rect(z.x, z.y, z.w, z.h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    const boxW = 580, boxH = 180;
    const boxX = app.w/2 - boxW/2;
    const boxY = app.h - boxH - 40;
    roundPanel(boxX, boxY, boxW, boxH, 12, "rgba(6,14,28,0.97)", "rgba(255,150,80,0.6)", 2);
    text("沙暴領主有 3 點「專注值」", boxX + boxW/2, boxY + 32, 20, "#ffb070", "1000", "center");
    text("成功超車削 1 點 → Boss 立刻反超回來。", boxX + boxW/2, boxY + 68, 13, "#fbe5d6", "700", "center");
    text("削光 → Boss 露出「破綻」 → 再次超車 = 通關！", boxX + boxW/2, boxY + 92, 13, "#fbe5d6", "700", "center");
    text("⚠ 本回合「全手牌盲牌」 — 打完 2 張其他才顯示", boxX + boxW/2, boxY + 120, 12, "rgba(255,200,160,0.85)", "700", "center");
    button("stage5-boss-intro-ok", "迎戰", boxX + boxW/2 - 90, boxY + boxH - 50, 180, 40, false, "start");
  }

  // 完美過彎：選道介面（其他道亮起、可點切換）
  function drawStage5CornerLanePick(time) {
    const ctx = app.ctx;
    // 先畫底層場景
    drawRace(time);
    drawHud(time);
    drawStage5SandOverlay(time);
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

  // 三選一首次教學（spotlight 中間那張車隊牌、講解兩類差異）
  function drawStage5RewardTutorialModal(time) {
    const s5 = app.stage5;
    if (!s5) return;
    const ctx = app.ctx;
    // 先把三選一場景畫上去（不點按鈕、無互動）
    drawStage5RewardModal(time);
    // 上面再蓋一層教學遮罩，spotlight 中間那張卡（slot 1，必為車隊牌）
    const cardW = 180, cardH = 300, gap = 24;
    const totalW = cardW * 3 + gap * 2;
    const startX = app.w/2 - totalW/2;
    const cardY = app.h/2 - 270 + 110;  // 跟 reward modal 的 cardY 對齊
    // 找 reward modal box：和 drawStage5RewardModal 一致
    const boxH = 540;
    const boxY = app.h/2 - boxH/2;
    const slotX = startX + 1 * (cardW + gap);
    const slotY = boxY + 110;
    const z = { x: slotX - 6, y: slotY - 6, w: cardW + 12, h: cardH + 12 };
    // 黑遮罩 + 鏤空 spotlight
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, app.w, app.h);
    const r = 12;
    ctx.moveTo(z.x+r, z.y);
    ctx.lineTo(z.x+z.w-r, z.y);
    ctx.quadraticCurveTo(z.x+z.w, z.y, z.x+z.w, z.y+r);
    ctx.lineTo(z.x+z.w, z.y+z.h-r);
    ctx.quadraticCurveTo(z.x+z.w, z.y+z.h, z.x+z.w-r, z.y+z.h);
    ctx.lineTo(z.x+r, z.y+z.h);
    ctx.quadraticCurveTo(z.x, z.y+z.h, z.x, z.y+z.h-r);
    ctx.lineTo(z.x, z.y+r);
    ctx.quadraticCurveTo(z.x, z.y, z.x+r, z.y);
    ctx.closePath();
    ctx.fillStyle = "rgba(0,0,0,0.78)";
    ctx.fill("evenodd");
    ctx.restore();
    const pulse = 0.5 + Math.sin(time * 0.005) * 0.5;
    ctx.save();
    ctx.strokeStyle = "rgba(120,220,160," + (0.7 + pulse * 0.3) + ")";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    ctx.rect(z.x, z.y, z.w, z.h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    // 文字面板（左側、不擋到三張卡）
    const boxW = 320, panelH = 240;
    const panelX = 30;
    const panelY = app.h/2 - panelH/2;
    roundPanel(panelX, panelY, boxW, panelH, 12, "rgba(6,14,28,0.97)", "rgba(120,220,160,0.6)", 2);
    text("超車成功！三選一", panelX + boxW/2, panelY + 28, 18, "#7be0a0", "1000", "center");
    text("每次成功超車，從 3 張中選 1 張加入你的牌組:", panelX + 16, panelY + 64, 12, "#e8f0ff", "700", "left");
    text("• 指令牌 (橙)：打出立刻生效、消失", panelX + 16, panelY + 92, 12, "#ffb070", "800", "left");
    text("• 車隊牌 (綠)：留場、持續生效", panelX + 16, panelY + 116, 12, "#7be0a0", "800", "left");
    text("  └ 永久型 → 選後直接進場", panelX + 16, panelY + 138, 11, "rgba(180,220,200,0.85)", "700", "left");
    text("  └ 其他型 → 進牌庫，要打出才生效", panelX + 16, panelY + 158, 11, "rgba(180,220,200,0.85)", "700", "left");
    text("或按「略過」不拿。", panelX + 16, panelY + 188, 12, "#e8f0ff", "700", "left");
    button("stage5-reward-tutorial-ok", "我明白了", panelX + 30, panelY + panelH - 44, boxW - 60, 36, false, "start");
  }

  // 首次 Pass 教學頁
  function drawStage5PassTutorialModal(time) {
    const s5 = app.stage5;
    if (!s5) return;
    const ctx = app.ctx;
    drawRace(time);
    drawHud(time);
    drawStage5SandOverlay(time);
    drawStage5SidePanel(time);
    drawStage5NextCircuit(time);
    drawHand(time);
    // spotlight 右下 HUD（速度比較區）
    const z = { x: app.w - 234, y: app.h - 200, w: 220, h: 186 };
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, app.w, app.h);
    const r = 12;
    ctx.moveTo(z.x+r, z.y);
    ctx.lineTo(z.x+z.w-r, z.y);
    ctx.quadraticCurveTo(z.x+z.w, z.y, z.x+z.w, z.y+r);
    ctx.lineTo(z.x+z.w, z.y+z.h-r);
    ctx.quadraticCurveTo(z.x+z.w, z.y+z.h, z.x+z.w-r, z.y+z.h);
    ctx.lineTo(z.x+r, z.y+z.h);
    ctx.quadraticCurveTo(z.x, z.y+z.h, z.x, z.y+z.h-r);
    ctx.lineTo(z.x, z.y+r);
    ctx.quadraticCurveTo(z.x, z.y, z.x+r, z.y);
    ctx.closePath();
    ctx.fillStyle = "rgba(0,0,0,0.78)";
    ctx.fill("evenodd");
    ctx.restore();
    const pulse = 0.5 + Math.sin(time * 0.005) * 0.5;
    ctx.save();
    ctx.strokeStyle = "rgba(140,180,255," + (0.7 + pulse * 0.3) + ")";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    ctx.rect(z.x, z.y, z.w, z.h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    const boxW = 580, boxH = 180;
    const boxX = app.w/2 - boxW/2;
    const boxY = 60;
    roundPanel(boxX, boxY, boxW, boxH, 12, "rgba(6,14,28,0.97)", "rgba(140,180,255,0.6)", 2);
    text("Pass：放棄這回合超車", boxX + boxW/2, boxY + 28, 20, "#8fb8ff", "1000", "center");
    text("如果你的「基礎速度」≤「對手速度」就不能超車。", boxX + boxW/2, boxY + 62, 13, "#e8f0ff", "700", "center");
    text("此時按 Pass：如果後車也比你快 → 進防守 QTE；否則維持名次。", boxX + boxW/2, boxY + 86, 13, "#e8f0ff", "700", "center");
    text("⚠ Pass 後速度歸零，下回合從 0 重新累積（除非有「維持胎溫」）。", boxX + boxW/2, boxY + 118, 12, "rgba(255,220,160,0.85)", "700", "center");
    button("stage5-pass-tutorial-ok", "繼續", boxX + boxW/2 - 80, boxY + boxH - 50, 160, 40, false, "start");
  }


  // ─── 遊戲規則頁 ────────────────────────────────────────────────────────────
  function drawRulesModal(time) {
    const box = getCenteredModalBox(720, 540);
    drawModalPanel(box, "rgba(255,200,60,0.45)");
    const cx = box.x + box.w/2;
    text("最後車手 / Final Driver", cx, box.y + 38, 22, "#ffd94f", "1000", "center");
    text("遊戲規則", cx, box.y + 68, 14, "rgba(220,220,200,0.8)", "700", "center");
    const ctx = app.ctx;
    ctx.save(); ctx.strokeStyle="rgba(255,200,60,0.3)"; ctx.lineWidth=1; ctx.setLineDash([5,5]);
    ctx.beginPath(); ctx.moveTo(box.x+40,box.y+90); ctx.lineTo(box.x+box.w-40,box.y+90); ctx.stroke();
    ctx.setLineDash([]); ctx.restore();
    const sections = [
      ["遊戲目標", "從第 5 名超越所有對手與 Boss，奪得第 1 名。"],
      ["打牌與動力", "每張牌有 cost，消耗動力打出。動力每回合刷新。"],
      ["超車", "速度 ≥ 對手 → 直接超車；同道 → 強制 QTE 超車。"],
      ["防守 QTE", "後車速度 > 你時觸發，移動滑鼠追綠色安全區。"],
      ["排名變動", "成功超車 +1 名次；防守失敗 -1（最低第 5 名）。"],
      ["第五關·循環賽段", "每次成功超車切換下一賽段：3 道 → 1 道 → 彎道 → 3 道（強沙暴）。"],
      ["第五關·三選一", "每次超車成功可從三張牌中選 1 張永久加入牌庫。"],
      ["第五關·Boss", "Boss 有 3 點專注值。削光後出現破綻，再次超車 = 通關。"],
      ["卡牌類別", "指令牌：立即效果，打出消失。 / 車隊牌：留場持續生效。"],
    ];
    let y = box.y + 110;
    const padX = 40;
    for (const [k, v] of sections) {
      text(k, box.x + padX, y, 14, "#7be0a0", "900", "left");
      text(v, box.x + padX + 110, y, 12, "#e8f0ff", "700", "left");
      y += 32;
    }
    button("close-rules", "關閉", cx - 80, box.y + box.h - 56, 160, 40, false, "primary");
  }


  // ─── QTE 相關繪製（沿用 Sam）─────────────────────────────────────────────
  function drawSplash() {
    const ctx = app.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(0,0,app.w,app.h);
    text(app.message, app.w/2, app.h*0.42, 38, "#ffd94f", "1000", "center");
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

  function drawQteTeachModal(isOvertake) {
    const page = Math.max(0, Math.min(1, app.qteTeachPage||0));
    const box = getCenteredModalBox(640, 380);
    drawModalPanel(box);
    const cx = box.x+box.w/2;
    text(isOvertake?"極限超車 QTE 教學":"防守 QTE 教學", cx, box.y+54, 28, "#dfeeff", "900", "center");
    text(`${page+1}/2`, box.x+36, box.y+96, 24, "#ffd94f", "900");
    if (isOvertake) {
      if (page===0) {
        text("圓圈由大往內收縮，接近拍點時點擊！", cx, box.y+132, 18, "#f4f8ff", "900", "center");
        text("點擊範圍是外圈內部，連續點完 5 顆。", cx, box.y+160, 16, "rgba(200,220,255,0.8)", "700", "center");
      } else {
        text("判定分為 Perfect / Good / Miss。", cx, box.y+132, 18, "#f4f8ff", "900", "center");
        text("Miss 數量達 3 個以上則超車失敗。", cx, box.y+160, 16, "rgba(200,220,255,0.8)", "700", "center");
      }
    } else {
      if (page===0) {
        text("移動滑鼠，讓指標停在綠色安全區。", cx, box.y+132, 18, "#f4f8ff", "900", "center");
        text("進度條滿了就防守成功！", cx, box.y+160, 16, "rgba(200,220,255,0.8)", "700", "center");
      } else {
        text("綠色區域會持續移動，要跟著追。", cx, box.y+132, 18, "#f4f8ff", "900", "center");
        text("10 秒內達到 100% 就算守住！", cx, box.y+160, 16, "rgba(200,220,255,0.8)", "700", "center");
      }
    }
    const last = page>=1;
    const btnId = last ? (isOvertake?"qte-tutorial-start-overtake":"qte-tutorial-start-defense") : "qte-tutorial-next";
    const btnLabel = last ? (isOvertake?"開始超車":"開始防守") : "下一頁";
    button(btnId, btnLabel, box.x+box.w-196, box.y+box.h-68, 160, 48);
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
    ctx.font='800 12px system-ui,"Microsoft JhengHei",sans-serif';
    ctx.textAlign="center";
    const pillW=Math.min(120,Math.max(88,ctx.measureText(label).width+30));
    roundPanel(cx-pillW/2,py,pillW,pillH,12,COL.pillBg,COL.pillBorder,2);
    ctx.textBaseline="middle"; ctx.fillStyle=COL.pillText;
    ctx.fillText(label,cx,py+pillH/2+0.5);
    ctx.restore();
  }

  // ─── 通用工具（沿用 Sam）─────────────────────────────────────────────────
  function text(message, x, y, size, color, weight="700", align="left", noShadow=false) {
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
    text(label,x+w/2,y+27,16,disabled?"rgba(216,236,255,0.55)":start?"#fff4d6":"#d8ecff",start?"1000":"800","center");
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
    resize();
    update(time);
    draw(time);
    requestAnimationFrame(loop);
  }

  function resize() {
    const rect = app.canvas.getBoundingClientRect();
    app.dpr = Math.min(2, window.devicePixelRatio||1);
    app.w = rect.width||window.innerWidth;
    app.h = rect.height||window.innerHeight;
    const width=Math.max(1,Math.floor(app.w*app.dpr));
    const height=Math.max(1,Math.floor(app.h*app.dpr));
    if(app.canvas.width!==width||app.canvas.height!==height){
      app.canvas.width=width; app.canvas.height=height;
    }
    app.ctx.setTransform(app.dpr,0,0,app.dpr,0,0);
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
    bossCgImage.onload = () => {};
    setupInput();
    reset();
    requestAnimationFrame(loop);
  }

  return { start };
})();

document.addEventListener("DOMContentLoaded", initQteTest);
