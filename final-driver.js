function initQteTest() {
  const root = document.querySelector("#qteTestRoot");
  const btn = document.querySelector("#qteTestButton");
  if (btn) btn.addEventListener("click", () => { window.location.href = "qte-test.html"; });
  if (root) CanvasQteTest.start(root);
}

const CanvasQteTest = (() => {
  /**
   * QTE TEST 狀態流（簡化字串 mode，對應說明）：
   * start-ready（準備起跑）→ 按「開始遊戲」→ tutorial-play, tutorial-stable, overtake-ready
   *   手牌：橫列略抬高，可與賽道重疊（不打 QTE 時）。
   * OVERTAKE_QTE_INTRO / OVERTAKE_QTE → splash-overtake, rhythm-formal
   *   手牌：僅 rhythm-* 時右下角小扇形（不註冊點擊區）；節奏判定為 |點擊時間−拍點| 秒誤差。
   * OVERTAKE_RESULT → result + resultFromOvertake
   * SECOND_CARD_PLAY_PHASE → round2-cards
   * DEFENSE_QTE_INTRO / DEFENSE_QTE → splash-defense, defense
   * DEFENSE_RESULT → defense-result
   * LAP_RESULT → lap-result
   * CARD_REWARD_CHOICE / toast → card-reward-choice, card-reward-toast
   * FINAL_RESULT → final-win
   */
  const OVERTAKE_TARGET = 8;
  const NORMAL_STAGE_BGM_SRC = "assets/BGM/001.mp3";
  const BLIND_DESERT_CG_SRC = "assets/blind-card-desert-boss.png";
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
  const normalBgm = new Audio(NORMAL_STAGE_BGM_SRC);
  normalBgm.loop = true;
  normalBgm.preload = "auto";
  normalBgm.volume = 0.58;
  const bossBgm = new Audio(BLIND_DESERT_BGM_SRC);
  bossBgm.loop = true;
  bossBgm.preload = "auto";
  bossBgm.volume = 0.72;
  bindBgmLoopFallback(normalBgm);
  bindBgmLoopFallback(bossBgm);
  /** 加速條滿刻度（數值仍可超過門檻與滿格） */
  const ACCEL_METER_DISPLAY_MAX = 10;
  const CARD_TYPES = {
    accel: { type: "accel", name: "加速", value: "+2", note: "" },
    throttle: { type: "throttle", name: "踩下油門", value: "", note: "本回合加速 +1" },
    hyper_accel: { type: "hyper_accel", name: "超加速", value: "+3", note: "" },
    mistake: { type: "mistake", name: "失誤", value: "+0", note: "" },
    reward_buff: { type: "reward_buff", name: "", value: "", note: "" },
  };

  const COMMON_REWARD_BLUEPRINTS = [
    { rewardId: "hyper_accel", type: "hyper_accel", name: "超加速", category: "速度", rarity: "普通", effect: "+3 速度", value: "+3", note: "" },
    { rewardId: "rhythm_preview", type: "reward_buff", name: "節奏預判", category: "超車 QTE", rarity: "普通", effect: "最後 1 顆圓圈變慢；Perfect 區 +25%", value: "", note: "" },
    { rewardId: "stable_chassis", type: "reward_buff", name: "穩定底盤", category: "防守 QTE", rarity: "普通", effect: "綠區變寬、紅區變窄", value: "", note: "" },
  ];
  const RARE_REWARD_BLUEPRINTS = [
    { rewardId: "fuel_boost", type: "throttle", name: "踩下油門", category: "強化", rarity: "稀有", effect: "本回合所有加速牌 +1 速度", value: "", note: "本回合加速 +1" },
    { rewardId: "burst_tap", type: "reward_buff", name: "爆發踩點", category: "超車 QTE", rarity: "稀有", effect: "每次 Perfect 額外推進超車目標", value: "", note: "" },
    { rewardId: "precision_steer", type: "reward_buff", name: "精準轉向", category: "防守 QTE", rarity: "稀有", effect: "防守指標晃動幅度降低", value: "", note: "" },
    { rewardId: "focus_mode", type: "reward_buff", name: "專注模式", category: "通用 QTE", rarity: "稀有", effect: "本回合所有 QTE 節奏變慢 15%", value: "", note: "" },
    { rewardId: "pressure_response", type: "reward_buff", name: "壓力反應", category: "通用 QTE", rarity: "稀有", effect: "若上一拍 Miss，下一拍判定區大幅放寬", value: "", note: "" },
  ];

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function rollRewardOptions() {
    const rare = { ...RARE_REWARD_BLUEPRINTS[(Math.random() * RARE_REWARD_BLUEPRINTS.length) | 0] };
    const commons = [...COMMON_REWARD_BLUEPRINTS];
    const i0 = (Math.random() * commons.length) | 0;
    const c0 = { ...commons.splice(i0, 1)[0] };
    const c1 = { ...commons[(Math.random() * commons.length) | 0] };
    const pair = shuffleInPlace([c0, c1]);
    return [pair[0], pair[1], rare];
  }

  function refreshDeckPerks() {
    app.perkRhythmLast = 0;
    app.perkChassis = 0;
    app.perkBurst = 0;
    app.perkPrecision = 0;
    app.perkFocus = 0;
    app.perkPressure = 0;
    for (const c of app.deck) {
      const id = c.rewardId;
      if (!id) continue;
      if (id === "rhythm_preview") app.perkRhythmLast++;
      else if (id === "stable_chassis") app.perkChassis++;
      else if (id === "burst_tap") app.perkBurst++;
      else if (id === "precision_steer") app.perkPrecision++;
      else if (id === "focus_mode") app.perkFocus++;
      else if (id === "pressure_response") app.perkPressure++;
    }
  }

  function getRhythmDuration(circleIndex) {
    let dur = RHYTHM_DURATIONS[circleIndex];
    dur *= 1 + 0.15 * app.perkFocus;
    if (circleIndex === 4 && app.perkRhythmLast) dur *= 1 + 0.24 * app.perkRhythmLast;
    return Math.round(dur);
  }

  function effectiveOvertakeTarget() {
    return Math.max(5, OVERTAKE_TARGET - app.burstTargetReduction);
  }

  const app = {
    root: null,
    canvas: null,
    ctx: null,
    dpr: 1,
    w: 1280,
    h: 720,
    mode: "start-ready",
    bossStage: false,
    bossStageName: "",
    bossBlindPlaysRemaining: 0,
    bossBgmPending: false,
    normalBgmPending: false,
    bossHpMax: 3,
    bossHp: 3,
    bossHitFx: null,
    bossTransitionStart: 0,
    bossTransitionSetup: false,
    bossTransitionBgmStarted: false,
    hand: [],
    deck: [],
    played: [],
    stable: [],
    drag: null,
    mouse: { x: 0, y: 0 },
    zones: {},
    tutorialAck: {},
    qteStart: 0,
    qteCircleStarts: [],
    qteClicked: new Set(),
    qteResults: {},
    qteDismissAt: {},
    defenseStart: 0,
    defenseProgress: 0,
    safeCenter: 50,
    safeTarget: 50,
    nextSafeShift: 0,
    message: "",
    backdropCanvas: null,
    bossCgReady: false,
    lapIndex: 1,
    rank: 5,
    rankTotal: 5,
    winOverlay: null,
    winReplayTimer: 0,
    qteScatterPos: null,
    qteTapPending: {},
    qteFinalized: {},
    qteResolveAt: 0,
    qtesSinceReward: 0,
    winAfterOvertake: false,
    resultFromOvertake: false,
    defenseRound: 0,
    defenseSucceeded: false,
    carriedAcceleration: 0,
    rewardOptions: [],
    rewardHoverSlot: -1,
    rewardPickAnim: null,
    rewardToastUntil: 0,
    seenRewardTutorial: false,
    seenMistakeTutorial: false,
    seenOvertakeQteTutorial: false,
    seenDefenseQteTutorial: false,
    qteTeachPage: 0,
    handDealSeq: 0,
    deckRemainingCount: 0,
    deckSeq: 0,
    perkRhythmLast: 0,
    perkChassis: 0,
    perkBurst: 0,
    perkPrecision: 0,
    perkFocus: 0,
    perkPressure: 0,
    burstPerfectsThisRhythm: 0,
    burstTargetReduction: 0,
    pressureWideBand: false,
    lastRhythmHadMiss: false,
    carMotion: null,
  };

  const CARD_SURFACE_MODES = ["tutorial-play", "tutorial-stable", "tutorial-mistake", "overtake-ready", "round2-cards"];
  const CARD_PLAY_MODES = ["tutorial-play", "tutorial-stable", "round2-cards"];
  const TEACHING_OVERLAY_MODES = ["tutorial-mistake", "overtake-ready", "tutorial-overtake-qte", "tutorial-defense-qte"];
  const CARD_TUTORIAL_TOTAL = 3;
  const QTE_TUTORIAL_TOTAL = 2;
  const TEACHING_TOTAL = CARD_TUTORIAL_TOTAL + QTE_TUTORIAL_TOTAL;

  function teachingPageNumber() {
    if (app.mode === "tutorial-stable") return 2;
    if (app.mode === "tutorial-mistake") return 3;
    if (app.mode === "tutorial-overtake-qte") return 4;
    if (app.mode === "tutorial-defense-qte") return 5;
    return 1;
  }

  function teachingPageText() {
    return `${teachingPageNumber()}/${TEACHING_TOTAL}`;
  }

  function isRhythmMode() {
    return app.mode === "rhythm-formal";
  }

  function isTeachingOverlayMode() {
    return tutorialBlocking() || TEACHING_OVERLAY_MODES.includes(app.mode);
  }

  function isCardPlayMode() {
    return CARD_PLAY_MODES.includes(app.mode);
  }

  function statusHudRect() {
    return { x: app.w - 312, y: 24, w: 288, h: 214 };
  }

  function cardTableVisible() {
    return app.mode === "start-ready" || CARD_SURFACE_MODES.includes(app.mode);
  }

  /** 穩定區拖放與繪製僅在此後出現（教學出牌段不顯示） */
  function stabilityDropVisible() {
    return app.mode === "tutorial-stable" || app.mode === "tutorial-mistake" || app.mode === "overtake-ready" || app.mode === "round2-cards";
  }

  const RHYTHM_DURATIONS = [1150, 1150, 1150, 1150, 1800];

  /** 節奏判定：與拍點時間差（秒），osu! 式絕對誤差（第二圈起正式難度） */
  const RHYTHM_BEAT_ERROR_PERFECT = 0.05;
  const RHYTHM_BEAT_ERROR_GOOD = 0.12;
  /** 正式超車 QTE：判定極寬（幾乎在收合視窗內點到就有） */
  const RHYTHM_FORMAL_EASY_PERFECT_SEC = 0.42;
  const RHYTHM_FORMAL_EASY_GOOD_SEC = 0.72;
  /** 散佈圖：圓心最小距離須大於兩倍點擊半徑，避免重疊誤判 */
  const RHYTHM_SCATTER_MIN_CENTER_DIST = 132;
  /** 節奏圈外框（點擊判定＝外框內，與縮小內圈無關） */
  const RHYTHM_OUTER_R = 48;
  const RHYTHM_UI_AVOID_PAD = 24;

  function start(root) {
    app.root = root;
    document.body.classList.add("qte-active", "qte-canvas-only");
    root.classList.remove("hidden");
    root.innerHTML = `<canvas class="qte-full-canvas" aria-label="QTE TEST Canvas"></canvas>
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
        if (e.target.closest("#qteWinReplay")) {
          hideGameWinOverlay();
          reset();
        }
      });
    }
    setupInput();
    bossCgImage.onload = () => {
      app.bossCgReady = true;
    };
    reset();
    if (new URLSearchParams(window.location.search).get("boss") === "blind-desert") {
      startBlindDesertBoss();
    }
    requestAnimationFrame(loop);
  }

  function dealFiveFromDeck() {
    app.hand = [];
    if (!app.deck.length) return;
    app.handDealSeq++;
    const pool = shuffleInPlace([...app.deck]);
    const drawCount = Math.min(5, pool.length);
    app.deckRemainingCount = Math.max(0, app.deck.length - drawCount);
    for (let i = 0; i < drawCount; i++) {
      const src = pool[i];
      app.hand.push({ ...src, id: `${src.id}-d${app.handDealSeq}-${i}`, blind: !!src.blind, revealed: false });
    }
  }

  function dealTutorialOpeningHand() {
    app.hand = [];
    app.handDealSeq++;
    app.deckRemainingCount = Math.max(0, app.deck.length - 5);
    for (let i = 0; i < 5; i++) {
      app.hand.push({ ...CARD_TYPES.accel, id: `tutorial-accel-${app.handDealSeq}-${i}` });
    }
  }

  function dealFirstDefenseHand() {
    app.hand = [];
    app.handDealSeq++;
    app.deckRemainingCount = Math.max(0, app.deck.length - 5);
    for (let i = 0; i < 3; i++) {
      app.hand.push({ ...CARD_TYPES.accel, id: `defense-accel-${app.handDealSeq}-${i}` });
    }
    for (let i = 0; i < 2; i++) {
      app.hand.push({ ...CARD_TYPES.mistake, id: `defense-mistake-${app.handDealSeq}-${i}` });
    }
  }

  function dealBlindDesertHand() {
    app.hand = [
      { ...CARD_TYPES.accel, id: `blind-accel-${app.handDealSeq}-0`, revealed: false },
      { ...CARD_TYPES.throttle, id: `blind-throttle-${app.handDealSeq}-1`, revealed: false },
      { ...CARD_TYPES.hyper_accel, id: `blind-hyper-${app.handDealSeq}-2`, revealed: false },
      { ...CARD_TYPES.mistake, id: `blind-mistake-${app.handDealSeq}-3`, revealed: false },
      { ...CARD_TYPES.accel, id: `blind-accel-${app.handDealSeq}-4`, revealed: false },
    ];
    app.bossBlindPlaysRemaining = 2;
    app.deckRemainingCount = Math.max(0, app.deck.length - app.hand.length);
  }

  function reset() {
    app.deck = [
      ...Array.from({ length: 8 }, (_, i) => makeCard("accel", i)),
      ...Array.from({ length: 2 }, (_, i) => makeCard("mistake", i)),
    ];
    app.handDealSeq = 0;
    app.deckRemainingCount = 0;
    app.deckSeq = 0;
    dealTutorialOpeningHand();
    app.played = [];
    app.stable = [];
    app.mode = "start-ready";
    app.bossStage = false;
    app.bossStageName = "";
    app.bossBlindPlaysRemaining = 0;
    app.bossBgmPending = false;
    app.normalBgmPending = false;
    app.bossHpMax = 3;
    app.bossHp = 3;
    app.bossHitFx = null;
    app.bossTransitionStart = 0;
    app.bossTransitionSetup = false;
    app.bossTransitionBgmStarted = false;
    stopBossBgm();
    stopNormalBgm();
    app.drag = null;
    app.tutorialAck = {};
    app.qteClicked = new Set();
    app.qteResults = {};
    app.qteDismissAt = {};
    app.defenseProgress = 0;
    app.message = "";
    app.lapIndex = 1;
    app.rank = 5;
    app.rankTotal = 5;
    app.qteScatterPos = null;
    app.qteTapPending = {};
    app.qteFinalized = {};
    app.qteResolveAt = 0;
    app.qtesSinceReward = 0;
    app.winAfterOvertake = false;
    app.resultFromOvertake = false;
    app.defenseRound = 0;
    app.defenseSucceeded = false;
    app.carriedAcceleration = 0;
    app.rewardOptions = [];
    app.rewardHoverSlot = -1;
    app.rewardPickAnim = null;
    app.rewardToastUntil = 0;
    app.seenRewardTutorial = false;
    app.seenMistakeTutorial = false;
    app.seenOvertakeQteTutorial = false;
    app.seenDefenseQteTutorial = false;
    app.qteTeachPage = 0;
    app.burstPerfectsThisRhythm = 0;
    app.burstTargetReduction = 0;
    app.pressureWideBand = false;
    app.lastRhythmHadMiss = false;
    app.carMotion = createCarMotion();
    refreshDeckPerks();
    hideGameWinOverlay();
  }

  function configureBlindDesertBoss(nextMode) {
    app.deck = [
      ...Array.from({ length: 6 }, (_, i) => makeCard("accel", `boss-${i}`)),
      ...Array.from({ length: 2 }, (_, i) => makeCard("hyper_accel", `boss-${i}`)),
      ...Array.from({ length: 2 }, (_, i) => makeCard("throttle", `boss-${i}`)),
      ...Array.from({ length: 2 }, (_, i) => makeCard("mistake", `boss-${i}`)),
    ];
    app.handDealSeq += 1;
    app.bossStage = true;
    app.bossStageName = "盲牌沙漠";
    app.bossHpMax = 3;
    app.bossHp = app.bossHpMax;
    app.bossHitFx = null;
    app.mode = nextMode;
    app.played = [];
    app.stable = [];
    app.drag = null;
    app.tutorialAck = {};
    app.qteClicked = new Set();
    app.qteResults = {};
    app.qteDismissAt = {};
    app.qteTapPending = {};
    app.qteFinalized = {};
    app.qteResolveAt = 0;
    app.qtesSinceReward = 0;
    app.lapIndex = 2;
    app.rank = 2;
    app.rankTotal = 5;
    app.winAfterOvertake = false;
    app.resultFromOvertake = false;
    app.defenseRound = 1;
    app.defenseSucceeded = false;
    app.carriedAcceleration = 0;
    app.rewardOptions = [];
    app.rewardHoverSlot = -1;
    app.rewardPickAnim = null;
    app.rewardToastUntil = 0;
    app.seenRewardTutorial = true;
    app.seenMistakeTutorial = true;
    app.seenOvertakeQteTutorial = true;
    app.seenDefenseQteTutorial = true;
    app.qteTeachPage = 0;
    app.burstPerfectsThisRhythm = 0;
    app.burstTargetReduction = 0;
    app.pressureWideBand = false;
    app.lastRhythmHadMiss = false;
    app.carMotion = createCarMotion();
    dealBlindDesertHand();
    refreshDeckPerks();
  }

  function startBlindDesertBoss() {
    hideGameWinOverlay();
    stopNormalBgm();
    configureBlindDesertBoss("boss-intro");
    playBossBgm();
  }

  function startBossStageTransition() {
    app.winAfterOvertake = false;
    app.mode = "boss-transition";
    app.bossTransitionStart = performance.now();
    app.bossTransitionSetup = false;
    app.bossTransitionBgmStarted = false;
    app.drag = null;
    primeBossBgmMuted();
  }

  function playNormalBgm() {
    if (app.bossStage) return;
    normalBgm.volume = 0.58;
    normalBgm.loop = true;
    const promise = normalBgm.play();
    if (promise && typeof promise.catch === "function") {
      promise
        .then(() => {
          app.normalBgmPending = false;
        })
        .catch(() => {
          app.normalBgmPending = true;
        });
    }
  }

  function bindBgmLoopFallback(audio) {
    audio.addEventListener("ended", () => {
      if (audio.loop) {
        audio.currentTime = 0;
        const promise = audio.play();
        if (promise && typeof promise.catch === "function") promise.catch(() => {});
      }
    });
  }

  function stopNormalBgm() {
    normalBgm.pause();
    normalBgm.currentTime = 0;
  }

  function playBossBgm() {
    stopNormalBgm();
    bossBgm.volume = 0.72;
    bossBgm.loop = true;
    const promise = bossBgm.play();
    if (promise && typeof promise.catch === "function") {
      promise
        .then(() => {
          app.bossBgmPending = false;
        })
        .catch(() => {
          app.bossBgmPending = true;
        });
    }
  }

  function primeBossBgmMuted() {
    stopNormalBgm();
    bossBgm.volume = 0;
    bossBgm.loop = true;
    const promise = bossBgm.play();
    if (promise && typeof promise.catch === "function") {
      promise
        .then(() => {
          app.bossBgmPending = false;
        })
        .catch(() => {
          app.bossBgmPending = true;
        });
    }
  }

  function revealBossTransitionBgm() {
    if (app.bossTransitionBgmStarted) return;
    app.bossTransitionBgmStarted = true;
    bossBgm.volume = 0.72;
    if (bossBgm.paused || app.bossBgmPending) playBossBgm();
  }

  function stopBossBgm() {
    bossBgm.pause();
    bossBgm.currentTime = 0;
  }

  function createCarMotion() {
    const make = (speedMin, speedMax) => ({
      speed: speedMin + Math.random() * (speedMax - speedMin),
      phase: Math.random() * Math.PI * 2,
    });
    return {
      red: make(0.00045, 0.00105),
      white: make(0.00035, 0.0009),
    };
  }

  function roadLaneBoundsAt(y) {
    const horizon = app.h * 0.38;
    const t = Math.max(0, Math.min(1, (y - horizon) / (app.h - horizon)));
    return {
      left: app.w * (0.45 + (0.08 - 0.45) * t),
      right: app.w * (0.55 + (0.92 - 0.55) * t),
    };
  }

  function carLaneX(kind, time, y, carW) {
    const motion = app.carMotion && app.carMotion[kind];
    const lane = roadLaneBoundsAt(y);
    const sidePad = carW * 0.5 + 6;
    const minX = lane.left + sidePad;
    const maxX = lane.right - sidePad;
    if (maxX <= minX) return (lane.left + lane.right) / 2;
    const center = (minX + maxX) / 2;
    const halfRange = (maxX - minX) / 2;
    if (!motion) return center;
    return center + Math.sin(time * motion.speed + motion.phase) * halfRange;
  }

  function hideGameWinOverlay() {
    if (!app.winOverlay) return;
    if (app.winReplayTimer) {
      clearTimeout(app.winReplayTimer);
      app.winReplayTimer = 0;
    }
    app.winOverlay.classList.remove("qte-win-overlay--visible", "qte-win-overlay--replay-ready");
    app.winOverlay.classList.add("hidden");
    app.winOverlay.setAttribute("aria-hidden", "true");
  }

  function showGameWinOverlay() {
    if (!app.winOverlay) return;
    if (app.winOverlay.classList.contains("qte-win-overlay--visible")) return;
    if (app.winReplayTimer) {
      clearTimeout(app.winReplayTimer);
      app.winReplayTimer = 0;
    }
    app.winOverlay.classList.remove("qte-win-overlay--replay-ready");
    const ribbons = app.winOverlay.querySelector(".qte-win-ribbons");
    const sub = app.winOverlay.querySelector(".qte-win-sub");
    if (sub) sub.textContent = `本圈名次 ${app.rank}/${app.rankTotal}`;
    if (ribbons) {
      ribbons.innerHTML = "";
      for (let i = 0; i < 22; i++) {
        const r = document.createElement("div");
        r.className = "qte-win-ribbon";
        r.style.left = `${(i * 4.3 + Math.random() * 8) % 94}%`;
        r.style.animationDelay = `${0.04 + Math.random() * 0.9}s`;
        const rot = -38 + Math.random() * 76;
        const dx = -55 + Math.random() * 110;
        r.style.setProperty("--rot", `${rot}deg`);
        r.style.setProperty("--dx", `${dx}px`);
        ribbons.appendChild(r);
      }
    }
    app.winOverlay.classList.remove("hidden");
    app.winOverlay.setAttribute("aria-hidden", "false");
    void app.winOverlay.offsetWidth;
    app.winOverlay.classList.add("qte-win-overlay--visible");
    app.winReplayTimer = setTimeout(() => {
      app.winReplayTimer = 0;
      app.winOverlay.classList.add("qte-win-overlay--replay-ready");
    }, 2400);
  }

  function makeCard(type, id) {
    return { ...CARD_TYPES[type], id: `${type}-${id}` };
  }

  function loop(time) {
    resize();
    update(time);
    draw(time);
    requestAnimationFrame(loop);
  }

  function resize() {
    const rect = app.canvas.getBoundingClientRect();
    app.dpr = Math.min(2, window.devicePixelRatio || 1);
    app.w = rect.width || window.innerWidth;
    app.h = rect.height || window.innerHeight;
    const width = Math.max(1, Math.floor(app.w * app.dpr));
    const height = Math.max(1, Math.floor(app.h * app.dpr));
    if (app.canvas.width !== width || app.canvas.height !== height) {
      app.canvas.width = width;
      app.canvas.height = height;
    }
    app.ctx.setTransform(app.dpr, 0, 0, app.dpr, 0, 0);
  }

  function setupInput() {
    app.canvas.addEventListener("mousemove", e => {
      const p = point(e);
      app.mouse = p;
      if (app.mode === "card-reward-choice" && !app.rewardPickAnim) {
        app.rewardHoverSlot = hitRewardSlot(p);
      }
      if (app.drag) {
        app.drag.x = p.x - app.drag.dx;
        app.drag.y = p.y - app.drag.dy;
      }
    });

    function onCanvasPrimaryDown(e) {
      if (e.button != null && e.button !== 0) return;
      const p = point(e);
      app.mouse = p;
      if (app.mode === "card-reward-choice" && !app.rewardPickAnim) {
        const slot = hitRewardSlot(p);
        if (slot >= 0) {
          app.rewardPickAnim = { t0: performance.now(), slot };
          return;
        }
      }
      const hit = hitButton(p);
      if (hit) {
        handleButton(hit);
        return;
      }
      if (isRhythmMode()) {
        hitCircle(p);
        return;
      }
      if (!canDragCards()) return;
      const cardHit = [...(app.zones.cards || [])].reverse().find(item => inRect(p, item.rect));
      if (!cardHit) return;
      app.drag = {
        card: cardHit.card,
        from: cardHit.index,
        x: cardHit.rect.x,
        y: cardHit.rect.y,
        w: cardHit.rect.w,
        h: cardHit.rect.h,
        dx: p.x - cardHit.rect.x,
        dy: p.y - cardHit.rect.y,
      };
    }

    app.canvas.addEventListener("mousedown", onCanvasPrimaryDown);
    app.canvas.addEventListener(
      "touchstart",
      e => {
        if (e.touches.length !== 1) return;
        e.preventDefault();
        onCanvasPrimaryDown(e);
      },
      { passive: false }
    );

    app.canvas.addEventListener("mouseup", e => {
      if (!app.drag) return;
      const p = point(e);
      const stableDrop = app.zones.stableHit || app.zones.stable;
      const target = inRect(p, app.zones.play) ? "play" : inRect(p, stableDrop) ? "stable" : "";
      if (target && !dropDisabled(target)) {
        const [card] = app.hand.splice(app.drag.from, 1);
        if (app.bossStage && app.bossBlindPlaysRemaining > 0) {
          card.revealed = true;
          app.bossBlindPlaysRemaining -= 1;
        }
        if (target === "play") app.played.push(card);
        if (target === "stable") app.stable.push(card);
        advanceCards();
      }
      app.drag = null;
    });
  }

  function point(e) {
    const rect = app.canvas.getBoundingClientRect();
    if (e.touches && e.touches[0]) {
      const t = e.touches[0];
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** 正式超車 QTE：僅放寬時間判定（點擊範圍一律為外框半徑 RHYTHM_OUTER_R） */
  function rhythmFormalEasy() {
    return isRhythmMode();
  }

  function rhythmBeatWindowSec() {
    if (rhythmFormalEasy()) {
      return { perfect: RHYTHM_FORMAL_EASY_PERFECT_SEC, good: RHYTHM_FORMAL_EASY_GOOD_SEC };
    }
    return { perfect: RHYTHM_BEAT_ERROR_PERFECT, good: RHYTHM_BEAT_ERROR_GOOD };
  }

  function tutorialBlocking() {
    return (app.mode === "tutorial-play" || app.mode === "tutorial-stable") && !app.tutorialAck[app.mode];
  }

  function teachingOverlayActive() {
    return isTeachingOverlayMode();
  }

  function drawModalBackdrop(time) {
    paintSceneIntoBackdropBuffer(time);
    compositeBlurredBackdrop();
  }

  function drawTeachingOverlay(time) {
    drawModalBackdrop(time);
    if (app.mode === "tutorial-mistake") drawMistakeTutorial();
    else if (app.mode === "overtake-ready") drawOvertakeReadyModal();
    else if (app.mode === "tutorial-overtake-qte" || app.mode === "tutorial-defense-qte") drawQteTeachingModal();
    else drawTutorial();
    if (app.drag) drawCard(app.drag.card, app.drag.x, app.drag.y, app.drag.w, app.drag.h, true, { blind: bossCardBlind(app.drag.card) });
  }

  function canDragCards() {
    if (tutorialBlocking()) return false;
    return isCardPlayMode();
  }

  function dropDisabled(target) {
    if (app.mode === "tutorial-play") return target !== "play";
    if (app.mode === "tutorial-stable") return target !== "stable";
    if (app.mode === "tutorial-mistake") return true;
    return false;
  }

  function advanceCards() {
    if (app.mode === "tutorial-play" && app.played.length >= 4) {
      app.mode = "tutorial-stable";
      return;
    }
    if (app.mode === "tutorial-stable" && app.stable.length >= 1) {
      app.mode = "overtake-ready";
      return;
    }
    if (app.mode === "round2-cards" && app.hand.length === 0) {
      if (canStartOvertake()) app.mode = "overtake-ready";
      else startDefense();
    }
  }

  function handleButton(id) {
    if (id === "start-tutorial") {
      playNormalBgm();
      app.mode = "tutorial-play";
      return;
    }
    if (id === "debug-boss-transition") {
      startBossStageTransition();
      return;
    }
    if (id === "boss-intro-start") {
      if (app.bossBgmPending || bossBgm.paused) playBossBgm();
      app.mode = "round2-cards";
      return;
    }
    if (id === "tutorial-ok") {
      app.tutorialAck[app.mode] = true;
      return;
    }
    if (id === "mistake-tutorial-ok") {
      app.seenMistakeTutorial = true;
      app.mode = "round2-cards";
      return;
    }
    if (id === "qte-tutorial-next") {
      app.qteTeachPage += 1;
      return;
    }
    if (id === "qte-tutorial-start-overtake") {
      app.seenOvertakeQteTutorial = true;
      app.qteTeachPage = 0;
      startOvertake();
      return;
    }
    if (id === "qte-tutorial-start-defense") {
      app.seenDefenseQteTutorial = true;
      app.qteTeachPage = 0;
      beginDefenseSequence();
      return;
    }
    if (id === "overtake" && canStartOvertake()) {
      if (!app.seenOvertakeQteTutorial) {
        app.qteTeachPage = 0;
        app.mode = "tutorial-overtake-qte";
      } else {
        startOvertake();
      }
    }
    if (id === "next-lap") {
      continueAfterQte();
    }
    if (id === "defense-result-ok") {
      continueAfterQte();
    }
    if (id === "lap-result-continue") {
      openRewardChoice();
    }
    if (id === "reward-skip" && app.mode === "card-reward-choice" && !app.rewardPickAnim) {
      app.rewardOptions = [];
      app.rewardHoverSlot = -1;
      app.seenRewardTutorial = true;
      startSecondRound();
    }
  }

  function accelValue() {
    const bonus = app.played.some(card => card.type === "throttle") ? 1 : 0;
    let sum = app.carriedAcceleration;
    for (const card of app.played) {
      if (card.type === "accel") sum += 2 + bonus;
      if (card.type === "hyper_accel") sum += 3 + bonus;
    }
    return sum;
  }

  function canStartOvertake() {
    return accelValue() >= effectiveOvertakeTarget();
  }

  function startOvertake() {
    app.mode = "splash-overtake";
    app.message = "超車階段";
    app.qteStart = performance.now();
    setTimeout(() => {
      app.mode = "rhythm-formal";
      resetRhythmState(app.lapIndex >= 2);
    }, 1500);
  }

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
          if (qtePointSafe(x, y, r)) {
            point = { x, y };
            break;
          }
        }
        if (!point) break;
        pts.push(point);
      }
      if (pts.length < 5) continue;
      let ok = true;
      for (let i = 0; i < 5 && ok; i++) {
        for (let j = i + 1; j < 5; j++) {
          if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < RHYTHM_SCATTER_MIN_CENTER_DIST) ok = false;
        }
      }
      if (ok) return pts;
    }
    const minY = statusHudRect().y + statusHudRect().h + RHYTHM_OUTER_R + RHYTHM_UI_AVOID_PAD;
    const maxY = app.h - RHYTHM_OUTER_R - RHYTHM_UI_AVOID_PAD;
    const y = Math.min(maxY, Math.max(app.h * 0.42, minY));
    const gap = Math.min(130, app.w * 0.085);
    const startX = app.w / 2 - gap * 2;
    return Array.from({ length: 5 }, (_, i) => ({ x: startX + i * gap, y }));
  }

  function resetRhythmState(useScatter) {
    refreshDeckPerks();
    app.qteStart = performance.now();
    app.qteCircleStarts = rhythmStarts(app.qteStart);
    app.qteClicked = new Set();
    app.qteResults = {};
    app.qteDismissAt = {};
    app.qteTapPending = {};
    app.qteFinalized = {};
    app.qteResolveAt = 0;
    app.burstPerfectsThisRhythm = 0;
    app.qteScatterPos = useScatter ? generateScatterPositions() : null;
  }

  function rhythmStarts(start) {
    return [0, 620, 1240, 1860, 2480].map(offset => start + offset);
  }

  function startSecondRound() {
    const showMistakeTutorial = app.lapIndex === 2 && app.qtesSinceReward === 1 && !app.seenMistakeTutorial;
    app.mode = showMistakeTutorial ? "tutorial-mistake" : "round2-cards";
    if (showMistakeTutorial) dealFirstDefenseHand();
    else dealFiveFromDeck();
    if (app.bossStage) app.bossBlindPlaysRemaining = 2;
    app.played = [];
    app.stable = [];
  }

  function openRewardChoice() {
    hideGameWinOverlay();
    app.qtesSinceReward = 0;
    app.rewardOptions = rollRewardOptions();
    app.rewardHoverSlot = -1;
    app.rewardPickAnim = null;
    app.mode = "card-reward-choice";
  }

  function continueAfterQte() {
    if (app.winAfterOvertake) {
      if (app.bossStage) {
        app.winAfterOvertake = false;
        app.mode = "final-win";
        showGameWinOverlay();
      } else {
        startBossStageTransition();
      }
      return;
    }
    if (app.qtesSinceReward >= 2) {
      openRewardChoice();
      return;
    }
    app.lapIndex += 1;
    startSecondRound();
  }

  function startDefense() {
    if (!app.seenDefenseQteTutorial) {
      app.qteTeachPage = 0;
      app.mode = "tutorial-defense-qte";
      return;
    }
    beginDefenseSequence();
  }

  function beginDefenseSequence() {
    app.mode = "splash-defense";
    app.message = "阻止超車";
    app.qteStart = performance.now();
    setTimeout(() => {
      app.mode = "defense";
      app.defenseRound += 1;
      app.defenseStart = performance.now();
      app.defenseProgress = 0;
      app.defenseSucceeded = false;
      app.safeCenter = 50;
      app.safeTarget = 50;
      app.nextSafeShift = performance.now() + 300;
    }, 1500);
  }

  function tryFinishRhythmFormal() {
    if (!isRhythmMode()) return;
    if (app.qteClicked.size < 5) return;
    if (!app.qteResolveAt) {
      const dismissTimes = Object.values(app.qteDismissAt);
      const lastDismissAt = dismissTimes.length ? Math.max(...dismissTimes) : performance.now() + 1200;
      app.qteResolveAt = lastDismissAt;
    }
  }

  function finalizeRhythmFormal() {
    if (!isRhythmMode()) return;
    refreshDeckPerks();
    if (app.perkBurst) {
      app.burstTargetReduction = Math.min(3, app.burstPerfectsThisRhythm);
    } else {
      app.burstTargetReduction = 0;
    }
    let reachedFirstPlace = false;
    if (app.bossStage) {
      app.bossHp = Math.max(0, app.bossHp - 1);
      triggerBossHitFx();
      reachedFirstPlace = app.bossHp <= 0;
      if (reachedFirstPlace) app.rank = 1;
    } else {
      const nextRank = Math.max(1, app.rank - 1);
      reachedFirstPlace = nextRank === 1;
      app.rank = nextRank;
    }
    app.carriedAcceleration = 0;
    app.played = [];
    app.qteResolveAt = 0;
    app.qtesSinceReward += 1;
    app.winAfterOvertake = reachedFirstPlace;
    app.mode = "result";
    app.resultFromOvertake = true;
  }

  function update(time) {
    if (isRhythmMode()) {
      for (let i = 0; i < 5; i++) {
        const start = app.qteCircleStarts[i] ?? app.qteStart;
        const elapsed = time - start;
        if (elapsed <= 0) continue;
        const dur = getRhythmDuration(i);
        const judgeT = start + dur;
        if (time >= judgeT && !app.qteFinalized[i]) {
          app.qteFinalized[i] = true;
          const tap = app.qteTapPending[i];
          let outcome = rhythmOutcomeFromTap(tap, start, dur, judgeT);
          if (outcome === "miss" && app.perkPressure) app.pressureWideBand = true;
          if (outcome === "perfect" && app.perkBurst) app.burstPerfectsThisRhythm++;
          app.qteResults[i] = outcome;
          app.qteDismissAt[i] = time + 1000;
          app.qteClicked.add(i);
          delete app.qteTapPending[i];
          tryFinishRhythmFormal();
        }
      }
    }
    if (isRhythmMode() && time - app.qteStart > 5800 && app.qteClicked.size < 5) {
      for (let i = 0; i < 5; i++) {
        if (app.qteFinalized[i]) continue;
        const start = app.qteCircleStarts[i] ?? app.qteStart;
        const dur = getRhythmDuration(i);
        const judgeT = start + dur;
        app.qteFinalized[i] = true;
        const tap = app.qteTapPending[i];
        let outcome = rhythmOutcomeFromTap(tap, start, dur, judgeT);
        if (outcome === "miss" && app.perkPressure) app.pressureWideBand = true;
        if (outcome === "perfect" && app.perkBurst) app.burstPerfectsThisRhythm++;
        app.qteResults[i] = outcome;
        app.qteDismissAt[i] = time + 1000;
        app.qteClicked.add(i);
        delete app.qteTapPending[i];
      }
      tryFinishRhythmFormal();
    }
    if (isRhythmMode() && app.qteResolveAt && time >= app.qteResolveAt) {
      finalizeRhythmFormal();
    }
    if (app.mode === "defense") updateDefense(time);
    if (app.rewardPickAnim) {
      const dt = time - app.rewardPickAnim.t0;
      if (dt >= 520) {
        const picked = app.rewardOptions[app.rewardPickAnim.slot];
        app.deck.push({ ...picked, id: `deck-${picked.rewardId}-${app.deckSeq++}` });
        refreshDeckPerks();
        app.seenRewardTutorial = true;
        app.rewardPickAnim = null;
        app.mode = "card-reward-toast";
        app.rewardToastUntil = time + 1100;
      }
    }
    if (app.mode === "card-reward-toast" && time >= app.rewardToastUntil) {
      app.rewardToastUntil = 0;
      startSecondRound();
    }
    if (app.bossHitFx && time - app.bossHitFx.t0 > 1050) {
      app.bossHitFx = null;
    }
  }

  function defenseDifficulty() {
    const easyFirstDefense = app.defenseRound <= 1;
    const stableBonus = Math.min(5, app.stable.length) * 1.4;
    const chassisBonus = app.perkChassis * 1.5;
    let safeWidth = Math.min(34, (easyFirstDefense ? 22 : 18) + stableBonus + chassisBonus);
    let perfectWidth = easyFirstDefense ? 7 : 5;
    perfectWidth += Math.min(2.5, app.perkChassis * 0.6);
    let shiftMin = easyFirstDefense ? 400 : 260;
    let shiftMax = easyFirstDefense ? 560 : 340;
    let lerp = easyFirstDefense ? 0.085 : 0.11;
    const prec = app.perkPrecision;
    if (prec) {
      shiftMin *= 1 + 0.2 * prec;
      shiftMax *= 1 + 0.2 * prec;
      lerp *= Math.pow(0.84, prec);
    }
    return {
      safeWidth,
      perfectWidth,
      shiftMin,
      shiftMax,
      lerp,
      missPenalty: Math.max(0.06, 0.1 - app.perkChassis * 0.02),
    };
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
    const safeWidth = diff.safeWidth;
    const perfectWidth = diff.perfectWidth;
    const safeMin = app.safeCenter - safeWidth / 2;
    const safeMax = app.safeCenter + safeWidth / 2;
    const perfectMin = app.safeCenter - perfectWidth / 2;
    const perfectMax = app.safeCenter + perfectWidth / 2;
    if (pos >= perfectMin && pos <= perfectMax) app.defenseProgress += 0.62;
    else if (pos >= safeMin && pos <= safeMax) app.defenseProgress += 0.38;
    else app.defenseProgress = Math.max(0, app.defenseProgress - diff.missPenalty);
    if (time - app.defenseStart >= 10000 || app.defenseProgress >= 100) {
      app.defenseSucceeded = app.defenseProgress >= 100;
      app.carriedAcceleration = app.defenseSucceeded ? accelValue() : 0;
      app.played = [];
      app.qtesSinceReward += 1;
      app.mode = "defense-result";
    }
  }

  /** 多圈重疊時取圓心最近者，避免誤判到別顆。 */
  function hitRhythmCircleAt(p) {
    if (!isRhythmMode()) return null;
    const list = app.zones.circles || [];
    let best = null;
    let bestD = Infinity;
    for (const c of list) {
      const d = dist(p.x, p.y, c.x, c.y);
      if (d <= c.r && d < bestD) {
        best = c;
        bestD = d;
      }
    }
    return best;
  }

  function hitCircle(p) {
    const hit = hitRhythmCircleAt(p);
    if (!hit) return;
    if (isRhythmMode() && !app.qteFinalized[hit.i]) {
      const now = performance.now();
      const start = app.qteCircleStarts[hit.i] || app.qteStart;
      const dur = hit.duration;
      const judgeT = start + dur;
      if (now > judgeT) return;
      if (!app.qteTapPending[hit.i]) {
        app.qteTapPending[hit.i] = { t: now };
      }
    }
  }

  function rhythmBeatTimeMs(startMs, durationMs) {
    return startMs + durationMs;
  }

  /** error = |clickTime - beatTime|（秒）；beatTime = 圈開始 + duration（收合完成拍點） */
  function rhythmOutcomeFromTap(tap, startMs, durationMs, judgeT) {
    let goodExtra = 0;
    if (app.perkPressure && app.pressureWideBand) {
      goodExtra = 0.08;
      app.pressureWideBand = false;
    }
    if (!tap || tap.t > judgeT) return "miss";
    const beatT = rhythmBeatTimeMs(startMs, durationMs);
    const errSec = Math.abs(tap.t - beatT) / 1000;
    const win = rhythmBeatWindowSec();
    if (errSec < win.perfect) return "perfect";
    if (errSec < win.good + goodExtra) return "good";
    return "miss";
  }

  function paintSceneIntoBackdropBuffer(time) {
    if (!app.backdropCanvas) app.backdropCanvas = document.createElement("canvas");
    app.backdropCanvas.width = app.canvas.width;
    app.backdropCanvas.height = app.canvas.height;
    const bctx = app.backdropCanvas.getContext("2d");
    bctx.setTransform(app.dpr, 0, 0, app.dpr, 0, 0);
    const prev = app.ctx;
    app.ctx = bctx;
    drawRace(time);
    drawHud();
    if (cardTableVisible()) {
      drawPlayArea(time);
      drawDeckArea(time);
      if (stabilityDropVisible()) drawStabilityDrop(time);
      drawHand(time);
    }
    drawExpressionDock(time);
    app.ctx = prev;
  }

  function compositeBlurredBackdrop() {
    const ctx = app.ctx;
    ctx.save();
    ctx.setTransform(app.dpr, 0, 0, app.dpr, 0, 0);
    ctx.clearRect(0, 0, app.w, app.h);
    ctx.filter = "blur(6px)";
    ctx.globalAlpha = 0.96;
    ctx.drawImage(app.backdropCanvas, 0, 0, app.w, app.h);
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(0,0,0,0.48)";
    ctx.fillRect(0, 0, app.w, app.h);
    ctx.restore();
  }

  /** 左下角人物表情（圓形虛線框 + 情緒標籤）；配色：深藍底、青虛線、琥珀標籤 */
  function countFormalMisses() {
    let n = 0;
    for (let i = 0; i < 5; i++) {
      if (app.qteResults[i] === "miss") n++;
    }
    return n;
  }

  function formalActiveRingStress(time) {
    if (!isRhythmMode()) return 0;
    for (let i = 0; i < 5; i++) {
      if (app.qteFinalized[i]) continue;
      const start = app.qteCircleStarts[i] ?? app.qteStart;
      const dur = getRhythmDuration(i);
      const elapsed = time - start;
      if (elapsed > 0 && elapsed < dur) return Math.min(1, elapsed / dur);
    }
    return 0;
  }

  function getExpressionState(time) {
    const m = app.mode;
    if (m === "rhythm-formal") {
      if (countFormalMisses() >= 2) return { mood: "sweat", label: "QTE 地獄級" };
      if (formalActiveRingStress(time) > 0.72) return { mood: "sweat", label: "極限難度" };
      if (countFormalMisses() === 1) return { mood: "nervous", label: "QTE 偏難" };
      return { mood: "nervous", label: "QTE 高壓" };
    }
    if (typeof m === "string" && m.startsWith("splash")) {
      return { mood: "nervous", label: "即將開戰" };
    }
    if (m === "defense") {
      if (app.defenseProgress >= 78) return { mood: "relaxed", label: "防守輕鬆" };
      if (app.defenseStart && time - app.defenseStart > 6500 && app.defenseProgress < 28) {
        return { mood: "sweat", label: "防守極難" };
      }
      if (app.defenseProgress < 40) return { mood: "nervous", label: "防守偏難" };
      return { mood: "nervous", label: "防守中壓" };
    }
    if (m === "card-reward-choice" || m === "card-reward-toast") {
      return { mood: "nervous", label: "取捨有壓力" };
    }
    if (m === "defense-result" || m === "lap-result") {
      return { mood: "relaxed", label: "難度暫緩" };
    }
    if (m === "result" && app.resultFromOvertake) {
      return { mood: "relaxed", label: "超車成功" };
    }
    if (m === "final-win") return { mood: "relaxed", label: "全通關" };
    if (m === "start-ready") return { mood: "nervous", label: "準備起跑" };
    if (m === "tutorial-mistake") return { mood: "nervous", label: "失誤教學" };
    if (m === "tutorial-overtake-qte") return { mood: "nervous", label: "超車教學" };
    if (m === "tutorial-defense-qte") return { mood: "nervous", label: "防守教學" };
    if (CARD_SURFACE_MODES.includes(m)) {
      if (m === "tutorial-play") {
        if (app.played.length === 0) return { mood: "nervous", label: "緊張" };
        if (app.played.length <= 2) return { mood: "nervous", label: "出牌偏難" };
        return { mood: "relaxed", label: "出牌變簡單" };
      }
      if (m === "tutorial-stable") {
        if (app.stable.length === 0) return { mood: "nervous", label: "緊張" };
        return { mood: "relaxed", label: "穩定區簡單" };
      }
      if (m === "round2-cards") {
        if (app.played.length === 0) return { mood: "nervous", label: "緊張" };
        const tgt = effectiveOvertakeTarget();
        const ax = accelValue();
        if (ax >= tgt) return { mood: "relaxed", label: "加速門檻簡單" };
        if (app.played.length <= 2 && ax < tgt * 0.55) return { mood: "sweat", label: "組牌極難" };
        if (app.played.length >= 3 && ax < tgt * 0.88) return { mood: "sweat", label: "時間壓力大" };
        if (app.played.length <= 2) return { mood: "nervous", label: "組牌偏難" };
        return { mood: "relaxed", label: "組牌尚可" };
      }
      if (m === "overtake-ready") {
        if (canStartOvertake()) return { mood: "relaxed", label: "超車準備簡單" };
        const tgt = effectiveOvertakeTarget();
        const ax = accelValue();
        if (ax < tgt * 0.42) return { mood: "sweat", label: "數值差太多" };
        if (ax < tgt * 0.72) return { mood: "nervous", label: "還缺一點" };
        return { mood: "relaxed", label: "臨門一腳" };
      }
    }
    return { mood: "relaxed", label: "待命" };
  }

  function drawExpressionFace(ctx, mood, cx, cy, s) {
    const skin = "#f2e8dc";
    const line = "#1a2838";
    const blush = "rgba(255,120,100,0.35)";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2);
    ctx.fill();
    if (mood === "relaxed") {
      ctx.fillStyle = blush;
      ctx.beginPath();
      ctx.arc(cx - s * 0.16, cy + s * 0.02, s * 0.06, 0, Math.PI * 2);
      ctx.arc(cx + s * 0.16, cy + s * 0.02, s * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = line;
      ctx.lineWidth = Math.max(1.5, s * 0.04);
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.04, s * 0.14, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = line;
      ctx.beginPath();
      ctx.arc(cx - s * 0.16, cy - s * 0.06, s * 0.045, 0, Math.PI * 2);
      ctx.arc(cx + s * 0.16, cy - s * 0.06, s * 0.045, 0, Math.PI * 2);
      ctx.fill();
    } else if (mood === "nervous") {
      ctx.strokeStyle = line;
      ctx.lineWidth = Math.max(1.5, s * 0.045);
      ctx.beginPath();
      ctx.ellipse(cx - s * 0.14, cy - s * 0.05, s * 0.07, s * 0.1, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx + s * 0.14, cy - s * 0.05, s * 0.07, s * 0.1, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.16, cy + s * 0.14);
      ctx.lineTo(cx + s * 0.16, cy + s * 0.14);
      ctx.stroke();
    } else {
      drawExpressionFace(ctx, "nervous", cx, cy, s);
      const dropCx = cx + s * 0.32;
      const dropCy = cy - s * 0.28;
      const g = ctx.createRadialGradient(dropCx - 2, dropCy - 2, 0, dropCx, dropCy, s * 0.14);
      g.addColorStop(0, "#b8f0ff");
      g.addColorStop(0.55, "#5ec8eb");
      g.addColorStop(1, "#2a8fb8");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(dropCx, dropCy - s * 0.02);
      ctx.bezierCurveTo(dropCx + s * 0.12, dropCy - s * 0.08, dropCx + s * 0.1, dropCy + s * 0.12, dropCx, dropCy + s * 0.16);
      ctx.bezierCurveTo(dropCx - s * 0.08, dropCy + s * 0.1, dropCx - s * 0.1, dropCy - s * 0.02, dropCx, dropCy - s * 0.02);
      ctx.fill();
      ctx.strokeStyle = "rgba(20,60,90,0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  /** 表情 dock 外接矩形（與實際繪製一致），用於避開教學黃框 */
  function expressionDockBounds(cx, cy, R, label) {
    const ctx = app.ctx;
    ctx.save();
    ctx.font = `800 12px system-ui, "Microsoft JhengHei", sans-serif`;
    const pillW = Math.min(120, Math.max(88, ctx.measureText(label).width + 30));
    ctx.restore();
    const pillH = 26;
    const py = cy + R - 18;
    const topPad = 6;
    return {
      left: Math.min(cx - R, cx - pillW / 2),
      right: Math.max(cx + R, cx + pillW / 2),
      top: cy - R - topPad,
      bottom: py + pillH,
    };
  }

  function rectFromBounds(b) {
    return { x: b.left, y: b.top, w: b.right - b.left, h: b.bottom - b.top };
  }

  function inflateRect(r, pad) {
    return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
  }

  function circleOverlapsRect(cx, cy, r, rect) {
    const nearestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
    const nearestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
    return dist(cx, cy, nearestX, nearestY) < r;
  }

  function qteAvoidRects(time) {
    const hud = statusHudRect();
    const R = Math.min(56, app.w * 0.072);
    const cx = 18 + R;
    const cy = app.h - 20 - R - 10;
    const label = getExpressionState(typeof time === "number" ? time : performance.now()).label;
    return [
      inflateRect(hud, RHYTHM_UI_AVOID_PAD),
      inflateRect(rectFromBounds(expressionDockBounds(cx, cy, R, label)), RHYTHM_UI_AVOID_PAD),
    ];
  }

  function qtePointSafe(x, y, r, time) {
    const edge = RHYTHM_UI_AVOID_PAD;
    if (x < r + edge || x > app.w - r - edge || y < r + edge || y > app.h - r - edge) return false;
    return qteAvoidRects(time).every(rect => !circleOverlapsRect(x, y, r, rect));
  }

  function boundsOverlapModal(b, mx, my, mw, mh) {
    return !(b.right <= mx || b.left >= mx + mw || b.bottom <= my || b.top >= my + mh);
  }

  function drawExpressionDock(time) {
    const ctx = app.ctx;
    const { mood, label } = getExpressionState(time);
    let R = Math.min(56, app.w * 0.072);
    const marginL = 18;
    const marginB = 20;
    let cx = marginL + R;
    let cy = app.h - marginB - R - 10;
    if (false && tutorialBlocking()) {
      /** 與手牌、HUD 相同：在黃框「外」、全螢幕模糊上；不可壓到黃框、也不塞進框內 */
      const tb = getTutorialModalBox();
      const mx = tb.x;
      const my = tb.y;
      const mw = tb.w;
      const mh = tb.h;
      const gap = 28;
      const sideGap = 24;
      const inScreen = b => b.left >= 10 && b.right <= app.w - 10 && b.top >= 10 && b.bottom <= app.h - 8;
      const ok = (tx, ty) => {
        const b = expressionDockBounds(tx, ty, R, label);
        return !boundsOverlapModal(b, mx, my, mw, mh) && inScreen(b);
      };
      const tryY = ty => ok(app.w / 2, ty);
      const modalBottom = my + mh;
      let ty = modalBottom + gap + R + 6;
      if (tryY(ty)) {
        cx = app.w / 2;
        cy = ty;
      } else {
        ty = app.h - marginB - R - 26;
        if (tryY(ty)) {
          cx = app.w / 2;
          cy = ty;
        } else {
          let tx = mx + mw + sideGap + R;
          let ty2 = Math.min(app.h - marginB - R - 10, my + mh * 0.52);
          if (tx + R <= app.w - 10 && ok(tx, ty2)) {
            cx = tx;
            cy = ty2;
          } else {
            tx = mx - sideGap - R;
            ty2 = Math.min(app.h - marginB - R - 10, my + mh * 0.52);
            if (tx - R >= 10 && ok(tx, ty2)) {
              cx = tx;
              cy = ty2;
            } else {
              ty2 = my - gap - R - 6;
              if (tryY(ty2)) {
                cx = app.w / 2;
                cy = ty2;
              } else {
                cx = marginL + R;
                cy = app.h - marginB - R - 10;
              }
            }
          }
        }
      }
    }
    const COL = {
      fill: "rgba(8, 22, 42, 0.88)",
      dash: "rgba(110, 210, 255, 0.82)",
      glow: "rgba(80, 200, 255, 0.25)",
      pillBg: "rgba(6, 14, 26, 0.94)",
      pillBorder: "rgba(255, 210, 100, 0.55)",
      pillText: "#ffe9b0",
    };
    ctx.save();
    ctx.shadowColor = COL.glow;
    ctx.shadowBlur = 14;
    ctx.fillStyle = COL.fill;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = COL.dash;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.arc(cx, cy, R - 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '700 11px system-ui, "Microsoft JhengHei", sans-serif';
    ctx.fillStyle = "rgba(160, 200, 230, 0.45)";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("表情", cx, cy - R + 16);
    drawExpressionFace(ctx, mood, cx, cy, R * 2.1);
    const pillH = 26;
    const py = cy + R - 18;
    ctx.font = '800 12px system-ui, "Microsoft JhengHei", sans-serif';
    ctx.textAlign = "center";
    const pillW = Math.min(120, Math.max(88, ctx.measureText(label).width + 30));
    roundPanel(cx - pillW / 2, py, pillW, pillH, 12, COL.pillBg, COL.pillBorder, 2);
    ctx.textBaseline = "middle";
    ctx.fillStyle = COL.pillText;
    ctx.fillText(label, cx, py + pillH / 2 + 0.5);
    ctx.restore();
  }

  function draw(time) {
    app.zones.buttons = [];
    if (!isRhythmMode()) app.zones.circles = [];
    if (!stabilityDropVisible()) {
      app.zones.stableHit = null;
      app.zones.stable = null;
    }
    if (app.mode === "start-ready") {
      drawModalBackdrop(time);
      drawStartReadyModal();
      if (app.drag) drawCard(app.drag.card, app.drag.x, app.drag.y, app.drag.w, app.drag.h, true, { blind: bossCardBlind(app.drag.card) });
      drawExpressionDock(time);
      return;
    }
    if (app.mode === "boss-intro") {
      drawRace(time);
      drawHud();
      drawBossIntroModal();
      drawExpressionDock(time);
      return;
    }
    if (app.mode === "boss-transition") {
      drawBossStageTransition(time);
      return;
    }
    if (teachingOverlayActive()) {
      drawTeachingOverlay(time);
      return;
    }
    if (app.mode === "final-win") {
      drawRace(time);
      drawHud();
      const ctx = app.ctx;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 0, app.w, app.h);
      drawExpressionDock(time);
      return;
    }
    if (app.mode === "card-reward-choice" || app.mode === "card-reward-toast") {
      drawRace(time);
      drawHud();
      drawCardRewardScreen(time);
      if (app.drag) drawCard(app.drag.card, app.drag.x, app.drag.y, app.drag.w, app.drag.h, true, { blind: bossCardBlind(app.drag.card) });
      drawExpressionDock(time);
      return;
    }
    if (app.mode === "defense-result" || app.mode === "lap-result") {
      drawRace(time);
      drawHud();
      if (app.mode === "defense-result") drawDefenseResult();
      else drawLapResult();
      if (app.drag) drawCard(app.drag.card, app.drag.x, app.drag.y, app.drag.w, app.drag.h, true, { blind: bossCardBlind(app.drag.card) });
      drawExpressionDock(time);
      return;
    }
    drawRace(time);
    drawHud();
    if (cardTableVisible()) {
      drawPlayArea(time);
      drawDeckArea(time);
      if (stabilityDropVisible()) drawStabilityDrop(time);
      drawHand(time);
    }
    if (app.mode.startsWith("splash")) drawSplash();
    if (isRhythmMode()) drawRhythm(time);
    if (isRhythmMode() && app.hand.length) {
      drawHandRhythmCorner();
    }
    if (app.mode === "success") drawCenterMessage(app.message, "#57e585");
    if (app.mode === "defense") drawDefense();
    if (app.mode === "result") drawResult();
    if (app.drag) drawCard(app.drag.card, app.drag.x, app.drag.y, app.drag.w, app.drag.h, true, { blind: bossCardBlind(app.drag.card) });
    drawExpressionDock(time);
  }

  function skylineHash01(n) {
    const x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  function drawBossStageTransition(time) {
    const ctx = app.ctx;
    const start = app.bossTransitionStart || time;
    const elapsed = time - start;
    const fadeOutDur = 900;
    const entranceDur = 2600;
    const mapFadeDur = 1500;
    const uiFadeDur = 1000;
    const entranceStart = fadeOutDur;
    const mapStart = fadeOutDur + entranceDur;
    const uiStart = mapStart + mapFadeDur;
    const finish = mapStart + mapFadeDur + uiFadeDur;

    if (elapsed < fadeOutDur) {
      drawRace(time);
      drawHud();
      drawResult();
      drawExpressionDock(time);
      const a = smooth01(elapsed / fadeOutDur);
      fillScreenBlack(a);
      if (a > 0.55) {
        revealBossTransitionBgm();
      }
      return;
    }

    if (elapsed < mapStart) {
      revealBossTransitionBgm();
      fillScreenBlack(1);
      drawBossEntranceLayers(elapsed - entranceStart, entranceDur, time);
      return;
    }

    if (!app.bossTransitionSetup) {
      configureBlindDesertBoss("boss-transition");
      app.bossTransitionSetup = true;
    }

    drawBlindDesertRace(time);
    if (elapsed < uiStart) {
      const a = 1 - smooth01((elapsed - mapStart) / mapFadeDur);
      fillScreenBlack(a);
      revealBossTransitionBgm();
      drawBossEntranceLayers(entranceDur, entranceDur, time, a);
      return;
    }

    const uiAlpha = smooth01((elapsed - uiStart) / uiFadeDur);
    ctx.save();
    ctx.globalAlpha = uiAlpha;
    drawHud();
    drawBossIntroModal();
    drawExpressionDock(time);
    ctx.restore();

    if (elapsed >= finish) {
      app.mode = "boss-intro";
      app.bossTransitionStart = 0;
      app.bossTransitionBgmStarted = true;
    }
  }

  function fillScreenBlack(alpha) {
    const ctx = app.ctx;
    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.max(0, Math.min(1, alpha))})`;
    ctx.fillRect(0, 0, app.w, app.h);
    ctx.restore();
  }

  function drawBossEntranceLayers(age, totalDur, time, fadeOut = 1) {
    const ctx = app.ctx;
    const w = app.w;
    const h = app.h;
    const settled = Math.max(0, Math.min(1, fadeOut));
    const t = n => smooth01((age - n) / 520);
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
    const redIn = t(140);
    const titleIn = t(620);
    const portraitIn = t(820);
    const infoIn = t(1280);
    const shake = Math.sin(time * 0.006) * 2.5 * (1 - Math.min(1, age / totalDur));

    ctx.save();
    ctx.translate(-w * (1 - redIn) * 0.18 + shake, h * 0.02);
    ctx.rotate(-0.105);
    if (banner) drawImageInRect(banner, -w * 0.14, h * 0.10, w * 1.30, h * 0.50, 0.98 * redIn, "cover");
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.34 * t(420);
    ctx.fillStyle = "#d60d12";
    for (let i = 0; i < 8; i++) {
      const x = w * (0.03 + i * 0.135);
      ctx.fillRect(x, h * 0.22 + (i % 2) * 9, w * 0.055, 8);
    }
    ctx.restore();

    if (detailB) drawImageInRect(detailB, w * 0.64, h * 0.17, w * 0.38, h * 0.42, 0.38 * infoIn, "contain");
    if (mask) drawImageInRect(mask, w * 0.71, h * 0.48, w * 0.24, h * 0.28, 0.58 * infoIn, "contain");

    if (portrait) {
      const px = w * (0.56 + (1 - portraitIn) * 0.08);
      const py = h * (0.00 + (1 - portraitIn) * 0.04);
      drawImageInRect(portrait, px, py, w * 0.46, h * 0.88, portraitIn, "contain");
    }

    drawSandParticles(w * 0.04, h * 0.04, w * 0.92, h * 0.84, {
      count: 180,
      alpha: 0.28 * settled,
      size: 1.25,
      drift: 58,
      fade: 120,
      seedOffset: 881,
    });

    if (quotePlate) drawImageInRect(quotePlate, w * 0.045, h * 0.435, w * 0.42, h * 0.18, infoIn, "contain");

    drawBossEntranceTypography(titleIn, infoIn, time, settled);
    ctx.restore();
  }

  function drawBossEntranceTypography(titleIn, infoIn, time, fadeOut = 1) {
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
    ctx.fillText("SAND VEIL", w * 0.045, h * 0.34);
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

  function drawCoverImage(img, alpha = 1, scaleBoost = 1, driftX = 0, driftY = 0) {
    const ctx = app.ctx;
    const iw = img.naturalWidth || img.width || 16;
    const ih = img.naturalHeight || img.height || 9;
    const scale = Math.max(app.w / iw, app.h / ih) * scaleBoost;
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, alpha));
    ctx.drawImage(img, (app.w - dw) / 2 + driftX, (app.h - dh) / 2 + driftY, dw, dh);
    ctx.restore();
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

  function drawBossTransitionTitle(alpha, time) {
    const ctx = app.ctx;
    const a = Math.max(0, Math.min(1, alpha));
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    drawSandParticles(app.w * 0.28, app.h * 0.32, app.w * 0.44, app.h * 0.30, {
      count: 120,
      alpha: 0.88,
      size: 1.35,
      drift: 42,
      fade: 70,
      seedOffset: 417,
    });
    ctx.font = '1000 54px system-ui, "Microsoft JhengHei", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(255, 198, 70, 0.72)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#ffd94f";
    ctx.fillText("盲牌沙漠", app.w / 2, app.h * 0.48 + Math.sin(time * 0.003) * 3);
    ctx.font = '800 18px system-ui, "Microsoft JhengHei", sans-serif';
    ctx.shadowBlur = 10;
    ctx.fillStyle = "rgba(255, 239, 180, 0.82)";
    ctx.fillText("沙暴正在吞沒賽道", app.w / 2, app.h * 0.48 + 52);
    ctx.restore();
  }

  function smooth01(v) {
    const t = Math.max(0, Math.min(1, v));
    return t * t * (3 - 2 * t);
  }

  /** 遠景大樓：兩層景深、立面漸層、窗格、頂冠與底部陰影 */
  function drawCitySkyline(ctx, w, h, horizon, time) {
    const twinkle = 0.08 + 0.06 * Math.sin(time * 0.0022);
    const drawLayer = (layer, count) => {
      const far = layer === 0;
      const alphaM = far ? 0.62 : 1;
      const hMul = far ? 0.78 : 1;
      const xShift = far ? w * 0.03 : 0;
      for (let i = 0; i < count; i++) {
        const seed = i * 2.17 + layer * 19.1;
        const sa = skylineHash01(seed);
        const sb = skylineHash01(seed * 1.9 + 1);
        const sc = skylineHash01(seed * 3.3 + 2);
        const bw = (far ? 28 : 34) + sa * (far ? 22 : 34);
        const bh = (horizon * (0.26 + sb * 0.34)) * hMul;
        const topY = horizon - bh;
        const baseX = (i / count) * (w + bw * 0.5) - bw * 0.35 + xShift + (sc - 0.5) * 16 - layer * 6;

        ctx.save();
        ctx.globalAlpha = alphaM;
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.beginPath();
        ctx.ellipse(baseX + bw * 0.5, horizon + 3, bw * 0.52, 4.5, 0, 0, Math.PI * 2);
        ctx.fill();

        const g = ctx.createLinearGradient(baseX, topY, baseX + bw, topY + bh);
        if (far) {
          g.addColorStop(0, "rgba(52,72,98,0.55)");
          g.addColorStop(0.5, "rgba(36,52,74,0.62)");
          g.addColorStop(1, "rgba(20,30,48,0.68)");
        } else {
          g.addColorStop(0, "rgba(42,58,82,0.96)");
          g.addColorStop(0.45, "rgba(26,38,58,0.98)");
          g.addColorStop(1, "rgba(10,16,28,1)");
        }
        ctx.fillStyle = g;
        ctx.fillRect(baseX, topY, bw, bh);

        const edge = ctx.createLinearGradient(baseX, 0, baseX + Math.min(10, bw * 0.14), 0);
        edge.addColorStop(0, "rgba(200, 228, 255, 0.14)");
        edge.addColorStop(1, "rgba(200, 228, 255, 0)");
        ctx.fillStyle = edge;
        ctx.fillRect(baseX, topY, Math.min(10, bw * 0.14), bh);

        ctx.strokeStyle = "rgba(0,0,0,0.28)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(baseX + bw * 0.32, topY + 10);
        ctx.lineTo(baseX + bw * 0.32, horizon - 5);
        ctx.moveTo(baseX + bw * 0.66, topY + 14);
        ctx.lineTo(baseX + bw * 0.66, horizon - 5);
        ctx.stroke();

        const crownH = far ? 2 : 3 + (sa > 0.55 ? 3 : 0);
        ctx.fillStyle = far ? "rgba(30,44,64,0.75)" : "rgba(18,28,44,0.95)";
        ctx.fillRect(baseX + bw * 0.08, topY - crownH, bw * 0.84, crownH);
        if (!far && sa > 0.82) {
          ctx.strokeStyle = "rgba(180,200,220,0.35)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(baseX + bw * 0.5, topY - crownH);
          ctx.lineTo(baseX + bw * 0.5, topY - crownH - 10 - sb * 6);
          ctx.stroke();
        }

        const padT = 12 + sb * 10;
        const padX = 5;
        const winW = far ? 4 : 5;
        const winH = far ? 6 : 8;
        const gapX = far ? 5 : 7;
        const gapY = far ? 9 : 11;
        let row = 0;
        for (let py = topY + padT; py + winH < horizon - 7; py += gapY, row++) {
          let col = 0;
          for (let px = baseX + padX; px + winW < baseX + bw - padX; px += gapX, col++) {
            const lit = skylineHash01(seed * 11 + row * 5.3 + col * 2.1) > (far ? 0.88 : 0.74);
            const warm = 0.35 + twinkle * (lit ? 1 : 0);
            ctx.fillStyle = lit
              ? `rgba(255, 224, 170, ${0.28 + warm * 0.35})`
              : `rgba(110, 140, 180, ${far ? 0.12 : 0.2})`;
            ctx.fillRect(px, py, winW, winH);
            if (!far && lit) {
              ctx.fillStyle = `rgba(255, 248, 220, ${0.08 + twinkle})`;
              ctx.fillRect(px, py, winW * 0.45, winH * 0.35);
            }
          }
        }

        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.lineWidth = 1;
        ctx.strokeRect(baseX + 0.5, topY + 0.5, bw - 1, bh - 1);
        ctx.restore();
      }
    };
    drawLayer(0, 16);
    drawLayer(1, 14);
  }

  function drawRace(time) {
    if (app.bossStage && app.bossStageName === "盲牌沙漠") {
      drawBlindDesertRace(time);
      return;
    }
    const ctx = app.ctx;
    const w = app.w;
    const h = app.h;
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#06101d");
    bg.addColorStop(0.45, "#122033");
    bg.addColorStop(1, "#05090d");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    const horizon = h * 0.38;
    drawCitySkyline(ctx, w, h, horizon, time);

    ctx.fillStyle = "#202934";
    ctx.beginPath();
    ctx.moveTo(w * 0.45, horizon);
    ctx.lineTo(w * 0.55, horizon);
    ctx.lineTo(w * 0.94, h);
    ctx.lineTo(w * 0.06, h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(255,217,79,0.7)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w * 0.45, horizon);
    ctx.lineTo(w * 0.08, h);
    ctx.moveTo(w * 0.55, horizon);
    ctx.lineTo(w * 0.92, h);
    ctx.stroke();

    for (let i = 0; i < 24; i++) {
      const p = ((i / 24) + (time * 0.00045) % 1) % 1;
      const y = horizon + p * p * (h - horizon);
      const spread = p * w * 0.42;
      ctx.strokeStyle = `rgba(230,241,255,${0.12 + p * 0.38})`;
      ctx.lineWidth = Math.max(1, p * 5);
      ctx.beginPath();
      ctx.moveTo(w * 0.5 - spread * 0.25, y);
      ctx.lineTo(w * 0.5 - spread * 0.25, y + 18 + p * 28);
      ctx.moveTo(w * 0.5 + spread * 0.25, y);
      ctx.lineTo(w * 0.5 + spread * 0.25, y + 18 + p * 28);
      ctx.stroke();
    }

    const redY = h * 0.54;
    const redW = 58;
    const whiteY = h * 0.80;
    const whiteW = 126;
    drawCar(carLaneX("red", time, redY, redW), redY, redW, 28, "#e94d48");
    drawCar(carLaneX("white", time, whiteY, whiteW), whiteY, whiteW, 58, "#dceaff");

    ctx.strokeStyle = "rgba(129,180,255,0.22)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 60; i++) {
      const x = ((i * 71 + time * 0.08) % (w + 160)) - 80;
      const y = (i * 43 + time * 0.25) % h;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 18, y + 42);
      ctx.stroke();
    }
  }

  function drawCar(x, y, w, h, color, opts = {}) {
    const ctx = app.ctx;
    const shadowAlpha = opts.shadowAlpha ?? 0.48;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = `rgba(0,0,0,${shadowAlpha})`;
    ctx.fillRect(-w * 0.5, h * 0.36, w, h * 0.22);
    ctx.fillStyle = color;
    ctx.fillRect(-w * 0.42, -h * 0.25, w * 0.84, h * 0.52);
    ctx.fillRect(-w * 0.28, -h * 0.5, w * 0.56, h * 0.3);
    ctx.fillStyle = "#121922";
    ctx.fillRect(-w * 0.2, -h * 0.42, w * 0.4, h * 0.18);
    ctx.fillStyle = "#ff3030";
    ctx.fillRect(-w * 0.36, h * 0.04, w * 0.22, h * 0.12);
    ctx.fillRect(w * 0.14, h * 0.04, w * 0.22, h * 0.12);
    ctx.restore();
  }

  function drawAccelMeterRow(x, y) {
    const ctx = app.ctx;
    const val = accelValue();
    const cap = ACCEL_METER_DISPLAY_MAX;
    const thresh = effectiveOvertakeTarget();
    text("加速值", x, y, 18, "#d7e6f8", "800");
    text(`${val} / ${cap}`, x + 226, y, 18, "#f4f8ff", "800", "right");
    panel(x, y + 16, 232, 18, "rgba(10,16,28,0.9)", "rgba(154,190,232,0.62)");
    const innerX = x + 4;
    const innerY = y + 20;
    const innerW = 224;
    const innerH = 10;
    const fillFrac = Math.min(1, val / cap);
    ctx.fillStyle = "#ffd94f";
    ctx.fillRect(innerX, innerY, innerW * fillFrac, innerH);
    const lineX = innerX + (innerW * thresh) / cap;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 52, 52, 0.92)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lineX + 0.5, innerY - 1);
    ctx.lineTo(lineX + 0.5, innerY + innerH + 1);
    ctx.stroke();
    ctx.restore();
  }

  function drawHud() {
    const status = statusHudRect();
    panel(status.x, status.y, status.w, status.h, "rgba(8,18,32,0.88)", "rgba(105,164,224,0.50)");
    text("狀態", status.x + 22, status.y + 34, 24, "#cfe7ff", "700");
    text(`本局名次 ${app.rank} / ${app.rankTotal}`, status.x + 22, status.y + 58, 14, "rgba(214,228,255,0.82)", "700");
    drawAccelMeterRow(status.x + 22, status.y + 76);
    meter("穩定性", `${app.stable.length} / 5`, status.x + 22, status.y + 134, app.stable.length * 20, "#80ef70");
    if (app.bossStage) {
      text(app.bossStageName, status.x + 22, status.y + 194, 15, "#ffd94f", "900");
      text("沙暴：手牌與 QTE 遮蔽", status.x + 142, status.y + 194, 13, "rgba(255,232,180,0.88)", "800");
    }
  }

  function triggerBossHitFx() {
    app.bossHitFx = {
      t0: performance.now(),
      seed: Math.random() * 1000,
    };
  }

  function drawPlayArea(time) {
    const width = Math.min(560, app.w - 760);
    const x = app.w / 2 - width / 2;
    const y = app.h - 430;
    app.zones.play = { x, y, w: width, h: 104 };
    panel(x, y, width, 104, "rgba(13,20,34,0.82)", dropDisabled("play") ? "rgba(120,128,140,0.30)" : "#ffd94f", true);
    text("拖曳打出卡牌", x + width / 2, y - 18 + Math.sin(time * 0.005) * 4, 18, "#ffdd82", "700", "center");
    if (app.mode === "tutorial-play") {
      const arrowY = y + 26 + Math.sin(time * 0.008) * 4;
      text("▲   ▲   ▲", x + width / 2, arrowY, 32, "rgba(255,179,187,0.78)", "900", "center");
    }
    drawMiniCards(app.played, x, y + 34, width, 58);
  }

  function drawStabilityDrop(time) {
    if (!stabilityDropVisible()) return;
    const t = typeof time === "number" ? time : performance.now();
    const r = { x: app.w - 292, y: app.h - 220, w: 268, h: 142 };
    app.zones.stableHit = { x: r.x, y: r.y, w: r.w, h: r.h };
    app.zones.stable = { x: r.x + 20, y: r.y + 58, w: r.w - 40, h: 58 };
    panel(r.x, r.y, r.w, r.h, "rgba(10,42,24,0.9)", dropDisabled("stable") ? "rgba(120,128,140,0.35)" : "#57e585", true);
    text("穩定性區域", r.x + r.w / 2, r.y + 34, 24, "#aaff9a", "900", "center");
    if (app.mode === "tutorial-stable") {
      const arrowX = r.x - 10 + Math.sin(t * 0.008) * 2.5;
      const col = "rgba(150, 255, 200, 0.9)";
      for (let i = 0; i < 3; i++) {
        text("▶", arrowX, r.y + r.h * (0.24 + i * 0.28), 18, col, "900", "right");
      }
    }
    strokeRect(app.zones.stable.x, app.zones.stable.y, app.zones.stable.w, app.zones.stable.h, dropDisabled("stable") ? "rgba(160,168,178,0.35)" : "#57e585", 3, [7, 6]);
    drawStableCountOnly(app.zones.stable.x, app.zones.stable.y, app.zones.stable.w, app.zones.stable.h);
  }

  function drawDeckArea(time) {
    const r = { x: app.w - 292, y: app.h - 318, w: 268, h: 88 };
    app.zones.deck = r;
    panel(r.x, r.y, r.w, r.h, "rgba(12,26,44,0.88)", "rgba(132,184,236,0.46)");
    text("牌庫", r.x + 24, r.y + 34, 20, "#d8ecff", "900");
    drawDeckRemainingStack(r.x + r.w - 64, r.y + 16);
    const count = app.deckRemainingCount;
    const label = count <= 0 ? "空" : count <= 3 ? "少" : "多";
    const pulse = 0.7 + Math.sin(time * 0.004) * 0.15;
    text(label, r.x + 24, r.y + 56, 13, `rgba(210,232,255,${pulse})`, "800");
  }

  function drawHand(time) {
    const cardW = 122;
    const cardH = 164;
    const gap = 10;
    const total = app.hand.length * cardW + Math.max(0, app.hand.length - 1) * gap;
    const x = app.w / 2 - total / 2;
    const y = app.h - 270;
    app.zones.cards = [];
    app.hand.forEach((card, i) => {
      if (app.drag && app.drag.card.id === card.id) return;
      const rect = { x: x + i * (cardW + gap), y, w: cardW, h: cardH };
      app.zones.cards.push({ card, index: i, rect });
      if (app.mode === "tutorial-mistake" && card.type === "mistake") {
        drawMistakeCardGlow(rect, time);
      }
      drawCard(card, rect.x, rect.y, rect.w, rect.h, false, { blind: bossCardBlind(card) });
    });
  }

  function drawMistakeCardGlow(rect, time) {
    const t = typeof time === "number" ? time : performance.now();
    const pulse = 0.65 + Math.sin(t * 0.006) * 0.25;
    const ctx = app.ctx;
    ctx.save();
    ctx.globalAlpha = 0.32 + pulse * 0.18;
    ctx.filter = `blur(${10 + pulse * 8}px)`;
    fillRoundRect(rect.x - 8, rect.y - 8, rect.w + 16, rect.h + 16, 16, "rgba(209, 213, 219, 0.55)");
    ctx.filter = "none";
    ctx.restore();
  }

  /** QTE 進行中：手牌縮小收在右下角，不註冊 zones（不與節奏圈搶點擊）。 */
  function drawHandRhythmCorner() {
    const ctx = app.ctx;
    const n = app.hand.length;
    if (!n) return;
    const cardW = 56;
    const cardH = 76;
    const pivot = { x: app.w - 42, y: app.h - 38 };
    for (let i = 0; i < n; i++) {
      const card = app.hand[i];
      if (app.drag && app.drag.card.id === card.id) continue;
      const t = n <= 1 ? 0.5 : i / (n - 1);
      const ang = -Math.PI * 0.73 - 0.11 + t * 0.22;
      const rr = 14 + i * 5;
      const cx = pivot.x + Math.cos(ang) * rr;
      const cy = pivot.y + Math.sin(ang) * rr;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.translate(cx, cy);
      ctx.rotate(ang + Math.PI * 0.48);
      drawCard(card, -cardW / 2, -cardH / 2, cardW, cardH, false, { blind: bossCardBlind(card) });
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /** 卡牌中心圖示（24×24 座標系，於中心縮放繪製） */
  function drawCardCenterIcon(card, cx, cy, iconSize) {
    const ctx = app.ctx;
    ctx.save();
    ctx.translate(cx, cy);
    const sc = iconSize / 24;
    ctx.scale(sc, sc);
    ctx.translate(-12, -12);
    if (card.type === "accel" || card.type === "hyper_accel") {
      const hyper = card.type === "hyper_accel";
      const g = ctx.createLinearGradient(3, 2, 20, 22);
      if (hyper) {
        g.addColorStop(0, "#fed7aa");
        g.addColorStop(0.45, "#fb923c");
        g.addColorStop(1, "#c2410c");
      } else {
        g.addColorStop(0, "#fdba74");
        g.addColorStop(0.5, "#ea580c");
        g.addColorStop(1, "#9a3412");
      }
      ctx.beginPath();
      ctx.moveTo(13.2, 2.2);
      ctx.lineTo(3.8, 15.2);
      ctx.lineTo(10.4, 15.2);
      ctx.lineTo(6.6, 22.6);
      ctx.lineTo(21.2, 8.4);
      ctx.lineTo(13.6, 8.4);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = hyper ? "rgba(124, 45, 18, 0.9)" : "rgba(92, 42, 18, 0.88)";
      ctx.lineWidth = 0.85;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(15.5, 6.5);
      ctx.lineTo(10.2, 13.2);
      ctx.lineTo(12.4, 13.2);
      ctx.lineTo(9.8, 17.2);
      ctx.lineTo(17.5, 9.2);
      ctx.closePath();
      ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
      ctx.fill();
    } else if (card.type === "mistake") {
      const rg = ctx.createLinearGradient(5, 6, 18, 20);
      rg.addColorStop(0, "#d1d5db");
      rg.addColorStop(0.45, "#9ca3af");
      rg.addColorStop(1, "#4b5563");
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.moveTo(4.8, 17.8);
      ctx.quadraticCurveTo(5.5, 10.8, 10.2, 8.4);
      ctx.quadraticCurveTo(12.4, 4.6, 16.2, 7.6);
      ctx.quadraticCurveTo(20.1, 8.8, 20.6, 15.8);
      ctx.quadraticCurveTo(17.2, 20.6, 10.6, 20.2);
      ctx.quadraticCurveTo(6.5, 20.1, 4.8, 17.8);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#374151";
      ctx.lineWidth = 0.85;
      ctx.stroke();
      ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
      ctx.beginPath();
      ctx.ellipse(10.1, 10.6, 2.7, 1.4, -0.45, 0, Math.PI * 2);
      ctx.fill();
    } else if (card.type === "reward_buff") {
      const hx = 12;
      const hy = 12;
      const R = 9;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        const px = hx + R * Math.cos(a);
        const py = hy + R * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      const rg = ctx.createRadialGradient(8, 7, 1.5, hx, hy, 11);
      rg.addColorStop(0, "#e8f0ff");
      rg.addColorStop(0.35, "#8fb4ff");
      rg.addColorStop(0.7, "#4d6ee8");
      rg.addColorStop(1, "#283878");
      ctx.fillStyle = rg;
      ctx.fill();
      ctx.strokeStyle = "#1a2860";
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hx, 5.2);
      ctx.lineTo(16.2, 10.2);
      ctx.lineTo(hx, 10.2);
      ctx.lineTo(7.8, 10.2);
      ctx.closePath();
      ctx.fillStyle = "rgba(255, 255, 255, 0.38)";
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(hx, 11.2);
      ctx.lineTo(15.2, 17.5);
      ctx.lineTo(hx, 15.8);
      ctx.lineTo(8.8, 17.5);
      ctx.closePath();
      ctx.fillStyle = "rgba(20, 40, 100, 0.22)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      ctx.lineWidth = 0.45;
      ctx.beginPath();
      ctx.moveTo(5.5, 12);
      ctx.lineTo(18.5, 12);
      ctx.stroke();
    } else if (card.type === "throttle") {
      const tg = ctx.createLinearGradient(6, 3, 18, 21);
      tg.addColorStop(0, "#fdba74");
      tg.addColorStop(0.55, "#f97316");
      tg.addColorStop(1, "#c2410c");
      ctx.beginPath();
      ctx.moveTo(12, 2.4);
      ctx.quadraticCurveTo(17.2, 8.5, 16.2, 12.8);
      ctx.quadraticCurveTo(18.8, 14.8, 12, 22.6);
      ctx.quadraticCurveTo(5.2, 14.8, 7.8, 12.8);
      ctx.quadraticCurveTo(6.8, 8.5, 12, 2.4);
      ctx.closePath();
      ctx.fillStyle = tg;
      ctx.fill();
      ctx.strokeStyle = "#7c2d12";
      ctx.lineWidth = 0.75;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(12, 11.5, 4.2, 2.1, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * 遊戲卡牌元件：手牌、拖曳、進站三選一共用。
   * @param {object} [opts] `pickOffer`：進站選牌（顯示稀有度角標、分類小字，版面與手牌 reward 一致）
   */
  function cardViewModel(card) {
    const value = card.value || (card.type === "hyper_accel" ? "+3" : card.type === "mistake" ? "+0" : card.type === "accel" ? "+2" : "");
    const description = card.effect || card.note || value || "";
    return {
      name: card.name || "",
      category: card.category || "",
      rarity: card.rarity || "",
      description,
    };
  }

  function drawBlindDesertRace(time) {
    const ctx = app.ctx;
    const w = app.w;
    const h = app.h;
    const hitShake = bossHitFxProgress(time);
    const shakeX = hitShake ? (Math.sin(time * 0.11 + app.bossHitFx.seed) * 9 + Math.sin(time * 0.047) * 5) * (1 - hitShake.t) : 0;
    const shakeY = hitShake ? Math.cos(time * 0.095 + app.bossHitFx.seed) * 6 * (1 - hitShake.t) : 0;
    ctx.save();
    ctx.translate(shakeX, shakeY);
    ctx.clearRect(0, 0, w, h);
    if (app.bossCgReady || bossCgImage.complete) {
      const iw = bossCgImage.naturalWidth || 16;
      const ih = bossCgImage.naturalHeight || 9;
      const scale = Math.max(w / iw, h / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      ctx.drawImage(bossCgImage, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else {
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#07131a");
      bg.addColorStop(0.42, "#5f3b20");
      bg.addColorStop(1, "#140c08");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.fillStyle = "rgba(5, 10, 16, 0.34)";
    ctx.fillRect(0, 0, w, h);
    const horizon = h * 0.38;
    const roadFadeStart = horizon + (h - horizon) * 0.16;
    const road = ctx.createLinearGradient(0, horizon, 0, h);
    road.addColorStop(0, "rgba(60, 50, 42, 0)");
    road.addColorStop(0.08, "rgba(60, 50, 42, 0)");
    road.addColorStop(0.22, "rgba(60, 50, 42, 0.46)");
    road.addColorStop(1, "rgba(28, 22, 18, 0.88)");
    ctx.fillStyle = road;
    ctx.beginPath();
    ctx.moveTo(w * 0.46, horizon);
    ctx.lineTo(w * 0.54, horizon);
    ctx.lineTo(w * 0.90, h);
    ctx.lineTo(w * 0.10, h);
    ctx.closePath();
    ctx.fill();
    const edge = ctx.createLinearGradient(0, horizon, 0, h);
    edge.addColorStop(0, "rgba(255, 215, 112, 0)");
    edge.addColorStop(0.18, "rgba(255, 215, 112, 0.22)");
    edge.addColorStop(1, "rgba(255, 215, 112, 0.56)");
    ctx.strokeStyle = edge;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w * 0.46, roadFadeStart);
    ctx.lineTo(w * 0.12, h);
    ctx.moveTo(w * 0.54, roadFadeStart);
    ctx.lineTo(w * 0.88, h);
    ctx.stroke();

    for (let i = 0; i < 34; i++) {
      const p = ((i / 34) + (time * 0.00038) % 1) % 1;
      const y = roadFadeStart + p * p * (h - roadFadeStart);
      const spread = p * w * 0.40;
      ctx.strokeStyle = `rgba(255,226,150,${0.12 + p * 0.28})`;
      ctx.lineWidth = Math.max(1, p * 4);
      ctx.beginPath();
      ctx.moveTo(w * 0.5 - spread * 0.22, y);
      ctx.lineTo(w * 0.5 - spread * 0.22, y + 16 + p * 24);
      ctx.moveTo(w * 0.5 + spread * 0.22, y);
      ctx.lineTo(w * 0.5 + spread * 0.22, y + 16 + p * 24);
      ctx.stroke();
    }

    const bossY = h * 0.53;
    const bossW = Math.min(178, Math.max(126, w * 0.12));
    const bossH = bossW * 0.43;
    const bossX = carLaneX("red", time, bossY, bossW);
    drawDesertBossCar(bossX, bossY, bossW, bossH, time);
    if (hitShake) drawBossHitBurst(bossX, bossY, bossW, bossH, hitShake.t, time);
    drawBossHealthBar(bossX, bossY + bossH * 0.74, bossW * 1.06, 16);
    drawCar(carLaneX("white", time, h * 0.80, 126), h * 0.80, 126, 58, "#e8f0ff");
    drawBossSandstorm(time);
    ctx.restore();
    if (hitShake) drawBossHitScreenFlash(hitShake.t);
  }

  function bossHitFxProgress(time) {
    if (!app.bossHitFx) return null;
    const t = Math.max(0, Math.min(1, (time - app.bossHitFx.t0) / 920));
    return { t };
  }

  function drawBossHitScreenFlash(t) {
    const ctx = app.ctx;
    const a = Math.max(0, (1 - t) * 0.46);
    ctx.save();
    ctx.fillStyle = `rgba(255, 236, 170, ${a})`;
    ctx.fillRect(0, 0, app.w, app.h);
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = `rgba(255, 118, 64, ${Math.max(0, (0.55 - t) * 0.28)})`;
    ctx.fillRect(0, 0, app.w, app.h);
    ctx.restore();
  }

  function drawBossHitBurst(x, y, w, h, t, time) {
    const ctx = app.ctx;
    const ease = 1 - Math.pow(1 - t, 3);
    const alpha = Math.max(0, 1 - t);
    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = "screen";
    ctx.strokeStyle = `rgba(255, 239, 150, ${alpha})`;
    ctx.lineWidth = 7 * alpha + 1;
    ctx.lineCap = "round";
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI * 0.92 + i * 0.34 + Math.sin(app.bossHitFx.seed + i) * 0.18;
      const r0 = w * (0.12 + ease * 0.10);
      const r1 = w * (0.36 + ease * 0.62 + i * 0.015);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0 - h * 0.05);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1 - h * 0.05);
      ctx.stroke();
    }

    ctx.fillStyle = `rgba(255, 197, 84, ${0.82 * alpha})`;
    for (let i = 0; i < 46; i++) {
      const seed = i * 19.33 + app.bossHitFx.seed;
      const a = seed % (Math.PI * 2);
      const d = w * (0.16 + ease * (0.22 + (i % 7) * 0.045));
      const px = Math.cos(a) * d + Math.sin(time * 0.006 + seed) * 6;
      const py = Math.sin(a) * d * 0.55 + Math.cos(time * 0.005 + seed) * 4;
      const r = 1.5 + (i % 4) * 0.9;
      ctx.globalAlpha = alpha * (0.55 + (i % 5) * 0.09);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = alpha;
    ctx.font = '1000 30px system-ui, "Microsoft JhengHei", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff0b8";
    ctx.shadowColor = "rgba(255, 78, 42, 0.85)";
    ctx.shadowBlur = 14;
    ctx.fillText("HIT!", 0, -h * 0.94 - ease * 18);
    ctx.restore();
  }

  function drawDesertBossCar(x, y, w, h, time) {
    const ctx = app.ctx;
    ctx.save();
    ctx.translate(x, y);
    const tilt = Math.sin(time * 0.0016) * 0.025;
    ctx.rotate(tilt);
    ctx.fillStyle = "rgba(0,0,0,0.56)";
    ctx.beginPath();
    ctx.ellipse(0, h * 0.52, w * 0.55, h * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();

    const body = ctx.createLinearGradient(-w * 0.5, -h * 0.35, w * 0.5, h * 0.38);
    body.addColorStop(0, "#8d5526");
    body.addColorStop(0.48, "#c58a3b");
    body.addColorStop(1, "#5b331a");
    ctx.fillStyle = body;
    beginRoundRectPath(ctx, -w * 0.46, -h * 0.24, w * 0.92, h * 0.54, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 218, 126, 0.55)";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.fillStyle = "#3b2518";
    beginRoundRectPath(ctx, -w * 0.25, -h * 0.48, w * 0.50, h * 0.28, 8);
    ctx.fill();
    ctx.fillStyle = "rgba(92, 220, 230, 0.72)";
    ctx.fillRect(-w * 0.18, -h * 0.42, w * 0.36, h * 0.12);

    ctx.fillStyle = "#2a1a12";
    ctx.fillRect(-w * 0.54, h * 0.18, w * 0.16, h * 0.22);
    ctx.fillRect(w * 0.38, h * 0.18, w * 0.16, h * 0.22);
    ctx.fillStyle = "#f6c35c";
    ctx.fillRect(-w * 0.38, -h * 0.02, w * 0.14, h * 0.10);
    ctx.fillRect(w * 0.24, -h * 0.02, w * 0.14, h * 0.10);

    ctx.strokeStyle = "rgba(255, 231, 150, 0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-w * 0.42, -h * 0.22);
    ctx.lineTo(-w * 0.18, h * 0.28);
    ctx.moveTo(w * 0.42, -h * 0.22);
    ctx.lineTo(w * 0.18, h * 0.28);
    ctx.stroke();
    ctx.restore();
  }

  function drawBossHealthBar(cx, y, w, h) {
    const ctx = app.ctx;
    const x = cx - w / 2;
    const segments = Math.max(1, app.bossHpMax);
    const gap = 5;
    const segW = (w - gap * (segments - 1)) / segments;
    text("血量", cx, y - 9, 13, "#ffd36f", "900", "center", true);
    roundPanel(x - 8, y - 5, w + 16, h + 12, 9, "rgba(30, 18, 10, 0.72)", "rgba(255, 211, 116, 0.48)", 2);
    for (let i = 0; i < segments; i++) {
      const sx = x + i * (segW + gap);
      const alive = i < app.bossHp;
      const fill = alive ? "rgba(188, 58, 38, 0.88)" : "rgba(78, 50, 28, 0.42)";
      const stroke = alive ? "rgba(255, 178, 105, 0.88)" : "rgba(255, 214, 132, 0.22)";
      roundPanel(sx, y, segW, h, 5, fill, stroke, 1.5);
      if (alive) {
        ctx.fillStyle = "rgba(255, 216, 128, 0.28)";
        ctx.fillRect(sx + 4, y + 3, Math.max(0, segW - 8), 3);
      }
    }
  }

  function drawBossSandstorm(time) {
    const ctx = app.ctx;
    const w = app.w;
    const h = app.h;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 70; i++) {
      const x = ((i * 97 + time * 0.16) % (w + 260)) - 180;
      const y = (i * 53 + time * 0.08) % h;
      const len = 70 + (i % 5) * 34;
      ctx.strokeStyle = `rgba(255, 219, 139, ${0.05 + (i % 4) * 0.018})`;
      ctx.lineWidth = 1 + (i % 3);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y - 22);
      ctx.stroke();
    }
    ctx.restore();

    const g = ctx.createRadialGradient(w * 0.5, h * 0.52, h * 0.08, w * 0.5, h * 0.5, h * 0.8);
    g.addColorStop(0, "rgba(255, 204, 115, 0.03)");
    g.addColorStop(0.72, "rgba(166, 101, 42, 0.18)");
    g.addColorStop(1, "rgba(8, 10, 12, 0.24)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function bossCardBlind(card) {
    return !!(app.bossStage && card && !card.revealed && app.bossBlindPlaysRemaining > 0 && app.hand.includes(card));
  }

  function drawCard(card, x, y, w, h, dragging, opts) {
    const ctx = app.ctx;
    const pickOffer = !!(opts && opts.pickOffer);
    const blind = !!(opts && opts.blind);
    let view = cardViewModel(card);
    if (blind) {
      view = {
        name: "盲牌",
        category: "沙暴遮蔽",
        rarity: "",
        description: "?",
      };
    }
    ctx.save();
    ctx.globalAlpha = dragging ? 0.88 : 1;
    ctx.shadowColor = "rgba(0,0,0,0.34)";
    ctx.shadowBlur = dragging ? 18 : 12;
    ctx.shadowOffsetX = dragging ? 5 : 4;
    ctx.shadowOffsetY = dragging ? 10 : 7;
    const g = ctx.createLinearGradient(x, y, x, y + h);
    if (card.type === "throttle") {
      g.addColorStop(0, "#fff6e8");
      g.addColorStop(1, "#ecd8b6");
    } else if (card.type === "hyper_accel") {
      g.addColorStop(0, "#fff9f0");
      g.addColorStop(1, "#f0dcc8");
    } else if (card.type === "reward_buff") {
      g.addColorStop(0, "#f4f8ff");
      g.addColorStop(1, "#dce6f2");
    } else {
      g.addColorStop(0, "#faf8f4");
      g.addColorStop(1, "#e8e2d6");
    }
    fillRoundRect(x, y, w, h, 12, g);
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    const barH = 4;
    const barGap = 7;
    const barTop = y + h - barH;
    ctx.save();
    beginRoundRectPath(ctx, x, y, w, h, 12);
    ctx.clip();
    const rarityBar = view.rarity === "稀有"
      ? "#d9a72f"
      : view.rarity === "普通"
        ? "#7f90a8"
        : card.type === "throttle" ? "#8f7d62" : card.type === "hyper_accel" ? "#c45c28" : card.type === "reward_buff" ? "#4a6a9e" : "#5c6f63";
    ctx.fillStyle = rarityBar;
    ctx.fillRect(x, barTop, w, barH);
    ctx.restore();
    text(view.name, x + 14, y + 26, 16, "#3d3528", "900", "left", true);
    if (view.category) {
      text(view.category, x + 14, y + 46, 12, "#5a6b82", "800", "left", true);
    }
    const cx = x + w / 2;
    const isRb = card.type === "reward_buff";
    const hasDescription = !!view.description;
    const iconSize = isRb && pickOffer ? 34 : isRb ? 42 : 50;
    let iconCy = isRb ? y + h * (pickOffer ? 0.33 : 0.34) : y + h * 0.42;
    if (hasDescription && !isRb) iconCy -= pickOffer ? 2 : 4;
    if (!blind) drawCardCenterIcon(card, cx, iconCy, iconSize);
    let descriptionTop = barTop - 12;
    if (hasDescription) {
      const descSize = blind ? 38 : isRb ? (pickOffer ? 10 : 10.5) : pickOffer ? 10.5 : 13;
      const lineH = isRb ? descSize + 3 : descSize + 5;
      const padX = 14;
      const maxLines = blind ? 1 : isRb ? 3 : pickOffer ? 3 : 2;
      const lines = wrapTextToLines(view.description, w - padX * 2, descSize, maxLines);
      const totalH = lines.length * lineH;
      descriptionTop = blind ? y + h * 0.56 - totalH / 2 : isRb ? barTop - 10 - totalH : barTop - 16 - totalH;
      let ty = descriptionTop + descSize * 0.82;
      for (let li = 0; li < lines.length; li++) {
        text(lines[li], cx, ty, descSize, blind ? "#fff0b8" : "#3a4558", blind ? "1000" : "800", "center", true);
        ty += lineH;
      }
    }
    if (blind) drawBlindCardSandVeil(x, y, w, h);
    ctx.restore();
  }

  function drawBlindCardSandVeil(x, y, w, h) {
    const ctx = app.ctx;
    ctx.save();
    beginRoundRectPath(ctx, x, y, w, h, 12);
    ctx.clip();
    const haze = ctx.createLinearGradient(x, y, x + w, y + h);
    haze.addColorStop(0, "rgba(246, 194, 105, 0.14)");
    haze.addColorStop(0.5, "rgba(126, 82, 38, 0.42)");
    haze.addColorStop(1, "rgba(250, 213, 135, 0.18)");
    ctx.fillStyle = haze;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(255, 226, 145, 0.48)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const yy = y + 18 + i * 17;
      ctx.beginPath();
      ctx.moveTo(x - 18, yy);
      ctx.lineTo(x + w + 18, yy - 20);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(8, 12, 18, 0.16)";
    ctx.fillRect(x + 10, y + 52, w - 20, 56);
    ctx.shadowColor = "rgba(255, 218, 126, 0.65)";
    ctx.shadowBlur = 10;
    text("?", x + w / 2, y + 93, 40, "#fff0b8", "1000", "center", true);
    ctx.restore();
    drawSandParticles(x - 20, y - 12, w + 40, h + 42, {
      count: 78,
      alpha: 0.88,
      size: 1.15,
      drift: 30,
      fade: 22,
      seedOffset: 31,
    });
  }

  function drawSandParticles(x, y, w, h, opts = {}) {
    const ctx = app.ctx;
    const count = opts.count || 70;
    const alpha = opts.alpha ?? 0.72;
    const size = opts.size || 1;
    const drift = opts.drift || 24;
    const fade = Math.max(1, opts.fade || 18);
    const seedOffset = opts.seedOffset || 0;
    const t = performance.now() * 0.001;
    ctx.save();
    for (let i = 0; i < count; i++) {
      const seed = (i + 1) * 41.733 + seedOffset;
      const nx = fract(Math.sin(seed * 12.9898) * 43758.5453 + t * (0.045 + (i % 5) * 0.012));
      const ny = fract(Math.sin(seed * 78.233) * 23454.153 + t * (0.13 + (i % 7) * 0.035));
      const px = x + nx * w + Math.sin(t * 1.1 + seed) * drift;
      const py = y + ny * h + Math.cos(t * 0.9 + seed * 0.7) * drift * 0.35;
      let edgeA = 1;
      edgeA *= Math.min(1, Math.max(0, (px - x) / fade), Math.max(0, (x + w - px) / fade));
      edgeA *= Math.min(1, Math.max(0, (py - y) / fade), Math.max(0, (y + h - py) / fade));
      if (edgeA <= 0) continue;
      const r = (0.75 + (i % 5) * 0.28) * size;
      ctx.globalAlpha = edgeA * alpha * (0.58 + (i % 4) * 0.12);
      ctx.fillStyle = i % 4 === 0 ? "#c9822e" : i % 4 === 1 ? "#e0a64d" : i % 4 === 2 ? "#f5c96c" : "#ffe09a";
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function fract(n) {
    return n - Math.floor(n);
  }

  /** 穩定性區小卡背（向量風格，不顯示牌名） */
  function drawStableCardBackChip(ctx, x, y, w, h, cornerR, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "#e4ebe6");
    g.addColorStop(0.55, "#c5d0c8");
    g.addColorStop(1, "#9daf9f");
    beginRoundRectPath(ctx, x, y, w, h, cornerR);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(34, 72, 44, 0.55)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = "rgba(87, 229, 133, 0.35)";
    ctx.beginPath();
    ctx.moveTo(x + 5, y + h * 0.38);
    ctx.lineTo(x + w - 5, y + h * 0.38);
    ctx.stroke();
    ctx.restore();
  }

  /** 穩定性區：以卡背 SVG 風格表示張數（1～2 實張；3+ 扇形重疊表示很多） */
  function drawStableCountOnly(boxX, boxY, boxW, boxH) {
    const ctx = app.ctx;
    const n = app.stable.length;
    const cw = 26;
    const ch = 38;
    const cornerR = 4;
    if (n === 0) return;
    if (n <= 2) {
      const gap = 8;
      const totalW = n * cw + (n - 1) * gap;
      const sx0 = boxX + (boxW - totalW) / 2;
      const sy = boxY + (boxH - ch) / 2;
      for (let i = 0; i < n; i++) {
        drawStableCardBackChip(ctx, sx0 + i * (cw + gap), sy, cw, ch, cornerR, 1);
      }
      return;
    }
    const vis = Math.min(5, n);
    const px = boxX + boxW / 2;
    const py = boxY + boxH - 2;
    const maxAng = 0.48;
    for (let i = 0; i < vis; i++) {
      const t = vis <= 1 ? 0 : (i / (vis - 1)) * 2 - 1;
      const ang = t * maxAng;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      drawStableCardBackChip(ctx, -cw / 2, -ch, cw, ch, cornerR, 0.88 + i * 0.028);
      ctx.restore();
    }
  }

  function drawDeckRemainingStack(cx, y) {
    const ctx = app.ctx;
    const count = app.deckRemainingCount;
    const cardW = 28;
    const cardH = 40;
    const visibleCards = count <= 0 ? 0 : count <= 3 ? 2 : 4;
    const x = cx - cardW / 2;

    ctx.save();
    if (visibleCards === 0) {
      strokeRect(x, y, cardW, cardH, "rgba(190,198,210,0.42)", 2, [4, 4]);
      ctx.restore();
      return;
    }
    for (let i = 0; i < visibleCards; i++) {
      const dy = i * 5;
      const alpha = 0.72 + i * 0.07;
      drawStableCardBackChip(ctx, x, y + dy, cardW, cardH, 5, alpha);
    }
    ctx.restore();
  }

  function drawMiniCards(list, boxX, boxY, boxW, boxH) {
    if (list.length === 0) return;
    const chipW = 58;
    const chipH = 32;
    const gap = 8;
    const totalW = list.length * chipW + (list.length - 1) * gap;
    const startX = boxX + Math.max(0, (boxW - totalW) / 2);
    const startY = boxY + Math.max(0, (boxH - chipH) / 2);
    list.forEach((card, i) => {
      const cx = startX + i * (chipW + gap);
      panel(cx, startY, chipW, chipH, "#2d3236", "rgba(247,250,247,0.18)");
      text(card.name, cx + chipW / 2, startY + 21, 14, "#f1f5ff", "800", "center");
    });
  }

  function getTutorialModalBox() {
    const margin = 24;
    /** 教學提示寬度：約 70vw（canvas 邏輯寬等同視窗），並保留左右 margin */
    const vw = 0.7;
    const w = Math.min(app.w * vw, app.w - margin * 2);
    const h = Math.min(400, app.h - margin * 2);
    return { x: (app.w - w) / 2, y: (app.h - h) / 2, w, h };
  }

  function getCenteredModalBox(maxW, maxH) {
    const margin = 24;
    const w = Math.min(maxW, app.w - margin * 2);
    const h = Math.min(maxH, app.h - margin * 2);
    return { x: (app.w - w) / 2, y: (app.h - h) / 2, w, h };
  }

  function drawModalPanel(box, stroke = "#ffd94f") {
    panel(box.x, box.y, box.w, box.h, "rgba(8,16,27,0.92)", stroke);
  }

  function drawTutorial() {
    const isStable = app.mode === "tutorial-stable";
    const box = getTutorialModalBox();
    drawModalPanel(box);
    const padX = 32;
    text("教學提示", box.x + padX, box.y + 58, 30, "#dfeeff", "900");
    text(teachingPageText(), box.x + padX, box.y + 100, 28, "#ffd94f", "900");
    const bodyMaxW = box.w - padX * 2;
    if (isStable) {
      wrapText("將 1 張牌拖曳到穩定性區域。放入這裡的牌不會發動效果，但會讓超車更簡單。", box.x + padX, box.y + 136, bodyMaxW, 18, "#f4f8ff", 4);
    } else {
      text("將任意 4 張加速牌拖曳到打出區。", box.x + padX, box.y + 148, 19, "#f4f8ff", "900");
    }
    const demoY = box.y + box.h * 0.54;
    const cardS = 100;
    const targetW = 200;
    const targetH = 100;
    const gapAfterCard = 36;
    const arrowBand = isStable ? 56 : 40;
    const rowW = cardS + gapAfterCard + arrowBand + targetW;
    const rowLeft = box.x + (box.w - rowW) / 2;
    panel(rowLeft, demoY - 50, cardS, targetH, "rgba(55,60,68,0.95)", "rgba(190,198,210,0.82)");
    text("卡牌", rowLeft + cardS / 2, demoY + 6, 22, "#eef4ff", "900", "center");
    const targetX = rowLeft + cardS + gapAfterCard + arrowBand;
    if (isStable) {
      const arrowX = targetX - 10;
      text("→", arrowX, demoY + 6, 34, "rgba(160, 230, 200, 0.92)", "900", "right");
    } else {
      const arrowCx = rowLeft + cardS + gapAfterCard + arrowBand / 2;
      text("→", arrowCx, demoY + 6, 34, "rgba(214,222,235,0.88)", "900", "center");
    }
    strokeRect(targetX, demoY - 50, targetW, targetH, "rgba(190,198,210,0.82)", 4, [9, 7]);
    text(isStable ? "穩定性區域" : "打出區", targetX + targetW / 2, demoY + 8, 22, "#eef4ff", "900", "center");
    button("tutorial-ok", "確定", box.x + box.w - 180, box.y + box.h - 68, 160, 48);
  }

  function drawMistakeTutorial() {
    const box = getTutorialModalBox();
    drawModalPanel(box);
    const padX = 32;
    text("教學提示", box.x + padX, box.y + 58, 30, "#dfeeff", "900");
    text(teachingPageText(), box.x + padX, box.y + 100, 28, "#ffd94f", "900");

    const cardW = 86;
    const cardH = 116;
    const demoY = box.y + box.h * 0.55;
    const rowW = cardW + 36 + 360;
    const rowLeft = box.x + (box.w - rowW) / 2;
    drawCard({ ...CARD_TYPES.mistake, id: "tutorial-mistake-demo" }, rowLeft, demoY - cardH / 2, cardW, cardH, false);

    const tx = rowLeft + cardW + 36;
    text("再厲害的車手也難免有失誤。", tx, demoY - 34, 19, "#f4f8ff", "900");
    text("打出失誤是不能加速的，", tx, demoY + 2, 18, "#f4f8ff", "800");
    text("好好善用它吧。", tx, demoY + 36, 18, "#d1d5db", "900");
    button("mistake-tutorial-ok", "確定", box.x + box.w - 180, box.y + box.h - 68, 160, 48);
  }

  function drawOvertakeReadyModal() {
    const box = getCenteredModalBox(520, 260);
    drawModalPanel(box);
    text("超車準備", box.x + 36, box.y + 56, 28, "#dfeeff", "900");
    text(`加速度達到指定值（${effectiveOvertakeTarget()}），`, box.x + 36, box.y + 112, 18, "#f4f8ff", "800");
    text("可以開始超車", box.x + 36, box.y + 138, 18, "#ffd94f", "900");
    text(`目前加速值：${accelValue()}`, box.x + 36, box.y + 174, 16, "rgba(214,228,255,0.82)", "700");
    drawOvertakeReadyIcon(box.x + box.w - 152, box.y + 86, 104, 88);
    button("overtake", "開始超車", box.x + box.w / 2 - 110, box.y + box.h - 64, 220, 52, !canStartOvertake());
  }

  function drawOvertakeReadyIcon(x, y, w, h) {
    const ctx = app.ctx;
    ctx.save();
    roundPanel(x, y, w, h, 14, "rgba(8,18,32,0.64)", "rgba(255,217,79,0.36)", 1.5);
    ctx.strokeStyle = "rgba(255,217,79,0.58)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.5, y + 10);
    ctx.lineTo(x + w * 0.5, y + h - 10);
    ctx.stroke();
    drawCar(x + w * 0.36, y + h * 0.60, 42, 22, "#dceaff", { shadowAlpha: 0.36 });
    drawCar(x + w * 0.66, y + h * 0.38, 34, 18, "#e94d48", { shadowAlpha: 0.36 });
    text("↑", x + w * 0.73, y + h * 0.78, 24, "#ffd94f", "1000", "center", true);
    ctx.restore();
  }

  function drawStartReadyModal() {
    const padX = 40;
    const bodyLines = [
      "這是一場結合卡牌與操作的賽車比賽。",
      null,
      "你將先打出加速牌累積速度，",
      "接著在超車階段抓準節奏完成超車。",
      null,
      "超車成功後，還需要穩住車身，",
      "在防守階段守住領先位置。",
      null,
      "按下開始，進行遊戲。",
    ];
    const box = getCenteredModalBox(520, 400);
    drawModalPanel(box);
    const cx = box.x + box.w / 2;
    const ctx = app.ctx;
    const hrInset = 8;
    const drawHrAt = yLine => {
      ctx.save();
      ctx.strokeStyle = "rgba(120, 170, 220, 0.5)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(box.x + padX + hrInset, yLine);
      ctx.lineTo(box.x + box.w - padX - hrInset, yLine);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    };

    const bodyColor = "#e8f0ff";
    text("準備起跑", cx, box.y + 52, 28, "#dfeeff", "900", "center");
    drawHrAt(box.y + 86);
    let y = box.y + 116;
    let lastTextBaseline = y;
    for (const line of bodyLines) {
      if (line === null) {
        y += 8;
        continue;
      }
      text(line, cx, y, 16, bodyColor, "700", "center");
      lastTextBaseline = y;
      y += 20;
    }
    const bottomHrY = lastTextBaseline + 30;
    drawHrAt(bottomHrY);
    button("start-tutorial", "開始遊戲", cx - 214, bottomHrY + 28, 200, 48, false, "start");
    button("debug-boss-transition", "進入 Boss 關", cx + 14, bottomHrY + 28, 200, 48);
  }

  function drawBossIntroModal() {
    const box = getCenteredModalBox(600, 360);
    drawModalPanel(box, "#ffd94f");
    const cx = box.x + box.w / 2;
    const padX = 42;
    text("Boss 關：盲牌沙漠", cx, box.y + 58, 30, "#ffe082", "1000", "center");
    text("沙暴會干擾你的判斷，但不是整手牌都失去資訊。", cx, box.y + 98, 17, "#e8f0ff", "800", "center");

    const y0 = box.y + 132;
    const itemX = box.x + padX;
    drawBossIntroBullet(itemX, y0, "成功超車 3 次，才能擊破 Boss。");
    drawBossIntroBullet(itemX, y0 + 42, "每回合前兩次打出的牌會是盲牌。");
    drawBossIntroBullet(itemX, y0 + 84, "視線會被風沙遮蔽。");

    button("boss-intro-start", "開始挑戰", cx - 110, box.y + box.h - 72, 220, 50);
  }

  function drawBossIntroBullet(x, y, line) {
    const ctx = app.ctx;
    ctx.save();
    ctx.fillStyle = "rgba(255, 217, 79, 0.92)";
    ctx.beginPath();
    ctx.arc(x + 8, y - 6, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    text(line, x + 26, y, 18, "#f4f8ff", "800");
  }

  function drawQteTeachingModal() {
    const isOvertake = app.mode === "tutorial-overtake-qte";
    const page = Math.max(0, Math.min(QTE_TUTORIAL_TOTAL - 1, app.qteTeachPage || 0));
    const box = getCenteredModalBox(640, 380);
    drawModalPanel(box);
    const cx = box.x + box.w / 2;
    const title = isOvertake ? "超車 QTE 教學" : "阻擋 QTE 教學";
    text(title, cx, box.y + 54, 30, "#dfeeff", "900", "center");
    text(teachingPageText(), box.x + 36, box.y + 96, 26, "#ffd94f", "900");

    if (isOvertake) {
      drawOvertakeQteTeachPage(box, page);
    } else {
      drawDefenseQteTeachPage(box, page);
    }

    const last = page >= QTE_TUTORIAL_TOTAL - 1;
    const btnId = last ? (isOvertake ? "qte-tutorial-start-overtake" : "qte-tutorial-start-defense") : "qte-tutorial-next";
    const btnText = last ? (isOvertake ? "開始超車" : "開始防守") : "下一頁";
    button(btnId, btnText, box.x + box.w - 196, box.y + box.h - 68, 160, 48);
  }

  function drawOvertakeQteTeachPage(box, page) {
    const cx = box.x + box.w / 2;
    const demoY = box.y + 218;
    if (page === 0) {
      text("圓圈會由大往內收縮，接近拍點時點擊。", cx, box.y + 124, 19, "#f4f8ff", "900", "center");
      text("點擊範圍是外圈內部，不必剛好點在中心。", cx, box.y + 154, 17, "rgba(214,228,255,0.84)", "800", "center");
      for (let i = 0; i < 3; i++) {
        const x = cx - 110 + i * 110;
        drawQteDemoCircle(x, demoY, 34, 0.25 + i * 0.22);
      }
      text("看準節奏，連續點完 5 顆。", cx, box.y + 292, 17, "#ffd94f", "900", "center");
      return;
    }
    text("判定會分成 Perfect、Good、Miss。", cx, box.y + 124, 19, "#f4f8ff", "900", "center");
    text("越接近拍點，越容易拿到好判定。", cx, box.y + 154, 17, "rgba(214,228,255,0.84)", "800", "center");
    const labels = [
      { grade: "perfect", label: "Perfect" },
      { grade: "good", label: "Good" },
      { grade: "miss", label: "Miss" },
    ];
    labels.forEach((item, i) => {
      const x = cx - 120 + i * 120;
      drawQteCircle(x, demoY, 34, 1, item.grade, false, true, true, 1150, 1150);
      text(item.label, x, demoY + 66, 16, item.grade === "miss" ? "#ffb4b8" : "#d7ffe4", "900", "center");
    });
  }

  function drawDefenseQteTeachPage(box, page) {
    const cx = box.x + box.w / 2;
    const demoY = box.y + 212;
    const bar = { x: cx - 210, y: demoY, w: 420, h: 52 };
    if (page === 0) {
      text("防守時要移動滑鼠，追住綠色安全區。", cx, box.y + 124, 19, "#f4f8ff", "900", "center");
      text("黃色游標停在綠區內，防守進度會更快累積。", cx, box.y + 154, 17, "rgba(214,228,255,0.84)", "800", "center");
      roundPanel(bar.x, bar.y, bar.w, bar.h, 10, "rgba(229,70,74,0.86)", "rgba(247,250,247,0.35)", 2);
      roundPanel(bar.x + 155, bar.y, 110, bar.h, 9, "rgba(122,221,123,0.60)", "rgba(122,221,123,0.30)", 2);
      roundPanel(bar.x + 194, bar.y, 32, bar.h, 8, "rgba(37,209,127,0.86)", "rgba(37,209,127,0.26)", 2);
      roundPanel(bar.x + 192, bar.y + bar.h / 2 - 12, 36, 24, 6, "#ffd94f", "#ffe15b", 2);
      text("紅區外危險，綠區安全，中心更好。", cx, box.y + 292, 17, "#ffd94f", "900", "center");
      return;
    }
    text("撐到時間結束，或把進度條推滿就成功。", cx, box.y + 124, 19, "#f4f8ff", "900", "center");
    text("穩定性越高，防守會越容易。", cx, box.y + 154, 17, "rgba(214,228,255,0.84)", "800", "center");
    panel(bar.x, bar.y + 8, bar.w, 18, "rgba(14,20,30,0.92)", "rgba(247,250,247,0.18)");
    app.ctx.fillStyle = "#57e585";
    app.ctx.fillRect(bar.x + 3, bar.y + 11, (bar.w - 6) * 0.72, 12);
    text("防守進度", cx, bar.y - 12, 18, "#d7e6f8", "900", "center");
    text("保持游標在綠區，讓進度穩定前進。", cx, box.y + 292, 17, "#ffd94f", "900", "center");
  }

  function drawSplash() {
    const age = Math.min(1, (performance.now() - app.qteStart) / 1500);
    const scale = 0.65 + Math.sin(age * Math.PI) * 0.55 + age * 0.35;
    const ctx = app.ctx;
    ctx.save();
    ctx.globalAlpha = age < 0.8 ? 1 : (1 - age) / 0.2;
    ctx.translate(app.w / 2, app.h / 2 - 70);
    ctx.scale(scale, scale);
    text(app.message, 0, 0, 72, "#ff4040", "1000", "center");
    ctx.restore();
  }

  function drawRhythm(time) {
    if (!isRhythmMode()) {
      app.zones.circles = [];
      return;
    }
    const minY = statusHudRect().y + statusHudRect().h + RHYTHM_OUTER_R + RHYTHM_UI_AVOID_PAD;
    const maxY = app.h - RHYTHM_OUTER_R - RHYTHM_UI_AVOID_PAD;
    const yLine = Math.min(maxY, Math.max(app.h * 0.42, minY));
    const gap = Math.min(130, app.w * 0.085);
    const startX = app.w / 2 - gap * 2;
    app.zones.circles = [];
    for (let i = 0; i < 5; i++) {
      if (app.qteDismissAt[i] != null && time >= app.qteDismissAt[i]) continue;
      const start = app.qteCircleStarts[i] || app.qteStart;
      const elapsed = time - start;
      if (elapsed < 0) continue;
      const duration = getRhythmDuration(i);
      const ratio = Math.min(1, elapsed / duration);
      const pos = app.qteScatterPos && isRhythmMode()
        ? app.qteScatterPos[i]
        : { x: startX + i * gap, y: yLine };
      const { x, y } = pos;
      const result = app.qteResults[i];
      const isFormal = isRhythmMode();
      const finalized = !!app.qteFinalized[i];
      const showOutcome = !!result && (!isFormal || finalized);
      const displayOutcome = showOutcome && result ? result : null;
      const drawn = drawQteCircle(x, y, RHYTHM_OUTER_R, ratio, displayOutcome, false, isFormal, finalized, elapsed, duration);
      if (app.bossStage && !displayOutcome) drawBossQteObscure(x, y, RHYTHM_OUTER_R, i, time);
      const activeEnd = start + duration;
      if (!isFormal) {
        if (drawn) app.zones.circles.push({ x, y, r: RHYTHM_OUTER_R, i, duration });
      } else if (!finalized && elapsed >= 0 && time <= activeEnd) {
        app.zones.circles.push({ x, y, r: RHYTHM_OUTER_R, i, duration });
      }
    }
  }

  function drawBossQteObscure(x, y, r, i, time) {
    const ctx = app.ctx;
    const phase = time * 0.004 + i * 1.7;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r + 14, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "rgba(111, 72, 32, 0.20)";
    ctx.fillRect(x - r - 16, y - r - 16, (r + 16) * 2, (r + 16) * 2);
    ctx.strokeStyle = "rgba(255, 222, 142, 0.58)";
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    for (let k = 0; k < 4; k++) {
      const yy = y - r + 16 + k * 22 + Math.sin(phase + k) * 8;
      ctx.beginPath();
      ctx.moveTo(x - r - 18, yy);
      ctx.lineTo(x + r + 22, yy - 20 - Math.cos(phase + k) * 8);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 可點擊範圍外圈：極細實線黃色（固定半徑，永遠畫在最上層之一） */
  function drawQteYellowTargetRing(ctx, x, y, outerR) {
    if (!isRhythmMode()) return;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 236, 170, 0.92)";
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, y, outerR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawQteDemoCircle(x, y, r, ratio) {
    const ctx = app.ctx;
    const innerR = Math.max(6, r * (1 - ratio));
    ctx.save();
    ctx.fillStyle = "rgba(80, 160, 255, 0.18)";
    ctx.strokeStyle = "rgba(150, 205, 255, 0.72)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 210, 95, 0.34)";
    ctx.beginPath();
    ctx.arc(x, y, innerR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** 節奏判定結果：整顆外圓半透明填色 + 實心細線外框（與可點範圍一致） */
  function drawQteRhythmOutcomeDisk(ctx, x, y, outerR, grade) {
    ctx.save();
    let fill;
    let stroke;
    if (grade === "perfect" || grade === "hit") {
      fill = "rgba(72, 255, 150, 0.30)";
      stroke = "rgba(130, 255, 185, 0.95)";
    } else if (grade === "good") {
      fill = "rgba(64, 220, 200, 0.28)";
      stroke = "rgba(120, 245, 225, 0.92)";
    } else {
      fill = "rgba(255, 88, 102, 0.30)";
      stroke = "rgba(255, 160, 165, 0.95)";
    }
    ctx.beginPath();
    ctx.arc(x, y, outerR, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.25;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 節奏圈：進行中外圈極細黃線（固定 r）＋內部半透明由大→小收縮（僅視覺；點擊以整個外圓 r 判定）。
   * outcome：perfect / good / miss / hit（教學）為整顆外圓半透明填色＋細線外框。
   */
  function drawQteCircle(x, y, r, ratio, outcome, frozenTutorial, isFormal, finalized, elapsed, duration) {
    const ctx = app.ctx;
    const outerR = r;
    if (outcome === "perfect" || outcome === "hit") {
      drawQteRhythmOutcomeDisk(ctx, x, y, outerR, "perfect");
      return true;
    }
    if (outcome === "good") {
      drawQteRhythmOutcomeDisk(ctx, x, y, outerR, "good");
      return true;
    }
    if (outcome === "miss") {
      drawQteRhythmOutcomeDisk(ctx, x, y, outerR, "miss");
      return true;
    }
    if (frozenTutorial) {
      ctx.save();
      ctx.fillStyle = "rgba(255, 224, 120, 0.42)";
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 200, 70, 0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      drawQteYellowTargetRing(ctx, x, y, outerR);
      return true;
    }
    const inGrace = isFormal && !finalized && elapsed > duration;
    const shrinking = !finalized && (inGrace ? false : elapsed >= 0);
    if (!shrinking && !inGrace) return false;

    if (!inGrace && ratio > 0.001) {
      const innerR = Math.max(0, outerR * (1 - ratio));
      if (innerR > 0.8) {
        ctx.save();
        ctx.fillStyle = "rgba(255, 210, 95, 0.38)";
        ctx.beginPath();
        ctx.arc(x, y, innerR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 190, 70, 0.42)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }
    }
    drawQteYellowTargetRing(ctx, x, y, outerR);
    return true;
  }

  function drawDefense() {
    const ctx = app.ctx;
    const bar = { x: app.w / 2 - 360, y: app.h * 0.36, w: 720, h: 72 };
    app.zones.defenseBar = bar;
    const diff = defenseDifficulty();
    const safeW = bar.w * (diff.safeWidth / 100);
    const perfectW = bar.w * (diff.perfectWidth / 100);
    const blindDesert = app.bossStage && app.bossStageName === "盲牌沙漠";
    panel(bar.x - 24, bar.y - 34, bar.w + 48, 172, blindDesert ? "rgba(48,33,10,0.48)" : "rgba(5,8,8,0.42)", blindDesert ? "rgba(255,202,93,0.36)" : "rgba(105,164,224,0.35)");
    roundPanel(bar.x, bar.y, bar.w, bar.h, 12, blindDesert ? "rgba(166,112,33,0.78)" : "rgba(229,70,74,0.9)", blindDesert ? "rgba(255,223,137,0.36)" : "rgba(247,250,247,0.35)", 2);
    const safeX = bar.x + (app.safeCenter / 100) * bar.w - safeW / 2;
    roundPanel(safeX, bar.y, safeW, bar.h, 10, blindDesert ? "rgba(216,159,50,0.50)" : "rgba(122,221,123,0.58)", blindDesert ? "rgba(255,226,137,0.24)" : "rgba(122,221,123,0.28)", 2);
    roundPanel(bar.x + (app.safeCenter / 100) * bar.w - perfectW / 2, bar.y, perfectW, bar.h, 8, blindDesert ? "rgba(255,206,86,0.64)" : "rgba(37,209,127,0.86)", blindDesert ? "rgba(255,235,160,0.24)" : "rgba(37,209,127,0.26)", 2);
    const cursorX = Math.max(bar.x, Math.min(bar.x + bar.w, app.mouse.x));
    roundPanel(cursorX - 18, bar.y + bar.h / 2 - 12, 36, 24, 6, "#ffd94f", "#ffe15b", 2);
    if (blindDesert) {
      drawDefenseSandstorm(bar.x - 46, bar.y - 44, bar.w + 92, bar.h + 118);
    }
    panel(bar.x, bar.y + 104, bar.w, 18, "rgba(14,20,30,0.92)", "rgba(247,250,247,0.18)");
    ctx.fillStyle = blindDesert ? "#d99b31" : "#57e585";
    ctx.fillRect(bar.x + 3, bar.y + 107, (bar.w - 6) * Math.min(1, Math.max(0, app.defenseProgress) / 100), 12);
    text(blindDesert ? "沙暴遮住判定區，追住最亮的黃色區域" : "移動滑鼠，追住快速移動的綠色區域", app.w / 2, bar.y + 152, 20, "#ffd94f", "900", "center");
  }

  function drawDefenseSandstorm(x, y, w, h) {
    const ctx = app.ctx;
    ctx.save();
    const fade = ctx.createRadialGradient(x + w / 2, y + h / 2, h * 0.18, x + w / 2, y + h / 2, Math.max(w, h) * 0.58);
    fade.addColorStop(0, "rgba(198, 126, 42, 0.12)");
    fade.addColorStop(0.62, "rgba(205, 135, 44, 0.18)");
    fade.addColorStop(1, "rgba(205, 135, 44, 0)");
    ctx.fillStyle = fade;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(246, 194, 98, 0.34)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 13; i++) {
      const yy = y + 10 + i * 13 + Math.sin(performance.now() * 0.004 + i) * 7;
      ctx.beginPath();
      ctx.moveTo(x + 12, yy);
      ctx.lineTo(x + w - 10, yy - 34);
      ctx.stroke();
    }
    ctx.restore();
    drawSandParticles(x, y, w, h, {
      count: 150,
      alpha: 0.92,
      size: 1.25,
      drift: 36,
      fade: 46,
      seedOffset: 113,
    });
  }

  function drawResult() {
    hideGameWinOverlay();
    const boxY = app.h * 0.28;
    const boxH = 280;
    panel(app.w / 2 - 310, boxY, 620, boxH, "rgba(4,8,8,0.58)", "#57e585");
    text("本圈獲勝", app.w / 2, boxY + 70, 48, "#57e585", "1000", "center");
    text("成功超越一台車子", app.w / 2, boxY + 126, 24, "#f4f8ff", "900", "center");
    text(`本圈名次 ${app.rank}/${app.rankTotal}`, app.w / 2, boxY + 166, 24, "#f4f8ff", "900", "center");
    button("next-lap", "下一圈", app.w / 2 - 110, boxY + 200, 220, 52);
  }

  function drawDefenseResult() {
    const ctx = app.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, app.w, app.h);
    const boxY = app.h * 0.3;
    const success = app.defenseSucceeded;
    panel(app.w / 2 - 280, boxY, 560, 220, "rgba(6,14,24,0.92)", "#69a4e0");
    text(success ? "防守成功！" : "防守失敗！", app.w / 2, boxY + 88, 40, success ? "#57e585" : "#ff6b7a", "1000", "center");
    text(success ? "加速值保留，準備結算本圈成績" : "加速值歸零，準備重新加速", app.w / 2, boxY + 140, 18, "#d7e6f8", "700", "center");
    button("defense-result-ok", "繼續", app.w / 2 - 100, boxY + 158, 200, 48);
  }

  function drawLapResult() {
    const ctx = app.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, app.w, app.h);
    const boxY = app.h * 0.28;
    panel(app.w / 2 - 310, boxY, 620, 260, "rgba(4,8,8,0.72)", "#57e585");
    text("本圈獲勝", app.w / 2, boxY + 70, 48, "#57e585", "1000", "center");
    text("成功超越一台車子", app.w / 2, boxY + 126, 24, "#f4f8ff", "900", "center");
    text(`本圈名次 ${app.rank}/${app.rankTotal}`, app.w / 2, boxY + 166, 24, "#f4f8ff", "900", "center");
    button("lap-result-continue", "繼續", app.w / 2 - 110, boxY + 200, 220, 52);
  }

  function hitRewardSlot(p) {
    const slots = app.zones.rewardSlots;
    if (!slots) return -1;
    for (let i = 0; i < slots.length; i++) {
      if (inRect(p, slots[i])) return i;
    }
    return -1;
  }

  function drawCardRewardScreen(time) {
    const ctx = app.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.68)";
    ctx.fillRect(0, 0, app.w, app.h);
    const titleY = app.h * 0.1;
    text("進站調校", app.w / 2, titleY, 36, "#ffe082", "1000", "center");
    text("選擇一張卡加入牌庫", app.w / 2, titleY + 44, 18, "#d7e6f8", "700", "center");
    if (!app.seenRewardTutorial) {
      text("每圈結束後，你可以選擇一張卡加入牌庫。", app.w / 2, titleY + 82, 15, "rgba(244,248,255,0.88)", "700", "center");
      text("新的卡牌會影響之後的速度、超車 QTE 或防守 QTE。", app.w / 2, titleY + 104, 15, "rgba(244,248,255,0.88)", "700", "center");
      text("每次三選一都會出現一張稀有卡（固定在最右側）。", app.w / 2, titleY + 126, 15, "rgba(180, 210, 255, 0.92)", "800", "center");
    }
    const cardW = 140;
    const cardH = 188;
    const gap = Math.max(18, Math.min(26, app.w * 0.018));
    const total = 3 * cardW + 2 * gap;
    const baseX = app.w / 2 - total / 2;
    const baseY = app.h * 0.35;
    app.zones.rewardSlots = [];
    const pick = app.rewardPickAnim;
    const pickSlot = pick ? pick.slot : -1;
    const pickAge = pick ? (time - pick.t0) / 520 : 0;
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.006);
    for (let s = 0; s < 3; s++) {
      const card = app.rewardOptions[s];
      if (!card) continue;
      let x = baseX + s * (cardW + gap);
      let y = baseY;
      let sc = 1;
      const hover = app.rewardHoverSlot === s && !pick;
      if (hover) {
        sc = 1.06;
        y -= 8;
      }
      if (pick && pickSlot === s) {
        sc = 1 + 0.14 * Math.min(1, pickAge * 1.8);
        y -= 12 * Math.min(1, pickAge * 2);
      }
      const cx = x + cardW / 2;
      const cy = y + cardH / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(sc, sc);
      const isRare = card.rarity === "稀有";
      if (isRare) {
        ctx.shadowColor = `rgba(255, 210, 80, ${0.35 + pulse * 0.35})`;
        ctx.shadowBlur = 22 + pulse * 12;
      }
      if (pick && pickSlot === s) {
        const g = Math.min(1, pickAge * 3);
        ctx.shadowColor = `rgba(255, 240, 120, ${0.5 + g * 0.45})`;
        ctx.shadowBlur = 28 + g * 40;
      }
      ctx.translate(-cx, -cy);
      drawRewardOfferCard(card, x, y, cardW, cardH, isRare);
      ctx.restore();
      app.zones.rewardSlots.push({ x, y, w: cardW, h: cardH });
    }
    if (app.mode === "card-reward-toast") {
      text("已加入牌庫", app.w / 2, app.h * 0.78, 28, "#ffe082", "1000", "center");
    } else {
      button("reward-skip", "略過", app.w / 2 - 72, baseY + cardH + 34, 144, 44, !!app.rewardPickAnim, "gray");
    }
  }

  function wrapTextToLines(str, maxW, size, maxLines) {
    const ctx = app.ctx;
    ctx.save();
    ctx.font = `700 ${size}px system-ui, "Microsoft JhengHei", sans-serif`;
    const lines = [];
    let start = 0;
    const n = str.length;
    while (start < n && lines.length < maxLines) {
      if (lines.length === maxLines - 1) {
        lines.push(str.slice(start));
        break;
      }
      let lo = start + 1;
      let hi = n;
      let best = start + 1;
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2);
        const w = ctx.measureText(str.slice(start, mid)).width;
        if (w <= maxW) {
          best = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      let end = best;
      if (end < n && end > start) {
        const chunk = str.slice(start, end);
        const sp = chunk.lastIndexOf(" ");
        if (sp > 0 && sp >= chunk.length * 0.32) end = start + sp + 1;
      }
      lines.push(str.slice(start, end));
      start = end;
      while (start < n && str[start] === " ") start++;
    }
    ctx.restore();
    return lines;
  }

  /** 進站三選一：外框 + 與手牌相同的 `drawCard` 本體 */
  function drawRewardOfferCard(card, x, y, w, h, isRare) {
    const ctx = app.ctx;
    ctx.save();
    const border = isRare ? "rgba(230, 190, 80, 0.92)" : "rgba(100, 120, 150, 0.45)";
    roundPanel(x - 3, y - 3, w + 6, h + 6, 14, "rgba(10, 16, 28, 0.96)", border, isRare ? 3.5 : 1.75);
    drawCard(card, x, y, w, h, false, { pickOffer: true });
    ctx.restore();
  }

  function wrapText(str, x, y, maxW, size, color, maxLines) {
    const ctx = app.ctx;
    ctx.save();
    ctx.font = `700 ${size}px system-ui, "Microsoft JhengHei", sans-serif`;
    let line = "";
    let yy = y;
    let lines = 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      const test = line + ch;
      if (ctx.measureText(test).width > maxW && line) {
        text(line, x, yy, size, color, "700", "left", true);
        line = ch;
        yy += size + 4;
        lines++;
        if (lines >= maxLines) break;
      } else {
        line = test;
      }
    }
    if (lines < maxLines && line) text(line, x, yy, size, color, "700", "left", true);
    ctx.restore();
  }

  function drawCenterMessage(message, color) {
    text(message, app.w / 2, app.h * 0.42, 34, color, "1000", "center");
  }

  function button(id, label, x, y, w, h, disabled = false, variant = "primary") {
    app.zones.buttons.push({ id, rect: { x, y, w, h }, disabled });
    const gray = variant === "gray";
    const start = variant === "start";
    const fill = disabled
      ? gray ? "rgba(54,60,70,0.45)" : start ? "rgba(91,34,34,0.52)" : "rgba(20,44,72,0.5)"
      : gray ? "rgba(70,76,88,0.88)" : start ? "rgba(169,39,42,0.94)" : "rgba(20,44,72,0.9)";
    const stroke = gray ? "rgba(190,198,210,0.46)" : start ? "rgba(255,188,108,0.88)" : "rgba(105,164,224,0.55)";
    if (start && !disabled) {
      const ctx = app.ctx;
      ctx.save();
      ctx.shadowColor = "rgba(255, 74, 54, 0.42)";
      ctx.shadowBlur = 18;
      roundPanel(x - 2, y - 2, w + 4, h + 4, 10, "rgba(255, 78, 54, 0.16)", "rgba(255, 211, 116, 0.34)", 2);
      ctx.restore();
    }
    roundPanel(x, y, w, h, 10, fill, stroke);
    if (start && !disabled) {
      app.ctx.fillStyle = "rgba(255, 219, 130, 0.18)";
      app.ctx.fillRect(x + 8, y + 7, w - 16, 6);
    }
    text(label, x + w / 2, y + 31, 18, disabled ? "rgba(216,236,255,0.55)" : start ? "#fff4d6" : "#d8ecff", start ? "1000" : "800", "center");
  }

  function hitButton(p) {
    const hit = (app.zones.buttons || []).find(item => !item.disabled && inRect(p, item.rect));
    return hit && hit.id;
  }

  function meter(label, value, x, y, pct, color) {
    text(label, x, y, 18, "#d7e6f8", "800");
    text(value, x + 226, y, 18, "#f4f8ff", "800", "right");
    panel(x, y + 16, 232, 18, "rgba(10,16,28,0.9)", "rgba(154,190,232,0.62)");
    app.ctx.fillStyle = color;
    app.ctx.fillRect(x + 4, y + 20, 224 * Math.min(1, pct / 100), 10);
  }

  function panel(x, y, w, h, fill, stroke = "rgba(255,255,255,0.2)", dashed = false) {
    roundPanel(x, y, w, h, 10, fill, stroke, 3, dashed ? [8, 6] : []);
  }

  function beginRoundRectPath(ctx, x, y, w, h, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function fillRoundRect(x, y, w, h, radius, fillStyle) {
    const ctx = app.ctx;
    beginRoundRectPath(ctx, x, y, w, h, radius);
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }

  function roundPanel(x, y, w, h, radius, fill, stroke = "rgba(255,255,255,0.2)", line = 3, dash = []) {
    const ctx = app.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = line;
    ctx.setLineDash(dash);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function strokeRect(x, y, w, h, color, line = 2, dash = []) {
    roundPanel(x, y, w, h, 10, "rgba(0,0,0,0)", color, line, dash);
  }

  function text(message, x, y, size, color, weight = "700", align = "left", noShadow = false) {
    const ctx = app.ctx;
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px system-ui, "Microsoft JhengHei", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    if (!noShadow) {
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 6;
    }
    ctx.fillText(message, x, y);
    ctx.restore();
  }

  function inRect(p, r) {
    return r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }

  function dist(x1, y1, x2, y2) {
    return Math.hypot(x1 - x2, y1 - y2);
  }

  return { start };
})();

document.addEventListener("DOMContentLoaded", initQteTest);

