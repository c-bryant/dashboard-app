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
  const wordPhaseCooldownRef = useRef<number>(0);
  const wordPhaseCountRef = useRef<number>(0);
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
      // Process every mousemove event immediately (no movement threshold)
      prevMouseRef.current = { x, y };
      lastInteractionRef.current = performance.now();
      if (DEBUG)
        console.log('[InkBlobs] onMouseMove', {
          x,
          y,
          phase,
          freeze: freezeRef.current,
          allowInteraction: allowInteractionRef.current,
        });
      // quick overlap check: if in word phase and interaction allowed, unfreeze when cursor overlaps a blob
      if (
        phase === 'word' &&
        allowInteractionRef.current &&
        freezeRef.current
      ) {
        for (const bb of blobs) {
          const dx = x - bb.x;
          const dy = y - bb.y;
          const dist = Math.hypot(dx, dy);
          const wobble2 = Math.sin(bb.wobblePhase) * (bb.r * 0.08);
          const radius = bb.r + wobble2;
          if (dist > 0 && dist < radius) {
            if (DEBUG)
              console.log('[InkBlobs] onMouseMove: overlap -> break', {
                blobIdx: blobs.indexOf(bb),
              });
            freezeRef.current = false;
            tryBreakWordPhase();
            // Apply immediate mouse-hit impulse for instant visual response
            const nxm = dx / dist;
            const nym = dy / dist;
            const nowHit = performance.now();
            bb.lastMouseHit = nowHit;
            bb.wasMouseHit = true;
            lastInteractionRef.current = nowHit;
            const vdotm = bb.vx * nxm + bb.vy * nym;
            const restitutionM = 3.2;
            bb.vx -= restitutionM * vdotm * nxm;
            bb.vy -= restitutionM * vdotm * nym;
            const penetrationM = Math.max(0, radius - dist);
            const impulseM = Math.min(2.6, penetrationM * 0.18);
            bb.vx -= nxm * impulseM;
            bb.vy -= nym * impulseM;
            const accelPulseM = Math.min(
              2.4,
              (penetrationM / Math.max(1, radius)) * (bb.r * 0.008)
            );
            bb.vx -= nxm * accelPulseM;
            bb.vy -= nym * accelPulseM;
            const maxAfterMouseM = 3.0;
            const spm = Math.hypot(bb.vx, bb.vy);
            if (spm > maxAfterMouseM) {
              const k = maxAfterMouseM / spm;
              bb.vx *= k;
              bb.vy *= k;
            }
            break;
          }
        }
      }
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
      if (DEBUG)
        console.log('[InkBlobs] onMouseDown', {
          phase,
          freeze: freezeRef.current,
          allowInteraction: allowInteractionRef.current,
        });
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
      // clear any pending release/fallback timers when moving resumes
      if (freezeReleaseTimerRef.current) {
        clearTimeout(freezeReleaseTimerRef.current);
        freezeReleaseTimerRef.current = null;
      }
      if (freezeTimerRef.current) {
        clearTimeout(freezeTimerRef.current);
        freezeTimerRef.current = null;
      }
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
      // short cooldown to prevent rapid re-entry
      const COOLDOWN_MS = 600;
      if (wordPhaseCooldownRef.current && now < wordPhaseCooldownRef.current) {
        logDebug('setWordPhase: in cooldown, skipping', {
          now,
          cooldownUntil: wordPhaseCooldownRef.current,
        });
        return;
      }
      console.log(
        '[InkBlobs] setWordPhase called, time:',
        now,
        'targets:',
        targetsRef.current.length
      );
      // If there are no targets, try safe fallbacks so word phase can still run
      if (!targetsRef.current || targetsRef.current.length === 0) {
        logDebug(
          'setWordPhase: computed zero targets — using fallback targets'
        );
        // Prefer precomputed hello/world targets if present
        if (helloTargets && helloTargets.length) {
          targetsRef.current = helloTargets;
        } else if (worldTargets && worldTargets.length) {
          targetsRef.current = worldTargets;
        } else {
          // Generate a simple grid of fallback targets
          const fallback: Array<{ x: number; y: number }> = [];
          const cols = Math.max(6, Math.floor(width / 60));
          const rows = Math.max(3, Math.floor(height / 60));
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const x = (c + 0.5) * (width / cols);
              const y = (r + 0.5) * (height / rows);
              fallback.push({ x, y });
            }
          }
          targetsRef.current = fallback;
        }
      }
      phase = 'word';
      wordPhaseCountRef.current += 1;
      logDebug('setWordPhase: count', wordPhaseCountRef.current);
      // record start time for word phase
      wordPhaseStartRef.current = now;
      // set cooldown to avoid immediate re-entry
      wordPhaseCooldownRef.current = now + COOLDOWN_MS;
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
        if (DEBUG) {
          console.log('[InkBlobs] freezeReleaseTimer fired', {
            wordPhaseCount: wordPhaseCountRef.current,
            mouseX,
            mouseY,
            allowInteraction: allowInteractionRef.current,
            wordPhaseStart: wordPhaseStartRef.current,
          });
        }
        // If fallback timer is still running, clear it
        if (freezeTimerRef.current) {
          clearTimeout(freezeTimerRef.current);
          freezeTimerRef.current = null;
        }
        // If the cursor is already over a blob when interaction becomes allowed,
        // unfreeze immediately so hover doesn't require a click or movement.
        if (mouseX !== null && mouseY !== null) {
          for (const bb of blobs) {
            const dxm = mouseX - bb.x;
            const dym = mouseY - bb.y;
            const distm = Math.hypot(dxm, dym);
            const wobble2 = Math.sin(bb.wobblePhase) * (bb.r * 0.08);
            const radius = bb.r + wobble2;
            if (distm > 0 && distm < radius) {
              freezeRef.current = false;
              tryBreakWordPhase();
              break;
            }
          }
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

    // collision diagnostics
    const collisionStats: {
      checks: number;
      near: number;
      collided: number;
      lastLog: number;
    } = { checks: 0, near: 0, collided: 0, lastLog: performance.now() };
    // visual debug arrays
    let nearPairs: Array<[number, number]> = [];

    const collide = (a: Blob, b: Blob) => {
      // allow collisions even while frozen so forces (mouse hits) propagate
      // through the system; keep positional correction to avoid sinking
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.0001;
      const minDist = a.r + b.r;
      const contactMargin = minDist * 0.02; // larger margin for more reliable contact
      // diagnostics
      collisionStats.checks++;
      if (dist < minDist * 1.2) {
        collisionStats.near++;
        // record near pair for visualization
        try {
          const ai = blobs.indexOf(a);
          const bi = blobs.indexOf(b);
          if (ai >= 0 && bi >= 0) nearPairs.push([ai, bi]);
        } catch (e) {}
      }
      if (dist > minDist + contactMargin) {
        // log near-misses (throttled) to help diagnose missed collisions
        try {
          const nowLog = performance.now();
          const last = (window as any).__ink_last_near_log || 0;
          if (nowLog - last > 500 && dist < minDist * 1.05) {
            (window as any).__ink_last_near_log = nowLog;
            if ((window as any).console && (window as any).console.log) {
              console.log('[InkBlobs] near-miss', {
                ai: blobs.indexOf(a),
                bi: blobs.indexOf(b),
                dist,
                minDist,
                contactMargin,
              });
            }
          }
        } catch (e) {}
        return;
      }
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
      // mark collided for diagnostics
      if (overlap > 0) {
        (a as any)._collided = true;
        (b as any)._collided = true;
        collisionStats.collided++;
      }

      // Resolve collision by decomposing velocities into normal and tangent
      // and applying a 1D elastic collision along the normal (mass-weighted).
      const m1 = Math.max(0.01, a.r * a.r);
      const m2 = Math.max(0.01, b.r * b.r);
      const restitution = 0.95; // slightly inelastic for stability

      // tangent vector (perpendicular to normal)
      const tx = -ny;
      const ty = nx;

      // project velocities onto normal and tangent
      const va_n = a.vx * nx + a.vy * ny;
      const va_t = a.vx * tx + a.vy * ty;
      const vb_n = b.vx * nx + b.vy * ny;
      const vb_t = b.vx * tx + b.vy * ty;

      // Only resolve if they're moving towards each other along the normal
      if (va_n - vb_n > 0) {
        const va_n_after = (va_n * (m1 - restitution * m2) + (1 + restitution) * m2 * vb_n) / (m1 + m2);
        const vb_n_after = (vb_n * (m2 - restitution * m1) + (1 + restitution) * m1 * va_n) / (m1 + m2);

        // convert scalar normal/tangent back to vectors
        a.vx = va_n_after * nx + va_t * tx;
        a.vy = va_n_after * ny + va_t * ty;
        b.vx = vb_n_after * nx + vb_t * tx;
        b.vy = vb_n_after * ny + vb_t * ty;
      }

      // Small positional correction to prevent sinking
      const penFactor = Math.min(overlap * 1.0, 8.0);
      const pix = penFactor * nx;
      const piy = penFactor * ny;
      a.x -= pix * 0.5;
      a.y -= piy * 0.5;
      b.x += pix * 0.5;
      b.y += piy * 0.5;

      // Also apply a small mass-weighted velocity transfer based on penetration
      // so overlapping blobs transfer momentum even if not strictly approaching
      const velTransferFactor = 0.6;
      a.vx -= (pix * velTransferFactor) / m1;
      a.vy -= (piy * velTransferFactor) / m1;
      b.vx += (pix * velTransferFactor) / m2;
      b.vy += (piy * velTransferFactor) / m2;

      // If one of the blobs was recently hit by the mouse, transfer additional
      // momentum to the other blob proportional to hit recency and relative speed.
      const nowHitTime = performance.now();
      const MOUSE_HIT_DECAY_MS = 300; // recency window
      const mouseTransferScale = 0.8; // how strongly mouse-hit transfers
      const applyMouseTransfer = (source: Blob, target: Blob) => {
        if (!source.wasMouseHit) return;
        const age = nowHitTime - (source.lastMouseHit || 0);
        if (age > MOUSE_HIT_DECAY_MS) return;
        const recency = Math.max(0, 1 - age / MOUSE_HIT_DECAY_MS);
        // transfer amount based on recency and relative approach speed
        const rel = Math.abs(relVel) + 0.5;
        const extra = Math.min(
          6.0,
          mouseTransferScale * recency * rel * (source.r * 0.02)
        );
        const ex = extra * nx;
        const ey = extra * ny;
        const sm = Math.max(0.01, source.r * source.r);
        const tm = Math.max(0.01, target.r * target.r);
        source.vx -= ex / sm;
        source.vy -= ey / sm;
        target.vx += ex / tm;
        target.vy += ey / tm;
        // propagate mouse-hit flag so momentum can cascade
        target.wasMouseHit = true;
      };

      applyMouseTransfer(a, b);
      applyMouseTransfer(b, a);

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
        // collisions deform blobs but do not change the word/move phase
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
        if (mouseX !== null && mouseY !== null) {
          const dxm = mouseX - b.x;
          const dym = mouseY - b.y;
          const distm = Math.hypot(dxm, dym);
          const wobble2 = Math.sin(b.wobblePhase) * (b.r * 0.08);
          const radius = b.r + wobble2;
          if (distm > 0 && distm < radius) {
            const nxm = dxm / distm;
            const nym = dym / distm;
            const nowHit = performance.now();
            // Run unfreeze check every frame while cursor is over the blob
            lastInteractionRef.current = nowHit;
            b.lastMouseHit = nowHit;
            b.wasMouseHit = true;
            if (freezeRef.current) {
              const nowLock = performance.now();
              const lockExpired =
                wordPhaseStartRef.current &&
                nowLock >=
                  wordPhaseStartRef.current + HELLO_ALLOW_INTERACTION_MS;
              if (DEBUG)
                console.log('[InkBlobs] hoverDecision', {
                  wordPhaseCount: wordPhaseCountRef.current,
                  mouseDown,
                  allowInteraction: allowInteractionRef.current,
                  lockExpired,
                });
              if (mouseDown || allowInteractionRef.current || lockExpired) {
                freezeRef.current = false;
                allowInteractionRef.current = true;
                tryBreakWordPhase();
                b.r = Math.max(16, Math.min(width, height) * 0.02);
              }
            }
            // Apply the stronger mouse-hit impulse only on initial entry
            if (!b.mouseOverActive) {
              b.mouseOverActive = true;
              const vdot = b.vx * nxm + b.vy * nym;
              const restitution = 3.0; // stronger bounce
              b.vx -= restitution * vdot * nxm;
              b.vy -= restitution * vdot * nym;
              const penetration = radius - distm;
              const impulse = Math.min(2.0, penetration * 0.12); // stronger immediate impulse
              b.vx -= nxm * impulse;
              b.vy -= nym * impulse;
              const accelPulse = Math.min(
                2.0,
                (penetration / Math.max(1, radius)) * (b.r * 0.006)
              );
              b.vx -= nxm * accelPulse;
              b.vy -= nym * accelPulse;
              // Limit velocity after mouse hit to keep blob in system
              const maxAfterMouse = 2.2;
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
    // increase passes to reduce tunneling and missed collisions
    // clear collision flags and visual pairs
    for (const bl of blobs) (bl as any)._collided = false;
    nearPairs.length = 0;
    let collisionCount = 0;
    for (let pass = 0; pass < 5; pass++) {
      for (let i = 0; i < blobs.length; i++) {
        for (let j = i + 1; j < blobs.length; j++) {
          const beforeA = (blobs[i] as any)._collided;
          const beforeB = (blobs[j] as any)._collided;
          collide(blobs[i], blobs[j]);
          const afterA = (blobs[i] as any)._collided;
          const afterB = (blobs[j] as any)._collided;
          if (!beforeA && afterA) collisionCount++;
          if (!beforeB && afterB) collisionCount++;
        }
      }
    }
    if (DEBUG && collisionCount > 0) {
      console.log('[InkBlobs] collisions this frame', collisionCount);
    }
    // log collision diagnostics once per second
    const nowDiag = performance.now();
    if (nowDiag - (collisionStats as any).lastLog > 1000) {
      (collisionStats as any).lastLog = nowDiag;
      if (DEBUG)
        console.log('[InkBlobs] collisionStats', {
          checks: (collisionStats as any).checks,
          near: (collisionStats as any).near,
          collided: (collisionStats as any).collided,
        });
      // reset counters each second
      (collisionStats as any).checks = 0;
      (collisionStats as any).near = 0;
      (collisionStats as any).collided = 0;
    }

    // draw visual debug overlays for near pairs and stats
    if (DEBUG) {
      // draw near pair lines
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,0,0.35)';
      for (const [ai, bi] of nearPairs) {
        const A = blobs[ai];
        const B = blobs[bi];
        if (!A || !B) continue;
        ctx.beginPath();
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(B.x, B.y);
        ctx.stroke();
      }
      ctx.restore();

      // draw stats text
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '12px monospace';
      ctx.fillText(`checks: ${(collisionStats as any).checks}`, 8, 18);
      ctx.fillText(`near: ${(collisionStats as any).near}`, 8, 34);
      ctx.fillText(`collided: ${(collisionStats as any).collided}`, 8, 50);
      ctx.restore();
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
      const collided = (b as any)._collided;
      ctx.strokeStyle = collided
        ? `rgba(255,255,255,0.95)`
        : `rgba(${cr},${cg},${cb},0.55)`;
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
