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
  const NORMAL_STAGE_BGM_SRC = "assets/BGM/001.mp3";
  const BLIND_DESERT_CG_SRC  = "assets/blind-card-desert-boss.png";
  const BLIND_DESERT_BGM_SRC = "assets/BGM/BOSS.mp3";
  const BOSS_ENTRANCE_LAYER_SRCS = [
    "assets/BOSS/boss-intro-red-banner.png",
    "assets/BOSS/boss-intro-title-code.png",
    "assets/BOSS/boss-intro-quote-panel.png",
    "assets/BOSS/boss-intro-sand-sweep.png",
    "assets/BOSS/boss-intro-bottom-panel.png",
    "assets/BOSS/boss-intro-stats-bars.png",
    "assets/BOSS/boss-intro-mask-emblem.png",
    "assets/BOSS/boss-intro-portrait.png",
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
  // 類型 A：車輛動作牌（打完消失，只留速度數值）
  // 類型 B：戰術牌（留場上，結算後才消失）
  const CARD_TYPES = {
    accel:       { type:"accel",       cardClass:"action", name:"加速",   cost:1, speedValue:2, note:"速度 +2" },
    hyper_accel: { type:"hyper_accel", cardClass:"action", name:"超加速", cost:2, speedValue:6, note:"速度 +6" },
    mistake:     { type:"mistake",     cardClass:"action", name:"失誤",   cost:0, speedValue:0, note:"無效果" },
  };

  // ─── 教學關卡定義 ──────────────────────────────────────────────────────────
  const STAGES = [
    {
      id: "stage-1",
      title: "關卡 1：認識打牌與換道",
      lanes: 3,
      playerLane: 1,
      opponentLane: 1,
      opponentSpeed: 3,
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
      opponentSpeed: 5,
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
      opponentSpeed: 4,
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
      opponentSpeed: 8,
      chaserSpeed: 3,  // 後車速度；玩家失誤牌打不出速度，會被追上
      deal: "dealStage4",
      opponentActions: [],
      laneBonus: null,
      laneBonuses: null,
      intro: [],   // overlay step 自己說明
      goal: "防守成功",
    },
    // ─── 第五關：沙暴登頂（正式關卡）───────────────────────────────────────
    {
      id: "stage-5",
      title: "關卡 5：沙暴登頂",
      isStage5: true,
      lanes: 3,
      playerLane: 1,
      opponentLane: 0,
      opponentSpeed: 5,
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
  const STAGE5_OPPONENTS = {
    A: {
      id: "A", name: "破風者", speed: 6, chaserSpeed: 5,
      actions: [{ onActionN: 2, action: "moveTo", target: "playerLane" }],
      flavor: "切入手 — 會切到你的道上強制纏鬥",
    },
    B: {
      id: "B", name: "沙塵旅人", speed: 7, chaserSpeed: 6,
      actions: [
        { onActionN: 2, action: "boost", amount: 1 },
        { onActionN: 4, action: "boost", amount: 1 },
      ],
      flavor: "阻擋手 — 會持續加速壓制",
    },
    C: {
      id: "C", name: "老鷹", speed: 5, chaserSpeed: 5,
      actions: [
        { onActionN: 1, action: "boost", amount: 1 },
        { onActionN: 2, action: "boost", amount: 1 },
        { onActionN: 3, action: "boost", amount: 1 },
      ],
      flavor: "節奏壓制 — 動作越多他越快",
    },
    BOSS: {
      id: "BOSS", name: "沙暴領主", speed: 8, chaserSpeed: 0, isBoss: true,
      actions: [{ onActionN: 3, action: "moveTo", target: "playerLane" }],
      flavor: "盲牌沙漠的主宰",
    },
  };

  // ─── 第五關：賽道循環定義 ────────────────────────────────────────────────
  // c1-c4: 一般循環（玩家未進 Boss 戰時用）
  // c5-c6: Boss 戰專用循環
  const STAGE5_CIRCUITS = [
    { id:"c1", name:"正常 3 道", icon:"🛣", lanes:3, bendCurve:0,    roadWidthScale:1.0, laneBonuses:null, sandLevel:1, hint:"標準賽道，沙塵微弱" },
    { id:"c2", name:"狹窄 1 道", icon:"▮",  lanes:1, bendCurve:0,    roadWidthScale:0.42,laneBonuses:null, sandLevel:1, hint:"強制 QTE 超車" },
    { id:"c3", name:"彎道 2 道", icon:"↪",  lanes:2, bendCurve:0.18, roadWidthScale:1.0,
      laneBonuses:[{lane:0,speedMult:1.25,qteDiff:"hard",label:"內彎 ×1.25 / QTE 難"},
                   {lane:1,speedMult:0.9, qteDiff:"easy",label:"外彎 ×0.9 / QTE 易"}],
      sandLevel:2, hint:"內彎快但 QTE 難" },
    { id:"c4", name:"正常 3 道", icon:"🛣", lanes:3, bendCurve:0,    roadWidthScale:1.0, laneBonuses:null, sandLevel:3, hint:"沙暴猛烈：cost 被遮蔽" },
    // Boss 戰專用循環
    { id:"b1", name:"沙暴峽谷", icon:"⚠",   lanes:3, bendCurve:0,    roadWidthScale:1.0, laneBonuses:null, sandLevel:4, hint:"Boss 戰 — 盲牌沙漠", bossOnly:true },
    { id:"b2", name:"沙暴峰會", icon:"☷",   lanes:2, bendCurve:0.15, roadWidthScale:0.9,
      laneBonuses:[{lane:0,speedMult:1.1, qteDiff:"normal",label:"內彎 ×1.1"},
                   {lane:1,speedMult:0.95,qteDiff:"normal",label:"外彎 ×0.95"}],
      sandLevel:4, hint:"Boss 戰 — 雙線高速", bossOnly:true },
  ];
  // 一般循環的索引（c1-c4）
  const STAGE5_NORMAL_CIRCUITS = [0,1,2,3];
  // Boss 戰循環的索引（b1-b2）
  const STAGE5_BOSS_CIRCUITS = [4,5];

  // ─── 第五關：牌池定義 ────────────────────────────────────────────────────
  const STAGE5_COMMAND_CARDS = {
    turbo:         { type:"turbo",         cardClass:"action", name:"渦輪增壓", cost:1, speedValue:3, note:"速度 +3" },
    perfectCorner: { type:"perfectCorner", cardClass:"action", name:"完美過彎", cost:2, speedValue:5, note:"速度 +5、可換道", canChangeLane:true },
    drag:          { type:"drag",          cardClass:"action", name:"風阻減免", cost:0, speedValue:1, note:"速度 +1" },
    tailwind:      { type:"tailwind",      cardClass:"action", name:"順風",     cost:1, speedValue:2, note:"速度 +2、下張 cost-1", buffNext:-1 },
    allIn:         { type:"allIn",         cardClass:"action", name:"孤注一擲", cost:1, speedValue:6, note:"速度 +6、下回合手牌-1", penaltyNextHand:-1 },
  };
  const STAGE5_TEAM_CARDS = {
    engineer: { type:"engineer", cardClass:"team", name:"工程師調校", cost:2, note:"動力上限 +1（永久）",        effect:"energyMaxPlus",  value:1,   persistence:"permanent",   persistenceLabel:"永久" },
    tireWarm: { type:"tireWarm", cardClass:"team", name:"維持胎溫",   cost:1, note:"結算後保留 +1 速度",          effect:"keepSpeed",      value:1,   persistence:"untilRankUp", persistenceLabel:"名次上升時棄" },
    bigData:  { type:"bigData",  cardClass:"team", name:"大數據預測", cost:1, note:"顯示對手下一動作",            effect:"showOpponent",   value:1,   persistence:"permanent",   persistenceLabel:"永久" },
    backup:   { type:"backup",   cardClass:"team", name:"後援車隊",   cost:2, note:"防守失敗時不掉名次（一次）",  effect:"saveOnDefeat",   value:1,   persistence:"oneShot",     persistenceLabel:"觸發後棄" },
    cool:     { type:"cool",     cardClass:"team", name:"冷靜!",      cost:1, note:"QTE 容錯範圍 +20%",            effect:"qteForgiveness", value:0.2, persistence:"permanent",   persistenceLabel:"永久" },
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
    opponentSpeed: 4,
    energy: 3,
    energyMax: 3,
    cardsPlayedThisRound: 0,
    opponentActionsThisStage: [],

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
    rank: 5,
    rankTotal: 5,
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

  // ─── 動力計算 ──────────────────────────────────────────────────────────────
  function cardCost(card) {
    let base = card.cost ?? 1;
    // 第五關「順風」buff：下一張 cost-1（只作用於下一張，扣完歸 0）
    if (isStage5() && app.stage5 && app.stage5.tailwindActive < 0) {
      base = Math.max(0, base + app.stage5.tailwindActive);
      // 用過扣完
      // 但這裡只是計算，扣 buff 應在打出去成功後做
    }
    return base;
  }

  function canAfford(card) {
    return app.energy >= cardCost(card);
  }

  function canAffordAny() {
    return app.hand.some(canAfford);
  }

  // ─── 速度計算 ──────────────────────────────────────────────────────────────
  function currentLaneSpeed() {
    const bonus = getLaneBonusFor(app.playerLane);
    if (bonus && bonus.speedMult) {
      return Math.floor(app.playerSpeed * bonus.speedMult);
    }
    return app.playerSpeed;
  }

  function canDirectOvertake() {
    return app.playerLane !== app.opponentLane && currentLaneSpeed() > app.opponentSpeed;
  }

  function shouldForceQTE() {
    // 核心規則：速度 > 對手才能超車（同道強制 QTE 也要速度夠）
    return app.playerLane === app.opponentLane && currentLaneSpeed() > app.opponentSpeed;
  }

  // 是否需要進入防守 QTE：
  // - stage 設了 noDefense → 永遠 false（教學關特殊規則）
  // - 沒設 chaserSpeed（舊關卡/向下相容）→ 一律要防守
  // - 有設 chaserSpeed → 玩家當前速度 < 後車速度，才會被追上，要防守
  function shouldDefend() {
    if (app.noDefense) return false;
    if (app.chaserSpeed == null) return true;
    return currentLaneSpeed() < app.chaserSpeed;
  }

  // 取得指定道的加成資料
  function getLaneBonusFor(laneIdx) {
    if (app.laneBonuses) {
      return app.laneBonuses.find(b => b.lane === laneIdx) ?? null;
    }
    if (app.laneBonus && app.laneBonus.lane === laneIdx) return app.laneBonus;
    return null;
  }

  // 玩家當前道的 QTE 難度修正
  function currentLaneQteDiff() {
    const b = getLaneBonusFor(app.playerLane);
    return b ? (b.qteDiff ?? "normal") : "normal";
  }

  function rhythmBeatWindowSec() {
    // 判定窗口固定，不隨道路難度改變（難度只影響圓圈收縮速度）
    if (app.mode === "rhythm-formal")
      return { perfect: RHYTHM_FORMAL_EASY_PERFECT, good: RHYTHM_FORMAL_EASY_GOOD };
    return { perfect: RHYTHM_BEAT_ERROR_PERFECT, good: RHYTHM_BEAT_ERROR_GOOD };
  }

  function getRhythmDuration(circleIndex) {
    // QTE 難度只反映在圓圈收縮速度上（duration 短=收得快=難；長=收得慢=易）
    let dur = RHYTHM_DURATIONS[circleIndex];
    const diff = currentLaneQteDiff();
    if (diff === "easy") dur *= 1.4;   // 外彎：圓圈收得慢，反應時間更充裕
    if (diff === "hard") dur *= 0.7;   // 內彎：圓圈收得快，要更早出手
    return Math.round(dur);
  }

  // ─── 防守難度 ──────────────────────────────────────────────────────────────
  function defenseDifficulty() {
    const easy = (app.stageIndex === 3); // 關卡4（index 3）是教學防守，給一點寬鬆
    return {
      safeWidth:    easy ? 28 : 20,
      perfectWidth: easy ? 8  : 5,
      shiftMin:     easy ? 450: 280,
      shiftMax:     easy ? 600: 380,
      lerp:         easy ? 0.08: 0.11,
      missPenalty:  0.08,
    };
  }

  // ─── 發牌 ──────────────────────────────────────────────────────────────────
  function makeCard(type, suffix) {
    return { ...CARD_TYPES[type], id: `${type}-${suffix}` };
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
    // 4 張 = 3 加速(cost 1) + 1 超加速(cost 2)，動力 3 點，至少能打 3 個動作
    // 典型：1 換道 + 2 打牌 / 3 全打不換道；超加速 cost 2 讓選擇有取捨
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
    return {
      id: `s5-${type}-${_stage5CardSeq}`,
      type: def.type,
      cardClass: def.cardClass,
      name: def.name,
      cost: def.cost,
      note: def.note,
      // 指令牌數值
      speedValue: def.speedValue,
      canChangeLane: def.canChangeLane,
      buffNext: def.buffNext,
      penaltyNextHand: def.penaltyNextHand,
      // 車隊牌
      effect: def.effect,
      value: def.value,
      persistence: def.persistence,
      persistenceLabel: def.persistenceLabel,
    };
  }
  // 第五關起始牌庫：跟前 4 關一致，只有加速 / 失誤 / 再加速
  // 三選一才能拿到華麗卡（渦輪 / 完美過彎 / 順風 / 孤注 + 車隊牌）
  function makeStage5InitialDeck() {
    const deck = [];
    // 6 加速 + 2 再加速 + 2 失誤 = 共 10 張基礎牌庫
    for (let i=0;i<6;i++) deck.push(makeCard("accel", `s5-init-acc-${i}`));
    for (let i=0;i<2;i++) deck.push(makeCard("hyper_accel", `s5-init-hyp-${i}`));
    for (let i=0;i<2;i++) deck.push(makeCard("mistake", `s5-init-mis-${i}`));
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
    // 先把上回合手牌（沒打出的）丟回 discardPile
    if (app.hand && app.hand.length > 0) {
      s5.discardPile.push(...app.hand);
      app.hand = [];
    }
    // 計算手牌數
    let handSize = 5;
    if (s5.penaltyNextHand) {
      handSize += s5.penaltyNextHand;
      s5.penaltyNextHand = 0;
    }
    handSize = Math.max(2, handSize);
    // 從 drawPile 抽，不夠時把 discardPile 洗進 drawPile
    const drawn = [];
    for (let i = 0; i < handSize; i++) {
      if (s5.drawPile.length === 0) {
        // 洗 discard 進 drawPile
        if (s5.discardPile.length === 0) break;  // 沒牌可抽（極端情況）
        s5.drawPile = [...s5.discardPile];
        s5.discardPile = [];
        shuffleArrayInPlace(s5.drawPile);
      }
      drawn.push(s5.drawPile.shift());
    }
    app.hand = drawn;
    // 開回合：依沙暴強度決定要遮哪幾張卡的 cost
    assignSandObscuredCards();
  }
  // 依當前賽段沙暴強度決定哪幾張手牌的 cost 被遮（用 id 鎖定）
  function assignSandObscuredCards() {
    const s5 = app.stage5;
    if (!s5) return;
    s5.obscuredCardIds = new Set();
    const circ = currentCircuit();
    if (!circ) return;
    const lvl = circ.sandLevel || 1;
    const handSize = app.hand.length;
    let count = 0;
    if (lvl === 1) count = 0;
    else if (lvl === 2) count = 1;
    else if (lvl === 3) count = Math.floor(handSize * 0.5);  // 無條件捨去
    else if (lvl === 4) {
      // 滿級：Boss 戰用盲牌邏輯接手，這裡不遮 cost
      return;
    }
    if (count <= 0) return;
    // 隨機選 count 張遮
    const indices = app.hand.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    for (let i = 0; i < count && i < indices.length; i++) {
      const card = app.hand[indices[i]];
      if (card && card.id) s5.obscuredCardIds.add(card.id);
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
    if (s5.bossStage) {
      // Boss 循環
      const curBossIdx = STAGE5_BOSS_CIRCUITS.indexOf(s5.circuitIndex);
      const nextBossIdx = (curBossIdx + 1) % STAGE5_BOSS_CIRCUITS.length;
      return STAGE5_CIRCUITS[STAGE5_BOSS_CIRCUITS[nextBossIdx]];
    }
    // 一般循環
    const curIdx = STAGE5_NORMAL_CIRCUITS.indexOf(s5.circuitIndex);
    const nextIdx = curIdx >= 0 ? (curIdx + 1) % STAGE5_NORMAL_CIRCUITS.length : 0;
    return STAGE5_CIRCUITS[STAGE5_NORMAL_CIRCUITS[nextIdx]];
  }
  // 套用賽道到 app 狀態
  function applyCircuit(circ) {
    initLanes(circ.lanes);
    app.bendCurve = circ.bendCurve;
    app.roadWidthScale = circ.roadWidthScale;
    app.laneBonuses = circ.laneBonuses;
    app.laneBonus = null;
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
      // Boss 戰循環：在 STAGE5_BOSS_CIRCUITS 之間切換
      const curBossIdx = STAGE5_BOSS_CIRCUITS.indexOf(s5.circuitIndex);
      const nextBossIdx = (curBossIdx + 1) % STAGE5_BOSS_CIRCUITS.length;
      s5.circuitIndex = STAGE5_BOSS_CIRCUITS[nextBossIdx];
      applyCircuit(STAGE5_CIRCUITS[s5.circuitIndex]);
      s5.circuitJustChanged = true;
      return;
    }
    // 一般循環：c1-c4 之間切換
    const curIdx = STAGE5_NORMAL_CIRCUITS.indexOf(s5.circuitIndex);
    const nextIdx = curIdx >= 0 ? (curIdx + 1) % STAGE5_NORMAL_CIRCUITS.length : 0;
    s5.circuitIndex = STAGE5_NORMAL_CIRCUITS[nextIdx];
    applyCircuit(STAGE5_CIRCUITS[s5.circuitIndex]);
    s5.circuitJustChanged = true;
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
    // 前方非 boss 候選
    const candidates = s5.ahead.filter(id => id !== "BOSS");
    if (candidates.length === 0) return "BOSS";  // 只剩 boss
    return candidates[Math.floor(Math.random()*candidates.length)];
  }
  // 取得當前後車（追車）
  function currentChaser() {
    if (!app.stage5 || !app.stage5.chaserId) return null;
    return STAGE5_OPPONENTS[app.stage5.chaserId];
  }
  // 套用當前對手到 app（speed + actions）
  function applyOpponentToApp(oppId) {
    const opp = STAGE5_OPPONENTS[oppId];
    if (!opp) return;
    app.opponentSpeed = opp.speed;
    app.opponentLane = (app.laneCount >= 2) ? (app.playerLane === 0 ? 1 : 0) : 0;
    app.opponentLaneVisual = app.opponentLane;
    app.opponentActionsThisStage = (opp.actions || []).map(a => ({...a}));
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
  // 初始化第五關狀態
  function initStage5State() {
    app.stage5 = {
      ahead: ["BOSS","A","B","C"],
      passed: [],
      currentOpponentId: null,
      pinnedNextOpponentId: null,
      chaserId: null,
      circuitIndex: 0,
      circuitJustChanged: false,
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
      tailwindActive: 0,
      penaltyNextHand: 0,
      blindPlaysRemaining: 0,
      seenIntro: false,
      tutorialPage: 0,              // 開場 spotlight 教學第幾頁
      rewardTutorialSeen: false,    // 是否看過三選一教學
      passTutorialSeen: false,      // 是否看過 Pass 教學
      obscuredCardIds: new Set(),  // 本回合 cost 被沙暴遮的卡 id（c2/c3/c4 用，回合開始時固定）
    };
    // 第一回合抽當前對手
    app.stage5.currentOpponentId = pickNextOpponent();
    applyCircuit(STAGE5_CIRCUITS[0]);
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
      app.rank = 5;
      app.rankTotal = 5;
      app.playerLane = 1;
      app.playerLaneVisual = 1;
      app.energyMax = 3;
      app.energy = app.energyMax;
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
    app.energy = app.energyMax;
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
    app.rank = 5;
    app.rankTotal = 5;
    app.stageIndex = 0;
    app.playerSpeed = 0;
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

    // 完美過彎這類「結算後可換道」的卡：必須拖到本道才能打
    if (card.canChangeLane && !isCurrentLane) {
      // 拒絕（玩家拖到別道是無效的）
      return;
    }

    // 換道（一般卡）：一律只消耗 1 動力（不論卡牌 cost），不加速度
    if (!isCurrentLane) {
      if (app.energy < 1) return;
      app.hand.splice(cardIdx, 1);
      // 第五關：消耗的卡進 discard
      if (isStage5() && app.stage5) app.stage5.discardPile.push(card);
      app.energy -= 1;
      app.playerLane = targetLane; // 邏輯立即切換
      // playerLaneVisual 在 update() 裡 lerp 追上
      app.actionsThisRound = (app.actionsThisRound ?? 0) + 1;
      triggerOpponentActions();
      checkAutoPrompt();
      return;
    }

    // 第五關：車隊牌 → 加入 teamCardsActive、套用效果（不丟 discard）
    if (isStage5() && card.cardClass === "team") {
      if (!canAfford(card)) return;
      app.energy -= cardCost(card);
      app.hand.splice(cardIdx, 1);
      app.cardsPlayedThisRound += 1;
      app.actionsThisRound = (app.actionsThisRound ?? 0) + 1;
      const s5 = app.stage5;
      s5.teamCardsActive.push(card);
      // 立即效果：energyMaxPlus 要當下就加動力上限與動力
      if (card.effect === "energyMaxPlus") {
        app.energyMax += (card.value || 0);
        app.energy = Math.min(app.energyMax, app.energy + (card.value || 0));
      }
      // 盲牌計數遞減
      if (s5.bossStage && s5.blindPlaysRemaining > 0) {
        s5.blindPlaysRemaining = Math.max(0, s5.blindPlaysRemaining - 1);
      }
      triggerOpponentActions();
      checkAutoPrompt();
      return;
    }

    // 打牌到當前道：速度累積到玩家身上
    if (!canAfford(card)) return;
    const usedTailwind = isStage5() && app.stage5 && app.stage5.tailwindActive < 0;
    app.energy -= cardCost(card);
    app.hand.splice(cardIdx, 1);
    // 第五關：打出的指令牌進 discard
    if (isStage5() && app.stage5) app.stage5.discardPile.push(card);
    app.cardsPlayedThisRound += 1;
    app.actionsThisRound = (app.actionsThisRound ?? 0) + 1;
    // 第五關指令牌：speedValue 直接加；順風 / 孤注一擲特殊處理
    if (isStage5()) {
      const s5 = app.stage5;
      let sv = card.speedValue || 0;
      // 沙暴遮蔽計數
      if (s5.bossStage && s5.blindPlaysRemaining > 0) {
        s5.blindPlaysRemaining = Math.max(0, s5.blindPlaysRemaining - 1);
      }
      app.playerSpeed += sv;
      // 用掉前一張的順風 buff（cost-1 已在 cardCost 計入）
      if (usedTailwind) {
        s5.tailwindActive = Math.min(0, s5.tailwindActive + 1);
      }
      // 順風：下張 cost-1
      if (card.buffNext) {
        s5.tailwindActive = (s5.tailwindActive || 0) + (card.buffNext);
      }
      // 孤注一擲：下回合手牌減
      if (card.penaltyNextHand) {
        s5.penaltyNextHand = (s5.penaltyNextHand || 0) + card.penaltyNextHand;
      }
    } else {
      app.playerSpeed += card.speedValue;
    }

    // 完美過彎這類「結算後選道」的卡：先觸發對手反應，再進選道 mode
    if (card.canChangeLane && app.laneCount > 1) {
      triggerOpponentActions();
      checkAutoPrompt();
      // 若 checkAutoPrompt 已自動切到結算流程（手牌空 / 動力空），就跳過選道
      if (app.mode === "playing") {
        app.cornerPickFromLane = app.playerLane;  // 紀錄選道前位置（取消用）
        app.mode = "stage5-corner-pick-lane";
      }
      return;
    }

    triggerOpponentActions();
    checkAutoPrompt();
  }

  function triggerOpponentActions() {
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

  function executeOpponentAction(act) {
    if (act.action === "moveTo") {
      const prevLane = app.opponentLane;
      if (act.target === "playerLane") {
        app.opponentLane = app.playerLane;
      } else if (typeof act.target === "number") {
        app.opponentLane = act.target;
      }
      if (app.opponentLane !== prevLane) {
        app.opponentActionFx = {
          label: `對手移動到第 ${app.opponentLane + 1} 道`,
          until: performance.now() + 1800,
        };
      }
    } else if (act.action === "boost") {
      // 對手反擊：speedBoost
      const amt = act.amount ?? 1;
      app.opponentSpeed += amt;
      app.opponentActionFx = {
        label: `對手加速！速度 +${amt}（現為 ${app.opponentSpeed}）`,
        until: performance.now() + 2000,
      };
    }
  }

  function checkAutoPrompt() {
    // 手牌空了或動力不夠打任何牌 → 自動詢問
    if (app.mode !== "playing") return;
    // 關卡2、3、4 教學：由各自 overlay 接管推進，不跳 prompt
    if (app.stageIndex === 1) return;
    if (app.stageIndex === 2) return;
    if (app.stageIndex === 3) return;
    if (app.hand.length === 0 || !canAffordAny()) {
      app.mode = "prompt-overtake-or-pass";
    }
  }

  function doOvertake() {
    // 第五關走自己的流程
    if (isStage5()) {
      clearLaneAfterOvertake();
      app.qteScore = null;
      app.qteScoreMax = null;
      app.qteScorePass = null;
      stage5OnOvertakeSuccess();
      return;
    }
    app.rank = Math.max(1, app.rank - 1);
    clearLaneAfterOvertake();
    // 直接超車（非 QTE）：清掉上次的 QTE 分數，避免結果畫面誤顯示
    app.qteScore = null;
    app.qteScoreMax = null;
    app.qteScorePass = null;
    app.mode = "result";
    app.message = "超車成功！";
  }

  function doOvertakeQTE() {
    app.mode = "splash-overtake";
    app.message = "極限超車 QTE";
    app.qteStart = performance.now();
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
    if (shouldForceQTE()) {
      // 同道對撞 → 強制 QTE
      if (!app.overtakeQteTutorialSeen) {
        app.qteTeachPage = 0;
        app.mode = "tutorial-overtake-qte";
      } else {
        doOvertakeQTE();
      }
    } else if (canDirectOvertake()) {
      doOvertake();
    } else {
      // 速度不足且不同道 → 無法超車（按鈕應該是 disabled）
    }
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
    // 牌池：1 指令 + 1 車隊 + 1 隨機
    const cmdKeys = Object.keys(STAGE5_COMMAND_CARDS);
    const teamKeys = Object.keys(STAGE5_TEAM_CARDS);
    const cmdPick = cmdKeys[Math.floor(Math.random()*cmdKeys.length)];
    const teamPick = teamKeys[Math.floor(Math.random()*teamKeys.length)];
    const allKeys = [...cmdKeys, ...teamKeys];
    const randomPick = allKeys[Math.floor(Math.random()*allKeys.length)];
    const picks = [cmdPick, teamPick, randomPick];
    s5.rewardOptions = picks.map(t => makeStage5Card(t));
    s5.rewardSlotHover = -1;
    // 首次三選一：先進教學頁
    if (!s5.rewardTutorialSeen) {
      app.mode = "stage5-reward-tutorial";
    } else {
      app.mode = "stage5-reward";
    }
  }
  // 玩家選了一張獎勵
  function stage5OnRewardPicked(slot) {
    const s5 = app.stage5;
    if (!s5 || !s5.rewardOptions || !s5.rewardOptions[slot]) return;
    const picked = s5.rewardOptions[slot];
    // 混合策略：
    //   - 永久型車隊牌（persistence === "permanent"）→ 馬上進場 teamCardsActive，不入牌庫
    //   - 非永久車隊牌 / 指令牌 → 進牌庫，需要打出才生效
    if (picked.cardClass === "team" && picked.persistence === "permanent") {
      s5.teamCardsActive.push(picked);
      // 立即套用 effect（例如：energyMaxPlus 要當下加動力上限）
      if (picked.effect === "energyMaxPlus") {
        app.energyMax += (picked.value || 0);
        app.energy = Math.min(app.energyMax, app.energy + (picked.value || 0));
      }
    } else {
      s5.deckPermanent.push(picked);
      // 新卡丟進 discardPile，下次重洗時會進 drawPile
      s5.discardPile.push(picked);
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
    // 重設動力上限為基準 3，再加上「工程師調校」
    let energyMax = 3;
    for (const c of s5.teamCardsActive) {
      if (c.effect === "energyMaxPlus") energyMax += (c.value || 0);
    }
    app.energyMax = energyMax;
  }
  // 開始一個新回合（換對手、發牌、清狀態）
  function stage5StartNewRound() {
    const s5 = app.stage5;
    if (!s5) return;
    // 檢查是否該進 Boss 戰
    if (!s5.bossStage && app.rank === 2) {
      // 進 Boss 戰（在 stage5EnterBossStage 內處理賽道）
      stage5EnterBossStage();
      return;
    }
    // 每一輪都切下一段賽道（Pass / 超車 / 防守失敗，都會走到這裡）
    // Boss 戰也會循環，但用 Boss 賽段（advanceCircuit 內部會判斷）
    advanceCircuit();
    // 一般回合
    // 1. 抽當前對手
    if (s5.bossStage) {
      s5.currentOpponentId = "BOSS";
    } else {
      s5.currentOpponentId = pickNextOpponent();
    }
    applyOpponentToApp(s5.currentOpponentId);
    // 2. 套用車隊牌持續效果
    applyTeamCardEffects();
    // 3. 後車邏輯：第 5 名無後車；其他名次（包含 Boss 戰中的第 2 名）都從 passed 抽
    if (app.rank === 5) {
      s5.chaserId = null;
    } else {
      // 從「玩家後方」非 boss 對手抽（即已被超過的對手）
      // 但若 chaserId 已被指定（剛超過你的人）就保留
      if (!s5.chaserId) {
        const behindCandidates = s5.passed.filter(id => id !== "BOSS");
        if (behindCandidates.length > 0) {
          s5.chaserId = behindCandidates[Math.floor(Math.random()*behindCandidates.length)];
        }
      }
    }
    applyChaserToApp(s5.chaserId);
    // 4. 清回合狀態（套用車隊牌「維持胎溫」keepSpeed 效果）
    let keepSpeedBonus = 0;
    for (const c of s5.teamCardsActive) {
      if (c.effect === "keepSpeed") keepSpeedBonus += (c.value || 0);
    }
    app.playerSpeed = keepSpeedBonus;
    app.energy = app.energyMax;
    app.cardsPlayedThisRound = 0;
    app.actionsThisRound = 0;
    // 5. 發手牌
    dealStage5Hand();
    // 6. Boss 戰盲牌設定
    if (s5.bossStage && !s5.bossBroken) {
      s5.blindPlaysRemaining = 2;
    } else {
      s5.blindPlaysRemaining = 0;
    }
    // 7. circuitJustChanged 在這回合 reset
    s5.circuitJustChanged = false;
    // 8. 進 playing
    app.mode = "playing";
  }
  // 玩家超車成功
  function stage5OnOvertakeSuccess() {
    const s5 = app.stage5;
    if (!s5) return;
    const oppId = s5.currentOpponentId;
    // Boss 戰：扣專注值或破綻通關
    if (s5.bossStage) {
      if (s5.bossBroken) {
        // 破綻狀態下超車 → 通關
        stage5OnGameWin();
        return;
      }
      // 扣 1 點專注值，Boss 立刻反超回來
      s5.bossFocus = Math.max(0, s5.bossFocus - 1);
      if (s5.bossFocus === 0) {
        s5.bossBroken = true;
      }
      // 不三選一、不切賽道（Boss 戰固定 c5）
      // 不變動排名（Boss 反超回來＝視覺上的事，邏輯上玩家仍第 2 名）
      // 進新回合
      app.message = s5.bossBroken ? "Boss 出現破綻！" : `專注值 ${s5.bossFocus} / ${s5.bossFocusMax}`;
      app.mode = "stage5-boss-hit";
      return;
    }
    // 一般對手：排名 +1、移除前方陣容、加到 passed
    if (oppId) {
      s5.ahead = s5.ahead.filter(id => id !== oppId);
      s5.passed.push(oppId);
      app.rank = Math.max(1, app.rank - 1);
    }
    s5.currentOpponentId = null;
    // 清空對手顯示（避免上一回合速度殘留在 HUD）
    app.opponentSpeed = 0;
    // 如果玩家剛剛被指定要追前面的（pinnedNextOpponentId），現在超過了，清除 pin
    // 後車 chaserId 不清，留到下回合（被超過的人不會回來追除非又掉名次）
    // 進三選一（賽道切換已移到 stage5StartNewRound 統一處理）
    app.message = "超車成功！";
    app.mode = "stage5-overtake-result";  // 顯示「超車成功」短畫面再進三選一
  }
  // 玩家超車失敗（QTE 失敗）
  function stage5OnOvertakeFail() {
    const s5 = app.stage5;
    if (!s5) return;
    // 排名不變，但前後方對手陣容洗牌（等同 Pass）
    shuffleStage5Ranks();
    app.message = "未超車";
    app.mode = "stage5-no-overtake";
  }
  // 玩家 Pass — 第五關
  function stage5OnPass() {
    const s5 = app.stage5;
    if (!s5) return;
    // 首次 Pass：進教學頁，之後才執行
    if (!s5.passTutorialSeen) {
      app.mode = "stage5-pass-tutorial";
      return;
    }
    stage5DoPassActual();
  }
  function stage5DoPassActual() {
    const s5 = app.stage5;
    if (!s5) return;
    const playerSpd = currentLaneSpeed();
    // Pass 時：前方非 Boss 對手 + 後方對手 各自洗牌
    shuffleStage5Ranks();
    // 後車存在且速度 > 玩家速度 → 防守
    const chaser = currentChaser();
    if (chaser && chaser.chaserSpeed > playerSpd) {
      app.message = "防守！";
      app._stage5DefenseInProgress = true;
      beginDefenseSequence();
      return;
    }
    app.message = "未超車";
    app.mode = "stage5-no-overtake";
  }
  // 排名洗牌：前方非 Boss 對手洗 + 後方對手洗（Boss 不動）
  function shuffleStage5Ranks() {
    const s5 = app.stage5;
    if (!s5) return;
    // 前方：Boss 固定在 index 0，非 boss 部分洗牌
    const boss = s5.ahead.filter(id => id === "BOSS");
    const aheadNonBoss = s5.ahead.filter(id => id !== "BOSS");
    for (let i = aheadNonBoss.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [aheadNonBoss[i], aheadNonBoss[j]] = [aheadNonBoss[j], aheadNonBoss[i]];
    }
    s5.ahead = [...boss, ...aheadNonBoss];
    // 後方對手洗牌
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
    // 真的掉名次
    const wasBoss = s5.bossStage;
    const chaserId = s5.chaserId;
    if (chaserId) {
      // 後車變成前車（重新出現在 ahead）
      if (!s5.ahead.includes(chaserId)) s5.ahead.push(chaserId);
      s5.passed = s5.passed.filter(id => id !== chaserId);
      // 「剛超過你的人」= 下回合指定對手
      s5.pinnedNextOpponentId = chaserId;
      // chaser 清除（他現在在前面了）
      s5.chaserId = null;
    }
    app.rank = Math.min(5, app.rank + 1);
    // 規則：「名次上升時棄」的車隊牌掉名次不棄
    // 如果是 Boss 戰被打掉：退出 Boss 戰
    if (wasBoss) {
      s5.bossStage = false;
      // bossFocus / bossBroken 保留 — 下次回 Boss 戰繼續這個進度
      // 切回一般循環的賽段（隨機從 c1~c4 抽一段）
      const normalIdx = STAGE5_NORMAL_CIRCUITS[Math.floor(Math.random() * STAGE5_NORMAL_CIRCUITS.length)];
      s5.circuitIndex = normalIdx;
      applyCircuit(STAGE5_CIRCUITS[normalIdx]);
      // BGM 切回 normal
      try { stopBossBgm(); playNormalBgm(); } catch(e){}
      app.message = "失守 — 退出 Boss 戰";
    } else {
      app.message = "防守失敗 — 掉 1 名次";
    }
    app.mode = "stage5-defense-result";
  }
  // 進 Boss 戰
  function stage5EnterBossStage() {
    const s5 = app.stage5;
    if (!s5) return;
    s5.bossStage = true;
    // 用第一個 Boss 戰賽段（b1）
    s5.circuitIndex = STAGE5_BOSS_CIRCUITS[0];
    applyCircuit(STAGE5_CIRCUITS[s5.circuitIndex]);
    // 首次進 Boss 戰才初始化專注值；二次回來保留進度
    if (s5.bossFocus == null || s5.bossFocusMax == null) {
      s5.bossFocus = 3;
      s5.bossFocusMax = 3;
      s5.bossBroken = false;
    }
    s5.currentOpponentId = "BOSS";
    applyOpponentToApp("BOSS");
    // Boss 戰也有後車（從已超過的對手中抽）
    if (!s5.chaserId) {
      const behindCandidates = s5.passed.filter(id => id !== "BOSS");
      if (behindCandidates.length > 0) {
        s5.chaserId = behindCandidates[Math.floor(Math.random()*behindCandidates.length)];
      }
    }
    applyChaserToApp(s5.chaserId);
    applyTeamCardEffects();
    // 套用車隊牌「維持胎溫」
    let keepSpeedBossBonus = 0;
    for (const c of s5.teamCardsActive) {
      if (c.effect === "keepSpeed") keepSpeedBossBonus += (c.value || 0);
    }
    app.playerSpeed = keepSpeedBossBonus;
    app.energy = app.energyMax;
    app.cardsPlayedThisRound = 0;
    app.actionsThisRound = 0;
    dealStage5Hand();
    s5.blindPlaysRemaining = 2;
    app.mode = "stage5-boss-intro";
    // BGM 切換到 boss
    try { stopNormalBgm(); playBossBgm(); } catch(e){}
  }
  // 通關第五關 = 整個遊戲勝利
  function stage5OnGameWin() {
    app.mode = "all-clear";
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
    if (time - app.defenseStart >= 10000 || app.defenseProgress >= 100) {
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
  function resetRhythmState() {
    app.qteStart = performance.now();
    app.qteCircleStarts = rhythmStarts(app.qteStart);
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
    // 每個圓圈分配一個按鍵，隨機從 QWER 選，但確保每個都不一樣（5 個圓圈從 4 鍵中取）
    const keys = ['q','w','e','r'];
    const assigned = [];
    for (let i = 0; i < 5; i++) {
      // 避免連續兩個相同
      let pick;
      do { pick = keys[Math.floor(Math.random() * keys.length)]; }
      while (assigned.length > 0 && pick === assigned[assigned.length - 1]);
      assigned.push(pick);
    }
    app.qteKeys = assigned;
  }

  function rhythmStarts(start) {
    // 基礎間隔：5 個圓圈固定相隔 620ms
    const baseOffsets = [0, 620, 1240, 1860, 2480];
    const diff = currentLaneQteDiff();
    // 依難度調整節奏倍率：easy 鬆、hard 緊
    let scale = 1;
    if (diff === "easy") scale = 1.25;  // 間隔拉長 → 節奏鬆
    if (diff === "hard") scale = 0.75;  // 間隔縮短 → 節奏緊湊
    // hard 額外加入小幅不規律抖動（最大 ±110ms），讓節拍不可預測
    const jitter = diff === "hard" ? 110 : 0;
    const result = [];
    let last = start;
    for (let i = 0; i < baseOffsets.length; i++) {
      const target = start + baseOffsets[i] * scale;
      const wobble = i === 0 ? 0 : (Math.random() - 0.5) * 2 * jitter;
      // 確保至少比前一個圓圈晚 200ms 出現，避免重疊
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
    if (app.qteClicked.size < 5) return;
    if (!app.qteResolveAt) {
      const times = Object.values(app.qteDismissAt);
      const last = times.length ? Math.max(...times) : performance.now() + 1200;
      app.qteResolveAt = last;
    }
  }

  function finalizeRhythmFormal() {
    if (!isRhythmMode()) return;
    // 分數制：perfect=2、good=1、miss=0；滿分 10，達 6 分為過關門檻
    const SCORE = { perfect: 2, good: 1, miss: 0 };
    let PASS_THRESHOLD = 6;
    // 第五關「冷靜!」車隊牌：判定門檻 -1（容錯 +20% 的簡化實作）
    if (isStage5() && app.stage5) {
      const hasCool = app.stage5.teamCardsActive.some(c => c.effect === "qteForgiveness");
      if (hasCool) PASS_THRESHOLD = 5;
    }
    let score = 0;
    for (const r of Object.values(app.qteResults)) score += SCORE[r] ?? 0;
    app.qteScore = score;
    app.qteScoreMax = 10;
    app.qteScorePass = PASS_THRESHOLD;
    const success = score >= PASS_THRESHOLD;
    // 第五關分流
    if (isStage5()) {
      clearLaneAfterOvertake();
      if (success) {
        stage5OnOvertakeSuccess();
      } else {
        stage5OnOvertakeFail();
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
    const r = RHYTHM_OUTER_R;
    const marginX = [r + RHYTHM_UI_AVOID_PAD, app.w - r - RHYTHM_UI_AVOID_PAD];
    const marginY = [r + RHYTHM_UI_AVOID_PAD, Math.min(app.h * 0.66, app.h - r - RHYTHM_UI_AVOID_PAD)];
    for (let attempt = 0; attempt < 90; attempt++) {
      const pts = [];
      for (let i = 0; i < 5; i++) {
        let point = null;
        for (let tries = 0; tries < 24; tries++) {
          const x = marginX[0] + Math.random() * (marginX[1] - marginX[0]);
          const y = marginY[0] + Math.random() * (marginY[1] - marginY[0]);
          if (qtePointSafe(x, y, r)) { point = { x, y }; break; }
        }
        if (!point) break;
        pts.push(point);
      }
      if (pts.length < 5) continue;
      let ok = true;
      for (let i = 0; i < 5 && ok; i++)
        for (let j = i + 1; j < 5; j++)
          if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < RHYTHM_SCATTER_MIN_CENTER_DIST) ok = false;
      if (ok) return pts;
    }
    const gap = Math.min(130, app.w * 0.085);
    const startX = app.w / 2 - gap * 2;
    return Array.from({ length: 5 }, (_, i) => ({ x: startX + i * gap, y: app.h * 0.44 }));
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
      if (!isRhythmMode()) return;
      const key = e.key.toLowerCase();
      if (!['q','w','e','r'].includes(key)) return;
      const now = performance.now();
      // 找到目前該按的圓圈（最早出現且還沒 finalized 的）
      for (let i = 0; i < 5; i++) {
        if (app.qteFinalized[i]) continue;
        const start = app.qteCircleStarts[i] ?? app.qteStart;
        if (now < start) continue; // 還沒出現
        const dur = getRhythmDuration(i);
        const judgeT = start + dur;
        if (now > judgeT) continue; // 已過判定時間
        const expectedKey = app.qteKeys[i];
        if (key === expectedKey) {
          // 按對鍵
          if (!app.qteTapPending[i]) app.qteTapPending[i] = { t: now };
        } else {
          // 按錯鍵：直接記為 miss
          if (!app.qteTapPending[i]) app.qteTapPending[i] = { t: now, wrong: true };
        }
        break; // 每次按鍵只處理最早的那個圓圈
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
    // 主選單：直接跳第五關（debug）
    if (id === "debug-jump-stage5") {
      playNormalBgm();
      loadStage(4);
      return;
    }
    // ─── 第五關 ───────────────────────────────────────────────────────
    // 開場 intro 確認
    if (id === "stage5-intro-next" && app.mode === "stage-5-intro") {
      const s5 = app.stage5;
      if (s5) s5.tutorialPage = (s5.tutorialPage || 0) + 1;
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
    if (id === "stage5-next-round" && (app.mode === "stage5-no-overtake" || app.mode === "stage5-defense-result")) {
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
    // Boss 戰：擊中專注值結算 → 進新回合
    if (id === "stage5-boss-continue" && app.mode === "stage5-boss-hit") {
      stage5StartNewRound();
      return;
    }
    // Boss 戰：intro 確認
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
      // 第二回合對手降速到 3（原本 8）；之後依玩家動作數會反擊 +2
      app.opponentSpeed = 3;
      // 排對手行動：玩家第 1 個動作後追過來、第 3 個動作後反擊 +2 速
      app.opponentActionsThisStage = [
        { onActionN: 1, action: "moveTo", target: "playerLane" },
        { onActionN: 3, action: "boost",  amount: 2 },
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
      if (shouldForceQTE() || canDirectOvertake()) pressOvertake();
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
    const lerpSpeed = 0.14;
    app.playerLaneVisual   += (app.playerLane   - app.playerLaneVisual)   * lerpSpeed;
    app.opponentLaneVisual += (app.opponentLane - app.opponentLaneVisual) * lerpSpeed;

    // 對手行動視覺提示計時
    if (app.opponentActionFx && time > app.opponentActionFx.until) {
      app.opponentActionFx = null;
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
            until: performance.now() + 1800,
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
      for (let i = 0; i < 5; i++) {
        if (app.qteFinalized[i]) continue;
        const start = app.qteCircleStarts[i] ?? app.qteStart;
        const elapsed = time - start;
        if (elapsed <= 0) continue;
        const dur = getRhythmDuration(i);
        const judgeT = start + dur;
        const tap = app.qteTapPending[i];

        // 提前按下：立刻結算（不必等 judgeT），玩家馬上看到 perfect/good/miss
        if (tap) {
          app.qteFinalized[i] = true;
          app.qteResults[i] = rhythmOutcomeFromTap(tap, start, dur, judgeT);
          app.qteDismissAt[i] = time + 1000;
          app.qteClicked.add(i);
          delete app.qteTapPending[i];
          tryFinishRhythmFormal();
          continue;
        }

        // 沒按、且時間到了：判 miss
        if (time >= judgeT) {
          app.qteFinalized[i] = true;
          app.qteResults[i] = rhythmOutcomeFromTap(undefined, start, dur, judgeT);
          app.qteDismissAt[i] = time + 1000;
          app.qteClicked.add(i);
          tryFinishRhythmFormal();
        }
      }
      if (time - app.qteStart > 5800 && app.qteClicked.size < 5) {
        for (let i = 0; i < 5; i++) {
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
    // 第五關常駐：右上角下一賽段預告 + 沙暴粒子 + 賽況面板
    if (isStage5() && (m === "playing" || m === "prompt-overtake-or-pass" || m === "stage5-overtake-result"
                       || m === "stage5-no-overtake" || m === "stage5-defense-result" || m === "stage5-reward"
                       || m === "stage5-boss-hit" || m.startsWith("splash") || isRhythmMode() || m === "defense")) {
      drawStage5SandOverlay(time);
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
      // 關卡2 QTE 教學 overlay
      if (app.stageIndex === 1) drawTutorialStage2QteOverlay(time);
      // 關卡3 overlay
      if (app.stageIndex === 2) drawTutorialStage2Overlay(time);
      // 關卡4 overlay
      if (app.stageIndex === 3) drawTutorialStage4Overlay(time);
    }

    if (m.startsWith("splash")) drawSplash();
    if (isRhythmMode()) drawRhythm(time);
    if (m === "defense") drawDefense();

    if (m === "result") drawResultModal();
    if (m === "defense-result") drawDefenseResultModal();
    if (m === "all-clear") drawAllClear();
    // 第五關專屬結算
    if (m === "stage5-overtake-result") drawStage5OvertakeResultModal();
    if (m === "stage5-no-overtake")     drawStage5NoOvertakeModal();
    if (m === "stage5-defense-result")  drawStage5DefenseResultModal();
    if (m === "stage5-reward")          drawStage5RewardModal(time);
    if (m === "stage5-boss-hit")        drawStage5BossHitModal();

    // 拖曳中的牌
    if (app.drag) drawCard(app.drag.card, app.drag.x, app.drag.y, app.drag.w, app.drag.h, true);

    // 第五關場上車隊牌 hover tooltip（最上層）
    if (isStage5()) drawStage5TeamCardTooltip(time);

    drawExpressionDock(time);
  }

  // ─── 賽道背景（沿用 Sam）──────────────────────────────────────────────────
  function createCarMotion() {
    const make = (a, b) => ({ speed: a + Math.random()*(b-a), phase: Math.random()*Math.PI*2 });
    return { red: make(0.00045,0.00105), white: make(0.00035,0.0009) };
  }
  let carMotion = createCarMotion();

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
    // 第五關：用沙漠背景（boss CG 圖 + 暗膜），讓賽道線、車子等繼續用標準繪製
    if (isStage5()) {
      drawStage5DesertBackground(time);
    } else {
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

    // 雨絲（白色細線，順著賽道方向）— 保留原本的快速感
    for(let i=0;i<24;i++){
      const p=((i/24)+(time*0.00045)%1)%1;
      const y=horizon+p*p*(h-horizon), spread=p*w*0.42;
      ctx.strokeStyle=`rgba(230,241,255,${0.12+p*0.38})`; ctx.lineWidth=Math.max(1,p*5);
      // 雨絲也跟著彎道偏移
      const bend = app.bendCurve ?? 0;
      const bendOffset = -bend * w * Math.pow(1 - p, 2);
      const cx = w*0.5 + bendOffset;
      ctx.beginPath();
      ctx.moveTo(cx-spread*0.25,y); ctx.lineTo(cx-spread*0.25,y+18+p*28);
      ctx.moveTo(cx+spread*0.25,y); ctx.lineTo(cx+spread*0.25,y+18+p*28);
      ctx.stroke();
    }

    // 對手車（紅）：速度越靠近門檻，對手車越靠近玩家車
    const opponentProgress = Math.min(1, app.playerSpeed / Math.max(1, app.opponentSpeed));
    // progress 0 → 對手在 0.62h（遠處）；progress 1 → 對手在 0.72h（快追到了）
    const opponentY = h * (0.62 + opponentProgress * 0.10);
    const redW = 82, redH = 40;
    const redX = laneCarX(app.opponentLaneVisual, app.laneCount, opponentY);
    drawCar(redX, opponentY, redW, redH, "#e94d48");

    // 第五關：大數據預測 — 對手車頭飄出對手下一個行動的小圖示
    if (isStage5() && app.stage5 && app.stage5.teamCardsActive.some(c => c.effect === "showOpponent")) {
      drawOpponentNextActionHint(redX + redW/2, opponentY, time);
    }

    // 玩家車（白）：使用 lerp 視覺道位置
    const whiteY = h * 0.80, whiteW = 176;
    const whiteX = laneCarX(app.playerLaneVisual, app.laneCount, whiteY);
    drawCar(whiteX, whiteY, whiteW, 82, "#dceaff");

    // 雨線
    ctx.strokeStyle="rgba(129,180,255,0.22)"; ctx.lineWidth=1;
    for(let i=0;i<60;i++){
      const x=((i*71+time*0.08)%(w+160))-80, y=(i*43+time*0.25)%h;
      ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x-18,y+42); ctx.stroke();
    }

    // 對手行動視覺提示
    if (app.opponentActionFx && time < app.opponentActionFx.until) {
      const alpha = Math.min(1, (app.opponentActionFx.until - time) / 400);
      text(app.opponentActionFx.label, app.w/2, app.h*0.22, 22, `rgba(255,100,100,${alpha})`, "900", "center");
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
    return { x: app.w - 300, y: app.h - 228 - 24, w: 276, h: 228 };
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

    // 動力圖示（分隔線下方給 10px 呼吸）
    text("動力", s.x+20, s.y+72, 13, "rgba(200,230,255,0.65)", "700");
    for (let i=0; i<app.energyMax; i++) {
      const filled = i < app.energy;
      roundPanel(s.x+76+i*30, s.y+57, 24, 24, 5,
        filled ? "rgba(255,200,60,0.9)" : "rgba(30,40,60,0.6)",
        filled ? "rgba(255,230,120,0.6)" : "rgba(80,100,130,0.3)", 1.5);
      if (filled) text("⚡", s.x+76+i*30+12, s.y+74, 12, "rgba(255,240,160,0.9)", "900", "center");
    }
    hr(s.y+92);

    // 玩家速度（分隔線下方 12px）— 顯示「基礎速度」（未經賽道加成）
    text("基礎速度", s.x+20, s.y+116, 13, "rgba(100,200,255,0.7)", "700");
    text(`${app.playerSpeed}`, s.x+s.w-20, s.y+120, 28, "rgba(120,220,255,0.95)", "900", "right");
    hr(s.y+140);

    // 對手速度
    text("對手速度", s.x+20, s.y+164, 13, "rgba(255,130,130,0.7)", "700");
    text(`${app.opponentSpeed}`, s.x+s.w-20, s.y+168, 28, "rgba(255,150,150,0.95)", "900", "right");

    // 進度條：用此道實際速度（含加成）vs 對手
    const barY = s.y+196;
    const barW = s.w-32;
    roundPanel(s.x+16, barY, barW, 14, 4, "rgba(10,16,28,0.9)", "rgba(100,140,200,0.22)", 1);
    const laneSpd = currentLaneSpeed();
    const frac = Math.min(1, laneSpd / Math.max(1, app.opponentSpeed));
    ctx.fillStyle = frac >= 1 ? "#57e585" : "rgba(100,200,255,0.85)";
    ctx.fillRect(s.x+20, barY+3, (barW-8)*frac, 8);
    ctx.fillStyle = "rgba(255,100,100,0.82)";
    ctx.fillRect(s.x+16+barW-3, barY, 3, 14);
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

      let borderColor = "rgba(60,80,110,0.35)";
      if (isBoth)          borderColor = "rgba(255,80,80,0.95)";
      else if (isPlayer)   borderColor = "rgba(100,200,255,0.9)";
      else if (isOpponent) borderColor = "rgba(255,100,100,0.55)";
      if (hasBonus)        borderColor = bonusData.speedMult >= 1
        ? "rgba(255,210,60,0.9)" : "rgba(140,180,200,0.7)";

      // 教學中不可互動的道格子半透明
      const alpha = (isTutorial1 && !droppable && !isPlayer && !isOpponent) ? 0.35 : 1;
      const ctx = app.ctx;
      ctx.save(); ctx.globalAlpha = alpha;

      let bgColor = "rgba(10,18,32,0.72)";
      if (isPlayer)                        bgColor = "rgba(12,28,52,0.88)";
      if (hasBonus && bonusData.speedMult >= 1) bgColor = "rgba(28,22,8,0.88)";
      panel(x, y, laneW, laneH, bgColor, borderColor, !isPlayer);

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

      // 加成標籤（緊跟道名下方，小字）
      if (hasBonus) {
        const bonusCol = bonusData.speedMult >= 1
          ? "rgba(255,200,60,0.88)" : "rgba(140,200,220,0.85)";
        text("★ " + (bonusData.label ?? `×${bonusData.speedMult}`),
          x+laneW/2, y+42, 10, bonusCol, "700", "center");
      }

      // 此道速度（每道都顯示，玩家道亮黃，他道暗灰，撞道紅）
      // 計算「如果在這道」會有多少速度（基礎 × 加成）
      const laneMult = hasBonus ? bonusData.speedMult : 1;
      // 預覽速度：拖卡懸停在此道時，模擬打牌後的此道速度
      let previewBase = app.playerSpeed;
      let isPreview = false;
      if (app.drag) {
        const dragCx = app.drag.x + app.drag.w/2;
        const dragCy = app.drag.y + app.drag.h/2;
        const hovering = inRect({ x: dragCx, y: dragCy }, { x, y, w: laneW, h: laneH });
        if (hovering) {
          if (i === app.playerLane) {
            // 拖到自己道 = 打牌：加上卡牌的速度值
            previewBase = app.playerSpeed + (app.drag.card.speedValue ?? 0);
            isPreview = true;
          } else if (droppable) {
            // 拖到其他道 = 換道：速度不變，但會被新道倍率影響（已是預設行為）
            // 這裡不算預覽，現況數字本來就是「換到此道的速度」
          }
        }
      }
      const laneSpeed = Math.floor(previewBase * laneMult);
      const numberY = y + (hasBonus ? 90 : 82);
      const labelY  = numberY + 22;
      const baseNumColor = isBoth   ? "rgba(255,140,140,0.95)"
                        : isPlayer  ? "rgba(255,230,100,0.95)"
                        :             "rgba(150,165,190,0.55)";
      // 預覽中閃爍綠色，玩家就能看到「打了會變多少」
      const numColor = isPreview ? "rgba(140,255,160,0.98)" : baseNumColor;
      const subColor = isPlayer ? "rgba(220,200,140,0.78)"
                     :            "rgba(140,150,170,0.5)";
      text(`${laneSpeed}`, x+laneW/2, numberY, 32, numColor, "900", "center");
      text(isPreview ? "預覽速度" : "此道速度", x+laneW/2, labelY, 11,
        isPreview ? "rgba(140,255,160,0.85)" : subColor, "700", "center");

      // 換道提示：拖曳時懸停在非當前道
      if (app.drag && i !== app.playerLane && droppable) {
        const dragCx = app.drag.x + app.drag.w/2;
        const dragCy = app.drag.y + app.drag.h/2;
        const hovering = inRect({ x: dragCx, y: dragCy }, { x, y, w: laneW, h: laneH });
        if (hovering) {
          panel(x, y, laneW, laneH, "rgba(255,200,80,0.15)", "rgba(255,200,80,0.9)", true);
          text("換道", x+laneW/2, y+laneH/2-6, 20, "rgba(255,220,100,0.98)", "900", "center");
          text("棄牌 ‧ 消耗 1 ⚡", x+laneW/2, y+laneH/2+18, 12, "rgba(255,210,140,0.85)", "800", "center");
        } else {
          text("拖到此處 ‧ 棄牌換道（1 ⚡）", x+laneW/2, y+laneH-18, 11, "rgba(180,170,130,0.62)", "700", "center");
        }
      }

      ctx.restore();
    }

    // 超車按鈕 + Pass 按鈕：放在右側並排
    const btnY = baseY;
    const canOv = canDirectOvertake() || shouldForceQTE();

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
      (app.mode === "playing" && !isStage2Tutorial && !isStage3Tutorial && !isStage4Tutorial)
      || isStage3OvertakeStep
      || isStage4FreeStep;

    // 教學 step 9：第一關超車按鈕直接顯示
    const showOvertakeTutorial = isTutorial1 && step === 9;

    if (isFreePlayPhase || showOvertakeTutorial) {
      const laneSpd = currentLaneSpeed();
      const lbl = shouldForceQTE() ? "⚡ QTE 超車"
                : canDirectOvertake() ? "✓ 超車"
                : `超車（差 ${app.opponentSpeed - laneSpd}）`;
      button("btn-overtake", lbl, app.w - 300, btnY, 130, 40,
        !canOv && !shouldForceQTE(),
        canDirectOvertake() ? "start" : "primary");
    }

    // Pass 按鈕：自由打牌階段永遠顯示；教學特殊 step（如第四關 step 3）也顯示
    if (isFreePlayPhase || isStage4PassStep) {
      button("btn-pass", "Pass →", app.w - 160, btnY, 120, 40, false, "gray");
    }

    // 對手行動倒數圖示
    drawOpponentActionCounter(baseX + totalW + 16, baseY, time);
  }

  // ─── 對手行動倒數圖示 ──────────────────────────────────────────────────────
  // 大數據預測：對手車頭飄圖示，預告下一個未觸發的對手行動
  function drawOpponentNextActionHint(cx, carTopY, time) {
    if (!app.opponentActionsThisStage) return;
    const actions = app.opponentActionsThisStage;
    const curN = app.actionsThisRound || 0;
    // 找下一個還沒觸發的行動（直接看 onActionN > curN 即可，已觸發的會在 triggerOpponentActions 內被消費掉）
    let nextAct = null;
    for (const a of actions) {
      if (a.onActionN > curN) {
        if (!nextAct || a.onActionN < nextAct.onActionN) nextAct = a;
      }
    }
    if (!nextAct) return;
    const remaining = nextAct.onActionN - curN;
    // 圖示文字
    let icon = "?";
    let label = "";
    if (nextAct.action === "moveTo") {
      icon = "→";
      label = "切道";
    } else if (nextAct.action === "boost") {
      icon = "⚡";
      label = `加速 +${nextAct.amount || 1}`;
    }
    // 飄浮動畫
    const t = time * 0.003;
    const floatY = Math.sin(t * 2) * 3;
    const hintY = carTopY - 44 + floatY;
    // 背景泡泡
    const ctx = app.ctx;
    const hintW = 108, hintH = 30;
    const hintX = cx - hintW/2;
    ctx.save();
    // 泡泡底
    ctx.fillStyle = "rgba(80, 180, 230, 0.92)";
    roundedRectPath(ctx, hintX, hintY, hintW, hintH, 8);
    ctx.fill();
    // 邊框
    ctx.strokeStyle = "rgba(160, 220, 255, 0.95)";
    ctx.lineWidth = 1.5;
    roundedRectPath(ctx, hintX, hintY, hintW, hintH, 8);
    ctx.stroke();
    // 圖示
    text(icon, hintX + 12, hintY + 22, 18, "#ffffff", "900", "left");
    // 預告文字
    text(`${remaining} 動作後`, hintX + 30, hintY + 12, 9, "rgba(220,240,255,0.85)", "700", "left");
    text(label, hintX + 30, hintY + 24, 11, "#ffffff", "800", "left");
    // 指向車的小三角
    ctx.fillStyle = "rgba(80, 180, 230, 0.92)";
    ctx.beginPath();
    ctx.moveTo(cx - 6, hintY + hintH);
    ctx.lineTo(cx + 6, hintY + hintH);
    ctx.lineTo(cx, hintY + hintH + 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawOpponentActionCounter(x, y, time) {
    // 第三關特殊：用教學 step 偽造倒數（對手在 step 4 玩家做完 2 個動作時追過來）
    let remaining = null;
    if (app.stageIndex === 2) {
      const s = app.tutorialStep;
      if (s >= 0 && s <= 4) {
        // 還沒追：剩餘動作 = 1 - 已做的動作（夾 0~1）
        remaining = Math.max(0, 1 - (app.actionsThisRound ?? 0));
      } else {
        return; // step 5 以後，對手已追過來，不再顯示
      }
    } else {
      // 一般關卡：找最近的等候型動作
      const actions = app.opponentActionsThisStage || [];
      if (actions.length === 0) return;
      // 把每個動作換算成「還剩幾步」（onCardN 看打牌數、onActionN 看總動作數）
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

    // 背景圓
    ctx.save();
    if (isImminent) {
      ctx.shadowColor = `rgba(255,80,80,${pulse * 0.6})`;
      ctx.shadowBlur = 16;
    }
    ctx.beginPath(); ctx.arc(cx, cy, size/2, 0, Math.PI*2);
    ctx.fillStyle = isImminent
      ? `rgba(60,12,12,0.95)`
      : "rgba(12,20,36,0.92)";
    ctx.fill();
    ctx.strokeStyle = isImminent
      ? `rgba(255,80,80,${0.8 + pulse * 0.2})`
      : "rgba(255,180,60,0.7)";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();

    // 倒數數字（大）
    text(`${remaining}`, cx, cy + 10, 28,
      isImminent ? `rgba(255,100,100,${0.9+pulse*0.1})` : "rgba(255,200,60,0.95)",
      "900", "center");

    // 上方小字
    text("對手行動", cx, cy - 24, 10, "rgba(200,200,200,0.75)", "700", "center");

    // 下方小字
    text(remaining === 0 ? "即將觸發！" : "個動作後", cx, cy + 28, 10,
      isImminent ? "rgba(255,140,140,0.9)" : "rgba(180,180,180,0.65)",
      "700", "center");

    // 立即觸發時加閃爍外圈
    if (isImminent) {
      ctx.save();
      ctx.globalAlpha = pulse * 0.4;
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
    // 盲牌：Boss 戰前 2 張打出去的牌完全看不到內容
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

    // 卡名
    text(card.name, x+w/2, y+42, 15, "#e8f0ff", "900", "center");

    // 動力費用（沙暴強度可能遮蔽）
    roundPanel(x+w-26, y+4, 22, 22, 5, "rgba(20,30,50,0.9)", "rgba(255,200,60,0.6)", 1.5);
    text(`${card.cost}`, x+w-15, y+20, 12, "#ffe080", "900", "center");
    // 第五關：依沙暴強度決定 cost 是否被遮
    if (isStage5() && isCostObscuredNow(card)) {
      drawCostSandObscure(x+w-26, y+4, 22, 22);
    }

    // 圖示
    drawCardCenterIcon(card, x+w/2, y+h*0.52, 40);

    // 效果描述
    text(card.note, x+w/2, y+h-24, 11, "rgba(200,220,255,0.75)", "700", "center");

    // 車隊牌：底部顯示棄牌條件
    if (isTeam && card.persistenceLabel) {
      text(`⌛ ${card.persistenceLabel}`, x+w/2, y+h-8, 9, "rgba(140,200,170,0.75)", "700", "center");
    }
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
  // 盲牌邏輯：Boss 戰中、blindPlaysRemaining > 0 時，所有手牌都是盲牌
  // 打完 blindPlaysRemaining 張後，剩下的牌才顯示
  function isStage5BlindCard(card) {
    if (!isStage5() || !app.stage5 || !app.stage5.bossStage) return false;
    if (app.stage5.bossBroken) return false;  // 破綻後不盲
    if (app.stage5.blindPlaysRemaining <= 0) return false;
    if (!card) return false;
    if (app.hand.indexOf(card) < 0) return false;
    return true;  // 全手牌盲
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
      text("1", cx2+cw-14, cy2+19, 12, "#ffe080", "900", "center");
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
      text("速度 +2", app.w/2, cy2+ch-10, 11, "rgba(200,220,255,0.75)", "700", "center");
      // 說明文字與卡牌之間留空白
      const descY = cy2 + ch + 20;
      text("右上角的 ⚡ 是動力，打出每張牌都需要消耗動力。", app.w/2, descY, 13, "rgba(200,220,255,0.9)", "700", "center");
      text("這張加速牌需要消耗 1 點動力。", app.w/2, descY+22, 13, "rgba(180,200,255,0.75)", "700", "center");
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
        text("換道消耗 1 點動力。", safeX+tipW/2, tipY+44, 12, "rgba(200,200,160,0.75)", "700", "center");
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
    text("Final Driver — Prototype v0.5", cx, box.y+88, 12, "rgba(150,180,220,0.55)", "700", "center");
    const ctx = app.ctx;
    ctx.save(); ctx.strokeStyle="rgba(120,170,220,0.3)"; ctx.lineWidth=1; ctx.setLineDash([5,5]);
    ctx.beginPath(); ctx.moveTo(box.x+40,box.y+102); ctx.lineTo(box.x+box.w-40,box.y+102); ctx.stroke();
    ctx.setLineDash([]); ctx.restore();
    text("你是車隊領隊，透過打牌以指揮車手", cx, box.y+140, 16, "#e8f0ff", "700", "center");
    text("駕駛賽車超過前車。", cx, box.y+164, 16, "#e8f0ff", "700", "center");
    button("start-game", "開始遊戲", cx-110, box.y+202, 220, 48, false, "start");
    button("open-rules", "遊戲規則", cx-110, box.y+260, 220, 38, false, "primary");
    button("debug-jump-stage5", "▶ 跳到第五關（測試）", cx-110, box.y+312, 220, 36, false, "gray");
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
    const box = getCenteredModalBox(480, 220);
    drawModalPanel(box);
    const cx = box.x+box.w/2;
    text("手牌出完了！", cx, box.y+56, 22, "#dfeeff", "900", "center");
    const spd = currentLaneSpeed();
    text(`當前道速度：${spd} pts　對手：${app.opponentSpeed} pts`, cx, box.y+90, 15, "rgba(200,220,255,0.8)", "700", "center");
    const canOv = canDirectOvertake() || shouldForceQTE();
    button("prompt-overtake", shouldForceQTE()?"⚡ QTE 超車":canOv?"✓ 超車":"超車（速度不足）",
      box.x+40, box.y+130, 180, 48, !canOv && !shouldForceQTE());
    button("prompt-pass", "Pass →", box.x+260, box.y+130, 180, 48, false, "gray");
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
    text("全關卡完成！", app.w/2, app.h*0.38, 56, "#ffd94f", "1000", "center");
    text("Final Driver Prototype v0.5", app.w/2, app.h*0.52, 20, "rgba(200,220,255,0.8)", "700", "center");
    button("replay", "再玩一次", app.w/2-110, app.h*0.62, 220, 52, false, "start");
  }

  // ─── 第五關繪製 ────────────────────────────────────────────────────────────
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

  // 沙塵粒子層（沿用 Sam 風格，密度依賽道 sandLevel）
  function drawStage5SandOverlay(time) {
    const circ = currentCircuit();
    if (!circ) return;
    const ctx = app.ctx;
    const w = app.w, h = app.h;
    const lvl = circ.sandLevel || 1;
    // 各等級的線條數量 / 透明度（Sam 沙暴版基線 = 滿級 78 條，按等級遞減）
    const params = {
      1: { count: 22, vignette: 0 },
      2: { count: 40, vignette: 0.08 },
      3: { count: 56, vignette: 0.16 },
      4: { count: 78, vignette: 0.24 },
    }[lvl] || { count: 22, vignette: 0 };

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < params.count; i++) {
      const x = ((i * 97 + time * 0.16) % (w + 260)) - 180;
      const y = (i * 53 + time * 0.08) % h;
      const len = 70 + (i % 5) * 34;
      const a = 0.05 + (i % 4) * 0.018;
      ctx.strokeStyle = `rgba(255, 219, 139, ${a * 4})`;
      ctx.lineWidth = 1 + (i % 3);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y - 22);
      ctx.stroke();
    }
    ctx.restore();

    // 邊緣暈染（強級 / 滿級）
    if (params.vignette > 0) {
      const g = ctx.createRadialGradient(w * 0.5, h * 0.52, h * 0.08, w * 0.5, h * 0.5, h * 0.8);
      g.addColorStop(0, `rgba(255, 204, 115, ${params.vignette * 0.15})`);
      g.addColorStop(0.72, `rgba(166, 101, 42, ${params.vignette * 0.9})`);
      g.addColorStop(1, `rgba(8, 10, 12, ${params.vignette * 1.2})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // 第五關左側面板：當前對手 / 後車 / Boss 專注值 / 車隊牌
  function drawStage5SidePanel(time) {
    const s5 = app.stage5;
    if (!s5) return;
    const ctx = app.ctx;
    const x = 14;
    const y = 80;
    const w = 232;
    let curY = y;
    const panelH = 290 + (s5.teamCardsActive.length > 0 ? 22 + s5.teamCardsActive.length * 22 : 0);
    roundPanel(x, y, w, panelH, 12, "rgba(10,18,28,0.88)", "rgba(120,170,220,0.35)", 1.5);
    curY = y + 14;
    text("沙暴登頂", x + 12, curY + 12, 14, "rgba(255,220,120,0.85)", "900");
    curY += 28;
    // 名次陣容
    text("名次：", x + 12, curY + 12, 11, "rgba(180,200,230,0.7)", "700");
    curY += 20;
    drawRankLineup(x + 12, curY, w - 24, s5);
    curY += 56;  // 名次格 (24) + 名次數字 (16) + 上下間距
    // 當前對手
    const opp = currentOpponent();
    if (opp) {
      const isBoss = opp.id === "BOSS";
      text(isBoss ? "▼ 對手（Boss）" : "▼ 前方對手", x + 12, curY + 10, 11, "rgba(255,140,140,0.85)", "800");
      curY += 16;
      text(opp.name, x + 12, curY + 14, 16, isBoss ? "#ffb070" : "#ffd0a0", "900");
      curY += 18;
      text(`速度 ${opp.speed}`, x + 12, curY + 12, 12, "rgba(220,230,255,0.8)", "700");
      curY += 18;
      // flavor
      text(opp.flavor || "", x + 12, curY + 12, 10, "rgba(180,200,230,0.65)", "600");
      curY += 18;
    }
    // 後車
    const chaser = currentChaser();
    if (chaser) {
      curY += 4;
      text("▲ 後車", x + 12, curY + 10, 11, "rgba(140,180,255,0.85)", "800");
      curY += 16;
      text(`${chaser.name}（速度 ${chaser.chaserSpeed}）`, x + 12, curY + 12, 12, "rgba(200,220,255,0.85)", "700");
      curY += 22;
    }
    // Boss 專注值
    if (s5.bossStage) {
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
      curY += 6;
      text("✦ 場上車隊牌：", x + 12, curY + 10, 11, "rgba(150,220,180,0.85)", "800");
      curY += 16;
      // 重設 hover rects 然後逐張畫
      s5._teamCardRects = [];
      for (const c of s5.teamCardsActive) {
        const itemY = curY;
        const itemRect = { x: x + 12, y: itemY, w: w - 24, h: 18, card: c };
        s5._teamCardRects.push(itemRect);
        // hover 高亮
        const isHover = app.mouse && inRect(app.mouse, itemRect);
        if (isHover) {
          ctx.fillStyle = "rgba(120,220,160,0.18)";
          ctx.fillRect(itemRect.x - 2, itemRect.y - 1, itemRect.w + 4, itemRect.h);
        }
        text(`• ${c.name}`, x + 14, curY + 12, 11, isHover ? "#dcf7e2" : "#cfe3d4", "700");
        curY += 18;
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
    text(`COST ${c.cost}`, tipX + tipW - 14, tipY + 22, 11, "#9fe0c0", "800", "right");
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
  function drawRankLineup(x, y, w, s5) {
    const ctx = app.ctx;
    // 從第 1 名到第 5 名：左到右
    const total = 5;
    const cellW = (w - (total-1)*4) / total;
    const playerRank = app.rank;

    // 先畫上方名次數字 1~5
    for (let pos = 1; pos <= total; pos++) {
      const cx = x + (pos-1) * (cellW + 4) + cellW/2;
      text(`${pos}`, cx, y + 11, 11, "rgba(150,170,200,0.7)", "800", "center");
    }

    // 再畫名次格
    for (let pos = 1; pos <= total; pos++) {
      const cx = x + (pos-1) * (cellW + 4);
      const cellY = y + 16;
      const isPlayer = (pos === playerRank);
      let label = "";
      let color = "rgba(80,100,130,0.7)";
      if (isPlayer) {
        label = "你";
        color = "#7be0a0";
      } else if (pos < playerRank) {
        // 前方：第 1 名一定是 boss（如果還在）；其餘從 ahead 排
        const aheadNonBoss = s5.ahead.filter(id => id !== "BOSS");
        const aheadHasBoss = s5.ahead.includes("BOSS");
        if (pos === 1 && aheadHasBoss) {
          label = "Boss";
          color = "#ff8060";
        } else {
          // 第 pos 名（前方非 Boss）
          // 若 boss 仍在前方：第 1 名 = boss，第 2~playerRank-1 名 = aheadNonBoss
          // 若 boss 不在：第 1~playerRank-1 名 = aheadNonBoss（不應發生：boss 不在表示玩家在 boss 戰中）
          const startIdx = aheadHasBoss ? 2 : 1;
          const idx = pos - startIdx;
          if (idx >= 0 && idx < aheadNonBoss.length) {
            label = STAGE5_OPPONENTS[aheadNonBoss[idx]]?.name?.[0] || aheadNonBoss[idx];
            color = "#ffb070";
          } else {
            label = "?"; color = "rgba(180,140,80,0.5)";
          }
        }
      } else if (pos > playerRank) {
        // 後方：已被超過的
        const idx = pos - playerRank - 1;
        if (idx >= 0 && idx < s5.passed.length) {
          label = STAGE5_OPPONENTS[s5.passed[idx]]?.name?.[0] || s5.passed[idx];
          color = "rgba(140,180,220,0.85)";
        } else {
          label = "-"; color = "rgba(80,100,130,0.4)";
        }
      }
      ctx.fillStyle = isPlayer ? "rgba(60,100,80,0.45)" : "rgba(40,55,80,0.45)";
      ctx.fillRect(cx, cellY, cellW, 24);
      ctx.strokeStyle = color;
      ctx.lineWidth = isPlayer ? 2 : 1;
      ctx.strokeRect(cx + 0.5, cellY + 0.5, cellW - 1, 23);
      // 字體：玩家「你」是大字，其他顯示縮寫
      const fontSize = label.length > 2 ? 9 : 11;
      text(label, cx + cellW/2, cellY + 16, fontSize, color, "800", "center");
    }
  }

  // 右上角：下一賽段預告
  function drawStage5NextCircuit(time) {
    const s5 = app.stage5;
    if (!s5) return;
    const cur = currentCircuit();
    const next = nextCircuit();
    const ctx = app.ctx;
    const w = 220;
    const h = 92;
    const x = app.w - w - 14;
    const y = 80;
    roundPanel(x, y, w, h, 12, "rgba(10,18,28,0.88)", "rgba(120,170,220,0.35)", 1.5);
    // 當前
    if (cur) {
      text("當前賽段", x + 12, y + 18, 10, "rgba(180,200,230,0.65)", "700");
      text(`${cur.icon} ${cur.name}`, x + 12, y + 38, 14, "#dfeeff", "900");
      // sand level
      const sandStr = "▮".repeat(cur.sandLevel) + "▯".repeat(4 - cur.sandLevel);
      text(`沙暴 ${sandStr}`, x + 12, y + 54, 10, "#ffd28a", "700");
    }
    // 下一
    if (next) {
      const ny = y + 64;
      text("→ 下一賽段：", x + 12, ny + 10, 10, "rgba(180,200,230,0.6)", "700");
      text(`${next.icon} ${next.name}`, x + 110, ny + 10, 11, "rgba(220,210,255,0.9)", "800");
    } else if (s5.bossStage) {
      text("⚠ Boss 戰", x + 12, y + 78, 12, "#ff9a6a", "900");
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
    const page = s5.tutorialPage;

    // 先畫底層場景（含沙暴），確保 spotlight 可以指實際 UI
    drawRace(time);
    drawHud(time);
    drawStage5SandOverlay(time);
    drawStage5SidePanel(time);
    drawStage5NextCircuit(time);
    drawHand(time);

    // 各頁 spotlight 區 + 文字
    const pages = [
      {
        zone: { x: 8, y: 74, w: 244, h: 360 },
        title: "這是你的名次",
        lines: [
          "玩家從第 5 名起，前方有 3 名對手 + 1 位 Boss。",
          "成功超車 → 名次 +1；防守失敗 → 名次 -1。",
          "Boss 永遠在第 1 名，需要爭到第 2 名才會遇到。",
        ],
      },
      {
        zone: { x: app.w - 234, y: 74, w: 220, h: 100 },
        title: "賽道會循環變化",
        lines: [
          "每回合結束自動切到下一段賽道。",
          "右上角預告下一段是什麼。",
          "賽段：3 道 → 1 道 → 彎道 → 3 道（沙暴猛烈）→ 循環。",
        ],
      },
      {
        zone: { x: app.w - 234, y: app.h - 200, w: 220, h: 186 },
        title: "右下：動力 / 速度",
        lines: [
          "動力（黃格）：打牌會消耗，每回合刷新。",
          "基礎速度：本回合打牌累積的速度。",
          "對手速度：超車門檻 — 你必須嚴格 > 它才能超車。",
        ],
      },
      {
        zone: { x: 14, y: app.h - 200, w: app.w - 28 - 252, h: 186 },
        title: "兩種牌：指令 vs 車隊",
        lines: [
          "指令牌（藍框）：打出即生效，加速度，打完消失。",
          "車隊牌（綠框）：打出留場、持續生效，效果見牌面。",
          "達到對手速度後，超車按鈕才會亮 — 然後決定超車 / Pass。",
        ],
      },
    ];

    const cur = pages[page] || pages[0];
    const z = cur.zone;

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

    // spotlight 邊框（橘色 pulse）
    const pulse = 0.5 + Math.sin(time * 0.005) * 0.5;
    ctx.save();
    ctx.strokeStyle = "rgba(255,200,80," + (0.65 + pulse * 0.35) + ")";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    ctx.rect(z.x, z.y, z.w, z.h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 教學文字面板（盡量不擋 spotlight）
    const boxW = 540, boxH = 200;
    // 預設放中央上方；如果 spotlight 在上方則放下方
    let boxX = app.w/2 - boxW/2;
    let boxY = (z.y < app.h/2) ? (app.h - boxH - 30) : 30;
    roundPanel(boxX, boxY, boxW, boxH, 12, "rgba(6,14,28,0.97)", "rgba(255,200,80,0.5)", 2);
    text("關卡 5：沙暴登頂", boxX + boxW/2, boxY + 26, 14, "rgba(255,200,60,0.85)", "800", "center");
    text(cur.title, boxX + boxW/2, boxY + 56, 22, "#ffd980", "1000", "center");
    let ly = boxY + 90;
    for (const line of cur.lines) {
      text(line, boxX + boxW/2, ly, 13, "#e8f0ff", "700", "center");
      ly += 22;
    }
    // 頁碼
    text((page+1) + " / " + pages.length, boxX + 24, boxY + boxH - 20, 11, "rgba(180,200,230,0.7)", "700", "left");
    // 按鈕：下一頁 / 出發
    if (page < pages.length - 1) {
      button("stage5-intro-next", "下一頁 →", boxX + boxW - 184, boxY + boxH - 44, 160, 36, false, "primary");
    } else {
      button("stage5-intro-ok", "出發", boxX + boxW - 184, boxY + boxH - 44, 160, 36, false, "start");
    }
  }

  // 超車成功結算（進三選一前的短畫面）
  function drawStage5OvertakeResultModal() {
    const box = getCenteredModalBox(420, 220);
    drawModalPanel(box, "rgba(120,220,150,0.5)");
    const cx = box.x + box.w/2;
    text("超車成功！", cx, box.y + 70, 32, "#7be0a0", "1000", "center");
    const opp = STAGE5_OPPONENTS[app.stage5?.passed[app.stage5.passed.length-1]];
    if (opp) text(`超越了「${opp.name}」`, cx, box.y + 106, 14, "rgba(220,240,225,0.85)", "700", "center");
    text(`名次：${app.rank} / 5`, cx, box.y + 132, 14, "rgba(220,240,225,0.85)", "700", "center");
    button("stage5-to-reward", "選擇獎勵牌 →", cx - 110, box.y + box.h - 60, 220, 44, false, "start");
  }

  // 未超車結算
  function drawStage5NoOvertakeModal() {
    const box = getCenteredModalBox(420, 180);
    drawModalPanel(box, "rgba(200,180,120,0.4)");
    const cx = box.x + box.w/2;
    text("未超車", cx, box.y + 70, 28, "#ffd94f", "900", "center");
    text("這回合沒能超過去", cx, box.y + 104, 13, "rgba(220,220,200,0.75)", "700", "center");
    button("stage5-next-round", "下一回合 →", cx - 100, box.y + box.h - 56, 200, 42, false, "primary");
  }

  // 防守結算
  function drawStage5DefenseResultModal() {
    const success = app.message === "防守成功！" || app.message === "後援車隊保住名次！";
    const box = getCenteredModalBox(420, 200);
    drawModalPanel(box, success ? "rgba(120,220,150,0.5)" : "rgba(255,120,120,0.5)");
    const cx = box.x + box.w/2;
    text(app.message || "防守結束", cx, box.y + 70, 26, success ? "#7be0a0" : "#ff8a8a", "900", "center");
    text(`名次：${app.rank} / 5`, cx, box.y + 110, 14, "rgba(220,240,225,0.85)", "700", "center");
    button("stage5-next-round", "下一回合 →", cx - 100, box.y + box.h - 56, 200, 42, false, success ? "start" : "primary");
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
      // cost
      text(`COST ${c.cost}`, cx0 + cardW/2, cardY + 88, 11, "#5a4a30", "800", "center");
      // 效果
      const lines = wrapTextLines(c.note || "", cardW - 24, 11);
      let ly = cardY + 128;
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

    for (let i=0;i<5;i++) {
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
      if (pos) { x=pos[i].x; y=pos[i].y; }
      else { const gap2=Math.min(130,app.w*0.085); x=app.w/2-gap2*2+i*gap2; y=app.h*0.44; }
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
      if (shouldForceQTE()) return { mood:"sweat", label:"對撞！" };
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
