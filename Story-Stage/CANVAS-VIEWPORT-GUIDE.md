# Canvas 視窗與座標系統實作指南（Story Stage）

> 給本專案其他頁面、新功能、AI 協作時的參考 PROMPT。  
> 共用工具：`canvas-viewport.js`  
> 參考實作：`story-stage.js`、`character-archive.js`

---

## 使用方式（可直接貼給 AI）

```
請依照 racing/Story-Stage/CANVAS-VIEWPORT-GUIDE.md 實作 canvas：

1. 固定設計稿 1920×1080 虛擬座標 + letterbox（contain）
2. devicePixelRatio 只用於 canvas 內部解析度，不用於物件縮放
3. 背景 CG 獨立以 cover 填滿整個 CSS 視窗
4. 立繪、對話框、遊戲內 UI 在設計座標內繪製
5. 角落固定按鈕（設定、圖鑑等）用 HTML + CSS，與視窗錨定，不要畫在 design transform 內
6. 滑鼠／觸控先轉 canvas CSS 座標，再 screenToWorld 做 hit test
7. 勿設 canvas.style.width/height 固定 px；勿用 100vw；iframe 內勿用 100dvh
8. 載入 canvas-viewport.js，使用 StoryCanvasViewport API
```

---

## 1. 架構總覽

```
┌─────────────────────────────────────────────┐
│  HTML 角落 UI（齒輪、圖鑑）← 視窗 CSS 錨定    │
├─────────────────────────────────────────────┤
│  Canvas（CSS 100% 填滿 .story-shell）        │
│  ┌───────────────────────────────────────┐  │
│  │ 背景層：cover 滿版（viewport 座標）     │  │
│  ├───────────────────────────────────────┤  │
│  │ letterbox 黑邊（可選，通常只有上下）    │  │
│  │ ┌─────────────────────────────────┐   │  │
│  │ │ 設計座標 1920×1080               │   │  │
│  │ │ 立繪、對話框、特效…              │   │  │
│  │ └─────────────────────────────────┘   │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

| 層級 | 座標系 | 縮放方式 |
|------|--------|----------|
| 背景 CG | `viewport.width` × `viewport.height` | `drawImageCover` 滿版 |
| 遊戲物件／對話框 | `1920` × `1080` 設計稿 | `finalScale` + `offsetX/Y` letterbox |
| 角落按鈕 | 視窗 CSS（`clamp` + `position: absolute`） | 不經 canvas transform |
| Canvas 解析度 | `viewport × devicePixelRatio` | 僅影響清晰度 |

---

## 2. 設計稿常數

```javascript
const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;

const viewport = StoryCanvasViewport.createViewportState(DESIGN_WIDTH, DESIGN_HEIGHT);
```

所有**排版、立繪位置、對話框、字級**一律用 `DESIGN_WIDTH` / `DESIGN_HEIGHT` 或設計稿內的固定 px（例如對話框寬 1180、高 278）。

---

## 3. Resize 與 DPR（`canvas-viewport.js`）

### 3.1 量測顯示尺寸

- 從 **父層容器** `getBoundingClientRect()` 量測，不要信任 canvas 上殘留的 inline `width/height` px。
- resize 時 **清除** `canvas.style.width` / `canvas.style.height`，由 CSS `width:100%; height:100%` 控制顯示大小。
- iframe 內文件用 `height: 100%` 傳遞高度，**不要用 `100dvh`**（易以外層視窗為準而裁切）。

### 3.2 設定內部解析度

```javascript
const dpr = window.devicePixelRatio || 1;
canvas.width = Math.round(viewWidth * dpr);
canvas.height = Math.round(viewHeight * dpr);
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
```

**禁止：** 用 `dpr` 或 `devicePixelRatio` 直接縮放遊戲物件。  
**禁止：** 把 `canvas.width` / `canvas.height` 當成 CSS 顯示寬高使用。

### 3.3 Letterbox 比例

```javascript
const scale = Math.min(viewWidth / DESIGN_WIDTH, viewHeight / DESIGN_HEIGHT);
const uiScale = getResponsiveUiScale(viewWidth); // 可選，見第 8 節
const finalScale = scale * uiScale;
const offsetX = (viewWidth - DESIGN_WIDTH * finalScale) / 2;
const offsetY = (viewHeight - DESIGN_HEIGHT * finalScale) / 2;
```

由 `StoryCanvasViewport.resizeCanvasToDisplay()` 自動寫入 `viewport.scale`、`viewport.finalScale`、`viewport.offsetX`、`viewport.offsetY`。

---

## 4. 繪圖順序（劇情頁範本）

```javascript
function draw() {
  const vw = viewport.width;
  const vh = viewport.height;

  ctx.clearRect(0, 0, vw, vh);

  // ① 背景：全視窗 cover（在 design transform 之外）
  drawBackgroundFullscreen(stage);

  // ② 全視窗特效（例如背景切換動畫）
  drawBackgroundAccordionTransitionFullscreen();

  // ③ 設計座標內容
  StoryCanvasViewport.applyDesignTransform(ctx, viewport);
  drawPortraits();
  drawDialogue();
  drawTransitionText(); // 黑幕可全視窗，文字在設計座標
  StoryCanvasViewport.restoreDesignTransform(ctx);

  // ④ HTML 角落按鈕不在此繪製
  syncCornerButtonsVisibility();

  // ⑤ Debug（可選）
  if (SHOW_VIEWPORT_DEBUG) {
    StoryCanvasViewport.drawViewportDebug(ctx, viewport, FONT_STACK);
  }
}
```

### 背景 cover 範例

```javascript
function drawImageCover(ctx, image, x, y, width, height) {
  const s = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawW = image.naturalWidth * s;
  const drawH = image.naturalHeight * s;
  const drawX = x + (width - drawW) / 2;
  const drawY = y + (height - drawH) / 2;
  ctx.drawImage(image, drawX, drawY, drawW, drawH);
}

function drawBackgroundFullscreen(stage) {
  const vw = viewport.width;
  const vh = viewport.height;
  ctx.fillRect(0, 0, vw, vh); // 底色
  drawImageCover(ctx, image, 0, 0, vw, vh);
}
```

---

## 5. 互動座標

### 5.1 螢幕 → Canvas CSS

```javascript
const screen = StoryCanvasViewport.getCanvasPoint(canvas, event.clientX, event.clientY);
// { x, y } 相對 canvas 顯示區
```

### 5.2 螢幕 → 設計稿（world）

```javascript
const world = StoryCanvasViewport.screenToWorld(screen, viewport);
// hit test 用 world.x, world.y
```

### 5.3 角落 HTML 按鈕

- **不要**用 `screenToWorld` 判斷圖鑑、設定等角落 UI。
- 使用獨立 `<button>` / `<a>`，`position: absolute` 錨定視窗，與 `.settings-link` 對稱。

```css
/* 左上：圖鑑 */
.atlas-link {
  position: absolute;
  top: clamp(12px, 2.2vh, 24px);
  left: clamp(16px, 2.2vw, 28px);
  z-index: 35;
  width: clamp(40px, 4.2vw, 48px);
  height: clamp(40px, 4.2vw, 48px);
}

/* 右上：設定 */
.settings-link {
  position: absolute;
  top: clamp(12px, 2.2vh, 24px);
  right: clamp(16px, 2.2vw, 28px);
  /* 同上 */
}
```

---

## 6. HTML 結構建議

```html
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
  <main class="story-shell">
    <button type="button" class="atlas-link" id="atlasOpenBtn" aria-label="角色圖鑑">…</button>
    <a class="settings-link" href="…" aria-label="設定">⚙</a>
    <canvas id="storyCanvas"></canvas>
  </main>
  <script src="canvas-viewport.js"></script>
  <script src="your-page.js"></script>
</body>
```

```css
html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
.story-shell { position: relative; width: 100%; height: 100%; overflow: hidden; }
#storyCanvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
```

---

## 7. 初始化與 Resize 綁定

```javascript
const canvas = document.querySelector("#storyCanvas");
const ctx = canvas.getContext("2d");
const viewport = StoryCanvasViewport.createViewportState(1920, 1080);

StoryCanvasViewport.bindCanvasResize(
  canvas,
  ctx,
  viewport,
  () => {
    needsRedraw = true;
  },
  { useUiScale: true } // 可設 false 做純 letterbox
);

function loop() {
  if (needsRedraw) draw();
  requestAnimationFrame(loop);
}
```

---

## 8. 可選 UI 縮放（uiScale）

僅在 letterbox 後仍覺得 UI 偏大時使用，**不可**用 `devicePixelRatio` 代替。

```javascript
function getResponsiveUiScale(viewWidth) {
  if (viewWidth <= 1366) return 0.85;
  if (viewWidth <= 1536) return 0.92;
  return 1;
}
// finalScale = scale * uiScale
// screenToWorld 必須使用 finalScale（已由 viewport 處理）
```

---

## 9. Debug 模式

網址加參數：`?viewportDebug=1`

顯示：`viewWidth`、`viewHeight`、`dpr`、`scale`、`uiScale`、`finalScale`、`offsetX`、`offsetY`。

```javascript
const SHOW_VIEWPORT_DEBUG = new URLSearchParams(location.search).has("viewportDebug");
```

---

## 10. 常見錯誤（禁止）

| 錯誤做法 | 後果 |
|----------|------|
| `canvas.style.width = '800px'` 且不清除 | 視窗放大後右側黑框、無法滿版 |
| 用 `window.innerWidth` 代替 canvas 父層量測 | 與 iframe／捲軸不同步 |
| 背景畫在 design transform 內 | 寬螢幕左右黑邊、背景不滿版 |
| 角落按鈕畫在 1920×1080 內 | 超寬螢幕按鈕「跑掉」往中間 |
| `100dvh` 用在 iframe 內頁 | 底部裁切 |
| `100vw` 在外層 | 橫向捲軸 |
| 用 `canvas.width` 做 layout | 座標錯誤（已乘 dpr） |
| 只用 dpr 放大 canvas 不設 transform | 模糊或座標混亂 |
| resize 時不觸發重繪 | 縮放後畫面錯位 |

---

## 11. 新頁面檢查清單

- [ ] 已載入 `canvas-viewport.js`
- [ ] `viewport` 使用 `createViewportState(1920, 1080)`
- [ ] `bindCanvasResize` 已綁定，且未寫死 canvas px 尺寸
- [ ] 背景（若有）在 **transform 外** cover 滿版
- [ ] 遊戲 UI／文字在 **applyDesignTransform 內**
- [ ] 角落控制項為 **HTML + CSS**，與齒輪按鈕對齊方式一致
- [ ] hit test 使用 `screenToWorld`（canvas 內互動）
- [ ] 未使用 `canvas.width`／`canvas.height` 做排版
- [ ] 外層 `overflow: hidden`，無 `min-width: 1920px`
- [ ] iframe 子頁用 `height: 100%`，不用 `100dvh`
- [ ] 已在 1366 / 1536 / 150% 縮放下目視確認

---

## 12. API 速查（`StoryCanvasViewport`）

| 方法 | 用途 |
|------|------|
| `createViewportState(w, h)` | 建立 viewport 狀態物件 |
| `resizeCanvasToDisplay(canvas, ctx, viewport, options?)` | 單次 resize |
| `bindCanvasResize(canvas, ctx, viewport, onResize, options?)` | 綁定 resize／ResizeObserver |
| `getCanvasPoint(canvas, clientX, clientY)` | 滑鼠 → CSS 座標 |
| `screenToWorld(point, viewport)` | CSS → 設計稿座標 |
| `worldToScreen(point, viewport)` | 設計稿 → CSS |
| `applyDesignTransform(ctx, viewport)` | 開始設計座標繪製 |
| `restoreDesignTransform(ctx)` | 結束設計座標繪製 |
| `fillLetterbox(ctx, viewport, color?)` | 填滿視窗底色 |
| `drawViewportDebug(ctx, viewport, fontStack?)` | Debug  overlay |

---

## 13. 參考檔案

| 檔案 | 說明 |
|------|------|
| `canvas-viewport.js` | 共用 viewport／DPR／座標轉換 |
| `story-stage.js` | 背景滿版 + 設計座標 + HTML 角落按鈕 |
| `story-stage.css` | shell／canvas／`.settings-link`／`.atlas-link` |
| `character-archive.js` | 全頁設計座標（圖鑑 UI） |

---

*最後更新：對應 Story Stage 劇情頁／圖鑑頁 canvas 重構（1920×1080 letterbox、背景獨立滿版、HTML 角落 UI）。*
