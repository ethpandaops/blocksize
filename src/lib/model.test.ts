import { describe, expect, it } from 'vitest';
import consensusJson from '../../spec-data/consensus.json';
import elJson from '../../spec-data/el.json';
import { computeBlockSize, type UserState } from './model';
import type { ConsensusSpec, ElSpec } from './schema';

const spec = consensusJson as unknown as ConsensusSpec;
const elSpec = elJson as unknown as ElSpec;

function stateFor(fork: string, overrides: Partial<UserState> = {}): UserState {
  return {
    fork,
    activeValidators: 1_100_000,
    gasLimit: 36_000_000,
    scenario: 'mixed',
    knobValues: {},
    ...overrides,
  };
}

describe('computeBlockSize', () => {
  it('runs for every fork without error', () => {
    for (const fork of spec.forkOrder) {
      const result = computeBlockSize(spec, elSpec, stateFor(fork));
      expect(result.sszBytes, fork).toBeGreaterThan(0n);
      expect(BigInt(result.gossipBytes), fork).toBeLessThanOrEqual(
        BigInt(result.snappyCeiling),
      );
    }
  });

  it('electra empty-block size is in the expected range', () => {
    const result = computeBlockSize(spec, elSpec, stateFor('electra', { gasLimit: 0 }));
    // Empty body + header + signature: spec minimum is ~1.2KB.
    expect(result.sszBytes).toBeGreaterThan(1000n);
    expect(result.sszBytes).toBeLessThan(5000n);
  });

  it('gas limit drives execution payload size at spec-derived rates', () => {
    const zeros = computeBlockSize(spec, elSpec, stateFor('electra', { scenario: 'zeros' }));
    // Post-EIP-7623 all-zero calldata floor: 36M gas / 10 gas per token
    // ≈ 3.6MB of calldata (matching the old tool's 2.86 MiB per 30M gas).
    const payloadBytes = zeros.payloadPlan!.totalCalldataBytes;
    expect(payloadBytes).toBeGreaterThan(3_400_000);
    expect(payloadBytes).toBeLessThan(3_600_000);
  });

  it('compression is measured, not estimated: zeros crush, random does not', () => {
    const zeros = computeBlockSize(spec, elSpec, stateFor('electra', { scenario: 'zeros' }));
    const random = computeBlockSize(spec, elSpec, stateFor('electra', { scenario: 'random' }));
    // Cheaper zero bytes buy more raw payload per gas (10 vs 40 gas/byte)...
    expect(zeros.sszBytes).toBeGreaterThan(random.sszBytes * 3n);
    // ...but Snappy erases nearly all of it on the wire, while random
    // calldata stays essentially incompressible.
    expect(zeros.gossipBytes).toBeLessThan(Number(zeros.sszBytes) / 10);
    expect(random.gossipBytes).toBeGreaterThan(Number(random.sszBytes) * 0.95);
  });

  it('attestations scale with validator count', () => {
    const knobValues = { 'message.body.attestations': 8 };
    const small = computeBlockSize(
      spec,
      elSpec,
      stateFor('electra', { activeValidators: 500_000, gasLimit: 0, knobValues }),
    );
    const large = computeBlockSize(
      spec,
      elSpec,
      stateFor('electra', { activeValidators: 2_000_000, gasLimit: 0, knobValues }),
    );
    expect(large.sszBytes).toBeGreaterThan(small.sszBytes);
  });

  it('fulu reports DAS column sidecars, deneb reports blob sidecars', () => {
    const knobValues = { 'message.body.blob_kzg_commitments': 6 };
    const fulu = computeBlockSize(spec, elSpec, stateFor('fulu', { knobValues }));
    const deneb = computeBlockSize(spec, elSpec, stateFor('deneb', { knobValues }));
    expect(fulu.sidecars[0]?.container).toBe('DataColumnSidecar');
    expect(deneb.sidecars[0]?.container).toBe('BlobSidecar');
    // A blob sidecar carries the 128KiB blob plus header and proof.
    expect(deneb.sidecars[0].bytesEach).toBeGreaterThan(131_072n);
    expect(deneb.sidecars[0].bytesEach).toBeLessThan(133_000n);
  });

  it('gloas body has no execution payload (ePBS)', () => {
    const result = computeBlockSize(spec, elSpec, stateFor('gloas'));
    expect(result.elModel).toBeNull();
    expect(result.payloadPlan).toBeNull();
  });
});
