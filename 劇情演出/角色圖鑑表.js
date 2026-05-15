const canvas = document.querySelector("#archiveCanvas");
const ctx = canvas.getContext("2d");

/** 畫布用黑體系：正黑／雅黑／PingFang／Noto TC */
const FONT_STACK = "Microsoft JhengHei, Microsoft YaHei, PingFang TC, Noto Sans TC, sans-serif";

/** 圖鑑主視窗角色名稱標籤上下內距（與 computeLayout 的 nameTagH 一致） */
const NAME_TAG_V_PAD = 11;
/** 名稱標籤下緣與「車手編號」文字頂端的間距 */
const NAME_CODE_BELOW_GAP = 18;

const COLORS = {
  paper: "#d9d0c5",
  paperDark: "#a89b92",
  ink: "#27201d",
  blood: "#8f2639",
  bloodLight: "#e78aa2",
  filmStripBar: "#0c0b0a"
};

const TITLE_DARK = "#1e1814";

(() => {
  try {
    for (const k of ["storyMaxLineIndex", "storyPart1Length", "storyGuideMilestone"]) {
      localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
})();

/** 單獨開圖鑑分頁時可經 sessionStorage 帶入；iframe 內由父頁 postMessage 更新 */
const STORY_GUIDE_HANDOFF_KEY = "storyGuideMilestoneHandoff";
let storyGuideMilestoneLevel = 0;
try {
  const raw = sessionStorage.getItem(STORY_GUIDE_HANDOFF_KEY);
  if (raw !== null) {
    sessionStorage.removeItem(STORY_GUIDE_HANDOFF_KEY);
    storyGuideMilestoneLevel = Math.min(2, Math.max(0, Number.parseInt(raw, 10)));
  }
} catch {
  /* ignore */
}

const XIAOMAN_INTRO_BASE =
  "可愛、元氣、天然呆。看起來不像能在殘酷賽制中活下來的人，卻總是最早到練習場、最後離開。";

function readStoryGuideMilestone() {
  return storyGuideMilestoneLevel;
}

const TAB_LABELS = ["人物", "暫定", "暫定", "暫定", "暫定"];
const ACTIVE_TAB = 0;

const CHARACTERS = Array.from({ length: 10 }, (_, i) => {
  const n = i + 1;
  return {
    id: n,
    name: n === 1 ? "小滿" : `角色 ${String(n).padStart(2, "0")}`,
    code: String(n).padStart(3, "0"),
    lineA: n === 1 ? XIAOMAN_INTRO_BASE : "角色資料待補。",
    lineB: n === 1 ? "" : "年齡、車隊、關係與劇情狀態會放在這裡。",
    memo: n === 1 ? "" : "先保留為 placeholder，等正式角色立繪與設定表放入後，再替換這裡的文字與圖片。",
    portraitSrc: n === 1 ? "assets/character/xiaoman/xiaoman-character-guide.png" : null
  };
});

let viewWidth = 0;
let viewHeight = 0;
let dpr = 1;
let selectedIndex = 0;
let activeTab = ACTIVE_TAB;
let filmScroll = 0;
let hover = { close: false, tab: -1, film: -1 };
let needsRedraw = true;

window.addEventListener("message", (event) => {
  const d = event.data;
  if (!d || typeof d !== "object" || d.type !== "archiveSetGuideLevel") {
    return;
  }
  storyGuideMilestoneLevel = Math.min(2, Math.max(0, Number.parseInt(String(d.level), 10) || 0));
  needsRedraw = true;
});

const imageCache = {};

function ensureImage(src) {
  if (!src) {
    return null;
  }
  if (imageCache[src]) {
    return imageCache[src];
  }
  const image = new Image();
  image._failed = false;
  image.onload = () => {
    needsRedraw = true;
  };
  image.onerror = () => {
    image._failed = true;
    needsRedraw = true;
  };
  image.src = src;
  imageCache[src] = image;
  return image;
}

function layout() {
  const stripH = 136;
  const marginX = 24;
  const marginTop = 8;
  const marginBottom = stripH + 8;
  const book = {
    x: marginX,
    y: marginTop,
    w: viewWidth - marginX * 2,
    h: viewHeight - marginTop - marginBottom
  };
  const narrow = viewWidth < 980;
  const title = { x: 44, y: 36, w: 280, h: 72 };
  const close = { x: viewWidth - 42 - 64, y: 20, w: 64, h: 64 };
  const contentTop = book.y + (narrow ? 100 : 112);
  const contentH = book.y + book.h - contentTop - 24;
  const padX = narrow ? 26 : 56;
  const tabW = narrow ? Math.min(140, (viewWidth - padX * 2 - 32) / 5) : 150;
  const tabH = narrow ? 52 : 72;
  const gap = narrow ? 8 : 26;
  const tabs = [];
  if (narrow) {
    const totalW = TAB_LABELS.length * tabW + (TAB_LABELS.length - 1) * gap;
    let tx = book.x + (book.w - totalW) / 2;
    const ty = contentTop + contentH - tabH - 8;
    for (let i = 0; i < TAB_LABELS.length; i += 1) {
      tabs.push({ x: tx, y: ty, w: tabW, h: tabH, index: i });
      tx += tabW + gap;
    }
  } else {
    const tx = book.x + book.w - padX - tabW;
    let ty = contentTop + contentH * 0.18;
    for (let i = 0; i < TAB_LABELS.length; i += 1) {
      tabs.push({ x: tx, y: ty, w: tabW, h: tabH, index: i });
      ty += tabH + gap;
    }
  }

  const dividerX = viewWidth / 2;
  const dividerGap = narrow ? 18 : 30;
  const leftInnerLeft = book.x + padX;
  const leftInnerRight = dividerX - dividerGap;
  const leftColW = Math.max(100, leftInnerRight - leftInnerLeft);

  const portraitAspect = 1.08;
  const portraitMaxW = Math.min(
    narrow ? leftColW - 6 : Math.min(520, leftColW - 10),
    leftColW * 0.98
  );
  const portraitH = Math.min(
    portraitMaxW / portraitAspect,
    contentH * (narrow ? 0.48 : 0.56)
  );
  const portraitW = portraitH * portraitAspect;
  const portraitX = leftInnerLeft + (leftColW - portraitW) / 2;
  const portraitToNameGap = 28;
  const nameSizeEst = Math.min(46, Math.max(40, Math.floor(viewWidth * 0.03)));
  const nameTagH = NAME_TAG_V_PAD * 2 + nameSizeEst;
  const codeBelowTagGap = NAME_CODE_BELOW_GAP;
  const codeLineH = 26;
  const nameBelowH = nameTagH + codeBelowTagGap + codeLineH;
  const leftBlockH = portraitH + portraitToNameGap + nameBelowH;
  const rightBlockH = Math.min(contentH * 0.52, narrow ? 220 : 300);
  const blockH = Math.max(leftBlockH, rightBlockH, 160);
  const startY = contentTop + Math.max(4, (contentH - blockH) / 2);
  const portraitY = startY + (blockH - leftBlockH) / 2;
  const nameBelowY = portraitY + portraitH + portraitToNameGap;

  const textLeft = dividerX + dividerGap;
  const textTop = startY + (blockH - rightBlockH) / 2;
  const textW = narrow
    ? Math.max(160, book.x + book.w - padX - textLeft)
    : Math.max(200, book.x + book.w - padX - textLeft - tabW - 36);
  const textH = narrow ? contentTop + contentH - textTop - (tabH + 32) : contentH - 40;
  const dividerTop = startY + 6;
  const dividerBottom = startY + blockH - 6;

  const strip = { x: 0, y: viewHeight - stripH, w: viewWidth, h: stripH };
  const filmCardW = 156;
  const filmCardH = 88;
  const filmGap = 16;
  const filmPad = Math.max(44, Math.floor(viewWidth * 0.034));
  const filmContentW = CHARACTERS.length * filmCardW + (CHARACTERS.length - 1) * filmGap;
  const filmTotalW = filmPad * 2 + filmContentW;
  const filmMaxScroll = Math.max(0, filmTotalW - viewWidth);
  const filmStartBias = filmMaxScroll > 0 ? 0 : Math.max(0, (viewWidth - filmTotalW) / 2);

  return {
    book,
    title,
    close,
    portrait: { x: portraitX, y: portraitY, w: portraitW, h: portraitH },
    nameBelowY,
    text: { x: textLeft, y: textTop, w: Math.max(160, textW), h: Math.max(120, textH) },
    dividerX,
    dividerTop,
    dividerBottom,
    tabs,
    strip,
    filmCardW,
    filmCardH,
    filmGap,
    filmPad,
    filmStartBias,
    filmMaxScroll,
    narrow
  };
}

function filmCardAt(layout, index) {
  const { strip, filmCardW, filmCardH, filmGap, filmPad, filmStartBias } = layout;
  const x = strip.x + filmPad + filmStartBias - filmScroll + index * (filmCardW + filmGap);
  const y = strip.y + 24;
  return { x, y, w: filmCardW, h: filmCardH };
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawWrappedText(text, x, y, maxWidth, lineHeight, font, fillStyle) {
  ctx.font = font;
  ctx.fillStyle = fillStyle;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  let cursorY = y;
  const paragraphs = text.split("\n");
  for (const paragraph of paragraphs) {
    let line = "";
    for (const char of Array.from(paragraph)) {
      const test = line + char;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, cursorY);
        cursorY += lineHeight;
        line = char;
      } else {
        line = test;
      }
    }
    if (line) {
      ctx.fillText(line, x, cursorY);
      cursorY += lineHeight;
    }
  }
  return cursorY;
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, viewWidth, viewHeight);
  g.addColorStop(0, "#0b0b0b");
  g.addColorStop(0.55, "#171412");
  g.addColorStop(1, "#080808");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, viewWidth, viewHeight);
  const r1 = ctx.createRadialGradient(
    viewWidth * 0.1,
    viewHeight * 0.12,
    0,
    viewWidth * 0.1,
    viewHeight * 0.12,
    viewWidth * 0.24
  );
  r1.addColorStop(0, "rgba(120, 108, 96, 0.16)");
  r1.addColorStop(1, "transparent");
  ctx.fillStyle = r1;
  ctx.fillRect(0, 0, viewWidth, viewHeight);
}

function drawPaperBook(L) {
  const { book } = L;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.58)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  roundRect(book.x, book.y, book.w, book.h, 8);
  const paperGrad = ctx.createLinearGradient(book.x, book.y, book.x + book.w, book.y + book.h);
  paperGrad.addColorStop(0, "#e8dfd4");
  paperGrad.addColorStop(0.5, COLORS.paper);
  paperGrad.addColorStop(1, COLORS.paperDark);
  ctx.fillStyle = paperGrad;
  ctx.fill();
  ctx.restore();
}

function drawTitle(L) {
  const t = L.title;
  ctx.save();
  ctx.font = `700 ${Math.min(92, Math.max(44, viewWidth * 0.055))}px ${FONT_STACK}`;
  ctx.fillStyle = TITLE_DARK;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("圖鑑", t.x, t.y);
  ctx.restore();
}

function drawClose(L) {
  const c = L.close;
  const over = hover.close;
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  const scale = over ? 1.08 : 1;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);
  ctx.font = `72px ${FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(36, 28, 22, 0.96)";
  ctx.strokeText("×", cx, cy);
  ctx.fillStyle = "#ffffff";
  ctx.fillText("×", cx, cy);
  ctx.restore();
}

function drawPortraitFrame(L, ch) {
  const p = L.portrait;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = "#cfc7bd";
  ctx.strokeStyle = "rgba(28, 22, 20, 0.72)";
  ctx.lineWidth = 4;
  roundRect(p.x, p.y, p.w, p.h, 6);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  const pad = 18 * (p.w / 620);
  const inner = {
    x: p.x + pad,
    y: p.y + pad,
    w: p.w - pad * 2,
    h: p.h - pad * 2
  };

  ctx.fillStyle = "#3f3936";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.62)";
  ctx.lineWidth = 3;
  roundRect(inner.x, inner.y, inner.w, inner.h, 2);
  ctx.fill();
  ctx.stroke();

  const img = ch.portraitSrc ? ensureImage(ch.portraitSrc) : null;
  if (img && img.complete && img.naturalWidth && !img._failed) {
    const scale = Math.max(inner.w / img.naturalWidth, inner.h / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const dx = inner.x + (inner.w - dw) / 2;
    const dy = inner.y + (inner.h - dh) / 2;
    ctx.save();
    roundRect(inner.x, inner.y, inner.w, inner.h, 2);
    ctx.clip();
    if (ch.id === 1 && readStoryGuideMilestone() >= 2) {
      ctx.filter = "grayscale(1)";
    }
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.filter = "none";
    ctx.restore();
  } else {
    ctx.font = `18px ${FONT_STACK}`;
    ctx.fillStyle = "rgba(241, 236, 231, 0.55)";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("CHARACTER PLACEHOLDER", inner.x + inner.w - 12, inner.y + inner.h - 16);
  }
}

function drawCharacterNameBelow(L, ch) {
  const p = L.portrait;
  const y0 = L.nameBelowY;
  const padX = 18;
  const nameSize = Math.min(46, Math.max(40, Math.floor(viewWidth * 0.03)));
  const codeSize = 22;
  const line2 = `車手編號 ${ch.code}`;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${nameSize}px ${FONT_STACK}`;
  const tw = ctx.measureText(ch.name).width;
  const tagW = Math.min(p.w, tw + padX * 2);
  const tagH = NAME_TAG_V_PAD * 2 + nameSize;
  const lx = p.x;
  const ly = y0;
  const r = 8;
  ctx.fillStyle = "#1c1612";
  roundRect(lx, ly, tagW, tagH, r);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 1;
  roundRect(lx, ly, tagW, tagH, r);
  ctx.stroke();
  ctx.fillStyle = "#fafafa";
  ctx.fillText(ch.name, lx + padX, ly + tagH / 2);
  ctx.textBaseline = "top";
  const codeY = ly + tagH + NAME_CODE_BELOW_GAP;
  ctx.font = `500 ${codeSize}px ${FONT_STACK}`;
  ctx.fillStyle = "#111111";
  ctx.fillText(line2, p.x, codeY);
  ctx.restore();
}

function drawContentDivider(L) {
  ctx.save();
  ctx.strokeStyle = "rgba(62, 48, 44, 0.42)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(L.dividerX, L.dividerTop);
  ctx.lineTo(L.dividerX, L.dividerBottom);
  ctx.stroke();
  ctx.restore();
}

function drawProfileXiaoman(L) {
  const t = L.text;
  const body = Math.min(34, Math.max(20, viewWidth * 0.022));
  const memoSize = 18;
  const lvl = readStoryGuideMilestone();
  let y = drawWrappedText(
    XIAOMAN_INTRO_BASE,
    t.x,
    t.y,
    t.w,
    body * 2,
    `${body}px ${FONT_STACK}`,
    COLORS.ink
  );
  if (lvl >= 1) {
    y += 18;
    y = drawWrappedText(
      "意外的擅長數學計算。",
      t.x,
      y,
      t.w,
      body * 2,
      `${body}px ${FONT_STACK}`,
      COLORS.ink
    );
  }
  if (lvl >= 2) {
    y += 36;
    ctx.strokeStyle = "rgba(62, 48, 44, 0.18)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(t.x, y);
    ctx.lineTo(t.x + Math.min(560, t.w), y);
    ctx.stroke();
    y += 28;
    drawWrappedText(
      "淘汰於 盲牌沙漠 。",
      t.x,
      y,
      t.w,
      memoSize * 1.75,
      `${memoSize}px ${FONT_STACK}`,
      "rgba(45, 36, 32, 0.66)"
    );
  }
}

function drawProfile(L, ch) {
  if (ch.id === 1) {
    drawProfileXiaoman(L);
    return;
  }
  const t = L.text;
  const body = Math.min(34, Math.max(20, viewWidth * 0.022));
  const memoSize = 18;
  let y = drawWrappedText(
    ch.lineA,
    t.x,
    t.y,
    t.w,
    body * 2,
    `${body}px ${FONT_STACK}`,
    COLORS.ink
  );
  y += 18;
  y = drawWrappedText(
    ch.lineB,
    t.x,
    y,
    t.w,
    body * 2,
    `${body}px ${FONT_STACK}`,
    COLORS.ink
  );
  y += 36;
  ctx.strokeStyle = "rgba(62, 48, 44, 0.18)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(t.x, y);
  ctx.lineTo(t.x + Math.min(560, t.w), y);
  ctx.stroke();
  y += 28;
  drawWrappedText(
    ch.memo,
    t.x,
    y,
    t.w,
    memoSize * 1.75,
    `${memoSize}px ${FONT_STACK}`,
    "rgba(45, 36, 32, 0.66)"
  );
}

function drawTabPolygon(x, y, w, h) {
  ctx.beginPath();
  ctx.moveTo(x + w * 0.14, y);
  ctx.lineTo(x + w, y + h * 0.08);
  ctx.lineTo(x + w * 0.92, y + h * 0.92);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x + w * 0.1, y + h * 0.5);
  ctx.closePath();
}

function drawTabs(L) {
  for (const tab of L.tabs) {
    const active = tab.index === activeTab;
    const over = hover.tab === tab.index;
    ctx.save();
    drawTabPolygon(tab.x, tab.y, tab.w, tab.h);
    const g = ctx.createLinearGradient(tab.x, tab.y, tab.x + tab.w, tab.y + tab.h);
    if (active) {
      g.addColorStop(0, over ? "#6a2840" : "#5e2132");
      g.addColorStop(1, "#8f2639");
    } else {
      g.addColorStop(0, over ? "#2c2a28" : "#201e1d");
      g.addColorStop(1, "#090908");
    }
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = `700 ${L.narrow ? 20 : 28}px ${FONT_STACK}`;
    ctx.fillStyle = active ? "#ffdbe4" : "#f0e6df";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(TAB_LABELS[tab.index], tab.x + tab.w * 0.52, tab.y + tab.h * 0.52);
    ctx.restore();
  }
}

function drawFilmStrip(L) {
  const s = L.strip;
  ctx.fillStyle = COLORS.filmStripBar;
  ctx.fillRect(s.x, s.y, s.w, s.h);
  ctx.strokeStyle = "rgba(32, 26, 22, 0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(s.x + s.w, s.y);
  ctx.stroke();

  for (let i = 0; i < CHARACTERS.length; i += 1) {
    const card = filmCardAt(L, i);
    if (card.x + card.w < s.x || card.x > s.x + s.w) {
      continue;
    }
    const active = i === selectedIndex;
    const over = hover.film === i;
    const chCard = CHARACTERS[i];
    ctx.fillStyle = over && !active ? "#5c534c" : "#504942";
    roundRect(card.x, card.y, card.w, card.h, 3);
    ctx.fill();

    const img = chCard.portraitSrc ? ensureImage(chCard.portraitSrc) : null;
    ctx.save();
    roundRect(card.x, card.y, card.w, card.h, 3);
    ctx.clip();
    if (img && img.complete && img.naturalWidth && !img._failed) {
      const scale = Math.max(card.w / img.naturalWidth, card.h / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      const dx = card.x + (card.w - dw) / 2;
      const dy = card.y + (card.h - dh) / 2;
      if (chCard.id === 1 && readStoryGuideMilestone() >= 2) {
        ctx.filter = "grayscale(1)";
      }
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.filter = "none";
    } else {
      ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
      ctx.fillRect(card.x, card.y, card.w, card.h);
    }
    ctx.restore();

    ctx.strokeStyle = active ? "#ffb5c6" : "rgba(236, 226, 218, 0.72)";
    ctx.lineWidth = active ? 4 : 3;
    roundRect(card.x, card.y, card.w, card.h, 3);
    ctx.stroke();
    if (active) {
      ctx.strokeStyle = "rgba(143, 38, 57, 0.72)";
      ctx.lineWidth = 3;
      roundRect(card.x - 2, card.y - 2, card.w + 4, card.h + 4, 4);
      ctx.stroke();
    }
  }
}

function tabPolygonContains(tab, mx, my) {
  ctx.beginPath();
  drawTabPolygon(tab.x, tab.y, tab.w, tab.h);
  return ctx.isPointInPath(mx, my);
}

function hitTest(mx, my) {
  const L = layout();
  if (
    mx >= L.close.x &&
    mx <= L.close.x + L.close.w &&
    my >= L.close.y &&
    my <= L.close.y + L.close.h
  ) {
    return { type: "close" };
  }
  for (const tab of L.tabs) {
    if (tabPolygonContains(tab, mx, my)) {
      return { type: "tab", index: tab.index };
    }
  }
  for (let i = 0; i < CHARACTERS.length; i += 1) {
    const c = filmCardAt(L, i);
    if (mx >= c.x && mx <= c.x + c.w && my >= c.y && my <= c.y + c.h) {
      return { type: "film", index: i };
    }
  }
  return null;
}

function draw() {
  const L = layout();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  drawBackground();
  drawPaperBook(L);
  drawTitle(L);

  const ch = CHARACTERS[selectedIndex];
  drawPortraitFrame(L, ch);
  drawCharacterNameBelow(L, ch);
  drawProfile(L, ch);
  drawContentDivider(L);
  drawTabs(L);
  drawFilmStrip(L);
  drawClose(L);

  needsRedraw = false;
}

function resizeCanvas() {
  dpr = Math.max(1, window.devicePixelRatio || 1);
  viewWidth = window.innerWidth;
  viewHeight = window.innerHeight;
  if (viewWidth < 980) {
    viewHeight = Math.max(viewHeight, 900);
  }
  canvas.width = Math.round(viewWidth * dpr);
  canvas.height = Math.round(viewHeight * dpr);
  canvas.style.width = `${viewWidth}px`;
  canvas.style.height = `${viewHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  selectedIndex = Math.min(selectedIndex, CHARACTERS.length - 1);
  needsRedraw = true;
}

function loop() {
  if (needsRedraw) {
    draw();
  }
  requestAnimationFrame(loop);
}

function clientToCanvas(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = viewWidth / rect.width;
  const scaleY = viewHeight / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

canvas.addEventListener("mousemove", (event) => {
  const { x, y } = clientToCanvas(event.clientX, event.clientY);
  const hit = hitTest(x, y);
  const next = {
    close: hit?.type === "close",
    tab: hit?.type === "tab" ? hit.index : -1,
    film: hit?.type === "film" ? hit.index : -1
  };
  if (next.close !== hover.close || next.tab !== hover.tab || next.film !== hover.film) {
    hover = next;
    canvas.style.cursor =
      hit?.type === "close" || hit?.type === "film" || hit?.type === "tab" ? "pointer" : "default";
    needsRedraw = true;
  }
});

canvas.addEventListener("mouseleave", () => {
  hover = { close: false, tab: -1, film: -1 };
  canvas.style.cursor = "default";
  needsRedraw = true;
});

canvas.addEventListener("click", (event) => {
  const { x, y } = clientToCanvas(event.clientX, event.clientY);
  const hit = hitTest(x, y);
  if (hit?.type === "close") {
    if (window.parent !== window) {
      try {
        window.parent.postMessage({ type: "archiveRequestClose" }, "*");
      } catch {
        /* ignore */
      }
    } else {
      window.location.href = "劇情演出階段.html";
    }
    return;
  }
  if (hit?.type === "tab") {
    activeTab = hit.index;
    needsRedraw = true;
    return;
  }
  if (hit?.type === "film") {
    selectedIndex = hit.index;
    const ch = CHARACTERS[selectedIndex];
    if (ch.portraitSrc) {
      ensureImage(ch.portraitSrc);
    }
    needsRedraw = true;
  }
});

canvas.addEventListener(
  "wheel",
  (event) => {
    const L = layout();
    const s = L.strip;
    const { x, y } = clientToCanvas(event.clientX, event.clientY);
    if (y >= s.y && y <= s.y + s.h) {
      event.preventDefault();
      filmScroll = Math.max(
        0,
        Math.min(L.filmMaxScroll, filmScroll + event.deltaY)
      );
      needsRedraw = true;
    }
  },
  { passive: false }
);

window.addEventListener("resize", resizeCanvas);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    needsRedraw = true;
  }
});
resizeCanvas();
CHARACTERS.forEach((c) => {
  if (c.portraitSrc) {
    ensureImage(c.portraitSrc);
  }
});
requestAnimationFrame(loop);
