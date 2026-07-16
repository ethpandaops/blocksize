/**
 * Verifies the TS size engine against ground truth: the extractor dumps
 * remerkleable's own min/max byte lengths for every container in every
 * fork, and the engine must reproduce all of them exactly.
 */

import { describe, expect, it } from 'vitest';
import consensusJson from '../../spec-data/consensus.json';
import type { ConsensusSpec } from './schema';
import { toBigInt } from './schema';
import { maxSize, minSize } from './ssz';

const spec = consensusJson as unknown as ConsensusSpec;

describe('size engine matches remerkleable ground truth', () => {
  for (const fork of spec.forkOrder) {
    const { containers } = spec.forks[fork];
    it(`${fork}: all ${Object.keys(containers).length} containers`, () => {
      for (const [name, container] of Object.entries(containers)) {
        expect(
          minSize(container, containers),
          `${fork}.${name} minSize`,
        ).toBe(toBigInt(container.minSize));
        expect(
          maxSize(container, containers),
          `${fork}.${name} maxSize`,
        ).toBe(toBigInt(container.maxSize));
      }
    });
  }
});
