const canvas = document.querySelector("#storyCanvas");
const ctx = canvas.getContext("2d");

/** 畫布用黑體系：正黑／雅黑／PingFang／Noto TC */
const FONT_STACK = "Microsoft JhengHei, Microsoft YaHei, PingFang TC, Noto Sans TC, sans-serif";

const DEFAULT_BACKGROUND_SRC = "assets/BG/xiaoman-supply-station-bg.png";

const BLACK_BACKGROUND_KEY = "__black_background__";

/** 試算表「背景CG」留空表示沿用上一張；play_test_2 填 none 表示純黑背景 */
function isSheetBackgroundUnsetToken(raw) {
  const s = (raw || "").trim();
  if (!s) {
    return true;
  }
  return /^(無|transparent|n\/a|na|-)$/i.test(s);
}

function isSheetBackgroundBlackToken(raw) {
  return /^(none|無背景)$/i.test((raw || "").trim());
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
    window.location.href = "character-archive.html";
    return;
  }
  const reveal = () => {
    postGuideLevelToArchiveFrame();
    frame.removeAttribute("hidden");
    const nudgeArchiveResize = () => {
      try {
        frame.contentWindow?.postMessage({ type: "archiveForceResize" }, "*");
      } catch {
        /* ignore */
      }
    };
    nudgeArchiveResize();
    requestAnimationFrame(nudgeArchiveResize);
    setTimeout(nudgeArchiveResize, 50);
  };
  if (!frame.dataset.archiveLoaded) {
    frame.addEventListener("load", reveal, { once: true });
    frame.src = "character-archive.html";
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

const DESIGN_WIDTH = StoryCanvasViewport.DEFAULT_DESIGN_WIDTH;
const DESIGN_HEIGHT = StoryCanvasViewport.DEFAULT_DESIGN_HEIGHT;
const SHOW_VIEWPORT_DEBUG = new URLSearchParams(globalThis.location?.search || "").has(
  "viewportDebug"
);

const viewport = StoryCanvasViewport.createViewportState(DESIGN_WIDTH, DESIGN_HEIGHT);
let dpr = 1;
let lineIndex = 0;
/** 本頁已讀到最遠的台詞索引，用於圖鑑里程碑（不持久化，重新整理劇情頁即重算） */
let storySessionMaxLineIndex = 0;
/** 0..2：圖鑑小滿追加文案與灰階，由 syncStoryGuideMilestone 更新 */
let storyGuideMilestoneLive = 0;
let typedChars = 0;
let lastTypeAt = 0;
let transition = null;
let backgroundTransition = null;
let needsRedraw = true;
const atlasOpenBtn = document.getElementById("atlasOpenBtn");
const typeStep = 2;
const PORTRAIT_FADE_MS = 420;
const BACKGROUND_TRANSITION_MS = 980;
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
  if (backgroundKey === BLACK_BACKGROUND_KEY) {
    return BLACK_BACKGROUND_KEY;
  }
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

function syncViewFromViewport() {
  dpr = viewport.dpr;
}

function resizeCanvas() {
  StoryCanvasViewport.resizeCanvasToDisplay(canvas, ctx, viewport);
  syncViewFromViewport();
  needsRedraw = true;
}

function currentLine() {
  return storyLines[lineIndex] || storyLines[storyLines.length - 1];
}

function maybeStartBackgroundTransition(fromIndex, toIndex) {
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
    return;
  }
  const fromLine = storyLines[fromIndex];
  const toLine = storyLines[toIndex];
  if (!Array.isArray(fromLine) || !Array.isArray(toLine)) {
    return;
  }
  if (fromLine[0] === transitionKey || toLine[0] === transitionKey) {
    return;
  }
  const fromPart = fromLine[2]?.sheetPart ?? 0;
  const toPart = toLine[2]?.sheetPart ?? 0;
  if (fromPart !== toPart) {
    return;
  }
  const fromStage = resolveStageState(fromIndex);
  const toStage = resolveStageState(toIndex);
  const fromSrc = backgroundSrc(fromStage.backgroundKey);
  const toSrc = backgroundSrc(toStage.backgroundKey);
  if (fromSrc === toSrc) {
    return;
  }
  if (fromSrc !== BLACK_BACKGROUND_KEY) {
    ensureImage(fromSrc);
  }
  if (toSrc !== BLACK_BACKGROUND_KEY) {
    ensureImage(toSrc);
  }
  backgroundTransition = {
    fromStage,
    toStage,
    start: performance.now(),
    duration: BACKGROUND_TRANSITION_MS
  };
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
    backgroundTransition = null;
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
    backgroundTransition = null;
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
    const prevLineIndex = lineIndex;
    markLineRead();
    lineIndex += 1;
    typedChars = 0;
    lastTypeAt = 0;
    resetAutoAdvanceTimer();
    bumpStoryMaxLine();
    if (currentLine()[0] === transitionKey) {
      backgroundTransition = null;
      transition = {
        text: currentLine()[1],
        start: performance.now(),
        duration: 1800
      };
      resetPortraitSlotAnimations();
    } else {
      maybeStartBackgroundTransition(prevLineIndex, lineIndex);
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
    backgroundTransition = null;
    resetAutoAdvanceTimer();
    bumpStoryMaxLine();
  }
  needsRedraw = true;
}

function updateBackgroundTransition(now) {
  if (!backgroundTransition) {
    return;
  }
  if (now - backgroundTransition.start >= backgroundTransition.duration) {
    backgroundTransition = null;
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
      } else {
        /** 該欄角色名稱留空表示離場，不沿用上一行 */
        state[side] = null;
      }
    };
    applySlot("left", "leftRole", "leftExpr");
    applySlot("center", "centerRole", "centerExpr");
    applySlot("right", "rightRole", "rightExpr");
    const bg = (meta.backgroundKey || "").trim();
    if (meta.sheetPart === 2 && isSheetBackgroundBlackToken(bg)) {
      state.backgroundKey = BLACK_BACKGROUND_KEY;
    } else if (bg && !isSheetBackgroundUnsetToken(bg) && !isSheetBackgroundBlackToken(bg)) {
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

function syncAtlasButtonVisibility() {
  if (!atlasOpenBtn) {
    return;
  }
  atlasOpenBtn.hidden = Boolean(transition);
}

function transitionOverlayAlpha() {
  if (!transition) {
    return 0;
  }
  const elapsed = performance.now() - transition.start;
  const fadeIn = Math.min(1, elapsed / 520);
  const fadeOut =
    elapsed > transition.duration - 520
      ? Math.max(0, (transition.duration - elapsed) / 520)
      : 1;
  return Math.min(fadeIn, fadeOut);
}

function draw() {
  const [sp] = currentLine();
  const blackChapterBreak = Boolean(transition);
  const vw = viewport.width;
  const vh = viewport.height;

  ctx.clearRect(0, 0, vw, vh);

  if (blackChapterBreak) {
    ctx.fillStyle = "#080d12";
    ctx.fillRect(0, 0, vw, vh);
  } else {
    const stage = resolveStageState(lineIndex);
    drawBackgroundFullscreen(stage);
    drawBackgroundAccordionTransitionFullscreen();
  }

  StoryCanvasViewport.applyDesignTransform(ctx, viewport);
  if (!blackChapterBreak) {
    drawPortraits();
  }
  drawDialogue();
  drawTransitionText();
  StoryCanvasViewport.restoreDesignTransform(ctx);

  syncAtlasButtonVisibility();

  if (SHOW_VIEWPORT_DEBUG) {
    StoryCanvasViewport.drawViewportDebug(ctx, viewport, FONT_STACK);
  }

  needsRedraw = Boolean(!transition && sp !== transitionKey);
}

/** 背景獨立於設計座標系，以 cover 填滿整個 CSS 視窗 */
function drawBackgroundFullscreen(stage) {
  const activeTransition = backgroundTransition && !transition;
  const displayStage = activeTransition
    ? ((performance.now() - backgroundTransition.start) / backgroundTransition.duration < 0.5
        ? backgroundTransition.fromStage
        : backgroundTransition.toStage)
    : stage;
  const src = backgroundSrc(displayStage.backgroundKey);
  const vw = viewport.width;
  const vh = viewport.height;

  ctx.fillStyle = src === BLACK_BACKGROUND_KEY ? "#000" : "#080d12";
  ctx.fillRect(0, 0, vw, vh);
  if (src === BLACK_BACKGROUND_KEY) {
    return;
  }
  const image = ensureImage(src);
  if (!image || !image.complete || !image.naturalWidth || image._loadFailed) {
    return;
  }
  drawImageCover(image, 0, 0, vw, vh);
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
  const targetHeight = DESIGN_HEIGHT * layout.heightFactor;
  const scale = targetHeight / image.naturalHeight;
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const footOverflow = DESIGN_HEIGHT * layout.footOverflow;
  const y = DESIGN_HEIGHT - height + footOverflow;
  let x;
  if (layout.anchor === "left") {
    x = DESIGN_WIDTH * layout.xRatio;
  } else if (layout.anchor === "right") {
    x = DESIGN_WIDTH * layout.xRatio - width;
  } else {
    x = DESIGN_WIDTH * layout.xRatio - width / 2;
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
  const labelOffset = 39;
  const x = Math.round((box.x + labelOffset) * 2) / 2;
  const y = Math.round((box.y - labelOffset) * 2) / 2;
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

function drawTransitionText() {
  if (!transition) {
    return;
  }
  const alpha = transitionOverlayAlpha();
  const vw = viewport.width;
  const vh = viewport.height;

  ctx.save();
  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, vw, vh);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = alpha;
  const transitionFontPx = 96;
  ctx.fillStyle = "rgba(255, 238, 207, 0.92)";
  ctx.font = `900 ${transitionFontPx}px ${FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(transition.text, DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2);
  ctx.restore();
}

/** 背景切換動畫覆蓋全視窗 */
function drawBackgroundAccordionTransitionFullscreen() {
  if (!backgroundTransition || transition) {
    return;
  }
  const vw = viewport.width;
  const vh = viewport.height;
  const elapsed = performance.now() - backgroundTransition.start;
  const t = Math.min(1, Math.max(0, elapsed / backgroundTransition.duration));
  const closing = t < 0.5;
  const phase = closing ? t / 0.5 : (t - 0.5) / 0.5;
  const base = closing ? easeInOut(phase) : 1 - easeInOut(phase);
  const stripCount = Math.max(10, Math.min(18, Math.round(vw / 92)));
  const stripW = Math.ceil(vw / stripCount);

  ctx.save();
  for (let i = 0; i < stripCount; i += 1) {
    const delay = (i / Math.max(1, stripCount - 1)) * 0.16;
    const local = closing
      ? Math.min(1, Math.max(0, base * 1.16 - delay))
      : Math.min(1, Math.max(0, base * 1.16 - (0.16 - delay)));
    const cover = easeInOut(local);
    if (cover <= 0.001) {
      continue;
    }
    const x0 = i * stripW;
    const w = Math.min(stripW + 1, vw - x0 + 1);
    const foldW = w * cover;
    const x = i % 2 === 0 ? x0 : x0 + w - foldW;
    const gradient = ctx.createLinearGradient(x, 0, x + Math.max(1, foldW), 0);
    gradient.addColorStop(0, "rgba(0, 0, 0, 0.98)");
    gradient.addColorStop(0.5, "rgba(0, 0, 0, 0.94)");
    gradient.addColorStop(1, "rgba(10, 10, 12, 0.98)");
    ctx.fillStyle = gradient;
    ctx.fillRect(x, 0, foldW, vh);

    ctx.globalAlpha = Math.min(0.36, cover * 0.36);
    ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.34)";
    ctx.fillRect(i % 2 === 0 ? x + foldW - 3 : x, 0, 3, vh);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function dialogueBoxRect() {
  const margin = 30;
  const width = Math.min(1180, DESIGN_WIDTH - margin * 2);
  const height = 278;
  const bottomCrop = -50;
  return {
    x: (DESIGN_WIDTH - width) / 2,
    y: DESIGN_HEIGHT - margin - height + bottomCrop,
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
  updateTyping(now);
  updateAutoPlay(now);
  updateTransition(now);
  updateBackgroundTransition(now);
  updatePortraitAnimations(now);
  if (needsRedraw) {
    draw();
  }
  requestAnimationFrame(loop);
}

function handleStoryCanvasPointer(event) {
  if (event.type === "pointermove" || event.type === "pointerleave") {
    return;
  }
  if (event.type === "pointerdown" && event.button !== 0) {
    return;
  }
  advanceLine();
}

atlasOpenBtn?.addEventListener("click", (event) => {
  event.stopPropagation();
  if (!transition) {
    openArchiveFrame();
  }
});

canvas.addEventListener("pointermove", handleStoryCanvasPointer);
canvas.addEventListener("pointerleave", handleStoryCanvasPointer);
canvas.addEventListener("pointerdown", handleStoryCanvasPointer);
window.addEventListener("keydown", (event) => {
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    advanceLine();
  } else if (event.key === "Control" || event.ctrlKey) {
    event.preventDefault();
    skipHeld = true;
    skipForward();
  }
});
window.addEventListener("keyup", (event) => {
  if (event.key === "Control") {
    skipHeld = false;
    resetAutoAdvanceTimer();
  }
});
StoryCanvasViewport.bindCanvasResize(
  canvas,
  ctx,
  viewport,
  () => {
    syncViewFromViewport();
    needsRedraw = true;
  },
  { useUiScale: true }
);
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

syncViewFromViewport();
syncAtlasButtonVisibility();
loadStoryLinesFromSheet();
requestAnimationFrame(loop);
