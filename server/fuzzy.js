import { normalize, prefixesFor } from "./search.js";

export const MIN_FUZZY_LENGTH = 3;
export const MAX_FUZZY_LENGTH = 24;

// Symmetric deletion signatures retrieve likely candidates without scanning the catalog.
// Verification below removes collisions (sharing a deletion alone is not a match).
export function deletionKeys(value) {
  return [
    ...new Set([
      value,
      ...Array.from(
        { length: value.length },
        (_, i) => value.slice(0, i) + value.slice(i + 1),
      ),
    ]),
  ];
}
export function fuzzyKeysFor(label) {
  return [
    ...new Set(
      prefixesFor(label)
        .filter(
          (prefix) =>
            prefix.length >= MIN_FUZZY_LENGTH - 1 &&
            prefix.length <= MAX_FUZZY_LENGTH + 1,
        )
        .flatMap(deletionKeys),
    ),
  ];
}

// Exact bounded edit distance: insertion, deletion, substitution, or adjacent swap.
// UTF-16 code units, matching the prefix index; no locale-aware tokenization.
export function withinOneEdit(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
  if (a.length === b.length) {
    return (
      a.slice(i + 1) === b.slice(i + 1) ||
      (a[i] === b[i + 1] &&
        a[i + 1] === b[i] &&
        a.slice(i + 2) === b.slice(i + 2))
    );
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.slice(i) === long.slice(i + 1);
}
export function fuzzyMatch(label, query) {
  const normalized = normalize(label);
  for (const term of new Set([normalized, ...normalized.split(" ")])) {
    // Prefer the same-length prefix to explain swaps/substitutions intuitively.
    for (const length of [query.length, query.length - 1, query.length + 1]) {
      if (length < MIN_FUZZY_LENGTH - 1 || length > term.length) continue;
      const prefix = term.slice(0, length);
      if (withinOneEdit(prefix, query)) return prefix;
    }
  }
  return null;
}
