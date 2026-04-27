/**
 * Pure helpers for the tiered (equal-ranking) ballot model used by
 * RankableOptions. Kept dependency-free so they can be unit-tested without
 * mounting React.
 */

/**
 * Canonical key for a pair of item ids, order-independent. Used so that
 * linked-pair membership survives when a linked-group is reordered end-to-end.
 */
export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Compute tier boundaries from a flat list + set of linked pairs.
 * Returns an array of tiers, where each tier is a list of indices into the
 * main list that belong to that tier.
 */
export function computeTierIndices(
  list: readonly { id: string }[],
  linkedPairs: ReadonlySet<string>,
): number[][] {
  if (list.length === 0) return [];
  const tiers: number[][] = [[0]];
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1];
    const curr = list[i];
    if (linkedPairs.has(pairKey(prev.id, curr.id))) {
      tiers[tiers.length - 1].push(i);
    } else {
      tiers.push([i]);
    }
  }
  return tiers;
}

/** Convert tier index ranges into the `[["A"], ["B","C"], ...]` shape. */
export function tiersFromList(
  list: readonly { id: string; text: string }[],
  linkedPairs: ReadonlySet<string>,
): string[][] {
  return computeTierIndices(list, linkedPairs).map(tier =>
    tier.map(i => list[i].text),
  );
}

/**
 * Pure, testable drop-target computation for main-list drags. Given the
 * dragged tier's visual center (from cursor + grab offset) and the list
 * layout, returns the original-list index where the tier should land.
 *
 * Algorithm: for every valid insertion point (between non-dragged units
 * or at the edges), compute where the tier's center would be in the
 * resulting layout. Return the insertion point whose layout center is
 * closest to the tier's actual visual center. This naturally gives
 * symmetric thresholds (midpoint between two adjacent layout centers)
 * and treats linked groups as atomic.
 */
export function computeDropTarget(
  itemIds: readonly string[],
  linkedPairs: ReadonlySet<string>,
  tierStart: number,
  tierSize: number,
  tierVisualCenter: number,
  itemHeight: number,
  groupedGapSize: number,
  totalItemHeight: number,
): number {
  const tEnd = tierStart + tierSize - 1;
  const tierH = tierSize > 1
    ? tierSize * itemHeight + (tierSize - 1) * groupedGapSize
    : itemHeight;

  // Build non-dragged unit groups
  const allTiers = computeTierIndices(
    itemIds.map(id => ({ id })),
    linkedPairs,
  );

  // Collect valid target indices (boundaries between non-dragged units)
  const validTargets: number[] = [];
  for (const tier of allTiers) {
    const first = tier[0];
    const last = tier[tier.length - 1];
    if (first >= tierStart && last <= tEnd) continue; // skip dragged tier
    validTargets.push(first); // insert-before-this-unit position
  }
  // After the last non-dragged unit
  const lastNonDragged = allTiers.filter(
    t => !(t[0] >= tierStart && t[t.length - 1] <= tEnd),
  );
  if (lastNonDragged.length > 0) {
    const last = lastNonDragged[lastNonDragged.length - 1];
    validTargets.push(last[last.length - 1] + 1);
  }

  if (validTargets.length === 0) return tierStart;

  // For each valid target, compute the tier's "natural center" in the
  // resulting layout. Each item takes one totalItemHeight slot. The tier
  // occupies tierSize slots starting at "slot = number of non-dragged
  // items before the insertion point".
  let bestTarget = validTargets[0];
  let bestDist = Infinity;

  for (const target of validTargets) {
    // Count non-dragged items whose original index < target
    let itemsBefore = 0;
    for (let i = 0; i < itemIds.length; i++) {
      if (i >= tierStart && i <= tEnd) continue;
      if (i < target) itemsBefore++;
    }
    const tierNaturalCenter = itemsBefore * totalItemHeight + tierH / 2;
    const dist = Math.abs(tierVisualCenter - tierNaturalCenter);
    if (dist < bestDist) {
      bestDist = dist;
      bestTarget = target;
    }
  }

  return bestTarget;
}

/**
 * Return `[tierStart, tierSize]` for the tier containing `index` in the
 * given list + links. A tier is a maximal run of consecutive items connected
 * by linked pairs. An untied item returns `[index, 1]`.
 */
export function getTierRange(
  list: readonly { id: string }[],
  linkedPairs: ReadonlySet<string>,
  index: number,
): [number, number] {
  if (index < 0 || index >= list.length) return [index, 1];
  // Walk backward while the previous pair is linked
  let start = index;
  while (start > 0 && linkedPairs.has(pairKey(list[start - 1].id, list[start].id))) {
    start--;
  }
  // Walk forward while the next pair is linked
  let end = index;
  while (end < list.length - 1 && linkedPairs.has(pairKey(list[end].id, list[end + 1].id))) {
    end++;
  }
  return [start, end - start + 1];
}

/**
 * Compute standard-competition ranks for a tiered ballot (1, 2, 2, 4).
 * Returns one integer per tier: the display rank for that tier.
 */
export function tierRanks(tiers: readonly (readonly unknown[])[]): number[] {
  const ranks: number[] = [];
  let pos = 0;
  for (const tier of tiers) {
    ranks.push(pos + 1);
    pos += tier.length;
  }
  return ranks;
}
