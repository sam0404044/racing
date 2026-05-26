(function () {
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

  function strokeRound(ctx, x, y, w, h, r, color, line = 1, dash = []) {
    ctx.save();
    roundRect(ctx, x, y, w, h, r);
    ctx.strokeStyle = color;
    ctx.lineWidth = line;
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.restore();
  }

  function drawPanel(ctx, x, y, w, h, accent, glow) {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "rgba(14,28,24,0.96)");
    g.addColorStop(0.58, "rgba(10,18,18,0.94)");
    g.addColorStop(1, "rgba(10,12,14,0.92)");
    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = 12;
    roundRect(ctx, x, y, w, h, 10);
    ctx.fillStyle = g;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    strokeRound(ctx, x + 5, y + 5, w - 10, h - 10, 8, "rgba(93,255,122,0.18)", 1);
  }

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

  function panelRect(viewport) {
    const v = viewport || {};
    const left = Number.isFinite(v.left) ? v.left : 0;
    const bottom = Number.isFinite(v.bottom) ? v.bottom : Number(v.height || 0);
    return { x: left + 24, y: bottom - 170 - 24, w: 290, h: 170 };
  }

  function draw(ctx, rect, options = {}) {
    const time = options.time || 0;
    const charges = Math.max(0, Number(options.charges || 0));
    const disabled = !!options.disabled;
    const hover = !!options.hover;
    const canAccept = !!options.canAccept;
    const accent = disabled
      ? "rgba(120,128,140,0.36)"
      : hover
        ? "#bfffd0"
        : canAccept
          ? `rgba(140,255,170,${0.62 + Math.sin(time * 0.006) * 0.2})`
          : "#5dff7a";
    const glow = hover ? "rgba(180,255,200,0.78)" : "rgba(93,255,122,0.34)";

    drawPanel(ctx, rect.x, rect.y, rect.w, rect.h, accent, glow);
    text(ctx, "\u8eca\u9ad4\u72c0\u614b \u00b7 CHASSIS", rect.x + 14, rect.y + 22, 12, "rgba(93,255,122,0.78)", "800");
    text(ctx, `\u7a7a\u529b ${charges}`, rect.x + rect.w - 14, rect.y + 22, 12, "#9fff9f", "900", "right");

    const car = {
      x: rect.x + 18,
      y: rect.y + 42,
      w: rect.w - 36,
      h: Math.max(52, rect.h - 96),
    };
    drawCarWireframe(ctx, car.x, car.y, car.w, car.h, accent, glow, time);

    if (options.showDropZone !== false) {
      strokeRound(ctx, car.x, car.y, car.w, car.h, 10, disabled ? "rgba(160,168,178,0.35)" : "rgba(93,255,122,0.62)", 2, [7, 6]);
    }

    if (options.message) {
      text(ctx, options.message, rect.x + rect.w / 2, rect.y + rect.h - 16, 12, hover ? "#e5ffeb" : "rgba(190,255,205,0.9)", "900", "center");
    }

    return {
      dropZone: { x: car.x, y: car.y, w: car.w, h: car.h },
    };
  }

  function drawStabilityPanel(ctx, viewport, options = {}) {
    const rect = panelRect(viewport);
    const visual = draw(ctx, rect, options);
    return { rect, ...visual };
  }

  window.FinalDriverChassisHud = { draw, panelRect, drawStabilityPanel };
})();
