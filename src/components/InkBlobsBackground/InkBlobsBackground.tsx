import { useEffect, useRef } from 'react';
import './InkBlobsBackground.scss';

function InkBlobsBackground() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const blobs = Array.from(
      container.querySelectorAll<HTMLSpanElement>('.blob')
    );

    // Mono mode only (grayscale)
    const grayProfiles = [
      { light: 95, mid: 75, dark: 20 },
      { light: 88, mid: 68, dark: 18 },
      { light: 80, mid: 60, dark: 16 },
      { light: 65, mid: 45, dark: 12 },
      { light: 50, mid: 35, dark: 10 },
      { light: 40, mid: 28, dark: 8 },
    ];
    blobs.forEach((el) => {
      // Force all blobs to mono (grayscale) mode
      el.classList.add('mono');
      el.classList.remove('color');
      const p = grayProfiles[Math.floor(Math.random() * grayProfiles.length)];
      el.style.setProperty('--light', String(p.light));
      el.style.setProperty('--mid', String(p.mid));
      el.style.setProperty('--dark', String(p.dark));
    });

    // Bounds
    let bounds = container.getBoundingClientRect();
    if (!bounds.width || !bounds.height) {
      bounds = {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: container.offsetWidth,
        bottom: container.offsetHeight,
        width: container.offsetWidth || 1,
        height: container.offsetHeight || 1,
        toJSON: () => ({}),
      } as DOMRect;
    }

    const rand = (min: number, max: number) =>
      Math.random() * (max - min) + min;

    type Body = {
      el: HTMLSpanElement;
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      scaleAmp: number;
    };
    const bodies: Body[] = blobs.map((el) => {
      const rect = el.getBoundingClientRect();
      let r = rect.width / 2;
      if (!r || r < 10) r = 10;
      return {
        el,
        x: rand(r, bounds.width - r),
        y: rand(r, bounds.height - r),
        vx: rand(-0.06, 0.06),
        vy: rand(-0.06, 0.06),
        r,
        scaleAmp: rand(0.005, 0.015),
      };
    });

    const damping = 0.998;
    const wallBounce = 0.98;

    let last = performance.now();
    let rafId = 0;
    const step = (now: number) => {
      let dt = now - last;
      if (dt > 50) dt = 50;
      last = now;

      for (const b of bodies) {
        b.vx *= damping;
        b.vy *= damping;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        if (b.x < b.r) {
          b.x = b.r;
          b.vx = Math.abs(b.vx) * wallBounce;
        }
        if (b.x > bounds.width - b.r) {
          b.x = bounds.width - b.r;
          b.vx = -Math.abs(b.vx) * wallBounce;
        }
        if (b.y < b.r) {
          b.y = b.r;
          b.vy = Math.abs(b.vy) * wallBounce;
        }
        if (b.y > bounds.height - b.r) {
          b.y = bounds.height - b.r;
          b.vy = -Math.abs(b.vy) * wallBounce;
        }
      }

      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i],
            c = bodies[j];
          const dx = c.x - a.x,
            dy = c.y - a.y;
          const dist2 = dx * dx + dy * dy;
          const minDist = a.r + c.r;
          if (dist2 > 0 && dist2 < minDist * minDist) {
            const dist = Math.sqrt(dist2) || 1;
            const nx = dx / dist,
              ny = dy / dist;
            const overlap = minDist - dist;
            const push = overlap * 0.5;
            a.x -= nx * push;
            a.y -= ny * push;
            c.x += nx * push;
            c.y += ny * push;
            const relvx = c.vx - a.vx;
            const relvy = c.vy - a.vy;
            const relVel = relvx * nx + relvy * ny;
            if (relVel < 0) {
              const impulse = -1.0 * relVel;
              const jx = impulse * nx * 0.5;
              const jy = impulse * ny * 0.5;
              a.vx -= jx;
              a.vy -= jy;
              c.vx += jx;
              c.vy += jy;
            }
          }
        }
      }

      for (const b of bodies) {
        const s = 1 + Math.sin(now * 0.0004) * b.scaleAmp;
        b.el.style.transform = `translate(${b.x - bounds.width / 2}px, ${
          b.y - bounds.height / 2
        }px) scale(${s})`;
      }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);

    const onResize = () => {
      const b = container.getBoundingClientRect();
      bounds = b.width && b.height ? b : bounds;
      for (const body of bodies) {
        body.x = Math.min(Math.max(body.x, body.r), b.width - body.r);
        body.y = Math.min(Math.max(body.y, body.r), b.height - body.r);
      }
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div className="ink-blobs-bg" aria-hidden>
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <filter id="goo">
            <feGaussianBlur
              in="SourceGraphic"
              stdDeviation="10"
              result="blur"
            />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="1 0 0 0 0
                      0 1 0 0 0
                      0 0 1 0 0
                      0 0 0 18 -10"
            />
          </filter>
        </defs>
      </svg>
      <div className="blobs" ref={containerRef}>
        <span className="blob b1" />
        <span className="blob b2" />
        <span className="blob b3" />
        <span className="blob b4" />
        <span className="blob b5" />
        <span className="blob b6" />
        <span className="blob b7" />
      </div>
    </div>
  );
}

export default InkBlobsBackground;
