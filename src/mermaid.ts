/**
 * Diagrams for ```mermaid code blocks. Mermaid is large, so it is loaded the
 * first time a document contains a diagram.
 */
type Mermaid = (typeof import("mermaid"))["default"];

let loading: Promise<Mermaid> | null = null;
let counter = 0;

const isDark = () => document.documentElement.dataset.theme === "dark";

/**
 * A diagram for export: light theme, and labels drawn as SVG text rather
 * than embedded HTML, so it can also be turned into a picture.
 */
export async function diagramSvg(content: string): Promise<string> {
  loading ??= import("mermaid").then((m) => m.default);
  const mermaid = await loading;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "default",
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    fontFamily: "Arial, sans-serif",
  });
  const id = `mdview-export-${++counter}`;
  try {
    return (await mermaid.render(id, content)).svg;
  } finally {
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
}

/** Rasterise an SVG (for Word and mail apps, which don't show SVG). */
export async function svgToPng(svg: string, scale = 2): Promise<{ src: string; width: number; height: number }> {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const el = doc.documentElement;
  const box = (el.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  const width = Math.ceil(box[2] || parseFloat(el.getAttribute("width") ?? "") || 600);
  const height = Math.ceil(box[3] || parseFloat(el.getAttribute("height") ?? "") || 400);
  el.setAttribute("width", String(width));
  el.setAttribute("height", String(height));
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(el))}`;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Could not draw the diagram."));
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { src: canvas.toDataURL("image/png"), width, height };
}

/** Matches Crepe's `renderPreview` contract: render later through `apply`. */
export function renderMermaid(content: string, apply: (value: HTMLElement | string | null) => void): undefined {
  loading ??= import("mermaid").then((m) => m.default);
  void loading.then(async (mermaid) => {
    // Re-read the theme on every render, so diagrams match after switching.
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: isDark() ? "dark" : "default",
      // An export may have switched these off; the screen uses HTML labels.
      htmlLabels: true,
      flowchart: { htmlLabels: true },
      fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    });
    const id = `mdview-mermaid-${++counter}`;
    try {
      const { svg } = await mermaid.render(id, content);
      const box = document.createElement("div");
      box.className = "mermaid-diagram";
      box.innerHTML = svg;
      apply(box);
    } catch (err) {
      // Mermaid leaves its error drawing in the page; take it away.
      document.getElementById(id)?.remove();
      document.getElementById(`d${id}`)?.remove();
      const msg = document.createElement("div");
      msg.className = "mermaid-error";
      msg.textContent = `Diagram error: ${err instanceof Error ? err.message : String(err)}`;
      apply(msg);
    }
  });
  return undefined;
}
