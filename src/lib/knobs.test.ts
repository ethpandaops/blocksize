import { describe, expect, it } from 'vitest';
import consensusJson from '../../spec-data/consensus.json';
import { discoverKnobs } from './knobs';
import { typicalKnobValues } from './presets';
import type { ConsensusSpec } from './schema';

const spec = consensusJson as unknown as ConsensusSpec;

function knobMap(fork: string) {
  const knobs = discoverKnobs(spec, fork);
  return { knobs, byPath: new Map(knobs.map((k) => [k.path, k])) };
}

describe('knob discovery', () => {
  it('electra body lists carry their SSZ limits', () => {
    const { byPath } = knobMap('electra');
    expect(byPath.get('message.body.attestations')?.max).toBe(8);
    expect(byPath.get('message.body.proposer_slashings')?.max).toBe(16);
    expect(byPath.get('message.body.execution_requests.deposits')?.max).toBe(8192);
  });

  it('gloas progressive lists resolve processing-limit constants', () => {
    const { byPath } = knobMap('gloas');
    expect(byPath.get('message.body.attestations')?.max).toBe(8); // MAX_ATTESTATIONS_ELECTRA
    expect(byPath.get('message.body.payload_attestations')?.max).toBe(4);
    const requests = 'message.body.parent_execution_requests';
    expect(byPath.get(`${requests}.deposits`)?.max).toBe(8192);
    expect(byPath.get(`${requests}.withdrawals`)?.max).toBe(16);
    expect(byPath.get(`${requests}.consolidations`)?.max).toBe(2);
    expect(byPath.get(`${requests}.builder_deposits`)?.max).toBe(64);
    expect(byPath.get(`${requests}.builder_exits`)?.max).toBe(16);
  });

  it('blob commitment knobs are capped by the blob schedule', () => {
    const { byPath } = knobMap('fulu');
    const max = byPath.get('message.body.blob_kzg_commitments')?.max ?? 0;
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(128); // schedule cap, not the 4096 SSZ limit
  });

  it('typical preset fills payload withdrawals but not withdrawal requests', () => {
    const { knobs } = knobMap('electra');
    const values = typicalKnobValues(spec, 'electra', knobs);
    expect(values['message.body.execution_payload.withdrawals']).toBe(16);
    expect(values['message.body.execution_requests.withdrawals']).toBe(0);
  });
});
