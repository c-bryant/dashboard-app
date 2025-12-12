import { describe, it, expect } from 'vitest';
import { computeHelloTargets, computeWorldTargets } from './InkBlobsCanvas';

describe('InkBlobs target generation', () => {
  it('generates non-empty HELLO targets for reasonable sizes', () => {
    const targets = computeHelloTargets(800, 600);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('generates non-empty WORLD targets for reasonable sizes', () => {
    const targets = computeWorldTargets(800, 600);
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeGreaterThanOrEqual(0);
    }
  });
});
