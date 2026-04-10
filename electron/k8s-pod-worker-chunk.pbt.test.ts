/**
 * Property-based tests for chunk pagination logic.
 * Uses fast-check to validate that slicing a pod cache with arbitrary
 * offset/limit pairs always returns the correct chunk length.
 *
 * **Validates: Requirement 5.3**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { LightweightPod } from '../src/types/pod-worker';

// --- Helpers ---

function makePod(uid: string): LightweightPod {
  return {
    uid,
    name: `pod-${uid}`,
    namespace: 'default',
    status: 'Running',
    restarts: 0,
    age: new Date().toISOString(),
    node: 'node-1',
    containers: [],
  };
}

/**
 * Replicates the chunk pagination logic from k8s-pod-worker.ts:
 *   const allPods = Array.from(podCache.values());
 *   const chunk = allPods.slice(offset, offset + limit);
 */
function getChunk(podCache: Map<string, LightweightPod>, offset: number, limit: number): LightweightPod[] {
  const allPods = Array.from(podCache.values());
  return allPods.slice(offset, offset + limit);
}

// --- Property 5: Chunk Pagination ---
// **Validates: Requirement 5.3**

describe('Property 5: Chunk Pagination', () => {
  it('chunk length equals min(limit, max(0, N - offset)) for any cache size and offset/limit', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 10000 }),
        fc.nat({ max: 10100 }),
        fc.integer({ min: 1, max: 5000 }),
        (cacheSize, offset, limit) => {
          // Build a Map with cacheSize entries
          const podCache = new Map<string, LightweightPod>();
          for (let i = 0; i < cacheSize; i++) {
            const uid = `uid-${i}`;
            podCache.set(uid, makePod(uid));
          }

          const chunk = getChunk(podCache, offset, limit);
          const expectedLength = Math.min(limit, Math.max(0, cacheSize - offset));

          expect(chunk).toHaveLength(expectedLength);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('chunk contains the correct pods from the cache in order', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 500 }),
        fc.nat({ max: 600 }),
        fc.integer({ min: 1, max: 500 }),
        (cacheSize, offset, limit) => {
          const podCache = new Map<string, LightweightPod>();
          for (let i = 0; i < cacheSize; i++) {
            const uid = `uid-${i}`;
            podCache.set(uid, makePod(uid));
          }

          const allPods = Array.from(podCache.values());
          const chunk = getChunk(podCache, offset, limit);

          // Each pod in the chunk should match the corresponding pod in the full array
          for (let i = 0; i < chunk.length; i++) {
            expect(chunk[i].uid).toBe(allPods[offset + i].uid);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('offset beyond cache size returns empty chunk', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        (cacheSize, limit) => {
          const podCache = new Map<string, LightweightPod>();
          for (let i = 0; i < cacheSize; i++) {
            const uid = `uid-${i}`;
            podCache.set(uid, makePod(uid));
          }

          // Offset is at least cacheSize, so chunk should be empty
          const offset = cacheSize + Math.floor(Math.random() * 100);
          const chunk = getChunk(podCache, offset, limit);

          expect(chunk).toHaveLength(0);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('offset 0 with limit >= N returns all pods', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 5000 }),
        (cacheSize) => {
          const podCache = new Map<string, LightweightPod>();
          for (let i = 0; i < cacheSize; i++) {
            const uid = `uid-${i}`;
            podCache.set(uid, makePod(uid));
          }

          const chunk = getChunk(podCache, 0, cacheSize + 1000);

          expect(chunk).toHaveLength(cacheSize);
        },
      ),
      { numRuns: 300 },
    );
  });
});
