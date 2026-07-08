// ─── 排位賽（輕量計分淘汰）──────────────────────────────────────────────
// 與正賽 1v1 爬升引擎完全獨立的 DOM 小賽制：
//   · 9 台車、3 圈、每圈 3 賽段
//   · 每賽段玩家從「整場共用、不補牌」的 12 張卡池挑 1 張打出（全場共打 9 張）
//   · 速度整場累積、不重置；每跑完一圈刷掉累積最低 3 台、起跑格鎖死
//   · 玩家被刷掉後、剩餘圈數自動快轉模擬補完起跑格
// 輸出：onDone(gridOrder) — 9 個 id、index 0 = 桿位（P1）
//
// 設計備忘：取捨在「強牌何時花」— 卡池總值固定、每圈刷人前都要決定
// 這圈梭哈保命、還是省牌賭墊底邊緣撐得住、把資源留到爭桿位。

import { STAGE2_OPPONENTS, WEEKEND_ROSTER, QUALI_CONFIG, QUALI_PLAYER_POOL } from './config.js';

function driverName(id) {
  if (id === "PLAYER") return "你（玩家）";
  return STAGE2_OPPONENTS[id]?.name || id;
}

export function runQualifying(rootEl, onDone, playerPool = null) {
  const cfg = QUALI_CONFIG;
  const totalGrid = WEEKEND_ROSTER.length; // 9

  // 車手狀態
  const drivers = WEEKEND_ROSTER.map(d => ({
    id: d.id,
    isPlayer: !!d.isPlayer,
    base: d.qualiBase || 0,
    jitter: d.qualiJitter || 0,
    total: 0,
    lastGain: null,     // 本賽段增量（顯示用）
    gridPos: null,      // 被刷掉 / 結束時鎖定的起跑格（1-based）
  }));

  // 玩家卡池（複製、加 used 旗標）— 優先用外部傳入的牌庫生成池、否則退回固定中性池
  const srcPool = (playerPool && playerPool.length) ? playerPool : QUALI_PLAYER_POOL;
  const pool = srcPool.map((c, i) => ({ ...c, idx: i, used: false }));

  let lap = 1;       // 1..laps
  let seg = 1;       // 1..segmentsPerLap
  let phase = "pick"; // pick → cut → done
  let lastCutIds = [];
  let nextLockSlot = totalGrid; // 從最後一格往前鎖（9,8,7 → 6,5,4 → …）

  const alive = () => drivers.filter(d => d.gridPos === null);
  const playerD = drivers.find(d => d.isPlayer);

  function aiGain(d) {
    return Math.max(0, Math.round(d.base + (Math.random() * 2 - 1) * d.jitter));
  }

  // 結算一個賽段：玩家打出 cardValue（玩家已被刷掉時傳 null）
  function resolveSegment(cardValue) {
    for (const d of alive()) {
      if (d.isPlayer) {
        d.lastGain = cardValue ?? 0;
      } else {
        d.lastGain = aiGain(d);
      }
      d.total += d.lastGain;
    }
  }

  // 跑完一圈 → 刷掉墊底 cut 台（最後一圈 = 鎖定剩餘全部名次）
  function doCut() {
    const isFinalLap = (lap >= cfg.laps);
    const sorted = alive().slice().sort((a, b) => b.total - a.total); // 高→低
    if (isFinalLap) {
      // 剩餘全部依總速度鎖 1..n
      sorted.forEach((d, i) => { d.gridPos = i + 1; });
      lastCutIds = [];
    } else {
      const cut = sorted.slice(-cfg.cutPerLap); // 墊底（仍依 total 高→低）
      lastCutIds = cut.map(d => d.id);
      // 墊底中 total 較高者拿較前的格（例：第一圈刷 3 → 鎖 7/8/9）
      const slots = [];
      for (let i = cfg.cutPerLap - 1; i >= 0; i--) slots.push(nextLockSlot - i);
      cut.forEach((d, i) => { d.gridPos = slots[i]; });
      nextLockSlot -= cfg.cutPerLap;
    }
  }

  // 玩家被刷掉後：快轉剩餘圈、自動補完起跑格
  function fastForward() {
    while (lap < cfg.laps || seg <= cfg.segmentsPerLap) {
      if (seg > cfg.segmentsPerLap) { doCut(); lap += 1; seg = 1; continue; }
      resolveSegment(null);
      seg += 1;
      if (seg > cfg.segmentsPerLap && lap >= cfg.laps) { doCut(); break; }
    }
    phase = "done";
  }

  function buildGridOrder() {
    return drivers.slice().sort((a, b) => a.gridPos - b.gridPos).map(d => d.id);
  }

  // ─── 渲染 ───────────────────────────────────────────────────────────
  function render() {
    const sortedView = drivers.slice().sort((a, b) => {
      // 已鎖定的排自己的格、未鎖定的依累積速度排前面區
      if (a.gridPos !== null && b.gridPos !== null) return a.gridPos - b.gridPos;
      if (a.gridPos !== null) return 1;
      if (b.gridPos !== null) return -1;
      return b.total - a.total;
    });
    const aliveCount = alive().length;
    const cutThresholdIdx = aliveCount - cfg.cutPerLap; // 存活區裡這條線以下危險

    const rowsHtml = sortedView.map((d, i) => {
      const locked = d.gridPos !== null;
      const aliveIdx = locked ? -1 : sortedView.filter(x => x.gridPos === null).indexOf(d);
      const danger = !locked && (lap < cfg.laps) && aliveIdx >= cutThresholdIdx;
      const justCut = lastCutIds.includes(d.id) && phase === "cut";
      const cls = [
        "q-row",
        d.isPlayer ? "q-row--player" : "",
        locked ? "q-row--locked" : "",
        danger ? "q-row--danger" : "",
        justCut ? "q-row--justcut" : "",
      ].join(" ");
      const posLabel = locked ? `P${d.gridPos}` : `${aliveIdx + 1}`;
      const gain = (d.lastGain !== null && !locked) ? `<span class="q-gain">+${d.lastGain}</span>` : "";
      return `<div class="${cls}">
        <span class="q-pos">${posLabel}</span>
        <span class="q-name">${driverName(d.id)}</span>
        <span class="q-total">${d.total}${gain}</span>
        <span class="q-state">${locked ? "🔒 格位鎖定" : (danger ? "⚠ 淘汰邊緣" : "")}</span>
      </div>`;
    }).join("");

    let actionHtml = "";
    if (phase === "pick") {
      const segName = cfg.segmentNames[(seg - 1) % cfg.segmentNames.length] || `賽段 ${seg}`;
      const remaining = pool.filter(c => !c.used).length;
      const cardsHtml = pool.map(c =>
        `<button class="q-card${c.used ? " q-card--used" : ""}" data-card="${c.idx}" ${c.used ? "disabled" : ""}>
          <span class="q-card-name">${c.name}</span>
          <span class="q-card-val">+${c.value}</span>
        </button>`
      ).join("");
      actionHtml = `
        <div class="q-seghead">第 ${lap} 圈 · ${segName}（${seg}/${cfg.segmentsPerLap}）</div>
        <div class="q-hint">挑 1 張打出 — 卡池整場共用、不補牌（剩 ${remaining} 張、之後還有 ${remainingSegments()} 個賽段）</div>
        <div class="q-pool">${cardsHtml}</div>`;
    } else if (phase === "cut") {
      const cutNames = lastCutIds.map(driverName).join("、");
      actionHtml = `
        <div class="q-seghead">第 ${lap} 圈結束 — 淘汰結算</div>
        <div class="q-hint">${cutNames ? `被刷掉：${cutNames}（起跑格鎖定）` : "名次鎖定"}</div>
        <button class="q-btn" data-act="next-lap">繼續 ➜</button>`;
    } else if (phase === "done") {
      const playerPos = playerD.gridPos;
      actionHtml = `
        <div class="q-seghead">排位賽結束</div>
        <div class="q-hint">你的正賽起跑格：<b class="q-grid-pos">P${playerPos}</b></div>
        <button class="q-btn q-btn--start" data-act="finish">確認起跑格、前往衝刺賽 ➜</button>`;
    }

    rootEl.innerHTML = `
      <div class="q-wrap">
        <h2 class="q-title">② 排位賽 — 累積速度淘汰制</h2>
        <p class="q-rule">每賽段打 1 張牌累積速度；每跑完一圈、累積最低 3 台被刷掉、起跑格鎖死。</p>
        <div class="q-board">${rowsHtml}</div>
        <div class="q-action">${actionHtml}</div>
      </div>`;

    // 事件
    rootEl.querySelectorAll(".q-card:not(.q-card--used)").forEach(btn => {
      btn.addEventListener("click", () => {
        const card = pool[parseInt(btn.dataset.card, 10)];
        if (!card || card.used) return;
        card.used = true;
        resolveSegment(card.value);
        seg += 1;
        if (seg > cfg.segmentsPerLap) {
          doCut();
          phase = "cut";
        }
        render();
      });
    });
    const nextBtn = rootEl.querySelector('[data-act="next-lap"]');
    if (nextBtn) nextBtn.addEventListener("click", () => {
      lap += 1;
      seg = 1;
      lastCutIds = [];
      if (lap > cfg.laps || playerD.gridPos !== null) {
        // 玩家被刷掉 → 快轉補完；或全部跑完
        if (playerD.gridPos !== null && drivers.some(d => d.gridPos === null)) {
          fastForward();
        } else {
          phase = "done";
        }
      } else {
        phase = "pick";
      }
      render();
    });
    const finBtn = rootEl.querySelector('[data-act="finish"]');
    if (finBtn) finBtn.addEventListener("click", () => onDone(buildGridOrder()));
  }

  function remainingSegments() {
    return (cfg.laps - lap) * cfg.segmentsPerLap + (cfg.segmentsPerLap - seg + 1);
  }

  render();
}
