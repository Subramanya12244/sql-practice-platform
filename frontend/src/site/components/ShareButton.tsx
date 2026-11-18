import { useState } from "react";
import { Share2 } from "lucide-react";
import { SITE_NAME, SITE_URL } from "../lib/seo";
import { BRAND_COLORS, MARK_PATH, WORDMARK, lockupMetrics } from "../../brandGeometry.js";

type Props =
  | { kind: "question"; title: string; number: number }
  | { kind: "progress"; solved: number; total: number; streak: number };

/** Draw a 1200×630 result card. */
function drawCard(p: Props): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 1200;
  c.height = 630;
  const g = c.getContext("2d")!;
  // The same flat ink card as the default social image: a blue rule, the lockup, no gradient.
  g.fillStyle = BRAND_COLORS.ink;
  g.fillRect(0, 0, 1200, 630);
  g.fillStyle = BRAND_COLORS.blue;
  g.fillRect(0, 0, 1200, 10);
  const L = lockupMetrics();
  g.save();
  g.translate(80, 58);
  g.scale(1.5, 1.5);
  g.save();
  g.scale(L.scale, L.scale);
  g.fillStyle = BRAND_COLORS.blueOnDark;
  g.fill(new Path2D(MARK_PATH));
  g.restore();
  g.translate(L.textX, L.baseline);
  g.fillStyle = "#F1F5F9";
  g.fill(new Path2D(WORDMARK.data));
  g.fill(new Path2D(WORDMARK.forge));
  g.restore();
  g.fillStyle = "#ffffff";
  if (p.kind === "question") {
    g.font = "700 64px Inter, system-ui, sans-serif";
    g.fillText("✓ Solved", 80, 260);
    g.font = "600 46px Inter, system-ui, sans-serif";
    wrap(g, `Q${p.number}: ${p.title}`, 80, 350, 1040, 58);
  } else {
    g.font = "700 64px Inter, system-ui, sans-serif";
    g.fillText(`${p.solved} / ${p.total} SQL questions solved`, 80, 280);
    g.font = "600 46px Inter, system-ui, sans-serif";
    g.fillText(`🔥 ${p.streak}-day streak`, 80, 380);
  }
  g.fillStyle = "#94A3B8";
  g.font = "500 30px Inter, system-ui, sans-serif";
  g.fillText(SITE_URL.replace(/^https?:\/\//, ""), 80, 560);
  return c;
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lh: number) {
  let line = "";
  for (const word of text.split(" ")) {
    const test = line ? `${line} ${word}` : word;
    if (g.measureText(test).width > max && line) {
      g.fillText(line, x, y);
      line = word;
      y += lh;
    } else line = test;
  }
  g.fillText(line, x, y);
}

export function ShareButton(props: Props) {
  const [status, setStatus] = useState<string | null>(null);

  async function share() {
    const text =
      props.kind === "question"
        ? `I solved "${props.title}" on ${SITE_NAME} — free SQL interview practice.`
        : `${props.solved}/${props.total} SQL interview questions solved, ${props.streak}-day streak on ${SITE_NAME}.`;
    const url = props.kind === "question" ? window.location.href : `${SITE_URL}/`;
    const blob = await new Promise<Blob | null>((res) => drawCard(props).toBlob(res, "image/png"));
    const file = blob ? new File([blob], "sql-practice.png", { type: "image/png" }) : null;
    try {
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ text, url, files: [file] });
        return;
      }
      if (navigator.share) {
        await navigator.share({ text, url });
        return;
      }
    } catch {
      return; // user dismissed the share sheet
    }
    if (blob) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "sql-practice.png";
      a.click();
      URL.revokeObjectURL(a.href);
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setStatus("Image saved, link copied");
    } catch {
      setStatus("Image saved");
    }
  }

  return (
    <button type="button" onClick={share} className="inline-flex items-center gap-1.5 rounded-lg border border-surface-border bg-surface-raised px-3 py-1.5 text-sm font-medium text-ink hover:border-accent/40">
      <Share2 className="h-4 w-4" aria-hidden /> {status ?? "Share"}
    </button>
  );
}
