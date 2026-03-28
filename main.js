(() => {
  const controls = {
    brightness: {
      value: 100,
      min: 50,
      max: 150,
      step: 5,
      output: document.getElementById("brightness-value"),
      slider: document.getElementById("brightness-slider"),
    },
    sharpness: {
      value: 50,
      min: 0,
      max: 100,
      step: 5,
      output: document.getElementById("sharpness-value"),
      slider: document.getElementById("sharpness-slider"),
    },
  };

  const bgCanvas = document.getElementById("bg-canvas");
  const fxCanvas = document.getElementById("fx-canvas");
  const fallbackGradient = document.getElementById("fallback-gradient");
  const motionNote = document.getElementById("motion-note");

  const reducedMotionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
  const coarsePointerMedia = window.matchMedia("(pointer: coarse)");

  let reducedMotion = reducedMotionMedia.matches;
  motionNote.hidden = !reducedMotion;

  const bgCtx = bgCanvas?.getContext?.("2d", { alpha: false });
  const fxCtx = fxCanvas?.getContext?.("2d", { alpha: true });

  const canvasSupported = Boolean(bgCtx && fxCtx);
  if (canvasSupported) {
    document.documentElement.classList.add("canvas-ready");
  } else {
    document.documentElement.classList.add("no-canvas");
  }

  const state = {
    width: 0,
    height: 0,
    dpr: 1,
    time: 0,
    lastFrame: 0,
    ripples: [],
    lastPointerSpawn: 0,
    pointer: { x: 0, y: 0, active: false },
    lastScrollY: window.scrollY,
    lastScrollSpawn: 0,
    rafId: 0,
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function snapToStep(value, min, step) {
    return min + Math.round((value - min) / step) * step;
  }

  function isCoarsePointer() {
    return coarsePointerMedia.matches;
  }

  function getMaxRipples() {
    return isCoarsePointer() ? 32 : 64;
  }

  function getDprCap() {
    return isCoarsePointer() ? 1.5 : 2;
  }

  function applyFilters() {
    const brightness = controls.brightness.value;
    const sharpness = controls.sharpness.value;
    const blurPx = ((100 - sharpness) / 100) * 1.8;
    const contrast = 90 + sharpness * 0.95;
    const saturate = 110 + sharpness * 0.6;
    const filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturate}%) blur(${blurPx.toFixed(2)}px)`;

    if (canvasSupported) {
      bgCanvas.style.filter = filter;
      fallbackGradient.style.filter = filter;
    } else {
      fallbackGradient.style.filter = filter;
    }
  }

  function updateControlUI(name) {
    const control = controls[name];
    control.slider.value = String(control.value);
    control.output.textContent = `${control.value}%`;
  }

  function setControl(name, nextValue) {
    const control = controls[name];
    const snapped = snapToStep(nextValue, control.min, control.step);
    const clamped = clamp(snapped, control.min, control.max);
    if (clamped === control.value) {
      return;
    }
    control.value = clamped;
    updateControlUI(name);
    applyFilters();

    if (reducedMotion && canvasSupported) {
      drawBackground(state.time);
    }
  }

  function initControls() {
    Object.entries(controls).forEach(([name, control]) => {
      control.slider.addEventListener("input", (event) => {
        setControl(name, Number(event.currentTarget.value));
      });

      updateControlUI(name);
    });

    applyFilters();
  }

  function resizeCanvas() {
    if (!canvasSupported) {
      return;
    }

    state.width = Math.max(1, Math.floor(window.innerWidth));
    state.height = Math.max(1, Math.floor(window.innerHeight));
    state.dpr = Math.min(window.devicePixelRatio || 1, getDprCap());

    [bgCanvas, fxCanvas].forEach((canvas) => {
      canvas.width = Math.floor(state.width * state.dpr);
      canvas.height = Math.floor(state.height * state.dpr);
      canvas.style.width = `${state.width}px`;
      canvas.style.height = `${state.height}px`;
    });

    bgCtx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    fxCtx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

    drawBackground(state.time);
    drawEffects(0);
  }

  function drawBackground(timeMs) {
    const w = state.width;
    const h = state.height;
    if (!w || !h) {
      return;
    }

    bgCtx.clearRect(0, 0, w, h);

    const hueOffset = (timeMs * 0.018) % 360;
    const primary = bgCtx.createLinearGradient(0, 0, w, h);
    for (let i = 0; i <= 7; i += 1) {
      const t = i / 7;
      const hue = (hueOffset + i * 52) % 360;
      primary.addColorStop(t, `hsl(${hue} 95% 55%)`);
    }
    bgCtx.fillStyle = primary;
    bgCtx.fillRect(0, 0, w, h);

    const cx = w * (0.5 + Math.sin(timeMs * 0.00015) * 0.11);
    const cy = h * (0.5 + Math.cos(timeMs * 0.00012) * 0.11);
    const ringScale = 0.55 + controls.sharpness.value / 140;

    for (let i = 0; i < 4; i += 1) {
      const pulse = 0.5 + 0.5 * Math.sin(timeMs * 0.001 + i * 1.7);
      const radius = Math.max(w, h) * (0.22 + i * 0.1) * ringScale;
      const grad = bgCtx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius);
      grad.addColorStop(0, `hsla(${(hueOffset + i * 70) % 360}, 100%, 64%, ${0.2 + pulse * 0.12})`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      bgCtx.globalCompositeOperation = "screen";
      bgCtx.fillStyle = grad;
      bgCtx.fillRect(0, 0, w, h);
    }

    bgCtx.globalCompositeOperation = "source-over";
  }

  function spawnRipple(x, y, options = {}) {
    if (reducedMotion || !canvasSupported) {
      return;
    }

    const cap = getMaxRipples();
    if (state.ripples.length >= cap) {
      state.ripples.shift();
    }

    const coarse = isCoarsePointer();
    const baseRadius = options.baseRadius ?? (coarse ? 12 : 10);
    const ttl = options.ttl ?? (coarse ? 900 : 980);
    const speed = options.speed ?? (coarse ? 0.095 : 0.105);

    state.ripples.push({
      x,
      y,
      age: 0,
      ttl: ttl + Math.random() * 260,
      baseRadius: baseRadius + Math.random() * 7,
      speed: speed + Math.random() * 0.03,
      lineWidth: (coarse ? 1.5 : 1.3) + Math.random() * 1.2,
      jitter: 0.8 + Math.random() * 1.7,
      wobbleFreq: 0.004 + Math.random() * 0.0035,
      phase: Math.random() * Math.PI * 2,
      hue: (state.time * 0.02 + Math.random() * 45) % 360,
      driftX: (Math.random() - 0.5) * 0.012,
      driftY: (Math.random() - 0.5) * 0.012,
    });
  }

  function spawnRippleBurst(x, y, burstSize, spread, intensity) {
    if (reducedMotion) {
      return;
    }

    for (let i = 0; i < burstSize; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * spread;
      spawnRipple(x + Math.cos(angle) * dist, y + Math.sin(angle) * dist, {
        baseRadius: 8 + intensity * 4 + Math.random() * 4,
        ttl: 760 + intensity * 240,
        speed: 0.09 + intensity * 0.03,
      });
    }
  }

  function drawEffects(deltaMs) {
    if (!canvasSupported) {
      return;
    }

    fxCtx.clearRect(0, 0, state.width, state.height);

    if (!state.ripples.length) {
      return;
    }

    const sharpness = controls.sharpness.value;

    fxCtx.globalCompositeOperation = "screen";

    for (let i = state.ripples.length - 1; i >= 0; i -= 1) {
      const ripple = state.ripples[i];
      ripple.age += deltaMs;

      if (ripple.age >= ripple.ttl) {
        state.ripples.splice(i, 1);
        continue;
      }

      const life = ripple.age / ripple.ttl;
      const fade = 1 - life;
      ripple.x += ripple.driftX * deltaMs;
      ripple.y += ripple.driftY * deltaMs;

      const wave = Math.sin(ripple.phase + ripple.age * ripple.wobbleFreq) * ripple.jitter;
      const radius = ripple.baseRadius + ripple.speed * ripple.age + wave;
      const alpha = (0.22 + sharpness / 380) * fade;
      const edgeAlpha = alpha * 0.55;
      const ringWidth = ripple.lineWidth + (1 - life) * 0.8;

      fxCtx.strokeStyle = `hsla(${ripple.hue}, 100%, 94%, ${alpha.toFixed(4)})`;
      fxCtx.lineWidth = ringWidth;
      fxCtx.beginPath();
      fxCtx.ellipse(
        ripple.x,
        ripple.y,
        radius,
        radius * (0.95 + Math.sin(ripple.phase + life * 6) * 0.04),
        Math.sin(ripple.phase + life * 4) * 0.12,
        0,
        Math.PI * 2
      );
      fxCtx.stroke();

      fxCtx.strokeStyle = `hsla(${(ripple.hue + 20) % 360}, 100%, 88%, ${edgeAlpha.toFixed(4)})`;
      fxCtx.lineWidth = Math.max(0.8, ringWidth - 0.6);
      fxCtx.beginPath();
      fxCtx.ellipse(
        ripple.x,
        ripple.y,
        radius * 1.12,
        radius * (1.05 + Math.cos(ripple.phase + life * 7) * 0.03),
        Math.cos(ripple.phase + life * 3) * 0.1,
        0,
        Math.PI * 2
      );
      fxCtx.stroke();
    }

    fxCtx.globalCompositeOperation = "source-over";
  }

  function handlePointerMove(x, y) {
    state.pointer.x = x;
    state.pointer.y = y;
    state.pointer.active = true;

    if (reducedMotion) {
      return;
    }

    const now = performance.now();
    const interval = isCoarsePointer() ? 64 : 34;
    if (now - state.lastPointerSpawn >= interval) {
      state.lastPointerSpawn = now;
      spawnRipple(x, y);
    }
  }

  function handlePointerBurst(x, y) {
    if (reducedMotion) {
      return;
    }

    const coarse = isCoarsePointer();
    spawnRippleBurst(x, y, coarse ? 3 : 5, coarse ? 14 : 20, coarse ? 0.75 : 1);
  }

  function handleScroll() {
    if (reducedMotion) {
      return;
    }

    const now = performance.now();
    if (now - state.lastScrollSpawn < 120) {
      return;
    }

    state.lastScrollSpawn = now;

    const nextScrollY = window.scrollY;
    const delta = Math.abs(nextScrollY - state.lastScrollY);
    state.lastScrollY = nextScrollY;

    if (delta < 1) {
      return;
    }

    const x = state.pointer.active ? state.pointer.x : state.width * 0.5;
    const y = state.pointer.active ? state.pointer.y : state.height * 0.5;
    const intensity = Math.min(delta / 80, 1.2);

    spawnRippleBurst(x, y, isCoarsePointer() ? 2 : 3, 16, intensity);
  }

  function attachInput() {
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", resizeCanvas, { passive: true });

    if (window.PointerEvent) {
      window.addEventListener(
        "pointermove",
        (event) => {
          handlePointerMove(event.clientX, event.clientY);
        },
        { passive: true }
      );

      window.addEventListener(
        "pointerdown",
        (event) => {
          handlePointerBurst(event.clientX, event.clientY);
        },
        { passive: true }
      );
    } else {
      window.addEventListener(
        "mousemove",
        (event) => {
          handlePointerMove(event.clientX, event.clientY);
        },
        { passive: true }
      );

      window.addEventListener(
        "click",
        (event) => {
          handlePointerBurst(event.clientX, event.clientY);
        },
        { passive: true }
      );

      window.addEventListener(
        "touchmove",
        (event) => {
          const touch = event.touches[0];
          if (touch) {
            handlePointerMove(touch.clientX, touch.clientY);
          }
        },
        { passive: true }
      );

      window.addEventListener(
        "touchstart",
        (event) => {
          const touch = event.touches[0];
          if (touch) {
            handlePointerBurst(touch.clientX, touch.clientY);
          }
        },
        { passive: true }
      );
    }

    const onReducedMotionChange = (event) => {
      reducedMotion = event.matches;
      motionNote.hidden = !reducedMotion;
      if (reducedMotion) {
        state.ripples.length = 0;
      }
      if (canvasSupported) {
        drawBackground(state.time);
        drawEffects(0);
        if (!state.rafId) {
          state.rafId = requestAnimationFrame(frame);
        }
      }
    };

    if (typeof reducedMotionMedia.addEventListener === "function") {
      reducedMotionMedia.addEventListener("change", onReducedMotionChange);
    } else if (typeof reducedMotionMedia.addListener === "function") {
      reducedMotionMedia.addListener(onReducedMotionChange);
    }

    const onPointerTypeChange = () => {
      resizeCanvas();
      state.ripples.length = Math.min(state.ripples.length, getMaxRipples());
    };

    if (typeof coarsePointerMedia.addEventListener === "function") {
      coarsePointerMedia.addEventListener("change", onPointerTypeChange);
    } else if (typeof coarsePointerMedia.addListener === "function") {
      coarsePointerMedia.addListener(onPointerTypeChange);
    }
  }

  function frame(timestamp) {
    state.rafId = 0;

    if (!state.lastFrame) {
      state.lastFrame = timestamp;
    }

    const delta = Math.min(34, timestamp - state.lastFrame);
    state.lastFrame = timestamp;

    if (canvasSupported) {
      if (!reducedMotion) {
        state.time += delta;
      }
      drawBackground(state.time);
      drawEffects(delta);
    }

    if (!canvasSupported) {
      return;
    }

    if (reducedMotion) {
      setTimeout(() => {
        if (!state.rafId) {
          state.rafId = requestAnimationFrame(frame);
        }
      }, 400);
      return;
    }

    state.rafId = requestAnimationFrame(frame);
  }

  initControls();
  resizeCanvas();
  attachInput();

  if (canvasSupported) {
    state.rafId = requestAnimationFrame(frame);
  }
})();
