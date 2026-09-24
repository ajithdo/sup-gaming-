import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Mounts the three.js controller scene and exposes the "fly to booking" action.
 * three.js is loaded lazily so the page's text and booking form render first.
 */
export function useSlipScene({ mountRef, heroRef, heroSlotRef, claimSlotRef, bookSlotRef }) {
  const sceneRef = useRef(null);
  const flying = useRef(false);
  const [loading, setLoading] = useState(true);
  const [pct, setPct] = useState(0);
  const [planet, setPlanet] = useState({ name: '', on: false });

  // Where on screen the controller should dock (viewport px), or null to float freely.
  const getAnchor = useCallback(() => {
    const H = window.innerHeight;
    const anchorOf = el => {
      const r = el.getBoundingClientRect();
      const f = window.innerWidth < 600 ? 0.78 : 0.9;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.min(r.width, r.height * 1.5) * f, r };
    };
    const b = bookSlotRef.current;
    if (flying.current && b) { const a = anchorOf(b); a.y = Math.min(H * 0.78, Math.max(H * 0.3, a.y)); return a; }
    for (const el of [heroSlotRef.current, claimSlotRef.current, b]) {
      if (!el) continue;
      const a = anchorOf(el);
      if (a.r.width > 0 && a.r.bottom > H * 0.08 && a.r.top < H * 0.92) return a;
    }
    return null;
  }, [bookSlotRef, claimSlotRef, heroSlotRef]);

  useEffect(() => {
    let disposed = false;
    let scene = null;
    import('./slip-scene.js').then(({ createSlipScene }) => {
      if (disposed || !mountRef.current) return;
      try {
        scene = createSlipScene(mountRef.current, {
          modelUrl: '/models/ps5.glb',
          opts: { glow: 1, speed: 1, flip: false, turn: false, mirror: true, exit: true },
          getAnchor,
          getScroll: () => { const r = heroRef.current; return r ? Math.max(0, -r.getBoundingClientRect().top / window.innerHeight) : 0; },
          onProgress: p => setPct(Math.round(p * 100)),
          onReady: () => setLoading(false),
          onPlanet: n => setPlanet(n ? { name: n, on: true } : prev => ({ ...prev, on: false })),
        });
        sceneRef.current = scene;
      } catch (err) {
        // No WebGL (old device, disabled GPU): the site still works without the 3D scene.
        console.warn('3D scene unavailable:', err);
        setLoading(false);
      }
    }).catch(err => { console.warn('3D scene failed to load:', err); setLoading(false); });
    return () => { disposed = true; scene?.destroy(); sceneRef.current = null; };
  }, [mountRef, heroRef, getAnchor]);

  /** Smooth-scroll to the booking dock while the controller flies along. */
  const bookFly = useCallback(e => {
    e?.preventDefault?.();
    const b = bookSlotRef.current;
    if (!b) return;
    const top = b.getBoundingClientRect().top + window.scrollY - 88;
    flying.current = true;
    sceneRef.current?.fly();
    window.scrollTo({ top, behavior: 'smooth' });
    const t0 = performance.now(); let still = 0; let last = null;
    const check = () => {
      const y = b.getBoundingClientRect().top;
      still = last !== null && Math.abs(y - last) < 0.5 ? still + 1 : 0; last = y;
      if ((still > 8 && performance.now() - t0 > 400) || performance.now() - t0 > 3500) {
        flying.current = false;
        setTimeout(() => sceneRef.current?.pulse(), 350);
        return;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }, [bookSlotRef]);

  const pulse = useCallback(() => sceneRef.current?.pulse(), []);

  return { loading, pct, planet: planet.on, planetName: planet.name, bookFly, pulse };
}
