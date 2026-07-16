import { describe, expect, it } from 'vitest';
import consensusJson from '../../spec-data/consensus.json';
import type { UserState } from './model';
import { DEFAULTS, landingFork, typicalKnobValues } from './presets';
import { discoverKnobs } from './knobs';
import type { ConsensusSpec } from './schema';
import { decodeState, encodeState } from './urlState';

const spec = consensusJson as unknown as ConsensusSpec;

describe('url state', () => {
  it('round-trips a customized configuration', () => {
    const knobs = discoverKnobs(spec, 'gloas');
    const knobValues = typicalKnobValues(spec, 'gloas', knobs);
    knobValues['message.body.attestations'] = 2;
    knobValues['message.body.parent_execution_requests.deposits'] = 100;
    const state: UserState = {
      fork: 'gloas',
      activeValidators: 2_000_000,
      gasLimit: 300_000_000,
      scenario: 'zeros',
      balBytes: 123_904,
      txCount: 42,
      calldataBytes: 1_000_000,
      knobValues,
    };
    const decoded = decodeState(spec, encodeState(spec, state), landingFork(spec));
    expect(decoded).toEqual(state);
  });

  it('defaults produce a bare fork param and decode to defaults', () => {
    const knobs = discoverKnobs(spec, 'fulu');
    const state: UserState = {
      fork: 'fulu',
      activeValidators: DEFAULTS.activeValidators,
      gasLimit: DEFAULTS.gasLimit,
      scenario: 'mixed',
      balBytes: null,
      txCount: null,
      calldataBytes: null,
      knobValues: typicalKnobValues(spec, 'fulu', knobs),
    };
    const encoded = encodeState(spec, state);
    expect(encoded).toBe('fork=fulu');
    expect(decodeState(spec, encoded, landingFork(spec))).toEqual(state);
  });

  it('rejects junk: unknown fork falls back, values clamp to knob caps', () => {
    const decoded = decodeState(spec, 'fork=doge&k.attestations=99999&v=-5', 'gloas');
    expect(decoded.fork).toBe('gloas');
    expect(decoded.knobValues['message.body.attestations']).toBe(8);
    expect(decoded.activeValidators).toBe(DEFAULTS.activeValidators);
  });
});
