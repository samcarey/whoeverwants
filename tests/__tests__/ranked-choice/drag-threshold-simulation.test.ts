import { describe, it, expect } from 'vitest';
import {
  pairKey,
  computeDropTarget,
} from '@/components/RankableOptions';

// --- Test helpers ---

/** Build an item ID list: ['a', 'b', 'c', ...] */
const ids = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i));

/** Build linked pairs for consecutive indices forming a group */
function linkGroup(itemIds: string[], start: number, size: number): Set<string> {
  const pairs = new Set<string>();
  for (let i = start; i < start + size - 1; i++) {
    pairs.add(pairKey(itemIds[i], itemIds[i + 1]));
  }
  return pairs;
}

/** Merge multiple pair sets */
function mergeLinks(...sets: Set<string>[]): Set<string> {
  const merged = new Set<string>();
  for (const s of sets) for (const v of s) merged.add(v);
  return merged;
}

// --- Layout constants (match RankableOptions defaults for non-location items) ---
const ITEM_HEIGHT = 56;
const GAP = 8;
const TOTAL = ITEM_HEIGHT + GAP; // 64
const GROUPED_GAP = 0;

/** Tier visual height */
function tierH(size: number): number {
  return size > 1 ? size * ITEM_HEIGHT + (size - 1) * GROUPED_GAP : ITEM_HEIGHT;
}

/**
 * Simulate a drag: for a tier starting at `tierStart` of `tierSize`, with
 * the cursor grabbed at the tier's center, sweep the cursor from startY to
 * endY and return the cursorY at which the target first differs from the
 * initial no-op target. Returns null if no change occurs.
 */
function findTriggerY(
  itemIds: string[],
  linked: Set<string>,
  tierStart: number,
  tierSize: number,
  startY: number,
  endY: number,
  step: number = 1,
): number | null {
  const initial = computeDropTarget(
    itemIds, linked, tierStart, tierSize, startY,
    ITEM_HEIGHT, GROUPED_GAP, TOTAL,
  );
  const dir = endY > startY ? 1 : -1;
  for (let y = startY + dir * step; dir > 0 ? y <= endY : y >= endY; y += dir * step) {
    const target = computeDropTarget(
      itemIds, linked, tierStart, tierSize, y,
      ITEM_HEIGHT, GROUPED_GAP, TOTAL,
    );
    if (target !== initial) return y;
  }
  return null;
}

/** Natural center of a tier at its current position */
function naturalCenter(tierStart: number, tierSize: number): number {
  return tierStart * TOTAL + tierH(tierSize) / 2;
}

// ============================================================
// Tests
// ============================================================

describe('computeDropTarget', () => {
  describe('no-op at rest', () => {
    it('singleton returns its own position when at natural center', () => {
      // [A, B, C]
      const items = ids(3);
      const center = naturalCenter(1, 1); // B at index 1
      const target = computeDropTarget(items, new Set(), 1, 1, center, ITEM_HEIGHT, GROUPED_GAP, TOTAL);
      // Target should map back to B's current position (no-op)
      // B is at index 1. Target could be 1 or 2 (both no-op due to finishDrag)
      expect(target === 1 || target === 2).toBe(true);
    });

    it('group-of-2 returns its own position at natural center', () => {
      // [A-B(group), C]
      const items = ids(3);
      const linked = linkGroup(items, 0, 2);
      const center = naturalCenter(0, 2); // group at [0,1]
      const target = computeDropTarget(items, linked, 0, 2, center, ITEM_HEIGHT, GROUPED_GAP, TOTAL);
      // Should be a no-op (target maps to current position)
      expect(target <= 2).toBe(true); // 0, 1, or 2 are all in the no-op zone
    });
  });

  describe('singleton past singleton: symmetry', () => {
    it('equal trigger distance for A-down and B-up in [A, B]', () => {
      const items = ids(2);
      const centerA = naturalCenter(0, 1); // 28
      const centerB = naturalCenter(1, 1); // 92

      // A dragging down
      const triggerDown = findTriggerY(items, new Set(), 0, 1, centerA, centerB + 50);
      // B dragging up
      const triggerUp = findTriggerY(items, new Set(), 1, 1, centerB, centerA - 50);

      expect(triggerDown).not.toBeNull();
      expect(triggerUp).not.toBeNull();

      // Trigger distances should be equal (±1px for rounding)
      const distDown = triggerDown! - centerA;
      const distUp = centerB - triggerUp!;
      expect(Math.abs(distDown - distUp)).toBeLessThanOrEqual(1);
    });

    it('trigger distance is roughly half a slot height', () => {
      const items = ids(2);
      const centerA = naturalCenter(0, 1);
      const triggerDown = findTriggerY(items, new Set(), 0, 1, centerA, 300);
      expect(triggerDown).not.toBeNull();
      const dist = triggerDown! - centerA;
      // Should be approximately TOTAL/2 = 32
      expect(dist).toBeGreaterThanOrEqual(30);
      expect(dist).toBeLessThanOrEqual(34);
    });
  });

  describe('singleton past group-of-2: symmetry', () => {
    it('[A, B-C]: A down past group vs [B-C, D]: D up past group', () => {
      // Case 1: A(singleton) above B-C(group), drag A down
      const items1 = ids(3); // a, b, c
      const linked1 = linkGroup(items1, 1, 2); // b-c linked
      const centerA = naturalCenter(0, 1);
      const triggerDown = findTriggerY(items1, linked1, 0, 1, centerA, 400);

      // Case 2: B-C(group) above D(singleton), drag D up
      const items2 = ids(3); // a, b, c where a-b linked, c is singleton
      const linked2 = linkGroup(items2, 0, 2);
      const centerD = naturalCenter(2, 1);
      const triggerUp = findTriggerY(items2, linked2, 2, 1, centerD, -100);

      expect(triggerDown).not.toBeNull();
      expect(triggerUp).not.toBeNull();

      const distDown = triggerDown! - centerA;
      const distUp = centerD - triggerUp!;
      expect(Math.abs(distDown - distUp)).toBeLessThanOrEqual(1);
    });
  });

  describe('group-of-2 past singleton: symmetry', () => {
    it('[A-B, C]: group down past C vs [C, A-B]: group up past C', () => {
      // Case 1: A-B(group) above C(singleton), drag group down
      const items1 = ids(3);
      const linked1 = linkGroup(items1, 0, 2);
      const center1 = naturalCenter(0, 2);
      const triggerDown = findTriggerY(items1, linked1, 0, 2, center1, 400);

      // Case 2: C(singleton) above A-B(group), drag group up
      const items2 = ids(3);
      const linked2 = linkGroup(items2, 1, 2);
      const center2 = naturalCenter(1, 2);
      const triggerUp = findTriggerY(items2, linked2, 1, 2, center2, -100);

      expect(triggerDown).not.toBeNull();
      expect(triggerUp).not.toBeNull();

      const distDown = triggerDown! - center1;
      const distUp = center2 - triggerUp!;
      expect(Math.abs(distDown - distUp)).toBeLessThanOrEqual(1);
    });
  });

  describe('group-of-2 past group-of-2: symmetry', () => {
    it('[A-B, C-D]: first group down vs second group up', () => {
      const items = ids(4);
      const linked = mergeLinks(linkGroup(items, 0, 2), linkGroup(items, 2, 2));

      const center1 = naturalCenter(0, 2);
      const triggerDown = findTriggerY(items, linked, 0, 2, center1, 400);

      const center2 = naturalCenter(2, 2);
      const triggerUp = findTriggerY(items, linked, 2, 2, center2, -100);

      expect(triggerDown).not.toBeNull();
      expect(triggerUp).not.toBeNull();

      const distDown = triggerDown! - center1;
      const distUp = center2 - triggerUp!;
      expect(Math.abs(distDown - distUp)).toBeLessThanOrEqual(1);
    });
  });

  describe('group-of-3 past singleton: symmetry', () => {
    it('[A-B-C, D]: group down vs [D, A-B-C]: group up', () => {
      const items1 = ids(4);
      const linked1 = linkGroup(items1, 0, 3);
      const center1 = naturalCenter(0, 3);
      const triggerDown = findTriggerY(items1, linked1, 0, 3, center1, 400);

      const items2 = ids(4);
      const linked2 = linkGroup(items2, 1, 3);
      const center2 = naturalCenter(1, 3);
      const triggerUp = findTriggerY(items2, linked2, 1, 3, center2, -100);

      expect(triggerDown).not.toBeNull();
      expect(triggerUp).not.toBeNull();

      const distDown = triggerDown! - center1;
      const distUp = center2 - triggerUp!;
      expect(Math.abs(distDown - distUp)).toBeLessThanOrEqual(1);
    });
  });

  describe('singleton past group-of-3: symmetry', () => {
    it('[A, B-C-D]: A down vs [B-C-D, E]: E up', () => {
      const items1 = ids(4);
      const linked1 = linkGroup(items1, 1, 3);
      const centerA = naturalCenter(0, 1);
      const triggerDown = findTriggerY(items1, linked1, 0, 1, centerA, 500);

      const items2 = ids(4);
      const linked2 = linkGroup(items2, 0, 3);
      const centerE = naturalCenter(3, 1);
      const triggerUp = findTriggerY(items2, linked2, 3, 1, centerE, -100);

      expect(triggerDown).not.toBeNull();
      expect(triggerUp).not.toBeNull();

      const distDown = triggerDown! - centerA;
      const distUp = centerE - triggerUp!;
      expect(Math.abs(distDown - distUp)).toBeLessThanOrEqual(1);
    });
  });

  describe('group-of-2 past group-of-3: symmetry', () => {
    it('[A-B, C-D-E]: group-2 down vs [C-D-E, A-B]: group-2 up', () => {
      const items1 = ids(5);
      const linked1 = mergeLinks(linkGroup(items1, 0, 2), linkGroup(items1, 2, 3));
      const center1 = naturalCenter(0, 2);
      const triggerDown = findTriggerY(items1, linked1, 0, 2, center1, 500);

      const items2 = ids(5);
      const linked2 = mergeLinks(linkGroup(items2, 0, 3), linkGroup(items2, 3, 2));
      const center2 = naturalCenter(3, 2);
      const triggerUp = findTriggerY(items2, linked2, 3, 2, center2, -100);

      expect(triggerDown).not.toBeNull();
      expect(triggerUp).not.toBeNull();

      const distDown = triggerDown! - center1;
      const distUp = center2 - triggerUp!;
      expect(Math.abs(distDown - distUp)).toBeLessThanOrEqual(1);
    });
  });

  describe('groups are atomic (no splitting)', () => {
    it('singleton cannot land inside a group-of-2', () => {
      // [A, B-C, D] — drag A to every possible Y, target should never be 2
      const items = ids(4);
      const linked = linkGroup(items, 1, 2);
      for (let y = -100; y <= 500; y += 5) {
        const target = computeDropTarget(items, linked, 0, 1, y, ITEM_HEIGHT, GROUPED_GAP, TOTAL);
        // Target should be 0 (before A), 1 (before B-C), 3 (after B-C), or 4 (after D)
        // Never 2 (inside B-C)
        expect(target).not.toBe(2);
      }
    });

    it('singleton cannot land inside a group-of-3', () => {
      // [A, B-C-D, E] — drag A
      const items = ids(5);
      const linked = linkGroup(items, 1, 3);
      for (let y = -100; y <= 600; y += 5) {
        const target = computeDropTarget(items, linked, 0, 1, y, ITEM_HEIGHT, GROUPED_GAP, TOTAL);
        expect(target).not.toBe(2);
        expect(target).not.toBe(3);
      }
    });
  });

  describe('overlap reduction: reorder only when beneficial', () => {
    it('does not trigger when dragged item has not moved enough', () => {
      // [A, B] — A barely moved down should stay as no-op
      const items = ids(2);
      const center = naturalCenter(0, 1); // 28
      // Move 10px (well under half a slot = 32)
      const target = computeDropTarget(items, new Set(), 0, 1, center + 10, ITEM_HEIGHT, GROUPED_GAP, TOTAL);
      // Should still map to current position
      const targetAtRest = computeDropTarget(items, new Set(), 0, 1, center, ITEM_HEIGHT, GROUPED_GAP, TOTAL);
      expect(target).toBe(targetAtRest);
    });

    it('does trigger when dragged item has moved past midpoint', () => {
      // [A, B] — A moved well past midpoint should reorder
      const items = ids(2);
      const center = naturalCenter(0, 1);
      const target = computeDropTarget(items, new Set(), 0, 1, center + 40, ITEM_HEIGHT, GROUPED_GAP, TOTAL);
      const targetAtRest = computeDropTarget(items, new Set(), 0, 1, center, ITEM_HEIGHT, GROUPED_GAP, TOTAL);
      expect(target).not.toBe(targetAtRest);
    });
  });

  describe('multi-item list: drag past multiple items', () => {
    it('[A, B, C, D, E]: A can reach every position', () => {
      const items = ids(5);
      const targets = new Set<number>();
      for (let y = -100; y <= 500; y += 1) {
        targets.add(computeDropTarget(items, new Set(), 0, 1, y, ITEM_HEIGHT, GROUPED_GAP, TOTAL));
      }
      // Should be able to reach positions 0 (no-op), 2, 3, 4, 5
      // (1 maps to same slot as 0 for the dragged item)
      expect(targets.size).toBeGreaterThanOrEqual(4);
    });
  });
});
