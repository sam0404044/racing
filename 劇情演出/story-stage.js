const canvas = document.querySelector("#storyCanvas");
const ctx = canvas.getContext("2d");

/** 畫布用黑體系：正黑／雅黑／PingFang／Noto TC */
const FONT_STACK = "Microsoft JhengHei, Microsoft YaHei, PingFang TC, Noto Sans TC, sans-serif";

const DEFAULT_BACKGROUND_SRC = "assets/BG/xiaoman-supply-station-bg.png";

/** 試算表「背景CG」填 none／無等表示沿用上一張，不載入 assets/BG/none.png */
function isSheetBackgroundUnsetToken(raw) {
  const s = (raw || "").trim();
  if (!s) {
    return true;
  }
  return /^(none|無|無背景|transparent|n\/a|na|-)$/i.test(s);
}

const PORTRAIT_ROLE_FOLDER = {
  小滿: "xiaoman"
};

const PORTRAIT_PATH_OVERRIDES = {};

const STORY_SHEET_ID = "1rIkC3ev81wGDyU9ItyMH0nO9jI22cvdofbNtk_QpSu0";
const STORY_SHEET_GID_PLAY_TEST_1 = "1983279972";
const STORY_SHEET_GID_PLAY_TEST_2 = "1747829090";
const SETTINGS_STORAGE_KEY = "storyStageSettings";
const READ_LINES_STORAGE_KEY = "storyStageReadLines";
const defaultStorySettings = {
  textSpeed: 10,
  autoInterval: 0,
  skipMode: "all"
};

function storySheetCsvUrl(gid) {
  return `https://docs.google.com/spreadsheets/d/${STORY_SHEET_ID}/export?format=csv&gid=${gid}`;
}

async function fetchStorySheetCsv(gid) {
  const url = `${storySheetCsvUrl(gid)}&cacheBust=${Date.now()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Story sheet gid=${gid} request failed: ${response.status}`);
  }
  return (await response.text()).replace(/^\uFEFF/, "");
}

const transitionKey = "__black_transition__";
let storyLines = [["旁白", ""]];
let storyPart1Length = 0;

/** 無 iframe 時改開新頁傳遞里程碑 */
const STORY_GUIDE_HANDOFF_KEY = "storyGuideMilestoneHandoff";
/** 舊版曾寫入 localStorage，載入劇情表時清除以免與新邏輯混淆 */
const LEGACY_STORY_STORAGE_KEYS = ["storyMaxLineIndex", "storyPart1Length", "storyGuideMilestone"];

function archiveFrameEl() {
  return document.getElementById("archiveFrame");
}

function postGuideLevelToArchiveFrame() {
  const frame = archiveFrameEl();
  try {
    frame?.contentWindow?.postMessage(
      { type: "archiveSetGuideLevel", level: storyGuideMilestoneLive },
      "*"
    );
  } catch {
    /* ignore */
  }
}

function openArchiveFrame() {
  const frame = archiveFrameEl();
  if (!frame) {
    try {
      sessionStorage.setItem(STORY_GUIDE_HANDOFF_KEY, String(storyGuideMilestoneLive));
    } catch {
      /* ignore */
    }
    window.location.href = "角色圖鑑表.html";
    return;
  }
  const reveal = () => {
    postGuideLevelToArchiveFrame();
    frame.removeAttribute("hidden");
  };
  if (!frame.dataset.archiveLoaded) {
    frame.addEventListener("load", reveal, { once: true });
    frame.src = "角色圖鑑表.html";
    frame.dataset.archiveLoaded = "1";
  } else {
    reveal();
  }
}

function closeArchiveFrame() {
  archiveFrameEl()?.setAttribute("hidden", "");
}

const dialogueStyle = {
  box: "#f1eadc",
  border: "rgba(70, 54, 42, 0.9)",
  innerBorder: "rgba(120, 96, 76, 0.56)",
  ink: "#2e2923",
  labelBg: "#31251d",
  labelBorder: "rgba(142, 115, 91, 0.82)",
  labelText: "#f7efe1",
  arrow: "#3c2b1c"
};

let viewWidth = 0;
let viewHeight = 0;
let dpr = 1;
let lineIndex = 0;
/** 本頁已讀到最遠的台詞索引，用於圖鑑里程碑（不持久化，重新整理劇情頁即重算） */
let storySessionMaxLineIndex = 0;
/** 0..2：圖鑑小滿追加文案與灰階，由 syncStoryGuideMilestone 更新 */
let storyGuideMilestoneLive = 0;
let typedChars = 0;
let lastTypeAt = 0;
let transition = null;
let needsRedraw = true;
let atlasIconHover = false;
/** 0..1，平滑接往 hover 目標（控制縮放） */
let atlasHoverAnim = 0;
let lastLoopNow = 0;
const ATLAS_HOVER_TAU_MS = 520;
const typeStep = 2;
const PORTRAIT_FADE_MS = 420;
let autoAdvanceReadyAt = 0;
let skipHeld = false;

function loadStorySettings() {
  try {
    return {
      ...defaultStorySettings,
      ...JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}")
    };
  } catch {
    return { ...defaultStorySettings };
  }
}

function textTypeIntervalMs() {
  const speed = Math.min(10, Math.max(1, Number(loadStorySettings().textSpeed) || 10));
  return 82 - speed * 7;
}

function autoPlayIntervalMs() {
  const seconds = Math.max(0, Number(loadStorySettings().autoInterval) || 0);
  return seconds * 1000;
}

function skipMode() {
  return loadStorySettings().skipMode === "read" ? "read" : "all";
}

function readLineSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem(READ_LINES_STORAGE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveReadLineSet(set) {
  try {
    localStorage.setItem(READ_LINES_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

function lineReadKey(index = lineIndex) {
  const [speaker, text, meta] = storyLines[index] || [];
  if (meta?.sheetPart && meta?.rowNum) {
    return `${meta.sheetPart}:${meta.rowNum}`;
  }
  return `${index}:${speaker || ""}:${text || ""}`;
}

function markLineRead(index = lineIndex) {
  const [speaker] = storyLines[index] || [];
  if (!speaker || speaker === transitionKey) {
    return;
  }
  const set = readLineSet();
  set.add(lineReadKey(index));
  saveReadLineSet(set);
}

function isLineRead(index = lineIndex) {
  return readLineSet().has(lineReadKey(index));
}

function resetAutoAdvanceTimer() {
  autoAdvanceReadyAt = 0;
}

function easeInOut(value) {
  return value * value * (3 - 2 * value);
}

function createPortraitSlotAnim() {
  return {
    targetKey: "",
    display: null,
    outgoing: null,
    incoming: null,
    phaseStart: 0
  };
}

const portraitSlotAnim = {
  left: createPortraitSlotAnim(),
  center: createPortraitSlotAnim(),
  right: createPortraitSlotAnim()
};

const imageCache = {};

function ensureImage(src) {
  if (!src) {
    return null;
  }
  if (imageCache[src]) {
    return imageCache[src];
  }
  const image = new Image();
  image._loadFailed = false;
  image.onload = () => {
    needsRedraw = true;
  };
  image.onerror = () => {
    image._loadFailed = true;
    needsRedraw = true;
  };
  image.src = src;
  imageCache[src] = image;
  return image;
}

ensureImage(DEFAULT_BACKGROUND_SRC);
ensureImage("assets/character/xiaoman/xiaoman-normal.png");
ensureImage("assets/character/xiaoman/xiaoman-angry.png");
ensureImage("assets/character/xiaoman/xiaoman-sad.png");
ensureImage("assets/character/xiaoman/xiaoman-happy.png");
ensureImage("assets/character/xiaoman/xiaoman-surprised.png");
ensureImage("assets/BG/race-results-screen.png");
ensureImage("assets/BG/pit-lounge.png");

function portraitSrc(role, expr) {
  const ex = (expr || "日常").trim();
  const key = `${role}|${ex}`;
  if (PORTRAIT_PATH_OVERRIDES[key]) {
    return PORTRAIT_PATH_OVERRIDES[key];
  }
  const folder = PORTRAIT_ROLE_FOLDER[role] || role;
  let file;
  if (folder === "xiaoman") {
    if (ex === "日常") {
      file = "xiaoman-normal.png";
    } else if (ex === "生氣") {
      file = "xiaoman-angry.png";
    } else if (ex === "沮喪") {
      file = "xiaoman-sad.png";
    } else if (ex === "開心") {
      file = "xiaoman-happy.png";
    } else if (ex === "驚訝") {
      file = "xiaoman-surprised.png";
    } else {
      file = `${ex}.png`;
    }
  } else {
    file = `${ex}.png`;
  }
  return `assets/character/${folder}/${file}`;
}

function backgroundSrc(backgroundKey) {
  if (isSheetBackgroundUnsetToken(backgroundKey)) {
    return DEFAULT_BACKGROUND_SRC;
  }
  const key = (backgroundKey || "").trim();
  if (key.startsWith("assets/")) {
    return key;
  }
  const base = key.endsWith(".png") ? key.slice(0, -4) : key;
  return `assets/BG/${base}.png`;
}

function resizeCanvas() {
  dpr = Math.max(1, window.devicePixelRatio || 1);
  viewWidth = window.innerWidth;
  viewHeight = window.innerHeight;
  canvas.width = Math.round(viewWidth * dpr);
  canvas.height = Math.round(viewHeight * dpr);
  canvas.style.width = `${viewWidth}px`;
  canvas.style.height = `${viewHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  needsRedraw = true;
}

function currentLine() {
  return storyLines[lineIndex] || storyLines[storyLines.length - 1];
}

function resetPortraitSlotAnimations() {
  for (const side of ["left", "center", "right"]) {
    const st = portraitSlotAnim[side];
    st.targetKey = "";
    st.display = null;
    st.outgoing = null;
    st.incoming = null;
    st.phaseStart = 0;
  }
}

function syncStoryGuideMilestone() {
  if (!storyLines.length) {
    storyGuideMilestoneLive = 0;
    return;
  }
  const maxIdx = Math.min(Math.max(0, storySessionMaxLineIndex), storyLines.length - 1);
  const p1 = storyPart1Length > 0 ? storyPart1Length : 0;
  let lvl = 0;
  if (p1 > 0 && maxIdx >= p1) {
    lvl = 1;
  }
  for (let i = Math.max(0, p1); i <= maxIdx; i += 1) {
    const meta = storyLines[i]?.[2];
    if (meta && meta.sheetPart === 2 && meta.rowNum >= 29) {
      lvl = 2;
      break;
    }
  }
  storyGuideMilestoneLive = lvl;
}

function bumpStoryMaxLine() {
  if (!storyLines.length) {
    return;
  }
  if (lineIndex > storySessionMaxLineIndex) {
    storySessionMaxLineIndex = lineIndex;
    syncStoryGuideMilestone();
  }
}

async function loadStoryLinesFromSheet() {
  try {
    const csvPlay1 = await fetchStorySheetCsv(STORY_SHEET_GID_PLAY_TEST_1);
    const part1 = rowsToStoryLines(parseCsv(csvPlay1), 1);
    if (part1.length === 0) {
      throw new Error("play_test_1 has no playable rows");
    }

    const csvPlay2 = await fetchStorySheetCsv(STORY_SHEET_GID_PLAY_TEST_2);
    const part2 = rowsToStoryLines(parseCsv(csvPlay2), 2);
    if (part2.length === 0) {
      throw new Error("play_test_2 has no playable rows");
    }

    storyLines = [...part1, ...part2];
    storyPart1Length = part1.length;
    storySessionMaxLineIndex = 0;
    try {
      for (const k of LEGACY_STORY_STORAGE_KEYS) {
        localStorage.removeItem(k);
      }
    } catch {
      /* ignore */
    }
    syncStoryGuideMilestone();
    lineIndex = 0;
    typedChars = 0;
    lastTypeAt = 0;
    transition = null;
    resetAutoAdvanceTimer();
    resetPortraitSlotAnimations();
    needsRedraw = true;
  } catch (error) {
    console.error("Story sheet load failed:", error);
    storyLines = [["旁白", "載入失敗"]];
    storyPart1Length = 0;
    storySessionMaxLineIndex = 0;
    storyGuideMilestoneLive = 0;
    lineIndex = 0;
    typedChars = 0;
    lastTypeAt = 0;
    transition = null;
    resetAutoAdvanceTimer();
    resetPortraitSlotAnimations();
    needsRedraw = true;
  }
}

function buildStageMeta(row, columnIndex) {
  const cell = (field) => {
    const index = columnIndex[field];
    return index >= 0 ? String(row[index] ?? "").trim() : "";
  };
  return {
    leftRole: cell("左側角色"),
    leftExpr: cell("左側表情"),
    centerRole: cell("中間角色"),
    centerExpr: cell("中間表情"),
    rightRole: cell("右側角色"),
    rightExpr: cell("右側表情"),
    backgroundKey: cell("背景CG"),
    rowNum:
      columnIndex.行號 >= 0
        ? Number.parseInt(String(row[columnIndex.行號] ?? "").trim(), 10) || 0
        : 0
  };
}

function rowsToStoryLines(rows, sheetPart) {
  const headers = rows.shift() || [];
  const indexOf = (name) => headers.indexOf(name);
  const columnIndex = {
    場景ID: indexOf("場景ID"),
    行號: indexOf("行號"),
    文本類型: indexOf("文本類型"),
    文本內容: indexOf("文本內容"),
    說話人: indexOf("說話人"),
    左側角色: indexOf("左側角色"),
    左側表情: indexOf("左側表情"),
    中間角色: indexOf("中間角色"),
    中間表情: indexOf("中間表情"),
    右側角色: indexOf("右側角色"),
    右側表情: indexOf("右側表情"),
    背景CG: indexOf("背景CG")
  };
  const typeIndex = columnIndex.文本類型;
  const textIndex = columnIndex.文本內容;
  const speakerIndex = columnIndex.說話人;
  if (typeIndex < 0 || textIndex < 0) {
    return [];
  }

  return rows
    .filter((row) => row.some((cell) => cell.trim()))
    .sort((a, b) => {
      const sceneA = columnIndex.場景ID >= 0 ? a[columnIndex.場景ID] || "" : "";
      const sceneB = columnIndex.場景ID >= 0 ? b[columnIndex.場景ID] || "" : "";
      if (sceneA !== sceneB) {
        return sceneA.localeCompare(sceneB, "zh-Hant");
      }
      const rowA = Number(columnIndex.行號 >= 0 ? a[columnIndex.行號] : 0);
      const rowB = Number(columnIndex.行號 >= 0 ? b[columnIndex.行號] : 0);
      return rowA - rowB;
    })
    .map((row) => {
      const type = (row[typeIndex] || "").trim();
      const text = (row[textIndex] || "").trim();
      const speaker = speakerIndex >= 0 ? (row[speakerIndex] || "").trim() : "";
      const meta = { ...buildStageMeta(row, columnIndex), sheetPart };
      if (!text) {
        return null;
      }
      if (type === "演出指示" && text.includes("黑色")) {
        return [transitionKey, "數日後", meta];
      }
      if (type === "旁白") {
        return ["旁白", text, meta];
      }
      if (type === "對白") {
        return [speaker || "旁白", text, meta];
      }
      return null;
    })
    .filter(Boolean);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function isTypingComplete() {
  const [, text] = currentLine();
  return typedChars >= text.length;
}

function advanceLine() {
  const [speaker, text] = currentLine();
  if (transition) {
    return;
  }
  if (speaker === transitionKey) {
    return;
  }
  if (typedChars < text.length) {
    typedChars = text.length;
    markLineRead();
    resetAutoAdvanceTimer();
    needsRedraw = true;
    return;
  }
  if (lineIndex < storyLines.length - 1) {
    markLineRead();
    lineIndex += 1;
    typedChars = 0;
    lastTypeAt = 0;
    resetAutoAdvanceTimer();
    bumpStoryMaxLine();
    if (currentLine()[0] === transitionKey) {
      transition = {
        text: currentLine()[1],
        start: performance.now(),
        duration: 1800
      };
      resetPortraitSlotAnimations();
    }
    needsRedraw = true;
  }
}

function updateTyping(now) {
  const [speaker, text] = currentLine();
  if (speaker === transitionKey || transition) {
    return;
  }
  if (typedChars < text.length && now - lastTypeAt >= textTypeIntervalMs()) {
    typedChars = Math.min(text.length, typedChars + typeStep);
    lastTypeAt = now;
    if (typedChars >= text.length) {
      markLineRead();
      resetAutoAdvanceTimer();
    }
    needsRedraw = true;
  }
}

function updateAutoPlay(now) {
  const interval = autoPlayIntervalMs();
  if (!interval || transition || skipHeld) {
    return;
  }
  const [speaker] = currentLine();
  if (speaker === transitionKey || !isTypingComplete()) {
    resetAutoAdvanceTimer();
    return;
  }
  if (!autoAdvanceReadyAt) {
    autoAdvanceReadyAt = now;
    return;
  }
  if (now - autoAdvanceReadyAt >= interval) {
    advanceLine();
  }
}

function skipForward() {
  if (transition) {
    return;
  }
  if (!isTypingComplete()) {
    if (skipMode() === "read" && !isLineRead()) {
      typedChars = currentLine()[1].length;
      markLineRead();
      resetAutoAdvanceTimer();
      needsRedraw = true;
      return;
    }
    typedChars = currentLine()[1].length;
    markLineRead();
  }
  if (skipMode() === "read" && !isLineRead(lineIndex + 1)) {
    needsRedraw = true;
    return;
  }
  advanceLine();
}

function updateTransition(now) {
  if (!transition) {
    return;
  }
  const elapsed = now - transition.start;
  if (elapsed >= transition.duration) {
    transition = null;
    lineIndex = Math.min(storyLines.length - 1, lineIndex + 1);
    typedChars = 0;
    lastTypeAt = 0;
    resetAutoAdvanceTimer();
    bumpStoryMaxLine();
  }
  needsRedraw = true;
}

function resolveStageState(upToLineIndex) {
  const state = {
    backgroundKey: "",
    left: null,
    center: null,
    right: null
  };
  const last = Math.min(Math.max(upToLineIndex, 0), Math.max(storyLines.length - 1, 0));
  for (let i = 0; i <= last; i += 1) {
    const line = storyLines[i];
    if (Array.isArray(line) && line[0] === transitionKey) {
      continue;
    }
    const meta = Array.isArray(line) ? line[2] : null;
    if (!meta) {
      continue;
    }
    if (i > 0) {
      const prevMeta = storyLines[i - 1]?.[2];
      const prevPart = prevMeta?.sheetPart ?? 0;
      const part = meta.sheetPart ?? 0;
      if (part > prevPart) {
        state.backgroundKey = "";
        state.left = null;
        state.center = null;
        state.right = null;
      }
    }
    const applySlot = (side, roleKey, exprKey) => {
      const role = (meta[roleKey] || "").trim();
      const expr = (meta[exprKey] || "").trim();
      if (role) {
        state[side] = { role, expr: expr || "日常" };
      } else if (expr && state[side]?.role) {
        state[side] = { role: state[side].role, expr };
      }
    };
    applySlot("left", "leftRole", "leftExpr");
    applySlot("center", "centerRole", "centerExpr");
    applySlot("right", "rightRole", "rightExpr");
    const bg = (meta.backgroundKey || "").trim();
    if (bg && !isSheetBackgroundUnsetToken(bg)) {
      state.backgroundKey = bg;
    }
  }
  return state;
}

function slotKey(slot) {
  return slot?.role ? `${slot.role}|${slot.expr}` : "";
}

function updatePortraitAnimations(now) {
  const stage = transition
    ? { left: null, center: null, right: null }
    : resolveStageState(lineIndex);
  let busy = false;
  for (const side of ["left", "center", "right"]) {
    const st = portraitSlotAnim[side];
    const tk = slotKey(stage[side]);
    const t = (now - st.phaseStart) / PORTRAIT_FADE_MS;
    if (t < 1 && (st.outgoing !== null || st.incoming !== null)) {
      busy = true;
    }

    if (tk !== st.targetKey) {
      const incomingSlot = stage[side]?.role
        ? { role: stage[side].role, expr: stage[side].expr }
        : null;
      const steady = !st.outgoing && !st.incoming;
      const oldRole = st.display?.role || "";
      const newRole = incomingSlot?.role || "";
      if (steady && oldRole && newRole && oldRole === newRole) {
        st.display = incomingSlot ? { ...incomingSlot } : null;
        st.outgoing = null;
        st.incoming = null;
        st.targetKey = tk;
        needsRedraw = true;
        continue;
      }

      let snapshot = null;
      if (st.outgoing || st.incoming) {
        const tt = Math.min(1, (now - st.phaseStart) / PORTRAIT_FADE_MS);
        const ee = easeInOut(tt);
        if (ee >= 0.5 && st.incoming) {
          snapshot = { ...st.incoming };
        } else if (st.outgoing) {
          snapshot = { ...st.outgoing };
        } else if (st.display) {
          snapshot = { ...st.display };
        }
      } else if (st.display) {
        snapshot = { ...st.display };
      }
      st.outgoing = snapshot;
      st.incoming = incomingSlot;
      st.targetKey = tk;
      st.phaseStart = now;
      busy = true;
    } else if (t >= 1 && (st.outgoing !== null || st.incoming !== null)) {
      st.display = st.incoming ? { ...st.incoming } : null;
      st.outgoing = null;
      st.incoming = null;
      needsRedraw = true;
    }
  }
  if (busy) {
    needsRedraw = true;
  }
}

function clientToCanvasStory(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return { x: 0, y: 0 };
  }
  return {
    x: ((clientX - rect.left) / rect.width) * viewWidth,
    y: ((clientY - rect.top) / rect.height) * viewHeight
  };
}

function atlasIconLayout() {
  const pad = 14;
  const size = 168;
  return { x: pad, y: pad, size };
}

function atlasIconHit(mx, my) {
  const { x, y, size } = atlasIconLayout();
  return mx >= x && mx <= x + size && my >= y && my <= y + size;
}

function updateAtlasHoverEase(now) {
  const prev = atlasHoverAnim;
  const dt = lastLoopNow ? Math.min(80, now - lastLoopNow) : 16;
  const target = atlasIconHover ? 1 : 0;
  const k = 1 - Math.exp(-dt / ATLAS_HOVER_TAU_MS);
  atlasHoverAnim += (target - atlasHoverAnim) * k;
  if (Math.abs(atlasHoverAnim - prev) > 0.0008) {
    needsRedraw = true;
  }
}

function drawAtlasIcon() {
  if (transition) {
    return;
  }
  const { x, y, size } = atlasIconLayout();
  const cx = x + size / 2;
  const cy = y + size / 2;
  const scale = 1 + 0.06 * atlasHoverAnim;

  const stroke = "#ffffff";
  const lineLens = Math.max(5, size * 0.048);
  const lineHandle = Math.max(5.5, size * 0.052);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);

  const gr = size * 0.19;
  const handleAngle = Math.PI / 4;
  const handleLen = gr * 1.52;
  const shift = gr * 0.34;
  const lx = cx - shift * Math.cos(handleAngle);
  const ly = cy - shift * Math.sin(handleAngle);
  const rimX = lx + Math.cos(handleAngle) * gr;
  const rimY = ly + Math.sin(handleAngle) * gr;

  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke;

  ctx.beginPath();
  ctx.arc(lx, ly, gr, 0, Math.PI * 2);
  ctx.lineWidth = lineLens;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(rimX, rimY);
  ctx.lineTo(rimX + Math.cos(handleAngle) * handleLen, rimY + Math.sin(handleAngle) * handleLen);
  ctx.lineCap = "round";
  ctx.lineWidth = lineHandle;
  ctx.stroke();

  ctx.restore();
}

function draw() {
  const [sp] = currentLine();
  const blackChapterBreak = Boolean(transition);
  ctx.clearRect(0, 0, viewWidth, viewHeight);
  if (blackChapterBreak) {
    ctx.fillStyle = "#080d12";
    ctx.fillRect(0, 0, viewWidth, viewHeight);
  } else {
    const stage = resolveStageState(lineIndex);
    drawBackground(stage);
    drawPortraits();
  }
  drawDialogue();
  drawAtlasIcon();
  drawTransition();
  needsRedraw = Boolean(!transition && sp !== transitionKey);
}

function drawBackground(stage) {
  const src = backgroundSrc(stage.backgroundKey);
  const image = ensureImage(src);
  ctx.fillStyle = "#080d12";
  ctx.fillRect(0, 0, viewWidth, viewHeight);
  if (!image || !image.complete || !image.naturalWidth || image._loadFailed) {
    return;
  }
  drawImageCover(image, 0, 0, viewWidth, viewHeight);
}

function drawPortraitSlotWithAlpha(slot, layout, alpha) {
  if (!slot?.role || alpha <= 0.001) {
    return;
  }
  const src = portraitSrc(slot.role, slot.expr);
  const image = ensureImage(src);
  if (!image || !image.complete || !image.naturalWidth || image._loadFailed) {
    return;
  }
  const targetHeight = viewHeight * layout.heightFactor;
  const scale = targetHeight / image.naturalHeight;
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const footOverflow = viewHeight * layout.footOverflow;
  const y = viewHeight - height + footOverflow;
  let x;
  if (layout.anchor === "left") {
    x = viewWidth * layout.xRatio;
  } else if (layout.anchor === "right") {
    x = viewWidth * layout.xRatio - width;
  } else {
    x = viewWidth * layout.xRatio - width / 2;
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = "rgba(0, 0, 0, 0.48)";
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 26;
  ctx.drawImage(image, x, y, width, height);
  ctx.restore();
}

function drawPortraits() {
  const now = performance.now();
  const leftLayout = { anchor: "left", xRatio: 0.06, heightFactor: 1.12, footOverflow: 0.28 };
  const rightLayout = { anchor: "right", xRatio: 0.96, heightFactor: 1.12, footOverflow: 0.28 };
  const centerLayout = { anchor: "center", xRatio: 0.5, heightFactor: 1.18, footOverflow: 0.3 };
  const layouts = { left: leftLayout, right: rightLayout, center: centerLayout };

  for (const side of ["left", "right", "center"]) {
    const st = portraitSlotAnim[side];
    const t = Math.min(1, (now - st.phaseStart) / PORTRAIT_FADE_MS);
    const e = easeInOut(t);
    if (st.outgoing) {
      drawPortraitSlotWithAlpha(st.outgoing, layouts[side], 1 - e);
    }
    if (st.incoming) {
      drawPortraitSlotWithAlpha(st.incoming, layouts[side], e);
    }
    if (!st.outgoing && !st.incoming && st.display) {
      drawPortraitSlotWithAlpha(st.display, layouts[side], 1);
    }
  }
}

function drawDialogue() {
  const [speaker, text] = currentLine();
  if (speaker === transitionKey) {
    return;
  }
  const raw = dialogueBoxRect();
  const snap = (v) => Math.round(v * 2) / 2;
  const box = { ...raw, x: snap(raw.x), y: snap(raw.y) };
  const outerR = 8;
  const borderW = 3;
  const innerR = Math.max(0, outerR - borderW);

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.46)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = dialogueStyle.border;
  roundRect(ctx, box.x, box.y, box.w, box.h, outerR);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = dialogueStyle.box;
  roundRect(
    ctx,
    box.x + borderW,
    box.y + borderW,
    box.w - borderW * 2,
    box.h - borderW * 2,
    innerR
  );
  ctx.fill();

  ctx.strokeStyle = dialogueStyle.innerBorder;
  ctx.lineWidth = 1;
  roundRect(ctx, box.x + 6, box.y + 6, box.w - 12, box.h - 12, 6);
  ctx.stroke();

  if (speaker !== "旁白") {
    drawSpeakerLabel(speaker, box);
  }

  const visibleText = text.slice(0, typedChars);
  const fontSize = 30;
  const paddingX = 50;
  const textTop = box.y + 58;
  ctx.fillStyle = dialogueStyle.ink;
  ctx.font = `${fontSize}px ${FONT_STACK}`;
  ctx.textBaseline = "top";
  drawWrappedText(visibleText, box.x + paddingX, textTop, box.w - paddingX * 2, fontSize * 1.75);
  drawNextArrow(box);
}

function drawSpeakerLabel(speaker, box) {
  const labelW = 294;
  const labelH = 81;
  const labelRadius = 15;
  const borderW = 3;
  const innerR = Math.max(0, labelRadius - borderW);
  const x = Math.round((box.x + 39) * 2) / 2;
  const y = Math.round((box.y - 39) * 2) / 2;
  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = dialogueStyle.labelBorder;
  roundRect(ctx, 0, 0, labelW, labelH, labelRadius);
  ctx.fill();

  ctx.shadowColor = "rgba(0, 0, 0, 0.38)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = dialogueStyle.labelBg;
  roundRect(ctx, borderW, borderW, labelW - borderW * 2, labelH - borderW * 2, innerR);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.save();
  roundRect(ctx, 0, 0, labelW, labelH, labelRadius);
  ctx.clip();
  ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
  ctx.fillRect(0, 0, labelW, Math.ceil(labelH * 0.42));
  ctx.restore();

  ctx.fillStyle = dialogueStyle.labelText;
  ctx.font = `500 48px ${FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(speaker, labelW / 2, labelH / 2);
  ctx.restore();
}

function drawNextArrow(box) {
  const now = performance.now();
  const floatPeriod = 4200;
  const floatAmp = 7;
  const floatY = Math.sin((now / floatPeriod) * Math.PI * 2) * floatAmp;
  const cx = box.x + box.w - 58;
  const cy = box.y + box.h - 44 + floatY;
  ctx.save();
  ctx.fillStyle = dialogueStyle.arrow;
  ctx.beginPath();
  ctx.moveTo(cx - 17, cy - 7);
  ctx.lineTo(cx + 17, cy - 7);
  ctx.lineTo(cx, cy + 12);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawTransition() {
  if (!transition) {
    return;
  }
  const elapsed = performance.now() - transition.start;
  const fadeIn = Math.min(1, elapsed / 520);
  const fadeOut = elapsed > transition.duration - 520 ? Math.max(0, (transition.duration - elapsed) / 520) : 1;
  const alpha = Math.min(fadeIn, fadeOut);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, viewWidth, viewHeight);
  const transitionFontPx = Math.floor(Math.min(120, Math.max(56, viewWidth * 0.072)));
  ctx.fillStyle = "rgba(255, 238, 207, 0.92)";
  ctx.font = `900 ${transitionFontPx}px ${FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(transition.text, viewWidth / 2, viewHeight / 2);
  ctx.restore();
}

function dialogueBoxRect() {
  const margin = 30;
  const width = Math.min(1180, viewWidth - margin * 2);
  const height = 278;
  const bottomCrop = -50;
  return {
    x: (viewWidth - width) / 2,
    y: viewHeight - margin - height + bottomCrop,
    w: width,
    h: height
  };
}

function drawImageCover(image, x, y, width, height) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawW = image.naturalWidth * scale;
  const drawH = image.naturalHeight * scale;
  const drawX = x + (width - drawW) / 2;
  const drawY = y + (height - drawH) / 2;
  ctx.drawImage(image, drawX, drawY, drawW, drawH);
}

function drawWrappedText(text, x, y, maxWidth, lineHeight) {
  const paragraphs = text.split("\n");
  let cursorY = y;
  for (const paragraph of paragraphs) {
    let line = "";
    for (const char of Array.from(paragraph)) {
      const testLine = line + char;
      if (ctx.measureText(testLine).width > maxWidth && line) {
        ctx.fillText(line, x, cursorY);
        cursorY += lineHeight;
        line = char;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, cursorY);
    cursorY += lineHeight;
  }
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function loop(now) {
  updateAtlasHoverEase(now);
  lastLoopNow = now;
  updateTyping(now);
  updateAutoPlay(now);
  updateTransition(now);
  updatePortraitAnimations(now);
  if (needsRedraw) {
    draw();
  }
  requestAnimationFrame(loop);
}

canvas.addEventListener("mousemove", (event) => {
  if (transition) {
    if (atlasIconHover) {
      atlasIconHover = false;
      canvas.style.cursor = "default";
      needsRedraw = true;
    }
    return;
  }
  const { x, y } = clientToCanvasStory(event.clientX, event.clientY);
  const over = atlasIconHit(x, y);
  if (over !== atlasIconHover) {
    atlasIconHover = over;
    canvas.style.cursor = over ? "pointer" : "default";
    needsRedraw = true;
  }
});

canvas.addEventListener("mouseleave", () => {
  if (atlasIconHover) {
    atlasIconHover = false;
    canvas.style.cursor = "default";
    needsRedraw = true;
  }
});

canvas.addEventListener("click", (event) => {
  if (!transition) {
    const { x, y } = clientToCanvasStory(event.clientX, event.clientY);
    if (atlasIconHit(x, y)) {
      openArchiveFrame();
      return;
    }
  }
  advanceLine();
});
window.addEventListener("keydown", (event) => {
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    advanceLine();
  } else if (event.key.toLowerCase() === "s") {
    event.preventDefault();
    skipHeld = true;
    skipForward();
  }
});
window.addEventListener("keyup", (event) => {
  if (event.key.toLowerCase() === "s") {
    skipHeld = false;
    resetAutoAdvanceTimer();
  }
});
window.addEventListener("resize", resizeCanvas);
window.addEventListener("storage", (event) => {
  if (event.key === SETTINGS_STORAGE_KEY) {
    resetAutoAdvanceTimer();
  }
});
window.addEventListener("message", (event) => {
  if (event?.data?.type === "archiveRequestClose") {
    closeArchiveFrame();
  }
});

resizeCanvas();
loadStoryLinesFromSheet();
requestAnimationFrame(loop);
