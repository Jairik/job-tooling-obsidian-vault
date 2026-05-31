import { useEffect, useRef } from "react";

// Animated backgrounds for "fun mode" — inspired by reactbits.dev, but
// reimplemented dependency-free (pure CSS + a small 2D canvas) so the app
// stays a no-install Bun project. Cyclable from the header.
export const FUN_VARIANTS = [
  { id: "aurora", label: "Aurora" },
  { id: "particles", label: "Particles" },
  { id: "waves", label: "Waves" },
  { id: "dots", label: "Dot Grid" },
  { id: "mesh", label: "Mesh" },
] as const;

export type FunVariant = (typeof FUN_VARIANTS)[number]["id"];

export function nextFunVariant(v: FunVariant): FunVariant {
  const i = FUN_VARIANTS.findIndex((x) => x.id === v);
  return FUN_VARIANTS[(i + 1) % FUN_VARIANTS.length].id;
}

export function funLabel(v: FunVariant): string {
  return FUN_VARIANTS.find((x) => x.id === v)?.label ?? "Aurora";
}

const isDark = () => (document.documentElement.dataset.theme ?? "dark") !== "light";

// Canvas scenes (particles, waves). CSS scenes are handled with plain divs.
function useCanvasScene(variant: FunVariant) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;
    let t = 0;
    let w = 0;
    let h = 0;
    let particles: { x: number; y: number; vx: number; vy: number; r: number }[] = [];

    const initParticles = () => {
      const count = Math.round(Math.min(110, (w * h) / 15000));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.32,
        vy: (Math.random() - 0.5) * 0.32,
        r: Math.random() * 1.6 + 0.6,
      }));
    };

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (variant === "particles") initParticles();
    };

    const drawParticles = () => {
      ctx.clearRect(0, 0, w, h);
      const c = isDark() ? "110,168,254" : "75,123,236";
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x += w;
        if (p.x > w) p.x -= w;
        if (p.y < 0) p.y += h;
        if (p.y > h) p.y -= h;
      }
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 130 * 130) {
            const alpha = (1 - Math.sqrt(d2) / 130) * 0.18;
            ctx.strokeStyle = `rgba(${c},${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      ctx.fillStyle = `rgba(${c},0.65)`;
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const drawWaves = () => {
      ctx.clearRect(0, 0, w, h);
      const dark = isDark();
      const hues = dark
        ? ["110,168,254", "99,230,190", "167,139,250"]
        : ["75,123,236", "45,160,140", "138,99,250"];
      for (let layer = 0; layer < 3; layer++) {
        const amp = 16 + layer * 16;
        const yBase = h * 0.5 + layer * h * 0.14;
        const speed = 0.0006 + layer * 0.00045;
        const wl = 0.008 - layer * 0.0016;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 6) {
          const y = yBase + Math.sin(x * wl + t * speed + layer) * amp;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = `rgba(${hues[layer]}, ${dark ? 0.1 : 0.14})`;
        ctx.fill();
      }
    };

    const frame = () => {
      t += 16;
      if (variant === "particles") drawParticles();
      else if (variant === "waves") drawWaves();
      if (!reduce) raf = requestAnimationFrame(frame);
    };

    resize();
    window.addEventListener("resize", resize);
    if (reduce) frame();
    else raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [variant]);

  return ref;
}

export function FunBackground({ variant }: { variant: FunVariant }) {
  const isCanvas = variant === "particles" || variant === "waves";
  const ref = useCanvasScene(variant);

  return (
    <div className="fun-bg" aria-hidden="true" data-variant={variant}>
      {isCanvas ? (
        <canvas ref={ref} className="fun-canvas" />
      ) : (
        <div className={`fun-css fun-${variant}`} />
      )}
    </div>
  );
}
