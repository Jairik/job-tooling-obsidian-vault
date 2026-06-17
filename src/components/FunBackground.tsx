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
  { id: "matrix", label: "Matrix Rain" },
  { id: "starfield", label: "Starfield" },
  { id: "grid3d", label: "3D Grid" },
  { id: "flicker", label: "Flickering Grid" },
  { id: "comet", label: "Shooting Stars" },
  { id: "balatro", label: "Balatro" },
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

// HSL to RGB helper for Balatro shader
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r, g, b;
  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/* Canvas-based scene renderer with requestAnimationFrame loop.
   Respects prefers-reduced-motion. CSS variants use plain divs. */
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

    // State variables for various effects
    let particles: { x: number; y: number; vx: number; vy: number; r: number }[] = [];
    let matrixDrops: number[] = [];
    let stars: { x: number; y: number; z: number }[] = [];
    let flickerSquares: { x: number; y: number; w: number; h: number; alpha: number; targetAlpha: number; speed: number }[] = [];
    let comets: { x: number; y: number; len: number; speed: number; angle: number }[] = [];

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

    const initMatrix = () => {
      const columns = Math.floor(w / 14) + 1;
      matrixDrops = Array.from({ length: columns }, () => Math.random() * -100);
    };

    const initStarfield = () => {
      const count = 120;
      stars = Array.from({ length: count }, () => ({
        x: (Math.random() - 0.5) * w,
        y: (Math.random() - 0.5) * h,
        z: Math.random() * w,
      }));
    };

    const initFlicker = () => {
      const cols = Math.floor(w / 40) + 1;
      const rows = Math.floor(h / 40) + 1;
      flickerSquares = [];
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          flickerSquares.push({
            x: c * 40 + 4,
            y: r * 40 + 4,
            w: 32,
            h: 32,
            alpha: Math.random() * 0.08,
            targetAlpha: Math.random() * 0.08,
            speed: Math.random() * 0.005 + 0.002,
          });
        }
      }
    };

    const initComets = () => {
      comets = Array.from({ length: 6 }, () => ({
        x: Math.random() * w,
        y: Math.random() * -h,
        len: Math.random() * 60 + 30,
        speed: Math.random() * 3 + 1.5,
        angle: Math.PI / 4,
      }));
    };

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      if (variant === "balatro") {
        canvas.width = 120;
        canvas.height = 90;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      } else {
        canvas.width = Math.max(1, Math.floor(w * dpr));
        canvas.height = Math.max(1, Math.floor(h * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      if (variant === "particles") initParticles();
      else if (variant === "matrix") initMatrix();
      else if (variant === "starfield") initStarfield();
      else if (variant === "flicker") initFlicker();
      else if (variant === "comet") initComets();
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

    const drawMatrix = () => {
      ctx.fillStyle = isDark() ? "rgba(10, 10, 10, 0.08)" : "rgba(240, 244, 248, 0.08)";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = isDark() ? "rgba(99, 230, 190, 0.35)" : "rgba(45, 160, 140, 0.35)";
      ctx.font = "12px monospace";
      for (let i = 0; i < matrixDrops.length; i++) {
        const char = String.fromCharCode(33 + Math.floor(Math.random() * 93));
        const x = i * 14;
        const y = matrixDrops[i] * 14;
        ctx.fillText(char, x, y);
        if (y > h && Math.random() > 0.975) {
          matrixDrops[i] = 0;
        } else {
          matrixDrops[i]++;
        }
      }
    };

    const drawStarfield = () => {
      ctx.clearRect(0, 0, w, h);
      const color = isDark() ? "255, 255, 255" : "10, 10, 10";
      const cx = w / 2;
      const cy = h / 2;
      for (const s of stars) {
        s.z -= 1.2;
        if (s.z <= 0) {
          s.x = (Math.random() - 0.5) * w;
          s.y = (Math.random() - 0.5) * h;
          s.z = w;
        }
        const px = (s.x / s.z) * w + cx;
        const py = (s.y / s.z) * h + cy;
        if (px >= 0 && px <= w && py >= 0 && py <= h) {
          const size = (1 - s.z / w) * 2;
          const alpha = (1 - s.z / w) * 0.5;
          ctx.fillStyle = `rgba(${color}, ${alpha})`;
          ctx.beginPath();
          ctx.arc(px, py, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const drawFlicker = () => {
      ctx.clearRect(0, 0, w, h);
      const baseColor = isDark() ? "110, 168, 254" : "75, 123, 236";
      for (const sq of flickerSquares) {
        if (Math.abs(sq.alpha - sq.targetAlpha) < 0.005) {
          sq.targetAlpha = Math.random() * 0.08;
        }
        sq.alpha += (sq.targetAlpha - sq.alpha) * sq.speed;
        ctx.fillStyle = `rgba(${baseColor}, ${sq.alpha})`;
        ctx.fillRect(sq.x, sq.y, sq.w, sq.h);
      }
    };

    const drawComets = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1.5;
      const color = isDark() ? "167, 139, 250" : "138, 99, 250";
      for (const c of comets) {
        c.x += c.speed * Math.cos(c.angle);
        c.y += c.speed * Math.sin(c.angle);
        if (c.x > w || c.y > h) {
          c.x = Math.random() * w * 0.5;
          c.y = Math.random() * -100;
          c.speed = Math.random() * 3 + 1.5;
        }
        const grad = ctx.createLinearGradient(
          c.x - c.len * Math.cos(c.angle),
          c.y - c.len * Math.sin(c.angle),
          c.x,
          c.y
        );
        grad.addColorStop(0, `rgba(${color}, 0)`);
        grad.addColorStop(1, `rgba(${color}, 0.3)`);
        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(c.x - c.len * Math.cos(c.angle), c.y - c.len * Math.sin(c.angle));
        ctx.lineTo(c.x, c.y);
        ctx.stroke();
      }
    };

    // Balatro-inspired low-res (120×90) psychedelic gradient shader.
    const drawBalatro = () => {
      const cw = 120;
      const ch = 90;
      const imgData = ctx.createImageData(cw, ch);
      const data = imgData.data;
      const time = t * 0.0018;
      const dark = isDark();

      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const nx = x / cw - 0.5;
          const ny = y / ch - 0.5;

          const cx = nx + 0.4 * Math.sin(time * 0.4);
          const cy = ny + 0.4 * Math.cos(time * 0.3);
          const dist = Math.sqrt(cx * cx + cy * cy);

          let v = Math.sin(nx * 6.0 + time) +
                  Math.sin(8.0 * (nx * Math.sin(time * 0.2) + ny * Math.cos(time * 0.3)) + time) +
                  Math.sin(dist * 12.0 - time);

          v = v / 3.0; // scale to [-1, 1]

          // Balatro theme palette mapping: HSL rotation
          // Accent hues centered at neon red/pink/orange/purple
          const hue = (v * 60 + time * 15 + 320) % 360;
          const sat = dark ? 0.72 : 0.85;
          // Subdued lightness to keep foreground text highly readable
          const light = dark ? 0.16 + v * 0.06 : 0.78 + v * 0.08;

          const [r, g, b] = hslToRgb(hue / 360, sat, light);
          const idx = (y * cw + x) * 4;
          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = dark ? 255 : 120; // translucent for light theme
        }
      }
      ctx.putImageData(imgData, 0, 0);
    };

    const frame = () => {
      t += 16;
      if (variant === "particles") drawParticles();
      else if (variant === "waves") drawWaves();
      else if (variant === "matrix") drawMatrix();
      else if (variant === "starfield") drawStarfield();
      else if (variant === "flicker") drawFlicker();
      else if (variant === "comet") drawComets();
      else if (variant === "balatro") drawBalatro();
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
  const isCanvas = variant === "particles" || variant === "waves" || variant === "matrix" || variant === "starfield" || variant === "flicker" || variant === "comet" || variant === "balatro";
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
