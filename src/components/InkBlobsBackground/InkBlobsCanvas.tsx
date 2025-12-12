import { useEffect, useRef } from 'react';

type Blob = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  wobblePhase: number;
  wobbleSpeed: number;
  color: { r: number; g: number; b: number };
  deformX: number;
  deformY: number;
  lastMouseHit?: number;
  wasMouseHit?: boolean;
  mouseOverActive: boolean;
};

function InkBlobsCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const freezeRef = useRef<boolean>(false);
  const targetsRef = useRef<Array<{ x: number; y: number }>>([]);
  const freezeTimerRef = useRef<number | null>(null);
  const freezeReleaseTimerRef = useRef<number | null>(null);
  const worldToggleRef = useRef(false);
  const wordPhaseStartRef = useRef<number>(0);
  // Prevent user interaction for 5s after "HELLO" appears
  const helloFreezeUntil = useRef(0);
  const lastInteractionRef = useRef<number>(0);
  const inactivityTimerRef = useRef<number | null>(null);
  const prevMouseRef = useRef<{ x: number; y: number } | null>(null);
  // move timer replaced by absolute end time checked in animation loop
  const movePhaseEndTimeRef = useRef<number>(0);
  const allowInteractionRef = useRef(false);

  const didInit = useRef(false);
  useEffect(() => {
    // initialize timing refs inside effect to avoid impure calls during render
    lastInteractionRef.current = performance.now();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = canvas.clientWidth;
    let height = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect();
      width = rect?.width || canvas.clientWidth || window.innerWidth;
      height = rect?.height || canvas.clientHeight || window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
    };
    resize();

    const rand = (min: number, max: number) =>
      Math.random() * (max - min) + min;

    // compute targets initially for both words and pick the larger count
    const helloTargets = computeHelloTargets(width, height);
    const worldTargets = computeWorldTargets(width, height);
    targetsRef.current = helloTargets;
    const initialCount = Math.max(helloTargets.length, worldTargets.length, 22);
    const freeR = Math.max(18, Math.min(width, height) * 0.025); // slightly smaller

    const START_SPEED = 0.14; // uniform starting speed for all blobs
    const blobs: Blob[] = Array.from({ length: initialCount }).map(() => {
      const angle = rand(0, Math.PI * 2);
      const speed = START_SPEED;
      return {
        x: rand(0.18 * width, 0.82 * width),
        y: rand(0.18 * height, 0.82 * height),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: freeR,
        wobblePhase: rand(0, Math.PI * 2),
        wobbleSpeed: rand(0.3, 0.6),
        color: {
          r: Math.floor(rand(80, 255)),
          g: Math.floor(rand(80, 255)),
          b: Math.floor(rand(80, 255)),
        },
        deformX: 0,
        deformY: 0,
        wasMouseHit: false,
        mouseOverActive: false,
      };
    });
    // Clamp initial speeds so no blob starts too fast (safety)
    const START_MAX_SPEED = 0.5;
    for (const b of blobs) {
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > START_MAX_SPEED) {
        const k = START_MAX_SPEED / sp;
        b.vx *= k;
        b.vy *= k;
      }
    }
    // physics params
    const gravity = 0.0;
    const friction = 0.0015;
    const MAX_SPEED = 1.6; // limit top speed to reduce tunneling
    const MIN_SPEED = 0.12;
    const NOISE_ACC = 0.00025;

    // mouse
    let mouseX: number | null = null;
    let mouseY: number | null = null;
    let mouseDown = false;
    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      mouseX = x;
      mouseY = y;
      const prev = prevMouseRef.current;
      const MOVEMENT_THRESHOLD = 6; // pixels
      let significant = false;
      if (!prev) significant = true;
      else if (Math.hypot(x - prev.x, y - prev.y) > MOVEMENT_THRESHOLD)
        significant = true;
      prevMouseRef.current = { x, y };
      if (!significant) return;
      lastInteractionRef.current = performance.now();
      // user interacted: record interaction. Do NOT break word phase here;
      // break is handled when hovering a blob after the hello lock expires.
    };
    const onMouseLeave = () => {
      prevMouseRef.current = null;
      mouseX = null;
      mouseY = null;
      lastInteractionRef.current = performance.now();
      // do not break word phase on leave; only blob collisions should break it
    };
    const onMouseDown = () => {
      mouseDown = true;
      // Allow a simple click anywhere on the canvas to break word phase when allowed
      if (phase === 'word' && allowInteractionRef.current) {
        freezeRef.current = false;
        tryBreakWordPhase();
      }
    };
    const onMouseUp = () => {
      mouseDown = false;
    };
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);

    // deterministic loop: initial move 7s, then Hello 10s (5s lock), then alternate 4s move/10s word
    const MOVING_MS_INITIAL = 7000;
    const MOVING_MS = 4000;
    const HELLO_ALLOW_INTERACTION_MS = 5000;
    let isInitial = true;
    let isFirstWord = true;
    let phase: 'moving' | 'word' = 'moving';

    const DEBUG = true;
    function logDebug(...args: any[]) {
      if (DEBUG) console.log('[InkBlobs]', ...args);
    }

    function setMovePhase() {
      logDebug('setMovePhase: enter');
      phase = 'moving';
      freezeRef.current = false;
      targetsRef.current = [];
      const duration = isInitial ? MOVING_MS_INITIAL : MOVING_MS;
      movePhaseEndTimeRef.current = performance.now() + duration;
      // clear any hello lock markers so cursor checks work during move
      helloFreezeUntil.current = 0;
      allowInteractionRef.current = true;
      isInitial = false;
      logDebug('setMovePhase: exit', {
        movePhaseEndTime: movePhaseEndTimeRef.current,
      });
    }
    function setWordPhase() {
      logDebug('setWordPhase: enter');
      const now = performance.now();
      console.log(
        '[InkBlobs] setWordPhase called, time:',
        now,
        'targets:',
        targetsRef.current.length
      );
      // If there are no targets, don't enter word phase
      if (!targetsRef.current || targetsRef.current.length === 0) {
        logDebug('setWordPhase: no targets - skipping');
        return;
      }
      phase = 'word';
      // record start time for word phase
      wordPhaseStartRef.current = performance.now();
      // clear any move phase end time so word phase persists until user interaction
      movePhaseEndTimeRef.current = 0;
      // First word phase should always be HELLO
      if (isFirstWord) {
        targetsRef.current = computeHelloTargets(width, height);
        worldToggleRef.current = true; // next will be WORLD
        isFirstWord = false;
      } else if (worldToggleRef.current) {
        targetsRef.current = computeWorldTargets(width, height);
        worldToggleRef.current = false;
      } else {
        targetsRef.current = computeHelloTargets(width, height);
        worldToggleRef.current = true;
      }

      freezeRef.current = true;
      allowInteractionRef.current = false;
      // Clear any existing timers
      if (freezeReleaseTimerRef.current) {
        clearTimeout(freezeReleaseTimerRef.current);
        freezeReleaseTimerRef.current = null;
      }
      if (freezeTimerRef.current) {
        clearTimeout(freezeTimerRef.current);
        freezeTimerRef.current = null;
      }
      // Set velocities to zero for all blobs
      // Do NOT zero velocities here; keep physics active during word phase
      // for (const bb of blobs) {
      //   bb.vx = 0;
      //   bb.vy = 0;
      // }
      // Timer to allow interaction after HELLO_ALLOW_INTERACTION_MS
      freezeReleaseTimerRef.current = window.setTimeout(() => {
        allowInteractionRef.current = true;
        // If fallback timer is still running, clear it
        if (freezeTimerRef.current) {
          clearTimeout(freezeTimerRef.current);
          freezeTimerRef.current = null;
        }
      }, HELLO_ALLOW_INTERACTION_MS) as unknown as number;
      helloFreezeUntil.current = performance.now() + HELLO_ALLOW_INTERACTION_MS;
      // No automatic fallback timer; word phase will persist until user interaction or strong collision
      logDebug('setWordPhase: exit', {
        helloFreezeUntil: helloFreezeUntil.current,
      });
    }

    // Guard against double-init (e.g. React Strict Mode)
    if (!didInit.current) {
      didInit.current = true;
      worldToggleRef.current = false;
      targetsRef.current = [];
      setMovePhase();
    }

    // Helper for breaking word phase after lockout
    function tryBreakWordPhase() {
      logDebug('tryBreakWordPhase: enter', {
        phase,
        allowInteraction: allowInteractionRef.current,
      });
      if (phase === 'word' && allowInteractionRef.current) {
        // Clear both timers to avoid overlap
        if (freezeReleaseTimerRef.current) {
          clearTimeout(freezeReleaseTimerRef.current);
          freezeReleaseTimerRef.current = null;
        }
        if (freezeTimerRef.current) {
          clearTimeout(freezeTimerRef.current);
          freezeTimerRef.current = null;
        }
        logDebug('tryBreakWordPhase: calling setMovePhase');
        setMovePhase();
      }
    }

    const collide = (a: Blob, b: Blob) => {
      // when frozen into the dot-matrix, skip collision responses to avoid jitter
      if (freezeRef.current) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.0001;
      const minDist = a.r + b.r;
      const contactMargin = minDist * 0.005;
      if (dist > minDist + contactMargin) return;
      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = Math.max(0, minDist - dist);
      // Separate blobs fully to prevent tunneling
      const sep = overlap;
      a.x -= nx * sep * 0.51;
      a.y -= ny * sep * 0.51;
      b.x += nx * sep * 0.51;
      b.y += ny * sep * 0.51;

      // Debug: collision entry
      // Throttle collision logs to avoid spamming the console
      if ((window as any).console && (window as any).console.log) {
        if (overlap > 15 || Math.random() < 0.02) {
          console.log('[InkBlobs] collide', {
            ax: a.x,
            ay: a.y,
            bx: b.x,
            by: b.y,
            overlap,
          });
        }
      }

      // Impulse-based collision resolution (equal mass)
      // Relative velocity along normal
      const relVel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      // If velocities are separating, no impulse needed
      if (relVel < 0) {
        const restitution = 0.9; // bounciness
        // impulse scalar for equal masses: j = -(1+e)*relVel / (1/m + 1/m) = -(1+e)*relVel/2
        const j = (-(1 + restitution) * relVel) / 2;
        const jx = j * nx;
        const jy = j * ny;
        a.vx -= jx;
        a.vy -= jy;
        b.vx += jx;
        b.vy += jy;
      }

      // Always propagate mouse-hit state when collision occurs
      if (a.wasMouseHit || b.wasMouseHit) {
        a.wasMouseHit = true;
        b.wasMouseHit = true;
      }

      // Positional correction to avoid sinking (Baumgarte)
      const percent = 0.8; // usually 20% to 80%
      const slop = 0.01; // usually small
      const correction = Math.max(overlap - slop, 0) / 2;
      if (correction > 0) {
        const cx = correction * percent * nx;
        const cy = correction * percent * ny;
        a.x -= cx;
        a.y -= cy;
        b.x += cx;
        b.y += cy;
      }

      // Deform both blobs based on penetration
      const relApproach = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (relApproach < 0) {
        const deformAmt = Math.min(
          0.16,
          (minDist - dist + contactMargin) / ((a.r + b.r) * 0.6)
        );
        a.deformX -= nx * deformAmt;
        a.deformY -= ny * deformAmt;
        b.deformX += nx * deformAmt;
        b.deformY += ny * deformAmt;
        // If collision is strong while in word phase, allow interaction and attempt to break word phase
        const STRONG_COLLISION_THRESHOLD = Math.max(0.5, (a.r + b.r) * 0.01);
        const collisionStrength = Math.abs(relApproach) + overlap * 0.01;
        if (
          phase === 'word' &&
          collisionStrength > STRONG_COLLISION_THRESHOLD
        ) {
          allowInteractionRef.current = true;
          tryBreakWordPhase();
        }
      }
    };

    // deterministic loop started below

    // no inactivity watcher: user interaction controls phase toggling

    const step = (dt: number) => {
      // Cap dt to avoid large jumps (max 40ms per frame)
      dt = Math.min(dt, 40);
      for (const b of blobs) {
        // Disable cursor effect for 2s after dot-matrix starts
        const now = performance.now();
        // Failsafe: if release timers exist, clear them when lock time passes.
        // Do NOT automatically unfreeze here — the word phase must persist until
        // explicit user interaction after the hello lock.
        if (freezeRef.current && now > helloFreezeUntil.current) {
          if (freezeReleaseTimerRef.current) {
            clearTimeout(freezeReleaseTimerRef.current);
            freezeReleaseTimerRef.current = null;
          }
          if (freezeTimerRef.current) {
            clearTimeout(freezeTimerRef.current);
            freezeTimerRef.current = null;
          }
        }
        const cursorActive = !freezeRef.current || allowInteractionRef.current;
        if (phase === 'word' && targetsRef.current.length) {
          // Only move blobs to targets in word phase
          const idx = blobs.indexOf(b);
          let t;
          if (targetsRef.current.length === 0) {
            return;
          }
          if (blobs.length <= targetsRef.current.length) {
            t =
              targetsRef.current[Math.min(idx, targetsRef.current.length - 1)];
          } else {
            const denom = Math.max(1, blobs.length - 1);
            const factor = idx / denom;
            const ti = Math.floor(factor * (targetsRef.current.length - 1));
            t = targetsRef.current[ti];
          }
          const k = 0.09;
          const dx = t.x - b.x;
          const dy = t.y - b.y;
          const distT = Math.hypot(dx, dy);
          const ease =
            1 -
            Math.pow(
              2,
              -6 *
                Math.min(distT / Math.max(1, Math.min(width, height) * 0.03), 1)
            );
          const effEase = Math.max(ease, 0.35);
          b.deformX = 0;
          b.deformY = 0;
          b.x += dx * k * effEase;
          b.y += dy * k * effEase;
          b.r = Math.max(16, Math.min(width, height) * 0.02);
          continue;
        }
        // Normal physics for moving phase
        b.wobblePhase += b.wobbleSpeed * dt * 0.001;
        const wobble = Math.sin(b.wobblePhase) * (b.r * 0.06);
        b.vx *= Math.max(0.0, 1 - friction * dt);
        b.vy *= Math.max(0.0, 1 - friction * dt);
        b.vx += (Math.random() - 0.5) * NOISE_ACC * dt;
        b.vy += (Math.random() - 0.5) * NOISE_ACC * dt;
        b.vy += gravity * dt * b.r * 0.02;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > MAX_SPEED) {
          const k = MAX_SPEED / sp;
          b.vx *= k;
          b.vy *= k;
        }
        if (sp < MIN_SPEED) {
          if (sp === 0) {
            const angle = Math.random() * Math.PI * 2;
            b.vx = Math.cos(angle) * MIN_SPEED;
            b.vy = Math.sin(angle) * MIN_SPEED;
          } else {
            const k = MIN_SPEED / sp;
            b.vx *= k;
            b.vy *= k;
          }
        }
        const deformDecay = Math.max(0.0, 1 - 0.02 * dt);
        b.deformX = Math.max(-0.25, Math.min(0.25, b.deformX * deformDecay));
        b.deformY = Math.max(-0.25, Math.min(0.25, b.deformY * deformDecay));
        const effR = b.r + wobble;
        if (b.x < effR) {
          b.x = effR;
          b.vx *= -1;
          b.vy += (Math.random() - 0.5) * 0.12;
        }
        if (b.x > width - effR) {
          b.x = width - effR;
          b.vx *= -1;
          b.vy += (Math.random() - 0.5) * 0.12;
        }
        if (b.y < effR) {
          b.y = effR;
          b.vy *= -1;
        }
        if (b.y > height - effR) {
          b.y = height - effR;
          b.vy *= -1;
        }
        if (cursorActive && mouseX !== null && mouseY !== null) {
          const dxm = mouseX - b.x;
          const dym = mouseY - b.y;
          const distm = Math.hypot(dxm, dym);
          const wobble2 = Math.sin(b.wobblePhase) * (b.r * 0.08);
          const radius = b.r + wobble2;
          if (distm > 0 && distm < radius) {
            if (!b.mouseOverActive) {
              b.mouseOverActive = true;
              const nxm = dxm / distm;
              const nym = dym / distm;
              const nowHit = performance.now();
              b.lastMouseHit = nowHit;
              b.wasMouseHit = true;
              lastInteractionRef.current = nowHit;
              if (freezeRef.current) {
                const nowLock = performance.now();
                const lockExpired =
                  wordPhaseStartRef.current &&
                  nowLock >=
                    wordPhaseStartRef.current + HELLO_ALLOW_INTERACTION_MS;
                if (mouseDown || lockExpired) {
                  // Unfreeze only after lock expired or on mouseDown
                  allowInteractionRef.current = true;
                  freezeRef.current = false;
                  tryBreakWordPhase();
                  b.r = Math.max(16, Math.min(width, height) * 0.02);
                }
              }
              const vdot = b.vx * nxm + b.vy * nym;
              const restitution = 3.0; // stronger bounce
              b.vx -= restitution * vdot * nxm;
              b.vy -= restitution * vdot * nym;
              const penetration = radius - distm;
              const impulse = Math.min(1.4, penetration * 0.08); // larger impulse
              b.vx -= nxm * impulse;
              b.vy -= nym * impulse;
              const accelPulse = Math.min(
                1.6,
                (penetration / Math.max(1, radius)) * (b.r * 0.004)
              );
              b.vx -= nxm * accelPulse;
              b.vy -= nym * accelPulse;
              // Limit velocity after mouse hit to keep blob in system
              const maxAfterMouse = 1.5;
              const sp = Math.hypot(b.vx, b.vy);
              if (sp > maxAfterMouse) {
                const k = maxAfterMouse / sp;
                b.vx *= k;
                b.vy *= k;
              }
            }
          } else {
            b.mouseOverActive = false;
          }
        }
      }
    };
    // Handle collisions between blobs
    // Run collision loop multiple times per frame for more robust interaction
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < blobs.length; i++) {
        for (let j = i + 1; j < blobs.length; j++) {
          collide(blobs[i], blobs[j]);
        }
      }
    }

    const drawBlob = (b: Blob) => {
      const baseR = b.r;
      const wobble = Math.sin(b.wobblePhase) * (b.r * 0.06);
      const r = baseR + wobble;
      const rx = r * (1 + b.deformX);
      const ry = r * (1 - b.deformX * 0.6 + b.deformY * 0.4);
      ctx.save();
      const { r: cr, g: cg, b: cb } = b.color;
      const widthBox = Math.max(16, rx * 2);
      const heightBox = Math.max(16, ry * 2);
      const x0 = b.x - widthBox / 2;
      const y0 = b.y - heightBox / 2;
      const radius = Math.min(widthBox, heightBox) * 0.18;
      ctx.beginPath();
      ctx.moveTo(x0 + radius, y0);
      ctx.lineTo(x0 + widthBox - radius, y0);
      ctx.arcTo(x0 + widthBox, y0, x0 + widthBox, y0 + radius, radius);
      ctx.lineTo(x0 + widthBox, y0 + heightBox - radius);
      ctx.arcTo(
        x0 + widthBox,
        y0 + heightBox,
        x0 + widthBox - radius,
        y0 + heightBox,
        radius
      );
      ctx.lineTo(x0 + radius, y0 + heightBox);
      ctx.arcTo(x0, y0 + heightBox, x0, y0 + heightBox - radius, radius);
      ctx.lineTo(x0, y0 + radius);
      ctx.arcTo(x0, y0, x0 + radius, y0, radius);
      ctx.closePath();
      ctx.globalAlpha = 1.0;
      const grad = ctx.createRadialGradient(
        b.x,
        b.y,
        Math.min(widthBox, heightBox) * 0.12,
        b.x,
        b.y,
        Math.max(widthBox, heightBox) * 0.6
      );
      grad.addColorStop(0.0, `rgba(${cr},${cg},${cb},0.95)`);
      grad.addColorStop(0.25, `rgba(${cr},${cg},${cb},0.65)`);
      grad.addColorStop(0.7, `rgba(${cr},${cg},${cb},0.26)`);
      grad.addColorStop(1.0, `rgba(${cr},${cg},${cb},0.05)`);
      ctx.fillStyle = grad;
      ctx.globalCompositeOperation = 'source-over';
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.55)`;
      ctx.stroke();
      ctx.restore();
    };

    let last = performance.now();
    let accumulator = 0;
    const FIXED_DT = 12;
    const MAX_FRAME_DT = 64;
    const loop = () => {
      const now = performance.now();
      // Defensive auto-unfreeze: if we're stuck in word phase too long, force move phase
      // No auto-unfreeze here; let collisions or explicit user interaction end the word phase.
      // check move->word by absolute end time
      if (
        phase === 'moving' &&
        movePhaseEndTimeRef.current &&
        now >= movePhaseEndTimeRef.current
      ) {
        setWordPhase();
      }
      if (!('loopLog' in loop)) (loop as any).loopLog = 0;
      if (now - (loop as any).loopLog > 1000) {
        (loop as any).loopLog = now;
      }
      let frameDt = now - last;
      last = now;
      frameDt = Math.min(MAX_FRAME_DT, Math.max(0, frameDt));
      accumulator += frameDt;
      while (accumulator >= FIXED_DT) {
        step(FIXED_DT);
        accumulator -= FIXED_DT;
      }
      ctx.clearRect(0, 0, width, height);

      for (const b of blobs) drawBlob(b);
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    window.addEventListener('resize', resize);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      if (freezeTimerRef.current) clearTimeout(freezeTimerRef.current);
      if (freezeReleaseTimerRef.current)
        clearTimeout(freezeReleaseTimerRef.current);
      // no move timer cleanup needed
      if (inactivityTimerRef.current) clearInterval(inactivityTimerRef.current);
    };
  }, []);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'auto',
        filter: 'none',
        backdropFilter: 'none',
      }}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

export default InkBlobsCanvas;

export { computeHelloTargets, computeWorldTargets };

function computeHelloTargets(
  width: number,
  height: number
): Array<{ x: number; y: number }> {
  const letters: number[][][] = [
    // H
    [
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
    ],
    // E
    [
      [1, 1, 1, 1, 1],
      [1, 0, 0, 0, 0],
      [1, 1, 1, 1, 0],
      [1, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
      [1, 1, 1, 1, 1],
    ],
    // L
    [
      [1, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
      [1, 1, 1, 1, 1],
    ],
    // L
    [
      [1, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
      [1, 1, 1, 1, 1],
    ],
    // O
    [
      [0, 1, 1, 1, 0],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [0, 1, 1, 1, 0],
    ],
  ];

  const dotSize = Math.min(width, height) * 0.013; // preferred small size
  const spacing = dotSize * 3.4; // wider horizontal spacing for HELLO
  const spacingY = dotSize * 4.0; // taller vertical spacing for HELLO
  const letterSpacing = dotSize * 4.6; // reduced space between HELLO letters
  // Center more vertically
  const totalRows = letters[0].length;
  const totalColsPerLetter = letters[0][0].length;
  const totalCols =
    letters.length * totalColsPerLetter +
    (letters.length - 1) * Math.round(letterSpacing / spacing);
  const startX = (width - totalCols * spacing) * 0.5;
  const startY = (height - totalRows * spacingY) * 0.5;
  const targets: Array<{ x: number; y: number }> = [];
  let colOffset = 0;
  for (let li = 0; li < letters.length; li++) {
    const grid = letters[li];
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        if (grid[r][c] === 1)
          targets.push({
            x: startX + (colOffset + c) * spacing,
            y: startY + r * spacingY,
          });
      }
    }
    colOffset += grid[0].length + Math.round(letterSpacing / spacing);
  }
  return targets;
}

function computeWorldTargets(
  width: number,
  height: number
): Array<{ x: number; y: number }> {
  const letters: number[][][] = [
    // W
    [
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 1, 0, 1],
      [1, 0, 1, 0, 1],
      [1, 0, 1, 0, 1],
      [1, 1, 0, 1, 1],
      [1, 0, 0, 0, 1],
    ],
    // O
    [
      [0, 1, 1, 1, 0],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [0, 1, 1, 1, 0],
    ],
    // R
    [
      [1, 1, 1, 1, 0],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 0],
      [1, 0, 1, 0, 0],
      [1, 0, 0, 1, 0],
      [1, 0, 0, 0, 1],
    ],
    // L
    [
      [1, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
      [1, 0, 0, 0, 0],
      [1, 1, 1, 1, 1],
    ],
    // D
    [
      [1, 1, 1, 1, 0],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 0, 0, 0, 1],
      [1, 1, 1, 1, 0],
    ],
  ];

  const dotSize = Math.min(width, height) * 0.013;
  const spacing = dotSize * 2.9;
  const spacingY = dotSize * 3.6;
  const letterSpacing = dotSize * 6.2;
  const totalRows = letters[0].length;
  const totalColsPerLetter = letters[0][0].length;
  const totalCols =
    letters.length * totalColsPerLetter +
    (letters.length - 1) * Math.round(letterSpacing / spacing);
  const startX = (width - totalCols * spacing) * 0.5;
  const startY = (height - totalRows * spacingY) * 0.5;
  const targets: Array<{ x: number; y: number }> = [];
  let colOffset = 0;
  for (let li = 0; li < letters.length; li++) {
    const grid = letters[li];
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        if (grid[r][c] === 1)
          targets.push({
            x: startX + (colOffset + c) * spacing,
            y: startY + r * spacingY,
          });
      }
    }
    colOffset += grid[0].length + Math.round(letterSpacing / spacing);
  }
  return targets;
}
