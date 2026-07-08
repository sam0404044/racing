// ─── 霓虹大獎賽週末編排器（run.js）──────────────────────────────────────
// 持有整個「賽事週末」的跨賽段狀態與流程狀態機：
//   intro → ① 自由練習（引擎/可跳）→ ② 排位賽（quali.js）→ 起跑格
//         → ③ 衝刺賽（引擎）→ 兌換（buff＋獎勵牌）→ ④ 正賽（引擎、NCC-7）→ 週末總結
//
// 與比賽引擎的接縫：startSessionRace(cfg) 進、cfg.onComplete(result) 出。
// 賽段之間的 shell 畫面（DOM）＝ 日後經營層的掛載點。

import { start, startSessionRace } from './game.js?v=neongp-39-revert';
import {
  STAGE2_OPPONENTS, STAGE2_ALL_CARDS,
  WEEKEND_ROSTER, SPRINT_BUFFS,
  SPRINT_REWARD_POOL_STRONG, SPRINT_REWARD_POOL_NORMAL,
  BASE_DECK_TYPES, QUALI_POOL_SIZE, QUALI_FILLER_CARD,
} from './config.js';

// ─── 週末跨賽段狀態 ────────────────────────────────────────────────────
const weekend = {
  deck: [],            // 永久牌庫（整個週末累積、跨賽段沿用）
  grid: null,          // 排位結果：9 個 id、index 0 = P1
  circuitOrder: null,  // 排位洗出的賽段順序、整個週末沿用（同一條賽道）
  playerGridPos: null, // 玩家起跑格（1-based）
  sprintRank: null,    // 衝刺賽名次
  sprintDNF: false,    // 衝刺賽是否爆胎 DNF（輪胎不跨賽事、每場滿胎起跑）
  buffs: [],           // 兌換到的進場 buff id
  rewardCardName: null,
  practiceResult: null,
  mainResult: null,
};

let _cardSeq = 0;
function makeRunCard(type) {
  const def = STAGE2_ALL_CARDS[type];
  if (!def) return { type, name: `[?] ${type}`, speedValue: 0, cardClass: "action", id: `${type}-run-${_cardSeq++}` };
  return { ...def, id: `${type}-run-${_cardSeq++}` };
}

function driverName(id) {
  if (id === "PLAYER") return "你的車隊";
  return STAGE2_OPPONENTS[id]?.name || id;
}

// 排位格前方的車手 id（最佳在前 = 引擎 ahead 格式 [第1名, ..., 玩家前一名]）
function aheadOfPlayer() {
  const idx = weekend.grid.indexOf("PLAYER");
  return weekend.grid.slice(0, idx);
}

// 排位格後方的車手 id（玩家身後、由近到遠）
function behindOfPlayer() {
  const idx = weekend.grid.indexOf("PLAYER");
  return weekend.grid.slice(idx + 1);
}

// ─── Shell（DOM 畫面）────────────────────────────────────────────────
const shell = document.querySelector("#shellRoot");
function showShell(html) {
  shell.style.display = "flex";
  shell.innerHTML = `<div class="sh-panel">${html}</div>`;
}
function hideShell() {
  shell.style.display = "none";
  shell.innerHTML = "";
}
function on(sel, fn) {
  const el = shell.querySelector(sel);
  if (el) el.addEventListener("click", fn);
}

const SCHEDULE_HTML = `
  <ol class="sh-schedule">
    <li><b>① 自由練習</b> — 正式比賽前的暖身時段。賽道開放試跑、熟悉路況，成績不列入計算，隨時可以收工。</li>
    <li><b>② 排位賽</b> — 決定起跑順位的計時賽。9 台車同場跑 3 圈，每圈結束、累積速度最慢的 3 台淘汰。最後停在第幾名，正賽就從第幾名發車。</li>
    <li><b>③ 衝刺賽</b> — 正賽前夜的短程賽。距離短、節奏快；名次越前面，車隊賽前能做的準備就越充足。</li>
    <li><b>④ 正賽</b> — 週末的壓軸戰。要想得到第 1 名，就得超過 <b>NCC-7</b>。</li>
  </ol>`;

// ─── ⓪ 週末開場 ───────────────────────────────────────────────────────
function showIntro() {
  showShell(`
    <h1 class="sh-title">霓虹大獎賽週末</h1>
    <p class="sh-sub">霓虹道路——白天屬於企業大樓，入夜後屬於引擎聲。今晚街道封閉、燈牌亮起，一年一度的霓虹大獎賽週末開跑。<br>
    本周末將有 3 個賽事：自由練習 → 排位賽 → 正賽。</p>
    <div class="sh-btnrow">
      <button class="sh-btn sh-btn--start" data-act="practice">① 開始自由練習</button>
      <button class="sh-btn" data-act="skip-practice">跳過練習 → ② 排位賽</button>
    </div>`);
  on('[data-act="practice"]', startPractice);
  on('[data-act="skip-practice"]', showQualiIntro);
}

// ─── ① 自由練習（引擎、教學、可隨時結束）──────────────────────────────
function startPractice() {
  hideShell();
  startSessionRace({
    id: "practice",
    name: "① 自由練習 — 純沙盒、不結轉",
    tutorial: true,
    lineup: ["P"],          // 陪跑員＝名符其實的練習夥伴
    maxRounds: 12,
    allowQuit: true,        // 畫面常駐「結束練習」按鈕
    deckPermanent: weekend.deck,
    completeLabel: "結束練習 ➜",
    onComplete: (r) => {
      weekend.practiceResult = r;
      // 練習不結轉任何東西（連練習中三選一拿的牌也不帶走）— 純沙盒
      showQualiIntro();
    },
  });
}

// ─── ② 排位賽 ────────────────────────────────────────────────────────
// 排位指令包：由玩家牌庫（基礎牌庫＋獎勵牌）生成 — 取每張的速度值、特效不生效。
//   - 失誤牌不進池（懲罰牌不該出現在排位）
//   - 不足 QUALI_POOL_SIZE 張 → 以標準指令補滿
//   - 超過 → 先取前 N 張（demo 牌庫不會超過；日後牌庫成長時、這裡改出選牌介面）
function buildQualiPool() {
  const types = [...BASE_DECK_TYPES, ...weekend.deck.map(c => c.type)];
  const cards = [];
  for (const t of types) {
    const def = STAGE2_ALL_CARDS[t];
    if (!def || def.cardClass !== "action" || def.type === "mistake") continue;
    cards.push({ name: def.name, value: def.speedValue || 0 });
  }
  while (cards.length < QUALI_POOL_SIZE) {
    cards.push({ name: QUALI_FILLER_CARD.name, value: QUALI_FILLER_CARD.value, filler: true });
  }
  return cards.slice(0, QUALI_POOL_SIZE);
}

function showQualiIntro() {
  const pool = buildQualiPool();
  const poolHtml = pool.map(c =>
    `<span class="sh-chip${c.filler ? " sh-chip--filler" : ""}">${c.name} <b>+${c.value}</b></span>`
  ).join("");
  showShell(`
    <h2 class="sh-title">② 排位賽</h2>
    <p class="sh-sub">牌庫共 ${pool.length} 張指令卡，<b>5 張手牌輪流</b>——打 1 張、補 1 張、整副循環使用。<br>
    跑完一圈（所有賽段）、累積速度最慢的 3 台淘汰；被淘汰時的名次就是接下來比賽的起跑順位。</p>
    <p class="sh-sub sh-dim">你的牌庫（由牌庫組成、不足 ${QUALI_POOL_SIZE} 張以標準指令補滿）：</p>
    <div class="sh-chiprow">${poolHtml}</div>
    <div class="sh-btnrow"><button class="sh-btn sh-btn--start" data-act="go">開始排位賽</button></div>`);
  on('[data-act="go"]', () => {
    hideShell();
    startSessionRace({
      id: "quali",
      name: "② 排位賽",
      qualiMode: true,            // 無對手計時實跑、引擎自帶側欄榜與結束畫面
      deckPermanent: weekend.deck, // 指令包＝牌庫（去失誤＋標準指令補滿，引擎內處理）
      tiresStart: 5,              // 排位耗胎、滿胎起跑（輪胎不跨賽事）
      onComplete: (gridOrder, circuitOrder) => {
        weekend.grid = gridOrder;
        weekend.playerGridPos = gridOrder.indexOf("PLAYER") + 1;
        weekend.circuitOrder = circuitOrder;  // 整個週末同一條賽道
        showGridResult();
      },
    });
  });
}

function showGridResult() {
  const rows = weekend.grid.map((id, i) => {
    const isP = id === "PLAYER";
    return `<div class="sh-grid-row${isP ? " sh-grid-row--player" : ""}">
      <span>P${i + 1}</span><span>${driverName(id)}</span></div>`;
  }).join("");
  showShell(`
    <h2 class="sh-title">起跑格確定</h2>
    <p class="sh-sub">接下來你們將從 <b class="sh-big">P${weekend.playerGridPos}</b> 位起跑。</p>
    <div class="sh-grid">${rows}</div>
    <div class="sh-btnrow"><button class="sh-btn sh-btn--start" data-act="main">③ 進入正賽</button></div>`);
  on('[data-act="main"]', showMainIntro);
}

// ─── ③ 衝刺賽（引擎、短程）───────────────────────────────────────────
function startSprint() {
  const ahead = aheadOfPlayer();
  if (ahead.length === 0) {
    // 桿位起跑、前方無人 — 衝刺賽直接領跑到底
    weekend.sprintRank = 1;
    showShell(`
      <h2 class="sh-title">③ 衝刺賽</h2>
      <p class="sh-sub">桿位發車、前方無人。你一路領跑到底，沒人碰得到你——衝刺賽第 1 入袋。</p>
      <div class="sh-btnrow"><button class="sh-btn sh-btn--start" data-act="next">領取兌換 ➜</button></div>`);
    on('[data-act="next"]', showSprintRewards);
    return;
  }
  hideShell();
  startSessionRace({
    id: "sprint",
    name: "③ 衝刺賽 — 成績兌換 buff 與獎勵牌",
    tutorial: false,
    lineup: ahead,
    maxRounds: 8,           // 短程：1～2 個賽段迴圈的長度
    deckPermanent: weekend.deck,
    startRank: weekend.playerGridPos,
    rankTotal: WEEKEND_ROSTER.length,   // 9
    tiresStart: 5,                      // 衝刺賽全新一組胎
    circuitOrder: weekend.circuitOrder, // 沿用排位決定的賽道順序
    completeLabel: "完成衝刺賽 ➜",
    onComplete: (r) => {
      // 爆胎 DNF → 兌換視為墊底（空手進正賽）
      weekend.sprintDNF = !!r.tireOut;
      weekend.sprintRank = r.tireOut ? r.rankTotal : r.rank;
      // 輪胎不跨賽事：每場比賽都從滿胎開始（設計定案）
      weekend.deck = r.deckPermanent;   // 衝刺賽內三選一拿的牌、沿用進正賽
      showSprintRewards();
    },
  });
}

// 衝刺名次 → 兌換檔位
function sprintTier(rank) {
  if (rank === 1) return { buff: true, pool: SPRINT_REWARD_POOL_STRONG, label: "buff 三選一 ＋ 強牌池三選一" };
  if (rank <= 3) return { buff: true, pool: SPRINT_REWARD_POOL_NORMAL, label: "buff 三選一 ＋ 普通池三選一" };
  if (rank <= 6) return { buff: false, pool: SPRINT_REWARD_POOL_NORMAL, label: "普通池三選一" };
  return { buff: false, pool: null, label: "空手進正賽" };
}

function showSprintRewards() {
  const tier = sprintTier(weekend.sprintRank);
  if (tier.buff) {
    showBuffPick(tier);
  } else if (tier.pool) {
    showCardPick(tier);
  } else {
    showShell(`
      <h2 class="sh-title">${weekend.sprintDNF ? "衝刺賽 DNF（輪胎報銷）" : `衝刺賽第 ${weekend.sprintRank} 名`}</h2>
      <p class="sh-sub">${weekend.sprintDNF
        ? "輪胎沒撐到終點，車隊來不及為正賽做任何準備。"
        : "名次太靠後，車隊什麼準備都沒換到——空手上正賽。"}</p>
      <div class="sh-btnrow"><button class="sh-btn sh-btn--start" data-act="main">④ 進入正賽</button></div>`);
    on('[data-act="main"]', showMainIntro);
  }
}

function showBuffPick(tier) {
  const btns = SPRINT_BUFFS.map(b =>
    `<button class="sh-card" data-buff="${b.id}">
      <span class="sh-card-name">${b.name}</span>
      <span class="sh-card-note">${b.desc}</span>
    </button>`).join("");
  showShell(`
    <h2 class="sh-title">衝刺賽第 ${weekend.sprintRank} 名 — 車隊備戰：${tier.label}</h2>
    <p class="sh-sub">賽前最後的準備時間，選一項讓技師連夜處理（選什麼，就是你的打法）：</p>
    <div class="sh-cardrow">${btns}</div>`);
  shell.querySelectorAll("[data-buff]").forEach(el => {
    el.addEventListener("click", () => {
      weekend.buffs = [el.dataset.buff];
      showCardPick(tier);
    });
  });
}

function showCardPick(tier) {
  // 從池抽 3 個不重複 type
  const pool = [...tier.pool];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const options = pool.slice(0, 3).map(makeRunCard);
  const btns = options.map((c, i) =>
    `<button class="sh-card" data-card="${i}">
      <span class="sh-card-name">${c.name}${c.speedValue ? `　+${c.speedValue}` : ""}</span>
      <span class="sh-card-note">${c.note || ""}</span>
    </button>`).join("");
  showShell(`
    <h2 class="sh-title">新指令三選一（${tier.pool === SPRINT_REWARD_POOL_STRONG ? "頂級配備" : "常規配備"}）</h2>
    <p class="sh-sub">挑一道新指令進你的車隊手冊、正賽可用：</p>
    <div class="sh-cardrow">${btns}</div>
    <div class="sh-btnrow"><button class="sh-btn" data-act="skip">不用了，直接進正賽</button></div>`);
  shell.querySelectorAll("[data-card]").forEach(el => {
    el.addEventListener("click", () => {
      const picked = options[parseInt(el.dataset.card, 10)];
      weekend.deck = [...weekend.deck, picked];
      weekend.rewardCardName = picked.name;
      showMainIntro();
    });
  });
  on('[data-act="skip"]', showMainIntro);
}

// ─── ④ 正賽（引擎、NCC-7 空降）───────────────────────────────────────
function showMainIntro() {
  const buffNames = weekend.buffs.map(id => SPRINT_BUFFS.find(b => b.id === id)?.name).filter(Boolean);
  showShell(`
    <h2 class="sh-title">③ 正賽 — 決勝夜</h2>
    <p class="sh-sub">
      起跑格：<b>P${weekend.playerGridPos}</b>（前方 ${weekend.playerGridPos - 1} 台）<br>
      <b class="sh-warn">⚠ NCC-7 排在隊列最頂。</b>
    </p>
    <div class="sh-btnrow"><button class="sh-btn sh-btn--start" data-act="go">起跑</button></div>`);
  on('[data-act="go"]', startMainRace);
}

function startMainRace() {
  hideShell();
  startSessionRace({
    id: "main",
    name: "③ 正賽 — NCC-7 空降爭冠",
    tutorial: false,
    lineup: ["BOSS", ...aheadOfPlayer()],   // BOSS 永遠在隊列最頂
    behind: behindOfPlayer(),               // 玩家身後的車手（名次榜後段顯示）
    maxRounds: 15,
    deckPermanent: weekend.deck,
    startRank: weekend.playerGridPos,       // 玩家從排位名次起跑（NCC-7 不佔名次格）
    rankTotal: WEEKEND_ROSTER.length,       // 9 台人類；NCC-7 是隊列最頂的 boss、不計名次
    tiresStart: 5,                          // 輪胎不跨賽事：滿胎起跑
    circuitOrder: weekend.circuitOrder,     // 沿用排位決定的賽道順序
    buffs: weekend.buffs,
    isMainRace: true,
    completeLabel: "查看週末總結 ➜",
    onComplete: (r) => {
      weekend.mainResult = r;
      showSummary();
    },
  });
}

// ─── 週末總結（→ 日後經營層結算的掛載點）──────────────────────────────
function showSummary() {
  const r = weekend.mainResult;
  const won = !r.tireOut && r.rank === 1;
  showShell(`
    <h1 class="sh-title">${won ? "🏆 你擊敗了 NCC-7" : (r.tireOut ? "DNF — 輪胎報銷" : "週末結束")}</h1>
    <p class="sh-sub">${r.tireOut
      ? `正賽未完賽（輪胎歸零）— 跑了 ${r.rounds} 回合`
      : `正賽名次：<b class="sh-big">第 ${r.rank} 名</b>（共 ${r.rankTotal} 台）`}</p>
    <ol class="sh-schedule">
      <li>① 自由練習：${weekend.practiceResult ? (weekend.practiceResult.skipped ? "提前結束" : "完成") : "跳過"}</li>
      <li>② 排位賽：起跑格 P${weekend.playerGridPos}</li>
      <li>③ 正賽：${r.tireOut ? "DNF（爆胎）" : `第 ${r.rank} 名`}、跑了 ${r.rounds} 回合</li>
    </ol>
    <div class="sh-btnrow"><button class="sh-btn sh-btn--start" data-act="again">再跑一個週末</button></div>`);
  on('[data-act="again"]', () => window.location.reload());
}

// ─── 啟動 ─────────────────────────────────────────────────────────────
function boot() {
  const engineRoot = document.querySelector("#qteTestRoot");
  start(engineRoot);   // 引擎初始化（canvas / 輸入 / RAF loop）— 之後由 startSessionRace 接管
  showIntro();
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
