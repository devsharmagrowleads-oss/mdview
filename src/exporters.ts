/**
 * Turning the rendered document into clean, standalone HTML: for copying into
 * mail and chat apps, and for exporting HTML and Word files.
 */
import { diagramSvg, svgToPng } from "./mermaid";
import { zip } from "./zip";

export interface CodeBlock {
  language: string;
  text: string;
}

const EXPORT_CSS = `
:root { color-scheme: light; }
body { margin: 0; background: #fff; color: #1d1c1a;
  font: 16px/1.65 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
article { max-width: 820px; margin: 0 auto; padding: 40px 24px 80px; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 0.6em; }
h1 { font-size: 2em; } h2 { font-size: 1.5em; border-bottom: 1px solid #e2dfd8; padding-bottom: 0.25em; }
h3 { font-size: 1.25em; }
p, ul, ol, blockquote, pre, table { margin: 0 0 1em; }
a { color: #2a5bd7; }
code { font-family: ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace; font-size: 0.9em;
  background: #f4f3f0; padding: 0.1em 0.35em; border-radius: 4px; }
pre { background: #f4f3f0; padding: 14px 16px; border-radius: 8px; overflow-x: auto; }
pre code { background: none; padding: 0; font-size: 0.875em; line-height: 1.55; }
blockquote { margin-left: 0; padding: 0.2em 1em; border-left: 3px solid #cfcbc2; color: #55524c; }
table { border-collapse: collapse; display: block; overflow-x: auto; }
th, td { border: 1px solid #e2dfd8; padding: 6px 12px; text-align: left; vertical-align: top; }
th { background: #f4f3f0; font-weight: 600; }
img, svg { max-width: 100%; height: auto; }
hr { border: 0; border-top: 1px solid #e2dfd8; margin: 2em 0; }
li > p { margin: 0.2em 0; }
input[type=checkbox] { margin-right: 0.4em; }
.mdview-mermaid { margin: 0 0 1em; text-align: center; }
@media print { article { padding: 0; } }
`;

/** Inline styles for pasting into apps that drop <style> (Gmail, Outlook, Slack). */
const INLINE_STYLES: Record<string, string> = {
  table: "border-collapse:collapse",
  th: "border:1px solid #d0cdc6;padding:4px 10px;background:#f4f3f0;text-align:left",
  td: "border:1px solid #d0cdc6;padding:4px 10px;vertical-align:top",
  pre: "background:#f4f3f0;padding:10px 12px;border-radius:6px;white-space:pre-wrap",
  code: "font-family:Consolas,Menlo,monospace;font-size:0.9em",
  blockquote: "margin:0 0 1em;padding:2px 12px;border-left:3px solid #cfcbc2;color:#55524c",
};

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function toDataUrl(src: string): Promise<string | null> {
  try {
    const blob = await (await fetch(src)).blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Clean HTML for the document body. `root` is the editor's `.ProseMirror`
 * element; `code` lists the document's code blocks in order (their full text,
 * which the on-screen code editor may only partly render).
 */
export async function documentBody(
  root: HTMLElement,
  code: CodeBlock[],
  { inlineStyles = false, pictures = false }: { inlineStyles?: boolean; pictures?: boolean } = {},
): Promise<string> {
  const clone = root.cloneNode(true) as HTMLElement;

  const blocks = Array.from(clone.querySelectorAll<HTMLElement>(".milkdown-code-block"));
  for (const [i, block] of blocks.entries()) {
    const info = code[i];
    const language = (info?.language ?? block.dataset.language ?? "").toLowerCase();
    if (language === "mermaid" && info?.text.trim()) {
      // Drawn again from the source: the on-screen copy follows the app's
      // theme, and Word and mail apps need a picture rather than SVG.
      try {
        const svg = await diagramSvg(info.text);
        const figure = document.createElement("div");
        figure.className = "mdview-mermaid";
        if (pictures) {
          const png = await svgToPng(svg);
          const img = document.createElement("img");
          img.src = png.src;
          img.alt = "Diagram";
          img.width = Math.min(png.width, 640);
          figure.append(img);
        } else {
          figure.innerHTML = svg;
        }
        block.replaceWith(figure);
        continue;
      } catch {
        // fall through: export the diagram's source as code
      }
    }
    const preview = block.querySelector(".preview");
    if (preview && preview.innerHTML.trim() && (language === "latex" || language === "math")) {
      const figure = document.createElement("div");
      figure.className = "mdview-math";
      figure.innerHTML = preview.innerHTML;
      block.replaceWith(figure);
      continue;
    }
    const pre = document.createElement("pre");
    const el = document.createElement("code");
    if (language) el.className = `language-${language}`;
    el.textContent = info?.text ?? block.querySelector(".cm-content")?.textContent ?? "";
    pre.append(el);
    block.replaceWith(pre);
  }

  // Tables: keep the table itself, not the editor's handles and drag preview.
  clone.querySelectorAll<HTMLElement>(".milkdown-table-block").forEach((wrapper) => {
    const table = wrapper.querySelector("table.children") ?? Array.from(wrapper.querySelectorAll("table")).find((t) => t.rows.length);
    if (table) {
      table.removeAttribute("class");
      table.querySelector("tbody")?.removeAttribute("class");
      wrapper.replaceWith(table);
    } else {
      wrapper.remove();
    }
  });

  clone
    .querySelectorAll(
      "button, .milkdown-block-handle, .ProseMirror-separator, .ProseMirror-trailingBreak, .tools, .language-picker, .preview-toggle-button, .prosemirror-virtual-cursor, .handle, .drag-preview",
    )
    .forEach((e) => e.remove());

  // The editor draws list markers itself; plain HTML lists bring their own,
  // and task items become real checkboxes.
  clone.querySelectorAll<HTMLElement>("li").forEach((li) => {
    const wrapper = li.querySelector(":scope > .label-wrapper");
    const label = wrapper?.querySelector(".label");
    const task = label?.classList.contains("checked") || label?.classList.contains("unchecked") || li.dataset.itemType === "task";
    wrapper?.remove();
    if (!task) return;
    const box = document.createElement("input");
    box.type = "checkbox";
    box.disabled = true;
    if (label?.classList.contains("checked") || li.dataset.checked === "true") box.setAttribute("checked", "");
    (li.querySelector("p") ?? li).prepend(box);
    li.setAttribute("style", "list-style:none");
  });

  for (const img of Array.from(clone.querySelectorAll("img"))) {
    const src = img.getAttribute("src") ?? "";
    if (src.startsWith("data:image/gif;base64,R0lGOD")) {
      img.remove();
    } else if (src.startsWith("blob:")) {
      const data = await toDataUrl(src);
      if (data) img.setAttribute("src", data);
      else img.remove();
    }
  }

  clone.querySelectorAll("*").forEach((e) => {
    for (const attr of Array.from(e.attributes)) {
      const n = attr.name;
      if (n === "contenteditable" || n === "draggable" || n === "spellcheck" || n === "translate" || n.startsWith("data-")) {
        e.removeAttribute(n);
      }
    }
    if (inlineStyles) {
      const style = INLINE_STYLES[e.tagName.toLowerCase()];
      if (style) e.setAttribute("style", style);
    }
  });
  return clone.innerHTML;
}

/** CSS for typeset math, taken from the app's own stylesheets (fonts excluded). */
function mathCss(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule && rule.selectorText.includes("katex")) out.push(rule.cssText);
    }
  }
  return out.join("\n");
}

export function standaloneHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="MDView">
<title>${escapeHtml(title)}</title>
<style>${EXPORT_CSS}
${mathCss()}</style>
</head>
<body>
<article>
${body}
</article>
</body>
</html>
`;
}

/**
 * A Word document that carries the HTML as an "alternative format chunk";
 * Word converts it to native content when the file is opened.
 */
export function docx(html: string): Uint8Array {
  const rels = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  return zip([
    {
      name: "[Content_Types].xml",
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="html" ContentType="text/html"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        "</Types>",
    },
    {
      name: "_rels/.rels",
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${rels}/officeDocument" Target="word/document.xml"/>` +
        "</Relationships>",
    },
    {
      name: "word/_rels/document.xml.rels",
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="htmlChunk" Type="${rels}/aFChunk" Target="document.html"/>` +
        "</Relationships>",
    },
    {
      name: "word/document.xml",
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
        `xmlns:r="${rels}"><w:body><w:altChunk r:id="htmlChunk"/>` +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
        "</w:body></w:document>",
    },
    { name: "word/document.html", data: html },
  ]);
}

/**
 * Put formatted HTML and plain Markdown on the clipboard together. Call it
 * straight from the click, before awaiting anything: Safari's engine (macOS)
 * only allows clipboard writes that start inside the click, so the HTML is
 * passed as a promise and finished while the write is pending.
 */
export async function copyRich(html: Promise<string>, plain: string) {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": html.then((h) => new Blob([h], { type: "text/html" })),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(plain);
}
