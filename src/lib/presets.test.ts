import { describe, expect, it } from 'vitest';
import consensusJson from '../../spec-data/consensus.json';
import { forkStatus, landingFork } from './presets';
import type { ConsensusSpec } from './schema';

const spec = consensusJson as unknown as ConsensusSpec;

describe('fork status and landing fork', () => {
  it('genesis and scheduled-past forks are live', () => {
    expect(forkStatus(spec, 'phase0')).toBe('live');
    expect(forkStatus(spec, 'electra')).toBe('live');
    expect(forkStatus(spec, 'fulu')).toBe('live');
  });

  it('unscheduled forks are in development, eip forks are features', () => {
    expect(forkStatus(spec, 'gloas')).toBe('development');
    expect(forkStatus(spec, 'heze')).toBe('development');
    expect(forkStatus(spec, 'eip8025')).toBe('feature');
  });

  it('the app lands on the next upcoming fork', () => {
    expect(landingFork(spec)).toBe('gloas');
  });
});
