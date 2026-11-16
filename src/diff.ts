/**
 * Which blocks of `next` are new or changed compared with `prev`. Blocks are
 * compared as whole strings; the result lists indexes into `next`.
 *
 * Common leading and trailing blocks are matched first (the usual shape of an
 * edit), then a longest-common-subsequence pass handles the middle. A middle
 * too large to compare cheaply is reported as changed in full.
 */
export function changedBlocks(prev: string[], next: string[], maxCells = 4_000_000): number[] {
  let start = 0;
  while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  const a = prev.slice(start, endPrev);
  const b = next.slice(start, endNext);
  const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
  if (!b.length) return [];
  if (!a.length || a.length * b.length > maxCells) return range(start, endNext);

  // lcs[i][j] = length of the LCS of a[i..] and b[j..], stored row-major.
  const w = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * w + j] =
        a[i] === b[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const changed: number[] = [];
  let i = 0;
  let j = 0;
  while (j < b.length) {
    if (i < a.length && a[i] === b[j]) {
      i++;
      j++;
    } else if (i < a.length && lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) {
      i++;
    } else {
      changed.push(start + j);
      j++;
    }
  }
  return changed;
}
