// ─── App 狀態 ─────────────────────────────────────────────────────────────
// 跨整個遊戲共享的狀態。一個遊戲只有一份。
// 所有模組透過 import { app } from './state.js' 來讀寫。

export const app = {
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
  // 空力區（穩定區）：本回合塞進來的牌數、每張讓道路節奏降一階（封頂 easy）
  // 在 stage2StartNewRound 重置；丟牌不觸發對手、不算行動
  stabilityCharges: 0,
  stabilityChargesMax: 3,
  stabilityDropFx: null,   // { until } — 丟牌後的閃光提示
  cardsPlayedThisRound: 0,
  opponentActionsThisStage: [],
  // 對手行為冷卻系統
  opponentBehaviors: null,            // [{ id, cooldown, weight, action, ... }] | null
  opponentBehaviorLastTriggered: null, // { [behaviorId]: actionClock }
  opponentTurnAnim: null,             // { startTime, endTime, behavior } | null — 對手回合過場
  opponentBoostFlash: null,           // { startTime, until } | null — 加速頻閃計時
  opponentAuraBypassed: false,        // B 清道夫強招：當下動作對手豁免自己光環
  opponentAbsBonusActive: false,      // B 清道夫強招：本動結算用 abs(差) 取代一般結算

  // 玩家動作待結算（玩家動作前半 → 對手過場 → 動作後半結算）
  //   { kind: "lane" | "card" | "team", card, laneCost, lanesCrossed } | null
  //   - lane: 換道、扣 laneCost
  //   - card: 打牌到本道、加 cardValue
  //   - team: 車隊牌、無速度效果
  pendingAction: null,
  // 玩家上一個動作開始前所在的道（對手 AI 用：對手目標 = 這條道）
  // 設計：對手在玩家動作前「預測」目標、不追真實位置 → 玩家可換道閃過
  // 每個玩家動作開始時更新（換道前先記）
  playerLaneBeforeAction: 0,

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

  // 對手行動視覺提示
  opponentActionFx: null,  // { label, until }

  // 速度結算飛字系統（每個來源一個 pop，依序冒出車身上方）
  // queue: 待播放的 pop，每隔 SPEED_POP_INTERVAL 從 queue 取一個移到 active
  // active: 正在播放動畫的 pop
  //   每筆形狀：{ target: "player"|"opponent", text, color, bornAt, duration }
  speedPopsQueue:  [],     // [{ target, text, color, durationOverride? }]
  speedPopsActive: [],     // [{ target, text, color, bornAt, duration }]
  speedPopsNextSpawnAt: { player: 0, opponent: 0 },  // 下次可從 queue 取的時間

  // 飛字播放期間鎖玩家輸入（拖牌、超車、PASS 都擋）
  // 由 deferUntilSpeedPopsClear() 設、tickSpeedPopGates() 在閘門觸發時清
  inputLocked: false,


  // 超車過場動畫
  overtakeAnim: null,  // { startTime, phase } phase: "approach"→"pass"→"recede"

  // 賽道加成
  laneBonus: null,  // { lane, speedMult, label } | null（舊格式，向下相容）
  laneBonuses: null, // [{ lane, speedMult, qteDiff, label }] | null（新格式，每道各自加成）

  // 賽道寬度比例（1.0 = 預設寬，<1 = 較窄）
  roadWidthScale: 1.0,

  // ─── 主關卡專用狀態 ─────────────────────────────────────────────────────
  stage2: null,
  /* stage2 結構（loadStage(0) 時建立）：
     {
       ahead: ["A","B","C"],                // 前方對手陣容
       passed: [],                          // 已超過的對手（不會回來追）
       currentOpponentId: "A" | null,       // 當前對手（前方）；null 表示要重抽
       pinnedNextOpponentId: null,          // 「剛超過你」的指定對手（被反超後填）
       chaserId: null,                       // 當前後方追車對手 id；null=無後車
       circuitIndex: 0,                      // 賽道圈索引（0..4）
       circuitJustChanged: false,            // 切賽道後第一回合的 flag
       deckPermanent: [],                    // 玩家累積牌庫（永久，從三選一加入）
       teamCardsActive: [],                  // 場上車隊牌
       rewardOptions: [],                    // 三選一卡選項
       rewardPickAnim: null,
       rewardSlotHover: -1,
       tailwindActive: 0,                    // 順風 buff：下張 cost-1
       penaltyNextHand: 0,                   // 孤注一擲：下回合手牌減少
       seenIntro: false,                     // 是否看過開場
     }
  */
};
