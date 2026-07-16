import { describe, expect, it } from 'vitest';
import consensusJson from '../../spec-data/consensus.json';
import { GAS_PER_DEPOSIT_REQUEST } from './el';
import { discoverKnobs } from './knobs';
import { typicalKnobValues } from './presets';
import type { ConsensusSpec } from './schema';

const spec = consensusJson as unknown as ConsensusSpec;
const GAS_60M = 60_000_000;

function knobMap(fork: string, gasLimit = GAS_60M) {
  const knobs = discoverKnobs(spec, fork, gasLimit);
  return { knobs, byPath: new Map(knobs.map((k) => [k.path, k])) };
}

describe('knob discovery', () => {
  it('electra body lists carry their SSZ limits', () => {
    const { byPath } = knobMap('electra');
    expect(byPath.get('message.body.attestations')?.max).toBe(8);
    expect(byPath.get('message.body.proposer_slashings')?.max).toBe(16);
  });

  it('gloas progressive lists resolve processing-limit constants', () => {
    const { byPath } = knobMap('gloas');
    expect(byPath.get('message.body.attestations')?.max).toBe(8); // MAX_ATTESTATIONS_ELECTRA
    expect(byPath.get('message.body.payload_attestations')?.max).toBe(4);
    const requests = 'message.body.parent_execution_requests';
    expect(byPath.get(`${requests}.withdrawals`)?.max).toBe(16);
    expect(byPath.get(`${requests}.consolidations`)?.max).toBe(2);
    expect(byPath.get(`${requests}.builder_deposits`)?.max).toBe(64);
    expect(byPath.get(`${requests}.builder_exits`)?.max).toBe(16);
  });

  it('deposit request caps follow the gas limit, not MAX_DEPOSIT_REQUESTS_PER_PAYLOAD', () => {
    // Gloas has no deposit list bound at all (progressive list, and
    // apply_parent_execution_payload asserts every request type's limit
    // except deposits); the dead 8,192 constant must not cap the knob.
    const path = 'message.body.parent_execution_requests.deposits';
    expect(knobMap('gloas', 300_000_000).byPath.get(path)?.max).toBe(
      Math.floor(300_000_000 / GAS_PER_DEPOSIT_REQUEST),
    );
    expect(knobMap('gloas', 300_000_000).byPath.get(path)?.max).toBeGreaterThan(8192);
    expect(knobMap('gloas', GAS_60M).byPath.get(path)?.max).toBe(
      Math.floor(GAS_60M / GAS_PER_DEPOSIT_REQUEST),
    );
  });

  it('electra deposit requests keep the SSZ bound where it binds before gas', () => {
    const path = 'message.body.execution_requests.deposits';
    // 60M gas pays for ~2.5k deposits, under the 8,192 SSZ limit...
    expect(knobMap('electra', GAS_60M).byPath.get(path)?.max).toBe(
      Math.floor(GAS_60M / GAS_PER_DEPOSIT_REQUEST),
    );
    // ...while at 300M gas the SSZ limit is the tighter cap.
    expect(knobMap('electra', 300_000_000).byPath.get(path)?.max).toBe(8192);
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
