/**
 * Canvas CSS 顯示尺寸 + DPR 清晰度 + 1920×1080 設計座標 letterbox。
 * devicePixelRatio 僅用於 canvas.width/height，不作為物件縮放比例。
 */
(function (global) {
  "use strict";

  const DEFAULT_DESIGN_WIDTH = 1920;
  const DEFAULT_DESIGN_HEIGHT = 1080;

  function getResponsiveUiScale(viewWidth) {
    if (viewWidth <= 1366) {
      return 0.85;
    }
    if (viewWidth <= 1536) {
      return 0.92;
    }
    return 1;
  }

  function createViewportState(designWidth, designHeight, useUiScale) {
    return {
      width: 0,
      height: 0,
      dpr: 1,
      designWidth,
      designHeight,
      scale: 1,
      uiScale: 1,
      finalScale: 1,
      offsetX: 0,
      offsetY: 0
    };
  }

  function updateViewportLayout(viewport, viewWidth, viewHeight, options = {}) {
    const useUiScale = options.useUiScale !== false;
    viewport.width = viewWidth;
    viewport.height = viewHeight;

    const baseScale = Math.min(
      viewWidth / viewport.designWidth,
      viewHeight / viewport.designHeight
    );
    viewport.scale = baseScale;
    viewport.uiScale = useUiScale ? getResponsiveUiScale(viewWidth) : 1;
    viewport.finalScale = baseScale * viewport.uiScale;

    const scaledW = viewport.designWidth * viewport.finalScale;
    const scaledH = viewport.designHeight * viewport.finalScale;
    viewport.offsetX = (viewWidth - scaledW) / 2;
    viewport.offsetY = (viewHeight - scaledH) / 2;
  }

  function readCanvasDisplaySize(canvas) {
    canvas.style.removeProperty("width");
    canvas.style.removeProperty("height");

    const parent = canvas.parentElement;
    const measureTarget = parent || canvas;
    void measureTarget.offsetHeight;

    const rect = measureTarget.getBoundingClientRect();
    let width = rect.width;
    let height = rect.height;

    if (width < 2) {
      width = global.innerWidth || global.document?.documentElement?.clientWidth || 0;
    }
    if (height < 2) {
      height = global.innerHeight || global.document?.documentElement?.clientHeight || 0;
    }

    return {
      width: Math.round(width),
      height: Math.round(height)
    };
  }

  function resizeCanvasToDisplay(canvas, ctx, viewport, options = {}) {
    const { width, height } = readCanvasDisplaySize(canvas);
    if (width < 2 || height < 2) {
      return false;
    }

    const dpr = global.devicePixelRatio || 1;
    viewport.dpr = dpr;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    updateViewportLayout(viewport, width, height, options);
    return true;
  }

  function getCanvasPoint(canvas, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return { x: 0, y: 0 };
    }
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function screenToWorld(point, viewport) {
    const scale = viewport.finalScale || 1;
    return {
      x: (point.x - viewport.offsetX) / scale,
      y: (point.y - viewport.offsetY) / scale
    };
  }

  function worldToScreen(point, viewport) {
    const scale = viewport.finalScale || 1;
    return {
      x: point.x * scale + viewport.offsetX,
      y: point.y * scale + viewport.offsetY
    };
  }

  function applyDesignTransform(ctx, viewport) {
    ctx.save();
    ctx.translate(viewport.offsetX, viewport.offsetY);
    ctx.scale(viewport.finalScale, viewport.finalScale);
  }

  function restoreDesignTransform(ctx) {
    ctx.restore();
  }

  function fillLetterbox(ctx, viewport, color) {
    ctx.fillStyle = color || "#080d12";
    ctx.fillRect(0, 0, viewport.width, viewport.height);
  }

  function drawViewportDebug(ctx, viewport, fontStack) {
    const lines = [
      `view: ${viewport.width}×${viewport.height}`,
      `dpr: ${viewport.dpr}`,
      `scale: ${viewport.scale.toFixed(4)}`,
      `uiScale: ${viewport.uiScale}`,
      `finalScale: ${viewport.finalScale.toFixed(4)}`,
      `offset: ${viewport.offsetX.toFixed(1)}, ${viewport.offsetY.toFixed(1)}`,
      `design: ${viewport.designWidth}×${viewport.designHeight}`
    ];
    const pad = 8;
    const lineH = 16;
    const boxH = lines.length * lineH + pad * 2;
    const boxW = 248;
    ctx.save();
    ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
    ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
    ctx.fillRect(pad, pad, boxW, boxH);
    ctx.fillStyle = "#9fd4ff";
    ctx.font = `12px ${fontStack || "monospace"}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    lines.forEach((line, i) => {
      ctx.fillText(line, pad + 6, pad + 6 + i * lineH);
    });
    ctx.restore();
  }

  function bindCanvasResize(canvas, ctx, viewport, onResize, options = {}) {
    let pending = false;
    let retryFrames = 0;
    let settleTimer = null;
    const MAX_ZERO_SIZE_RETRIES = 120;

    const run = () => {
      pending = false;
      const ok = resizeCanvasToDisplay(canvas, ctx, viewport, options);
      if (!ok) {
        if (retryFrames < MAX_ZERO_SIZE_RETRIES) {
          retryFrames += 1;
          requestAnimationFrame(run);
        }
        return;
      }
      retryFrames = 0;
      if (typeof onResize === "function") {
        onResize();
      }
    };

    const schedule = () => {
      if (pending) {
        return;
      }
      pending = true;
      requestAnimationFrame(run);
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      settleTimer = setTimeout(run, 120);
    };

    window.addEventListener("resize", schedule);
    if (global.visualViewport) {
      global.visualViewport.addEventListener("resize", schedule);
    }

    let resizeObserver = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(schedule);
      if (canvas.parentElement) {
        resizeObserver.observe(canvas.parentElement);
      }
      resizeObserver.observe(canvas);
    }

    let intersectionObserver = null;
    if (typeof IntersectionObserver !== "undefined") {
      intersectionObserver = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            schedule();
          }
        },
        { threshold: 0 }
      );
      intersectionObserver.observe(canvas);
    }

    run();

    return function teardownCanvasResize() {
      window.removeEventListener("resize", schedule);
      if (global.visualViewport) {
        global.visualViewport.removeEventListener("resize", schedule);
      }
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
    };
  }

  function forceResize(canvas, ctx, viewport, onResize, options) {
    const ok = resizeCanvasToDisplay(canvas, ctx, viewport, options);
    if (ok && typeof onResize === "function") {
      onResize();
    }
    return ok;
  }

  global.StoryCanvasViewport = {
    DEFAULT_DESIGN_WIDTH,
    DEFAULT_DESIGN_HEIGHT,
    createViewportState,
    updateViewportLayout,
    readCanvasDisplaySize,
    resizeCanvasToDisplay,
    getCanvasPoint,
    screenToWorld,
    worldToScreen,
    applyDesignTransform,
    restoreDesignTransform,
    fillLetterbox,
    drawViewportDebug,
    bindCanvasResize,
    forceResize,
    getResponsiveUiScale
  };
})(typeof window !== "undefined" ? window : globalThis);
