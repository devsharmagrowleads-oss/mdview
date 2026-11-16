/** User preferences, kept in this machine's local storage. */
export interface Prefs {
  /** What to do when a watched folder gets a new or changed Markdown file. */
  autoOpen: "all" | "new" | "none";
  /** Bring the window forward when an agent opens a file that wasn't open. */
  focusAgent: boolean;
  /** Ctrl+Alt+M anywhere opens the clipboard's path or Markdown. */
  clipboardShortcut: boolean;
  autoUpdate: boolean;
  defaultPromptDismissed: boolean;
  watchDirs: string[];
}

const KEY = "mdview.prefs";

const defaults: Prefs = {
  autoOpen: "all",
  focusAgent: true,
  clipboardShortcut: true,
  autoUpdate: true,
  defaultPromptDismissed: false,
  watchDirs: [],
};

function load(): Prefs {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const merged = { ...defaults, ...stored } as Prefs;
    if (!Array.isArray(merged.watchDirs)) merged.watchDirs = [];
    if (!["all", "new", "none"].includes(merged.autoOpen)) merged.autoOpen = "all";
    return merged;
  } catch {
    return { ...defaults };
  }
}

export const prefs: Prefs = load();

export function savePrefs() {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // preferences just won't persist
  }
}

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // just won't persist
  }
}
