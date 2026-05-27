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

  // textRaw: 跟 text 幾乎一樣、但可選 noShadow 旗標、給小字（"+1"、"01"）用、避免發光糊掉
  function textRaw(ctx, message, x, y, size, color, weight = "700", align = "left", noShadow = false) {
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


  // ─── 細節車體俯視 schematic (Phase 2) ───────────────────────────
  // 永遠回傳鮮綠色組（輪胎機制已移除、health color 介面保留）
  function _carPartStroke(ctx, part, hoverPart, isTyre, hc, tier = "med") {
    const isHover = (hoverPart === part);
    const widths = { bold: 1.6, med: 1.0, thin: 0.7 };
    const blurs  = { bold: 4, med: 3, thin: 2 };
    ctx.lineWidth = widths[tier] || 1.0;
    if (isTyre) {
      ctx.strokeStyle = isHover ? "#dfffe8" : hc.main;
      ctx.shadowColor = isHover ? "rgba(180,255,200,0.7)" : hc.glow;
      ctx.shadowBlur = (blurs[tier] || 3) + (isHover ? 3 : 0);
    } else if (isHover) {
      ctx.strokeStyle = "#bfffd0";
      ctx.shadowColor = "rgba(180,255,200,0.7)";
      ctx.shadowBlur = (blurs[tier] || 3) + 3;
    } else {
      ctx.strokeStyle = "#5dff7a";
      ctx.shadowColor = "rgba(93,255,122,0.4)";
      ctx.shadowBlur = blurs[tier] || 3;
    }
  }

  function chassisHitAreas(x, y, w, h) {
    const SX = w / 510, SY = h / 240;
    const cy = 120;
    const trackHalf = 88, wheelW = 60, wheelH = 36;
    const bodyHalf = 16, sidepodHalf = 66, noseHalf = 4, floorHalf = 70;
    const rwX1 = 10, rwX2 = 54;
    const rearWheelCx = 105;
    const gearboxX2 = 168;
    const sidepodX1 = 158, sidepodX2 = 300;
    const airboxX2 = 238;
    const cockpitX1 = 238, cockpitX2 = 282;
    const noseBaseX = 304;
    const frontWheelCx = 388;
    const noseTipX = 462;
    const fwX2 = 502;
  
    const areas = [];
    const push = (part, vx, vy, vw, vh) => {
      areas.push({ part, x: x + vx * SX, y: y + vy * SY, w: vw * SX, h: vh * SY });
    };
  
    // 1. AERO – top floor strip
    push("aero", rearWheelCx + wheelW/2 - 4, cy - floorHalf - 2,
      (frontWheelCx - wheelW/2 + 4) - (rearWheelCx + wheelW/2 - 4),
      (cy - sidepodHalf) - (cy - floorHalf - 2));
    // 2. AERO – bottom floor strip
    push("aero", rearWheelCx + wheelW/2 - 4, cy + sidepodHalf,
      (frontWheelCx - wheelW/2 + 4) - (rearWheelCx + wheelW/2 - 4),
      (cy + floorHalf + 2) - (cy + sidepodHalf));
    // 3. REAR WING
    push("rearWing", rwX1 - 8, cy - trackHalf - 8,
      (rwX2 + 6) - (rwX1 - 8), trackHalf * 2 + 16);
    // 4. AERO – slat counter (rear wing center)
    push("aero", rwX1 + 2, cy - 30, rwX2 - rwX1 - 4, 60);
    // 5. POWERTRAIN
    push("powertrain", rwX2 + 2, cy - bodyHalf - 4,
      airboxX2 - (rwX2 + 2), bodyHalf * 2 + 8);
    // 6. TYRES (4 wheels)
    [[rearWheelCx, cy - trackHalf], [rearWheelCx, cy + trackHalf],
     [frontWheelCx, cy - trackHalf], [frontWheelCx, cy + trackHalf]].forEach(([cx, cyW]) => {
      push("tyres", cx - wheelW/2 - 4, cyW - wheelH/2 - 4, wheelW + 8, wheelH + 8);
    });
    // 7. REAR SUSPENSION (top + bottom)
    push("suspension", rearWheelCx - 4, (cy - trackHalf + wheelH/2) - 4,
      (gearboxX2 + 4) - (rearWheelCx - 4),
      (cy - bodyHalf) - ((cy - trackHalf + wheelH/2) - 4));
    push("suspension", rearWheelCx - 4, cy + bodyHalf,
      (gearboxX2 + 4) - (rearWheelCx - 4),
      ((cy + trackHalf - wheelH/2) + 4) - (cy + bodyHalf));
    // 8. SIDEPOD (top + bottom)
    push("sidepod", sidepodX1, cy - sidepodHalf,
      sidepodX2 - sidepodX1, sidepodHalf - bodyHalf);
    push("sidepod", sidepodX1, cy + bodyHalf,
      sidepodX2 - sidepodX1, sidepodHalf - bodyHalf);
    // 9. AERO – bargeboards
    push("aero", sidepodX2 + 4, cy - floorHalf,
      (noseBaseX + 30) - (sidepodX2 + 4), floorHalf * 2);
    // 10. COCKPIT (drawn AFTER powertrain so wins overlap)
    push("cockpit", cockpitX1 - 4, cy - bodyHalf - 6,
      (cockpitX2 + 4) - (cockpitX1 - 4), bodyHalf * 2 + 12);
    // 11. NOSE
    push("nose", noseBaseX + 30, cy - noseHalf - 8,
      (noseTipX - 4) - (noseBaseX + 30), noseHalf * 2 + 16);
    // 12. FRONT SUSPENSION (top + bottom)
    push("suspension", noseBaseX + 70, (cy - trackHalf + wheelH/2) - 4,
      (frontWheelCx - 8) - (noseBaseX + 70),
      (cy - bodyHalf) - ((cy - trackHalf + wheelH/2) - 4));
    push("suspension", noseBaseX + 70, cy + bodyHalf,
      (frontWheelCx - 8) - (noseBaseX + 70),
      ((cy + trackHalf - wheelH/2) + 4) - (cy + bodyHalf));
    // 13. FRONT WING
    push("frontWing", noseTipX - 2, cy - trackHalf - 18,
      (fwX2 + 10) - (noseTipX - 2), trackHalf * 2 + 36);
  
    return areas;
  }

  function tireHealthColor(time) {
    return {
      main: "#5dff7a",
      dim: "rgba(80, 200, 110, 0.55)",
      glow: "rgba(90, 255, 130, 0.55)",
      danger: false,
      pulse: 1,
    };
  }

  function drawCarSchematic(ctx, x, y, w, h, hc, time, hoverPart, charges) {
  
    // v10 設計座標系（510×240）→ canvas 縮放
    const SX = w / 510, SY = h / 240;
    const TX = (vx) => x + vx * SX;
    const TY = (vy) => y + vy * SY;
    // y 軸用 SY 等比例縮放尺寸（半寬 / 半高等）
    const SH = (n) => n * SY;
    const SW = (n) => n * SX;
  
    // v10 設計座標
    const dCy = 120;
    const trackHalf = 88, wheelW = 60, wheelH = 36;
    const bodyHalf = 16, sidepodHalf = 66, noseHalf = 4, floorHalf = 70;
    const rwX1 = 10, rwX2 = 54;
    const rearWheelCx = 105;
    const gearboxX1 = 138, gearboxX2 = 168;
    const engineX1 = 168, engineX2 = 214;
    const sidepodX1 = 158, sidepodX2 = 300;
    const airboxX1 = 214, airboxX2 = 238;
    const cockpitX1 = 238, cockpitX2 = 282;
    const noseBaseX = 304;
    const frontWheelCx = 388;
    const noseTipX = 462;
    const fwX1 = 458, fwX2 = 502;
  
    const cy = TY(dCy);
    const topWheelInnerY = TY(dCy - trackHalf + wheelH/2);
    const botWheelInnerY = TY(dCy + trackHalf - wheelH/2);
  
    // ════════════════════════════════════════════════════════════════
    // LAYER 1: FLOOR (aero)
    // ════════════════════════════════════════════════════════════════
    ctx.save();
    _carPartStroke(ctx, "aero", hoverPart, false, hc, "thin");
    ctx.setLineDash([4 * SX, 3 * SX]);
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(TX(rearWheelCx + wheelW/2 - 2), TY(dCy - floorHalf));
    ctx.lineTo(TX(frontWheelCx - wheelW/2 + 2), TY(dCy - floorHalf));
    ctx.lineTo(TX(frontWheelCx - wheelW/2 - 4), TY(dCy - bodyHalf - 10));
    ctx.lineTo(TX(noseTipX - 30), TY(dCy - noseHalf - 4));
    ctx.lineTo(TX(noseTipX - 30), TY(dCy + noseHalf + 4));
    ctx.lineTo(TX(frontWheelCx - wheelW/2 - 4), TY(dCy + bodyHalf + 10));
    ctx.lineTo(TX(frontWheelCx - wheelW/2 + 2), TY(dCy + floorHalf));
    ctx.lineTo(TX(rearWheelCx + wheelW/2 - 2), TY(dCy + floorHalf));
    ctx.closePath();
    // 半透明 fill
    const isAeroActive = hoverPart === "aero";
    ctx.fillStyle = isAeroActive ? "rgba(180,255,200,0.20)" : "rgba(93,255,122,0.14)";
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  
    // Floor edge vortex generators
    ctx.save();
    _carPartStroke(ctx, "aero", hoverPart, false, hc, "med");
    for (let i = 0; i < 7; i++) {
      const vx = sidepodX2 - 10 - i * 14;
      if (vx < sidepodX1 + 30) break;
      ctx.beginPath();
      ctx.moveTo(TX(vx),     TY(dCy - floorHalf + 2));
      ctx.lineTo(TX(vx + 4), TY(dCy - floorHalf - 5));
      ctx.lineTo(TX(vx + 8), TY(dCy - floorHalf + 2));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(TX(vx),     TY(dCy + floorHalf - 2));
      ctx.lineTo(TX(vx + 4), TY(dCy + floorHalf + 5));
      ctx.lineTo(TX(vx + 8), TY(dCy + floorHalf - 2));
      ctx.stroke();
    }
    ctx.restore();
  
    // ════════════════════════════════════════════════════════════════
    // LAYER 2: BODY SILHOUETTE (shared, no hover)
    // ════════════════════════════════════════════════════════════════
    ctx.save();
    ctx.fillStyle = "rgba(93,255,122,0.18)";
    ctx.strokeStyle = "#5dff7a";
    ctx.shadowColor = "rgba(93,255,122,0.4)";
    ctx.shadowBlur = 3;
    ctx.lineWidth = 1.4;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(TX(rwX2 + 4), TY(dCy - bodyHalf + 2));
    ctx.lineTo(TX(gearboxX1 - 4), TY(dCy - bodyHalf));
    ctx.bezierCurveTo(
      TX(gearboxX2 + 10), TY(dCy - bodyHalf - 2),
      TX(sidepodX1 + 4), TY(dCy - sidepodHalf + 18),
      TX(sidepodX1 + 30), TY(dCy - sidepodHalf)
    );
    ctx.bezierCurveTo(
      TX(sidepodX1 + 80), TY(dCy - sidepodHalf - 1),
      TX(sidepodX2 - 80), TY(dCy - sidepodHalf - 1),
      TX(sidepodX2 - 30), TY(dCy - sidepodHalf)
    );
    ctx.bezierCurveTo(
      TX(sidepodX2 - 4), TY(dCy - sidepodHalf + 14),
      TX(sidepodX2 + 18), TY(dCy - bodyHalf - 8),
      TX(noseBaseX + 8), TY(dCy - bodyHalf)
    );
    ctx.bezierCurveTo(
      TX(noseBaseX + 40), TY(dCy - bodyHalf),
      TX(noseBaseX + 80), TY(dCy - noseHalf - 2),
      TX(noseBaseX + 100), TY(dCy - noseHalf)
    );
    ctx.lineTo(TX(noseTipX - 8), TY(dCy - noseHalf + 0.5));
    ctx.lineTo(TX(noseTipX), TY(dCy - 1));
    ctx.lineTo(TX(noseTipX + 6), TY(dCy));
    ctx.lineTo(TX(noseTipX), TY(dCy + 1));
    ctx.lineTo(TX(noseTipX - 8), TY(dCy + noseHalf - 0.5));
    ctx.lineTo(TX(noseBaseX + 100), TY(dCy + noseHalf));
    ctx.bezierCurveTo(
      TX(noseBaseX + 80), TY(dCy + noseHalf + 2),
      TX(noseBaseX + 40), TY(dCy + bodyHalf),
      TX(noseBaseX + 8), TY(dCy + bodyHalf)
    );
    ctx.bezierCurveTo(
      TX(sidepodX2 + 18), TY(dCy + bodyHalf + 8),
      TX(sidepodX2 - 4), TY(dCy + sidepodHalf - 14),
      TX(sidepodX2 - 30), TY(dCy + sidepodHalf)
    );
    ctx.bezierCurveTo(
      TX(sidepodX2 - 80), TY(dCy + sidepodHalf + 1),
      TX(sidepodX1 + 80), TY(dCy + sidepodHalf + 1),
      TX(sidepodX1 + 30), TY(dCy + sidepodHalf)
    );
    ctx.bezierCurveTo(
      TX(sidepodX1 + 4), TY(dCy + sidepodHalf - 18),
      TX(gearboxX2 + 10), TY(dCy + bodyHalf + 2),
      TX(gearboxX1 - 4), TY(dCy + bodyHalf)
    );
    ctx.lineTo(TX(rwX2 + 4), TY(dCy + bodyHalf - 2));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  
    // ════════════════════════════════════════════════════════════════
    // LAYER 3: REAR WING
    // ════════════════════════════════════════════════════════════════
    ctx.save();
    _carPartStroke(ctx, "rearWing", hoverPart, false, hc, "bold");
    // 主翼框
    ctx.strokeRect(TX(rwX1), TY(dCy - trackHalf), SW(rwX2 - rwX1), SH(trackHalf * 2));
    // 端板
    ctx.strokeRect(TX(rwX1 - 6), TY(dCy - trackHalf - 6), SW(6), SH(trackHalf * 2 + 12));
    ctx.strokeRect(TX(rwX2),     TY(dCy - trackHalf - 6), SW(6), SH(trackHalf * 2 + 12));
    // DRS slot + flap divisions
    _carPartStroke(ctx, "rearWing", hoverPart, false, hc, "med");
    ctx.beginPath();
    ctx.moveTo(TX(rwX1 + 2), TY(dCy - trackHalf + 8));
    ctx.lineTo(TX(rwX2 - 2), TY(dCy - trackHalf + 8));
    ctx.moveTo(TX(rwX1 + 2), TY(dCy - trackHalf + 12));
    ctx.lineTo(TX(rwX2 - 2), TY(dCy - trackHalf + 12));
    for (let i = 1; i < 4; i++) {
      const yi = dCy - trackHalf + i * (trackHalf * 2 / 4);
      ctx.moveTo(TX(rwX1), TY(yi));
      ctx.lineTo(TX(rwX2), TY(yi));
    }
    // 端板 louvre
    for (let i = 0; i < 4; i++) {
      const ey = (dCy - trackHalf - 6) + 14 + i * (((trackHalf * 2 + 12) - 28) / 3);
      ctx.moveTo(TX(rwX1 - 6), TY(ey));
      ctx.lineTo(TX(rwX1),     TY(ey));
      ctx.moveTo(TX(rwX2),     TY(ey));
      ctx.lineTo(TX(rwX2 + 6), TY(ey));
    }
    ctx.stroke();
    ctx.restore();
  
    // ════════════════════════════════════════════════════════════════
    // LAYER 4: AERO SLAT COUNTER (rear wing center)
    // ════════════════════════════════════════════════════════════════
    const visibleCharges = Math.min(charges, 6);
    const overflow = Math.max(0, charges - 6);
    const slatThick = 4, slatGap = 4;
    ctx.save();
    ctx.shadowColor = "rgba(140,255,170,0.85)";
    ctx.shadowBlur = 4;
    ctx.fillStyle = isAeroActive ? "rgba(220,255,230,0.95)" : "rgba(180,255,200,0.88)";
    for (let i = 0; i < visibleCharges; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const step = Math.floor(i / 2) + 1;
      const sy = dCy + side * (step * (slatThick + slatGap)) - slatThick / 2;
      ctx.fillRect(TX(rwX1 + 4), TY(sy), SW(rwX2 - rwX1 - 8), SH(slatThick));
    }
    ctx.restore();
    if (overflow > 0) {
      textRaw(ctx, `+${overflow}`, TX((rwX1 + rwX2) / 2), cy + 4, 11,
        "rgba(180,255,200,0.98)", "900", "center", true);
    }
  
    // ════════════════════════════════════════════════════════════════
    // LAYER 5: POWERTRAIN (rear pylons + diffuser + gearbox + V6 + airbox)
    // ════════════════════════════════════════════════════════════════
    ctx.save();
    _carPartStroke(ctx, "powertrain", hoverPart, false, hc, "bold");
    // 後翼 pylons (3)
    ctx.beginPath();
    ctx.moveTo(TX(rwX2),       TY(dCy - 14));
    ctx.lineTo(TX(gearboxX1),  TY(dCy - bodyHalf + 4));
    ctx.moveTo(TX(rwX2),       TY(dCy + 14));
    ctx.lineTo(TX(gearboxX1),  TY(dCy + bodyHalf - 4));
    ctx.moveTo(TX(rwX2),       cy);
    ctx.lineTo(TX(gearboxX1),  cy);
    ctx.stroke();
    // Diffuser strakes (4)
    for (let i = 0; i < 4; i++) {
      const vx = rwX2 + 8 + i * 14;
      if (vx > gearboxX1 - 6) break;
      ctx.strokeRect(TX(vx), TY(dCy - bodyHalf + 4), SW(3), SH(bodyHalf * 2 - 8));
    }
    // Gearbox
    ctx.strokeRect(TX(gearboxX1), TY(dCy - bodyHalf + 2),
                   SW(gearboxX2 - gearboxX1), SH(bodyHalf * 2 - 4));
    _carPartStroke(ctx, "powertrain", hoverPart, false, hc, "med");
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      const ly = dCy - bodyHalf + 2 + i * (bodyHalf * 2 - 4) / 4;
      ctx.moveTo(TX(gearboxX1 + 3), TY(ly));
      ctx.lineTo(TX(gearboxX2 - 3), TY(ly));
    }
    ctx.stroke();
    // V6 engine block
    _carPartStroke(ctx, "powertrain", hoverPart, false, hc, "bold");
    ctx.strokeRect(TX(engineX1 + 2), TY(dCy - bodyHalf + 2),
                   SW(engineX2 - engineX1 - 4), SH(bodyHalf * 2 - 4));
    // V6 cylinders (2 rows × 3)
    const cylRows = [dCy - bodyHalf * 0.55, dCy + bodyHalf * 0.55];
    for (const cyR of cylRows) {
      for (let i = 0; i < 3; i++) {
        const ccx = engineX1 + 10 + i * 14;
        // 外圈
        ctx.beginPath();
        ctx.ellipse(TX(ccx), TY(cyR), SW(4.5), SH(4.5), 0, 0, Math.PI * 2);
        ctx.stroke();
        // 內圈
        _carPartStroke(ctx, "powertrain", hoverPart, false, hc, "med");
        ctx.beginPath();
        ctx.ellipse(TX(ccx), TY(cyR), SW(2), SH(2), 0, 0, Math.PI * 2);
        ctx.stroke();
        _carPartStroke(ctx, "powertrain", hoverPart, false, hc, "bold");
      }
    }
    // Intake plenum
    ctx.strokeRect(TX(engineX1 + 6), TY(dCy - 2.5),
                   SW(engineX2 - engineX1 - 12), SH(5));
    // Plenum runners
    _carPartStroke(ctx, "powertrain", hoverPart, false, hc, "med");
    ctx.beginPath();
    for (const cyR of cylRows) {
      for (let i = 0; i < 3; i++) {
        const ccx = engineX1 + 10 + i * 14;
        const dy = cyR < dCy ? dCy - 2.5 : dCy + 2.5;
        ctx.moveTo(TX(ccx), TY(cyR + (cyR < dCy ? 4.5 : -4.5)));
        ctx.lineTo(TX(ccx), TY(dy));
      }
    }
    ctx.stroke();
    // Exhaust headers
    _carPartStroke(ctx, "powertrain", hoverPart, false, hc, "bold");
    ctx.beginPath();
    ctx.moveTo(TX(engineX1 + 10), TY(dCy - bodyHalf * 0.55 - 4.5));
    ctx.quadraticCurveTo(TX(engineX1 - 2), TY(dCy - bodyHalf * 0.85),
                         TX(engineX1 - 6), TY(dCy - bodyHalf + 2));
    ctx.moveTo(TX(engineX1 + 10), TY(dCy + bodyHalf * 0.55 + 4.5));
    ctx.quadraticCurveTo(TX(engineX1 - 2), TY(dCy + bodyHalf * 0.85),
                         TX(engineX1 - 6), TY(dCy + bodyHalf - 2));
    ctx.stroke();
    // Airbox
    ctx.strokeRect(TX(airboxX1), TY(dCy - bodyHalf + 2),
                   SW(airboxX2 - airboxX1), SH(bodyHalf * 2 - 4));
    _carPartStroke(ctx, "powertrain", hoverPart, false, hc, "thin");
    ctx.beginPath();
    ctx.moveTo(TX(airboxX1 + 2), TY(dCy - 5));
    ctx.lineTo(TX(airboxX2 - 2), TY(dCy - 5));
    ctx.moveTo(TX(airboxX1 + 2), TY(dCy + 5));
    ctx.lineTo(TX(airboxX2 - 2), TY(dCy + 5));
    ctx.stroke();
    // Intake mouth
    _carPartStroke(ctx, "powertrain", hoverPart, false, hc, "bold");
    ctx.beginPath();
    ctx.moveTo(TX(airboxX1),     TY(dCy - 10));
    ctx.lineTo(TX(airboxX1 - 8), TY(dCy - 6));
    ctx.lineTo(TX(airboxX1 - 8), TY(dCy + 6));
    ctx.lineTo(TX(airboxX1),     TY(dCy + 10));
    ctx.stroke();
    ctx.restore();
  
    // ════════════════════════════════════════════════════════════════
    // LAYER 6: TYRES (4 wheels, use hc for color)
    // ════════════════════════════════════════════════════════════════
    function drawWheelV10(cxV, cyVdesign) {
      ctx.save();
      _carPartStroke(ctx, "tyres", hoverPart, true, hc, "bold");
      const wx = TX(cxV - wheelW/2);
      const wy = TY(cyVdesign - wheelH/2);
      const wW = SW(wheelW), wH = SH(wheelH);
      const r = SW(6);
      // 圓角矩形
      ctx.beginPath();
      ctx.moveTo(wx + r, wy);
      ctx.lineTo(wx + wW - r, wy);
      ctx.quadraticCurveTo(wx + wW, wy, wx + wW, wy + r);
      ctx.lineTo(wx + wW, wy + wH - r);
      ctx.quadraticCurveTo(wx + wW, wy + wH, wx + wW - r, wy + wH);
      ctx.lineTo(wx + r, wy + wH);
      ctx.quadraticCurveTo(wx, wy + wH, wx, wy + wH - r);
      ctx.lineTo(wx, wy + r);
      ctx.quadraticCurveTo(wx, wy, wx + r, wy);
      ctx.closePath();
      ctx.stroke();
      // 內側 sidewall band
      _carPartStroke(ctx, "tyres", hoverPart, true, hc, "med");
      ctx.strokeRect(TX(cxV - wheelW/2 + 5), TY(cyVdesign - wheelH/2 + 4),
                     SW(wheelW - 10), SH(wheelH - 8));
      // 中央 brake disc 3 層 ellipse
      _carPartStroke(ctx, "tyres", hoverPart, true, hc, "bold");
      ctx.beginPath();
      ctx.ellipse(TX(cxV), TY(cyVdesign), SW(wheelW * 0.28), SH(wheelH * 0.42), 0, 0, Math.PI * 2);
      ctx.stroke();
      _carPartStroke(ctx, "tyres", hoverPart, true, hc, "med");
      ctx.beginPath();
      ctx.ellipse(TX(cxV), TY(cyVdesign), SW(wheelW * 0.20), SH(wheelH * 0.30), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(TX(cxV), TY(cyVdesign), SW(wheelW * 0.10), SH(wheelH * 0.16), 0, 0, Math.PI * 2);
      ctx.stroke();
      // 中央十字
      ctx.beginPath();
      ctx.moveTo(TX(cxV - 3), TY(cyVdesign));
      ctx.lineTo(TX(cxV + 3), TY(cyVdesign));
      ctx.moveTo(TX(cxV), TY(cyVdesign - 3));
      ctx.lineTo(TX(cxV), TY(cyVdesign + 3));
      ctx.stroke();
      // Brake caliper（內側亮條）
      _carPartStroke(ctx, "tyres", hoverPart, true, hc, "bold");
      const inboardY = cyVdesign < dCy
        ? cyVdesign + wheelH * 0.32
        : cyVdesign - wheelH * 0.32 - 5;
      ctx.strokeRect(TX(cxV - 10), TY(inboardY), SW(20), SH(5));
      // 胎面紋
      _carPartStroke(ctx, "tyres", hoverPart, true, hc, "thin");
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) {
        const ty = cyVdesign + i * (wheelH * 0.22);
        ctx.moveTo(TX(cxV - wheelW/2 + 3), TY(ty));
        ctx.lineTo(TX(cxV + wheelW/2 - 3), TY(ty));
      }
      ctx.stroke();
      ctx.restore();
    }
    drawWheelV10(rearWheelCx, dCy - trackHalf);
    drawWheelV10(rearWheelCx, dCy + trackHalf);
    drawWheelV10(frontWheelCx, dCy - trackHalf);
    drawWheelV10(frontWheelCx, dCy + trackHalf);
  
    // ════════════════════════════════════════════════════════════════
    // LAYER 7: REAR SUSPENSION (3 arms per side)
    // ════════════════════════════════════════════════════════════════
    ctx.save();
    _carPartStroke(ctx, "suspension", hoverPart, false, hc, "bold");
    ctx.beginPath();
    // Top
    ctx.moveTo(TX(gearboxX2 - 2), TY(dCy - bodyHalf));
    ctx.lineTo(TX(rearWheelCx + wheelW/2 - 10), TY(dCy - trackHalf + wheelH/2 + 1));
    ctx.moveTo(TX(gearboxX1 + 4), TY(dCy - bodyHalf));
    ctx.lineTo(TX(rearWheelCx - wheelW/2 + 10), TY(dCy - trackHalf + wheelH/2 + 1));
    ctx.moveTo(TX(gearboxX1 + 14), TY(dCy - bodyHalf + 4));
    ctx.lineTo(TX(rearWheelCx),    TY(dCy - trackHalf + wheelH/2 + 4));
    // Bottom
    ctx.moveTo(TX(gearboxX2 - 2), TY(dCy + bodyHalf));
    ctx.lineTo(TX(rearWheelCx + wheelW/2 - 10), TY(dCy + trackHalf - wheelH/2 - 1));
    ctx.moveTo(TX(gearboxX1 + 4), TY(dCy + bodyHalf));
    ctx.lineTo(TX(rearWheelCx - wheelW/2 + 10), TY(dCy + trackHalf - wheelH/2 - 1));
    ctx.moveTo(TX(gearboxX1 + 14), TY(dCy + bodyHalf - 4));
    ctx.lineTo(TX(rearWheelCx),    TY(dCy + trackHalf - wheelH/2 - 4));
    ctx.stroke();
    ctx.restore();
  
    // ════════════════════════════════════════════════════════════════
    // LAYER 8: SIDEPOD (inlets + cooling louvres)
    // ════════════════════════════════════════════════════════════════
    ctx.save();
    _carPartStroke(ctx, "sidepod", hoverPart, false, hc, "med");
    // Inlets
    ctx.beginPath();
    ctx.moveTo(TX(sidepodX1 + 2), TY(dCy - bodyHalf));
    ctx.lineTo(TX(sidepodX1 + 18), TY(dCy - sidepodHalf + 8));
    ctx.lineTo(TX(sidepodX1 + 28), TY(dCy - sidepodHalf + 8));
    ctx.moveTo(TX(sidepodX1 + 2), TY(dCy + bodyHalf));
    ctx.lineTo(TX(sidepodX1 + 18), TY(dCy + sidepodHalf - 8));
    ctx.lineTo(TX(sidepodX1 + 28), TY(dCy + sidepodHalf - 8));
    // Structural ridges
    ctx.moveTo(TX(sidepodX1 + 22), TY(dCy - sidepodHalf + 12));
    ctx.lineTo(TX(sidepodX2 - 24), TY(dCy - sidepodHalf + 12));
    ctx.moveTo(TX(sidepodX1 + 22), TY(dCy + sidepodHalf - 12));
    ctx.lineTo(TX(sidepodX2 - 24), TY(dCy + sidepodHalf - 12));
    // Cooling louvres
    for (let i = 0; i < 6; i++) {
      const lx = sidepodX2 - 34 + i * 5;
      if (lx > sidepodX2 - 6) break;
      ctx.moveTo(TX(lx),     TY(dCy - sidepodHalf + 4));
      ctx.lineTo(TX(lx + 3), TY(dCy - sidepodHalf + 14));
      ctx.moveTo(TX(lx),     TY(dCy + sidepodHalf - 4));
      ctx.lineTo(TX(lx + 3), TY(dCy + sidepodHalf - 14));
    }
    ctx.stroke();
    ctx.restore();
  
    // ════════════════════════════════════════════════════════════════
    // LAYER 9: BARGEBOARDS (aero) — between sidepod and front wheels
    // ════════════════════════════════════════════════════════════════
    ctx.save();
    _carPartStroke(ctx, "aero", hoverPart, false, hc, "med");
    const bbX1 = sidepodX2 + 4;
    const bbX2 = noseBaseX + 30;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const off = i * 4;
      ctx.moveTo(TX(bbX1 + 4 - off), TY(dCy - bodyHalf - 2));
      ctx.quadraticCurveTo(TX(bbX1 + 16),       TY(dCy - floorHalf + off + 8),
                           TX(bbX2 - 4 + off),  TY(dCy - bodyHalf - 4 + off));
      ctx.moveTo(TX(bbX1 + 4 - off), TY(dCy + bodyHalf + 2));
      ctx.quadraticCurveTo(TX(bbX1 + 16),       TY(dCy + floorHalf - off - 8),
                           TX(bbX2 - 4 + off),  TY(dCy + bodyHalf + 4 - off));
    }
    ctx.stroke();
    // Turning vanes
    _carPartStroke(ctx, "aero", hoverPart, false, hc, "thin");
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const bx = bbX1 + 8 + i * 8;
      if (bx > bbX2 - 4) break;
      ctx.moveTo(TX(bx), TY(dCy - floorHalf + 6));
      ctx.lineTo(TX(bx), TY(dCy - bodyHalf - 2));
      ctx.moveTo(TX(bx), TY(dCy + floorHalf - 6));
      ctx.lineTo(TX(bx), TY(dCy + bodyHalf + 2));
    }
    ctx.stroke();
    ctx.restore();
  
    // ════════════════════════════════════════════════════════════════
    // LAYER 10: COCKPIT (drawn AFTER powertrain so wins overlap)
    // ════════════════════════════════════════════════════════════════
    const cockpitCx = (cockpitX1 + cockpitX2) / 2;
    ctx.save();
    _carPartStroke(ctx, "cockpit", hoverPart, false, hc, "bold");
    // Cockpit tub
    ctx.strokeRect(TX(cockpitX1), TY(dCy - bodyHalf + 2),
                   SW(cockpitX2 - cockpitX1), SH(bodyHalf * 2 - 4));
    // Halo (outer ellipse)
    ctx.beginPath();
    ctx.ellipse(TX(cockpitCx), cy, SW(16), SH(12), 0, 0, Math.PI * 2);
    ctx.stroke();
    // Halo inner
    _carPartStroke(ctx, "cockpit", hoverPart, false, hc, "med");
    ctx.beginPath();
    ctx.ellipse(TX(cockpitCx), cy, SW(14), SH(10), 0, 0, Math.PI * 2);
    ctx.stroke();
    // Halo Y-strut forward
    _carPartStroke(ctx, "cockpit", hoverPart, false, hc, "bold");
    ctx.strokeRect(TX(cockpitCx + 12), TY(dCy - 2), SW(10), SH(4));
    // Halo aft mounts
    _carPartStroke(ctx, "cockpit", hoverPart, false, hc, "med");
    ctx.beginPath();
    ctx.moveTo(TX(cockpitCx - 12), TY(dCy - 5));
    ctx.lineTo(TX(cockpitCx - 18), TY(dCy - 8));
    ctx.moveTo(TX(cockpitCx - 12), TY(dCy + 5));
    ctx.lineTo(TX(cockpitCx - 18), TY(dCy + 8));
    ctx.stroke();
    // Helmet
    _carPartStroke(ctx, "cockpit", hoverPart, false, hc, "bold");
    ctx.beginPath();
    ctx.ellipse(TX(cockpitCx), cy, SW(9), SH(7), 0, 0, Math.PI * 2);
    ctx.stroke();
    // Visor (dark band)
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.fillRect(TX(cockpitCx - 5), TY(dCy - 2), SW(10), SH(4));
    ctx.restore();
    ctx.strokeRect(TX(cockpitCx - 5), TY(dCy - 2), SW(10), SH(4));
    // Steering wheel
    ctx.strokeRect(TX(cockpitCx - 7), TY(dCy + 10), SW(14), SH(3));
    ctx.restore();
  
    // ════════════════════════════════════════════════════════════════
    // LAYER 11: NOSE (S-ducts + car number)
    // ════════════════════════════════════════════════════════════════
    ctx.save();
    _carPartStroke(ctx, "nose", hoverPart, false, hc, "bold");
    // S-duct nostrils
    ctx.beginPath();
    ctx.ellipse(TX(noseBaseX + 38), TY(dCy - 2.5), SW(3), SH(1.2), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(TX(noseBaseX + 38), TY(dCy + 2.5), SW(3), SH(1.2), 0, 0, Math.PI * 2);
    ctx.stroke();
    // Car number badge
    ctx.strokeRect(TX(noseBaseX + 58), TY(dCy - 4), SW(14), SH(8));
    ctx.restore();
    textRaw(ctx, "01", TX(noseBaseX + 65), TY(dCy + 2), 8,
      hoverPart === "nose" ? "#bfffd0" : "#5dff7a", "900", "center", true);
  
    // ════════════════════════════════════════════════════════════════
    // LAYER 12: FRONT SUSPENSION (4 arms per side)
    // ════════════════════════════════════════════════════════════════
    ctx.save();
    _carPartStroke(ctx, "suspension", hoverPart, false, hc, "bold");
    const susTopFrom = noseBaseX + 78;
    const susBotFrom = noseBaseX + 96;
    ctx.beginPath();
    ctx.moveTo(TX(susTopFrom), TY(dCy - bodyHalf - 2));
    ctx.lineTo(TX(frontWheelCx - 8), TY(dCy - trackHalf + 10));
    ctx.moveTo(TX(susBotFrom), TY(dCy - bodyHalf));
    ctx.lineTo(TX(frontWheelCx + 8), TY(dCy - trackHalf + 10));
    ctx.moveTo(TX(susTopFrom), TY(dCy + bodyHalf + 2));
    ctx.lineTo(TX(frontWheelCx - 8), TY(dCy + trackHalf - 10));
    ctx.moveTo(TX(susBotFrom), TY(dCy + bodyHalf));
    ctx.lineTo(TX(frontWheelCx + 8), TY(dCy + trackHalf - 10));
    ctx.stroke();
    _carPartStroke(ctx, "suspension", hoverPart, false, hc, "med");
    ctx.beginPath();
    ctx.moveTo(TX(susTopFrom), TY(dCy - bodyHalf));
    ctx.lineTo(TX(frontWheelCx - 8), TY(dCy - trackHalf - 4));
    ctx.moveTo(TX(susBotFrom), TY(dCy - bodyHalf + 2));
    ctx.lineTo(TX(frontWheelCx + 8), TY(dCy - trackHalf - 4));
    ctx.moveTo(TX(susTopFrom), TY(dCy + bodyHalf));
    ctx.lineTo(TX(frontWheelCx - 8), TY(dCy + trackHalf + 4));
    ctx.moveTo(TX(susBotFrom), TY(dCy + bodyHalf - 2));
    ctx.lineTo(TX(frontWheelCx + 8), TY(dCy + trackHalf + 4));
    ctx.stroke();
    ctx.restore();
  
    // ════════════════════════════════════════════════════════════════
    // LAYER 13: FRONT WING (chevron, ㄑ endplates)
    // ════════════════════════════════════════════════════════════════
    ctx.save();
    _carPartStroke(ctx, "frontWing", hoverPart, false, hc, "bold");
    // Center span
    ctx.strokeRect(TX(noseTipX), TY(dCy - 6), SW(fwX2 - noseTipX - 6), SH(12));
    // 2 pylons
    ctx.strokeRect(TX(noseTipX), TY(dCy - 5), SW(8), SH(3));
    ctx.strokeRect(TX(noseTipX), TY(dCy + 2), SW(8), SH(3));
    // Top cascade
    ctx.beginPath();
    ctx.moveTo(TX(noseTipX),       TY(dCy - 6));
    ctx.lineTo(TX(noseTipX + 14),  TY(dCy - trackHalf + 6));
    ctx.lineTo(TX(fwX2 - 8),       TY(dCy - trackHalf + 6));
    ctx.lineTo(TX(fwX2 - 6),       TY(dCy - 6));
    ctx.closePath();
    ctx.stroke();
    // Bottom cascade
    ctx.beginPath();
    ctx.moveTo(TX(noseTipX),       TY(dCy + 6));
    ctx.lineTo(TX(noseTipX + 14),  TY(dCy + trackHalf - 6));
    ctx.lineTo(TX(fwX2 - 8),       TY(dCy + trackHalf - 6));
    ctx.lineTo(TX(fwX2 - 6),       TY(dCy + 6));
    ctx.closePath();
    ctx.stroke();
    // Cascade flap lines
    _carPartStroke(ctx, "frontWing", hoverPart, false, hc, "med");
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const t = (i + 1) / 4;
      const yTop = dCy - 6 + t * ((dCy - trackHalf + 6) - (dCy - 6));
      ctx.moveTo(TX(noseTipX + 4 + t * 12), TY(yTop));
      ctx.lineTo(TX(fwX2 - 6), TY(yTop));
      const yBot = dCy + 6 + t * ((dCy + trackHalf - 6) - (dCy + 6));
      ctx.moveTo(TX(noseTipX + 4 + t * 12), TY(yBot));
      ctx.lineTo(TX(fwX2 - 6), TY(yBot));
    }
    ctx.stroke();
    // ㄑ endplates
    _carPartStroke(ctx, "frontWing", hoverPart, false, hc, "bold");
    const wingY1 = dCy - trackHalf - 14;
    const wingY2 = dCy - trackHalf + 16;
    const wingY3 = dCy + trackHalf - 16;
    const wingY4 = dCy + trackHalf + 14;
    ctx.beginPath();
    // Top endplate (folded)
    ctx.moveTo(TX(fwX2 - 10), TY(wingY1));
    ctx.lineTo(TX(fwX2),      TY(wingY1 + 8));
    ctx.lineTo(TX(fwX2),      TY(wingY2 + 6));
    ctx.lineTo(TX(fwX2 - 4),  TY(wingY2 + 8));
    // Bottom endplate (mirror)
    ctx.moveTo(TX(fwX2 - 10), TY(wingY4));
    ctx.lineTo(TX(fwX2),      TY(wingY4 - 8));
    ctx.lineTo(TX(fwX2),      TY(wingY3 - 6));
    ctx.lineTo(TX(fwX2 - 4),  TY(wingY3 - 8));
    ctx.stroke();
    // Endplate vertical bars (front edges)
    ctx.strokeRect(TX(fwX2), TY(wingY1 + 8), SW(4), SH((wingY2 + 6) - (wingY1 + 8)));
    ctx.strokeRect(TX(fwX2), TY(wingY3 - 6), SW(4), SH((wingY4 - 8) - (wingY3 - 6)));
    // Endplate louvre slits
    _carPartStroke(ctx, "frontWing", hoverPart, false, hc, "med");
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const ey = wingY1 + 10 + i * 5;
      ctx.moveTo(TX(fwX2),     TY(ey));
      ctx.lineTo(TX(fwX2 + 4), TY(ey));
      const ey2 = wingY3 - 10 + i * 5;
      ctx.moveTo(TX(fwX2),     TY(ey2));
      ctx.lineTo(TX(fwX2 + 4), TY(ey2));
    }
    ctx.stroke();
    ctx.restore();
  }
  
  // 俯視輪胎：圓角矩形 + 中央橫線（從上看的輪胎輪廓）
  function drawTopWheel(ctx, cx, cy, w, h, hc) {
    ctx.save();
    ctx.shadowColor = hc.glow;
    ctx.shadowBlur = 5;
    ctx.strokeStyle = hc.main;
    ctx.lineWidth = 1.5;
    // 圓角矩形 path
    const r = h * 0.42;
    ctx.beginPath();
    ctx.moveTo(cx - w/2 + r, cy - h/2);
    ctx.lineTo(cx + w/2 - r, cy - h/2);
    ctx.quadraticCurveTo(cx + w/2, cy - h/2, cx + w/2, cy - h/2 + r);
    ctx.lineTo(cx + w/2, cy + h/2 - r);
    ctx.quadraticCurveTo(cx + w/2, cy + h/2, cx + w/2 - r, cy + h/2);
    ctx.lineTo(cx - w/2 + r, cy + h/2);
    ctx.quadraticCurveTo(cx - w/2, cy + h/2, cx - w/2, cy + h/2 - r);
    ctx.lineTo(cx - w/2, cy - h/2 + r);
    ctx.quadraticCurveTo(cx - w/2, cy - h/2, cx - w/2 + r, cy - h/2);
    ctx.closePath();
    ctx.stroke();
    // 中央橫線（輪輻側面 / 胎面紋的暗示）
    ctx.shadowBlur = 0;
    ctx.strokeStyle = hc.dim;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.35, cy);
    ctx.lineTo(cx + w * 0.35, cy);
    ctx.stroke();
    // 兩條輔助胎面紋
    ctx.strokeStyle = fadeColor(hc.main, 0.3);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.30, cy - h * 0.25);
    ctx.lineTo(cx + w * 0.30, cy - h * 0.25);
    ctx.moveTo(cx - w * 0.30, cy + h * 0.25);
    ctx.lineTo(cx + w * 0.30, cy + h * 0.25);
    ctx.stroke();
    ctx.restore();
  }
  

  function drawScanLine(ctx, x, y, w, h, time, hc) {
  
    const period = 3200;
    // tri wave: 0 → 1 → 0 → ...
    const phase = (time % period) / period;
    const t = phase < 0.5 ? phase * 2 : (1 - phase) * 2;  // 0..1..0
    const scanY = y + 8 + (h - 16) * t;
  
    // 條紋光暈
    ctx.save();
    const grad = ctx.createLinearGradient(0, scanY - 14, 0, scanY + 14);
    const baseColor = hc.main.startsWith("#")
      ? `${hc.main}`
      : "rgba(140, 255, 160, 1)";
    grad.addColorStop(0, fadeColor(baseColor, 0));
    grad.addColorStop(0.5, fadeColor(baseColor, 0.30));
    grad.addColorStop(1, fadeColor(baseColor, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(x + 4, scanY - 14, w - 8, 28);
    // 中央細亮線
    ctx.strokeStyle = fadeColor(baseColor, 0.7);
    ctx.lineWidth = 1;
    ctx.shadowColor = fadeColor(baseColor, 0.6);
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(x + 4, scanY);
    ctx.lineTo(x + w - 4, scanY);
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

  // ─── 整套面板（chrome + 細節車體 schematic）── L1 + L2 共用 ───────
  // L1 直接呼叫這個拿到完整面板；L2 用 drawChrome + 自己呼叫 drawCarSchematic / drawScanLine
  function drawStabilityPanel(ctx, viewport, options = {}) {
    const chrome = drawChrome(ctx, viewport, options);
    const cr = chrome.carRect;
    const time = options.time || 0;
    const charges = Math.max(0, Number(options.charges || 0));
    const hc = tireHealthColor(time);

    // 拖曳時 aero 部件亮起、否則無 hover
    const hoverPart = chrome.hover ? "aero" : null;

    // 細節俯視車體
    drawCarSchematic(ctx, cr.x, cr.y, cr.w, cr.h, hc, time, hoverPart, charges);

    // 掃描線
    drawScanLine(ctx, cr.x, cr.y, cr.w, cr.h, time, hc);

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
    // Phase 2: L2 直接呼叫的細節車體 API
    drawCarSchematic,
    drawScanLine,
    chassisHitAreas,
    tireHealthColor,
    // 內部 helper（給特殊情況用）
    drawTerranPanel,
  };
})();
