(() => {
  const controls = {
    brightness: {
      value: 100,
      min: 50,
      max: 150,
      step: 5,
      output: document.getElementById("brightness-value"),
      minus: document.getElementById("brightness-minus"),
      plus: document.getElementById("brightness-plus"),
    },
    sharpness: {
      value: 50,
      min: 0,
      max: 100,
      step: 5,
      output: document.getElementById("sharpness-value"),
      minus: document.getElementById("sharpness-minus"),
      plus: document.getElementById("sharpness-plus"),
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
    particles: [],
    lastPointerSpawn: 0,
    pointer: { x: 0, y: 0, active: false },
    lastScrollY: window.scrollY,
    lastScrollSpawn: 0,
    rafId: 0,
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function isCoarsePointer() {
    return coarsePointerMedia.matches;
  }

  function getMaxParticles() {
    return isCoarsePointer() ? 110 : 230;
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
    control.output.textContent = `${control.value}%`;
    control.minus.disabled = control.value <= control.min;
    control.plus.disabled = control.value >= control.max;
  }

  function setControl(name, nextValue) {
    const control = controls[name];
    const clamped = clamp(nextValue, control.min, control.max);
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
      control.minus.addEventListener("click", () => {
        setControl(name, control.value - control.step);
      });

      control.plus.addEventListener("click", () => {
        setControl(name, control.value + control.step);
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

  function spawnParticles(x, y, count, velocityScale) {
    if (reducedMotion || !canvasSupported) {
      return;
    }

    const cap = getMaxParticles();

    for (let i = 0; i < count; i += 1) {
      if (state.particles.length >= cap) {
        state.particles.shift();
      }

      const angle = Math.random() * Math.PI * 2;
      const speed = (0.045 + Math.random() * 0.16) * velocityScale;
      state.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        spin: (Math.random() - 0.5) * 0.01,
        size: (1.6 + Math.random() * 4.8) * (isCoarsePointer() ? 0.9 : 1.1),
        age: 0,
        ttl: 650 + Math.random() * 1100,
        hue: (state.time * 0.02 + Math.random() * 360) % 360,
      });
    }
  }

  function drawEffects(deltaMs) {
    if (!canvasSupported) {
      return;
    }

    fxCtx.clearRect(0, 0, state.width, state.height);

    if (!state.particles.length) {
      return;
    }

    const sharpness = controls.sharpness.value;

    fxCtx.globalCompositeOperation = "lighter";

    for (let i = state.particles.length - 1; i >= 0; i -= 1) {
      const p = state.particles[i];
      p.age += deltaMs;

      if (p.age >= p.ttl) {
        state.particles.splice(i, 1);
        continue;
      }

      const life = p.age / p.ttl;
      const fade = 1 - life;
      const rot = p.spin * deltaMs;
      const rx = p.vx * Math.cos(rot) - p.vy * Math.sin(rot);
      const ry = p.vx * Math.sin(rot) + p.vy * Math.cos(rot);
      p.vx = rx * 0.995;
      p.vy = ry * 0.995;
      p.x += p.vx * deltaMs;
      p.y += p.vy * deltaMs;

      const radius = Math.max(0.8, p.size * (0.6 + sharpness / 120) * fade * 2.2);
      const alpha = 0.42 * fade;
      const grad = fxCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      grad.addColorStop(0, `hsla(${p.hue}, 100%, 72%, ${alpha})`);
      grad.addColorStop(1, `hsla(${(p.hue + 80) % 360}, 100%, 58%, 0)`);

      fxCtx.fillStyle = grad;
      fxCtx.beginPath();
      fxCtx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      fxCtx.fill();
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
    const interval = isCoarsePointer() ? 40 : 20;
    if (now - state.lastPointerSpawn >= interval) {
      state.lastPointerSpawn = now;
      spawnParticles(x, y, isCoarsePointer() ? 2 : 3, 1);
    }
  }

  function handlePointerBurst(x, y) {
    if (reducedMotion) {
      return;
    }
    spawnParticles(x, y, isCoarsePointer() ? 12 : 18, isCoarsePointer() ? 1.2 : 1.5);
  }

  function handleScroll() {
    if (reducedMotion) {
      return;
    }

    const now = performance.now();
    if (now - state.lastScrollSpawn < 80) {
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
    spawnParticles(x, y, isCoarsePointer() ? 4 : 7, 1 + Math.min(delta / 40, 1.3));
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
        state.particles.length = 0;
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
      state.particles.length = Math.min(state.particles.length, getMaxParticles());
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
