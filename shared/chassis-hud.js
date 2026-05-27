(function () {
  // ─── 基礎工具 ─────────────────────────────────────────────
  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
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

  function strokeRound(ctx, x, y, w, h, r, color, line = 1, dash = []) {
    ctx.save();
    roundRect(ctx, x, y, w, h, r);
    ctx.strokeStyle = color;
    ctx.lineWidth = line;
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.restore();
  }

  function text(ctx, message, x, y, size, color, weight = "800", align = "left") {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px system-ui, "Microsoft JhengHei", sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 6;
    ctx.fillText(message, x, y);
    ctx.restore();
  }

  function inRect(p, r) {
    return p && r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }

  // hex / rgba 換 alpha
  function fadeColor(c, a) {
    if (!c) return `rgba(140, 255, 140, ${a})`;
    if (c.startsWith("#")) {
      const r = parseInt(c.slice(1, 3), 16);
      const g = parseInt(c.slice(3, 5), 16);
      const b = parseInt(c.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    return c.replace(/rgba?\(([^)]+)\)/, (_, inner) => {
      const parts = inner.split(",").map(s => s.trim());
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${a})`;
    });
  }

  // ─── SC1 Terran 風格切角面板 ──────────────────────────────
  // 兩層線框 + 四角斜切 + 深色玻璃感、accent / glow 由呼叫者依狀態決定
  function drawTerranPanel(ctx, x, y, w, h, accent, glow) {
    ctx.save();
    // 底色：深色玻璃漸層
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, "rgba(6, 22, 12, 0.92)");
    grad.addColorStop(1, "rgba(3, 12, 8, 0.94)");
    ctx.fillStyle = grad;
    // 斜切角 path
    const cut = 10;
    ctx.beginPath();
    ctx.moveTo(x + cut, y);
    ctx.lineTo(x + w - cut, y);
    ctx.lineTo(x + w, y + cut);
    ctx.lineTo(x + w, y + h - cut);
    ctx.lineTo(x + w - cut, y + h);
    ctx.lineTo(x + cut, y + h);
    ctx.lineTo(x, y + h - cut);
    ctx.lineTo(x, y + cut);
    ctx.closePath();
    ctx.fill();
    // 外層線框 + glow
    ctx.shadowColor = glow || "rgba(80, 255, 110, 0.45)";
    ctx.shadowBlur = 10;
    ctx.strokeStyle = accent || "rgba(80, 255, 110, 0.85)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;
    // 內層細線
    ctx.strokeStyle = fadeColor(accent || "rgba(60, 180, 90, 1)", 0.32);
    ctx.lineWidth = 1;
    ctx.beginPath();
    const inset = 4;
    const cut2 = cut - 2;
    ctx.moveTo(x + inset + cut2, y + inset);
    ctx.lineTo(x + w - inset - cut2, y + inset);
    ctx.lineTo(x + w - inset, y + inset + cut2);
    ctx.lineTo(x + w - inset, y + h - inset - cut2);
    ctx.lineTo(x + w - inset - cut2, y + h - inset);
    ctx.lineTo(x + inset + cut2, y + h - inset);
    ctx.lineTo(x + inset, y + h - inset - cut2);
    ctx.lineTo(x + inset, y + inset + cut2);
    ctx.closePath();
    ctx.stroke();
    // 標題列底色
    ctx.fillStyle = fadeColor(accent || "rgba(50, 160, 80, 1)", 0.15);
    ctx.fillRect(x + 6, y + 6, w - 12, 22);
    // 標題列下緣分隔線
    ctx.strokeStyle = fadeColor(accent || "rgba(120, 255, 150, 1)", 0.4);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 6, y + 28);
    ctx.lineTo(x + w - 6, y + 28);
    ctx.stroke();
    // 標題列左側裝飾小方塊
    ctx.fillStyle = fadeColor(accent || "rgba(120, 255, 150, 1)", 0.85);
    ctx.fillRect(x + 10, y + 12, 4, 10);
    ctx.restore();
  }

  // ─── 簡單線框車（L1 backward compat、Phase 2 會替換成細節車體）─────
  function drawCarWireframe(ctx, x, y, w, h, accent, glow, time) {
    const scanT = (Math.sin(time * 0.004) + 1) / 2;
    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x + 14, y + h * 0.52);
    ctx.lineTo(x + w * 0.25, y + 12);
    ctx.lineTo(x + w * 0.58, y + 8);
    ctx.lineTo(x + w - 22, y + h * 0.36);
    ctx.lineTo(x + w - 14, y + h * 0.64);
    ctx.lineTo(x + w * 0.58, y + h - 8);
    ctx.lineTo(x + w * 0.25, y + h - 12);
    ctx.closePath();
    ctx.stroke();

    ctx.strokeStyle = "rgba(93,255,122,0.38)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.25, y + 12);
    ctx.lineTo(x + w * 0.42, y + h * 0.5);
    ctx.lineTo(x + w * 0.25, y + h - 12);
    ctx.moveTo(x + w * 0.58, y + 8);
    ctx.lineTo(x + w * 0.69, y + h * 0.5);
    ctx.lineTo(x + w * 0.58, y + h - 8);
    ctx.stroke();

    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    const wheelW = Math.max(16, w * 0.075);
    const wheelH = Math.max(10, h * 0.18);
    ctx.strokeRect(x + w * 0.08, y + 7, wheelW, wheelH);
    ctx.strokeRect(x + w * 0.08, y + h - wheelH - 7, wheelW, wheelH);
    ctx.strokeRect(x + w * 0.83, y + 7, wheelW, wheelH);
    ctx.strokeRect(x + w * 0.83, y + h - wheelH - 7, wheelW, wheelH);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(37,217,255,0.62)";
    ctx.lineWidth = 1;
    const scanY = y + 5 + scanT * (h - 10);
    ctx.beginPath();
    ctx.moveTo(x, scanY);
    ctx.lineTo(x + w, scanY);
    ctx.stroke();
    ctx.restore();
  }

  // ─── 位置計算 ─────────────────────────────────────────────
  function panelRect(viewport) {
    const v = viewport || {};
    const left = Number.isFinite(v.left) ? v.left : 0;
    const bottom = Number.isFinite(v.bottom) ? v.bottom : Number(v.height || 0);
    return { x: left + 24, y: bottom - 170 - 24, w: 290, h: 170 };
  }

  // ─── 面板「外殼」（無車體）── L2 自畫車體時用這個 ──────────
  // 畫面板 + 標題列 + 充能 + 拖曳狀態 + drop fx + 訊息
  // 回傳: { rect, carRect, dropZone, accent, glow, canAccept, hover, isDragging }
  function drawChrome(ctx, viewport, options = {}) {
    const time = options.time || 0;
    const charges = Math.max(0, Number(options.charges || 0));
    const disabled = !!options.disabled;

    const rect = panelRect(viewport);

    // Drop zone = 標題列以下的整個面板（比 carRect 略大）
    const dropZone = {
      x: rect.x + 6,
      y: rect.y + 30,
      w: rect.w - 12,
      h: rect.h - 36,
    };

    // canAccept / hover：可以由呼叫者直接給、或由 drag + dropZone 推算
    const drag = options.drag || null;
    const canAccept = options.canAccept !== undefined
      ? !!options.canAccept
      : (!!drag && !disabled);
    let hover;
    if (options.hover !== undefined) {
      hover = !!options.hover;
    } else if (canAccept && drag) {
      const dragCenter = {
        x: drag.x + (drag.w || 0) / 2,
        y: drag.y + (drag.h || 0) / 2,
      };
      hover = inRect(dragCenter, dropZone);
    } else {
      hover = false;
    }

    // Border accent
    let accent, glow;
    if (disabled) {
      accent = "rgba(120, 128, 140, 0.36)";
      glow = "rgba(120, 128, 140, 0.18)";
    } else if (hover) {
      accent = "#bfffd0";
      glow = "rgba(180, 255, 200, 0.85)";
    } else if (canAccept) {
      const p = 0.55 + 0.45 * Math.sin(time * 0.006);
      accent = `rgba(140, 255, 170, ${p})`;
      glow = `rgba(140, 255, 170, ${0.4 * p + 0.2})`;
    } else {
      accent = "#5dff7a";
      glow = "rgba(93, 255, 122, 0.4)";
    }

    // 1) Panel chrome (SC1 切角)
    drawTerranPanel(ctx, rect.x, rect.y, rect.w, rect.h, accent, glow);

    // 2) Drop fx pulse overlay
    const dropFx = options.dropFx;
    if (dropFx && dropFx.until) {
      const pulse = Math.max(0, Math.min(1, (dropFx.until - performance.now()) / 520));
      if (pulse > 0) {
        ctx.save();
        ctx.fillStyle = `rgba(150, 255, 180, ${0.16 * pulse})`;
        ctx.fillRect(rect.x + 4, rect.y + 4, rect.w - 8, rect.h - 8);
        ctx.restore();
      }
    }

    // 3) 標題列（綠字）+ 右上角充能數
    text(ctx, "\u8eca\u9ad4\u72c0\u614b \u00b7 CHASSIS",
         rect.x + 14, rect.y + 22, 12, "rgba(93, 255, 122, 0.78)", "800");
    text(ctx, `\u7a7a\u529b ${charges}`,
         rect.x + rect.w - 14, rect.y + 22, 12, "#9fff9f", "900", "right");

    // 4) 內部車體區域
    const carRect = {
      x: rect.x + 10,
      y: rect.y + 32,
      w: rect.w - 20,
      h: rect.h - 42,
    };

    // 5) 底部訊息（拖曳提示 / 警告）
    if (options.message) {
      const msgColor = hover ? "rgba(220, 255, 230, 1)" : "rgba(150, 255, 180, 0.95)";
      text(ctx, options.message,
           rect.x + rect.w / 2, rect.y + rect.h - 12, 12, msgColor, "900", "center");
    }

    return {
      rect,
      carRect,
      dropZone,
      accent,
      glow,
      canAccept,
      hover,
      isDragging: !!drag,
    };
  }

  // ─── 整套面板（chrome + 簡單線框車）── L1 用、向後相容 ──────
  function drawStabilityPanel(ctx, viewport, options = {}) {
    const chrome = drawChrome(ctx, viewport, options);
    const cr = chrome.carRect;

    // 簡單線框車（Phase 2 會替換成 L2 風格的細節 schematic）
    drawCarWireframe(ctx, cr.x, cr.y, cr.w, cr.h, chrome.accent, chrome.glow, options.time || 0);

    // Drop zone 虛線框（提示玩家可放置）
    if (options.showDropZone !== false) {
      strokeRound(ctx, cr.x, cr.y, cr.w, cr.h, 10,
                  options.disabled
                    ? "rgba(160, 168, 178, 0.35)"
                    : "rgba(93, 255, 122, 0.62)",
                  2, [7, 6]);
    }

    return {
      rect: chrome.rect,
      dropZone: chrome.dropZone,
    };
  }

  // 公開 API
  window.FinalDriverChassisHud = {
    panelRect,
    drawChrome,
    drawStabilityPanel,
    // 留個別 helper 給有需要的呼叫者
    drawTerranPanel,
    drawCarWireframe,
  };
})();
