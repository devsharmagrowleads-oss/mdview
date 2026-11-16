/**
 * "Sort & filter" for tables. The document itself is never changed: the table
 * is copied into a window where it can be sorted, filtered and copied.
 */

/** A number from cells like "1,234", "$5.2k", "+46,324", "12%", "111.1 k". */
export function sortNumber(text: string): number | null {
  const t = text.replace(/[\s,$€£₹¥⭐★+]/g, "");
  const m = /^(-?\d+(?:\.\d+)?)([kmb%])?$/i.exec(t);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mult: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };
  return n * (m[2] ? (mult[m[2].toLowerCase()] ?? 1) : 1);
}

export function compareCells(a: string, b: string): number {
  const na = sortNumber(a);
  const nb = sortNumber(b);
  if (na !== null && nb !== null) return na - nb;
  if (na !== null) return -1;
  if (nb !== null) return 1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function openTableTool(source: HTMLTableElement, onLink: (href: string) => void) {
  const rows = Array.from(source.rows);
  if (rows.length < 2) return;
  const header = Array.from(rows[0].cells).map((c) => c.textContent?.trim() ?? "");
  const body = rows.slice(1).map((r, index) => ({
    index,
    texts: Array.from(r.cells).map((c) => c.textContent?.trim() ?? ""),
    cells: Array.from(r.cells).map((c) => Array.from(c.childNodes).map((n) => n.cloneNode(true))),
  }));

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const modal = document.createElement("div");
  modal.className = "modal table-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Sort and filter table");
  modal.innerHTML = `
    <div class="modal-head">
      <input type="search" class="table-filter" placeholder="Filter rows" spellcheck="false" aria-label="Filter rows" />
      <span class="table-count"></span>
      <button type="button" class="btn" data-act="csv">Copy as CSV</button>
      <button type="button" class="icon-btn" data-act="close" aria-label="Close" title="Close (Esc)"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="table-scroll"><table><thead><tr></tr></thead><tbody></tbody></table></div>
    <div class="modal-foot">Click a column heading to sort. The document is not changed.</div>`;
  backdrop.append(modal);
  document.body.append(backdrop);

  const filter = modal.querySelector<HTMLInputElement>(".table-filter")!;
  const count = modal.querySelector<HTMLElement>(".table-count")!;
  const headRow = modal.querySelector("thead tr")!;
  const tbody = modal.querySelector("tbody")!;
  let sortCol = -1;
  let sortDir: 1 | -1 = 1;
  let visible = body;

  header.forEach((name, col) => {
    const th = document.createElement("th");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sort-btn";
    btn.textContent = name || `Column ${col + 1}`;
    btn.addEventListener("click", () => {
      if (sortCol !== col) {
        sortCol = col;
        sortDir = 1;
      } else if (sortDir === 1) {
        sortDir = -1;
      } else {
        sortCol = -1;
      }
      render();
    });
    th.append(btn);
    headRow.append(th);
  });

  function render() {
    const q = filter.value.trim().toLowerCase();
    visible = body.filter((r) => !q || r.texts.some((t) => t.toLowerCase().includes(q)));
    if (sortCol >= 0) {
      visible = [...visible].sort(
        (a, b) => sortDir * compareCells(a.texts[sortCol] ?? "", b.texts[sortCol] ?? "") || a.index - b.index,
      );
    }
    headRow.querySelectorAll("th").forEach((th, i) => {
      th.setAttribute("aria-sort", i !== sortCol ? "none" : sortDir === 1 ? "ascending" : "descending");
    });
    tbody.replaceChildren(
      ...visible.map((r) => {
        const tr = document.createElement("tr");
        r.cells.forEach((nodes) => {
          const td = document.createElement("td");
          td.append(...nodes.map((n) => n.cloneNode(true)));
          tr.append(td);
        });
        return tr;
      }),
    );
    count.textContent = q ? `${visible.length} of ${body.length} rows` : `${body.length} rows`;
  }

  function close() {
    document.removeEventListener("keydown", onKey, true);
    backdrop.remove();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }
  document.addEventListener("keydown", onKey, true);
  backdrop.addEventListener("mousedown", (e) => e.target === backdrop && close());
  filter.addEventListener("input", render);
  modal.addEventListener("click", (e) => {
    const target = e.target as Element;
    const link = target.closest("a[href]");
    if (link) {
      e.preventDefault();
      onLink(link.getAttribute("href") ?? "");
      return;
    }
    const act = target.closest<HTMLElement>("[data-act]")?.dataset.act;
    if (act === "close") close();
    if (act === "csv") {
      const lines = [header, ...visible.map((r) => r.texts)].map((r) => r.map(csvCell).join(","));
      void navigator.clipboard.writeText(lines.join("\n")).then(() => {
        const btn = modal.querySelector<HTMLElement>('[data-act="csv"]')!;
        btn.textContent = "Copied";
        setTimeout(() => (btn.textContent = "Copy as CSV"), 1500);
      });
    }
  });
  render();
  filter.focus();
}
