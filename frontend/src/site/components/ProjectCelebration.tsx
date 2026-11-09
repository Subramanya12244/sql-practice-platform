import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, Trophy, ArrowRight } from "lucide-react";
import { prefersReducedMotion } from "./Motion";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  rotation: number;
  vRot: number;
}

const COLORS = [
  "#2dd4bf", // teal accent
  "#38bdf8", // sky
  "#a78bfa", // violet
  "#34d399", // emerald
  "#fbbf24", // amber/gold
  "#f472b6", // pink
];

export function ProjectCelebration({
  projectSlug,
  projectTitle,
  completed,
  passedCount,
  totalCount,
}: {
  projectSlug: string;
  projectTitle: string;
  completed: boolean;
  passedCount: number;
  totalCount: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showBurst, setShowBurst] = useState(false);
  const hasTriggered = useRef(false);

  useEffect(() => {
    if (!completed || totalCount === 0 || passedCount < totalCount) return;

    const storageKey = `df.celebrated.${projectSlug}`;
    const alreadyCelebrated = typeof sessionStorage !== "undefined" && sessionStorage.getItem(storageKey) === "1";

    if (!alreadyCelebrated && !hasTriggered.current) {
      hasTriggered.current = true;
      try {
        sessionStorage.setItem(storageKey, "1");
      } catch {
        /* storage unavailable */
      }
      if (!prefersReducedMotion()) {
        setShowBurst(true);
      }
    }
  }, [completed, passedCount, totalCount, projectSlug]);

  useEffect(() => {
    if (!showBurst) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const particles: Particle[] = [];
    const count = 36;
    const originX = canvas.width / 2;
    const originY = canvas.height * 0.45;

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = 3.5 + Math.random() * 4.5;
      particles.push({
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2.5,
        size: 4 + Math.random() * 4,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        alpha: 1,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.2,
      });
    }

    let raf = 0;
    const t0 = performance.now();
    const duration = 2000;

    const tick = (now: number) => {
      const elapsed = now - t0;
      if (elapsed > duration) {
        setShowBurst(false);
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const gravity = 0.14;

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += gravity;
        p.vx *= 0.985;
        p.rotation += p.vRot;
        p.alpha = Math.max(0, 1 - elapsed / duration);

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [showBurst]);

  if (!completed) return null;

  return (
    <div className="relative my-6 overflow-hidden rounded-card border border-success/30 bg-gradient-to-r from-success-dim/50 via-accent-dim/30 to-secondary-dim/30 p-5 shadow-panel">
      {showBurst && (
        <canvas
          ref={canvasRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 h-full w-full"
        />
      )}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 animate-pop items-center justify-center rounded-2xl bg-gradient-to-br from-success to-accent text-white shadow-glow">
            <Trophy className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-success">
              <Sparkles className="h-3.5 w-3.5" aria-hidden /> Project Completed
            </p>
            <h3 className="font-display text-lg font-bold text-ink sm:text-xl">
              Congratulations! All automated checks passed
            </h3>
            <p className="mt-0.5 text-xs text-ink-muted">
              You built and verified {projectTitle}. All {totalCount} automated tasks are complete and saved.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/portfolio"
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-surface-border bg-surface-raised px-3 text-xs font-semibold text-ink transition-all duration-fast hover:border-accent/40 active:scale-[0.98]"
          >
            View in Portfolio <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link
            to="/projects-lab"
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-on-accent shadow-glow transition-all duration-fast hover:brightness-110 active:scale-[0.98]"
          >
            Next Project
          </Link>
        </div>
      </div>
    </div>
  );
}

