/**
 * The constants-coverage ratchet. The EIP-7934 block size cap sat in the
 * extracted data while the model ignored it — this test makes that class
 * of miss impossible to repeat silently. Every size-relevant constant in
 * the extracted spec data must carry an explicit disposition; when a
 * spec update introduces a new one, this test fails and names it,
 * forcing a decision: wire it into the model, or disposition it with a
 * reason.
 *
 * Dispositions:
 *  - modeled:     participates in the size math or knob caps
 *  - structural:  already expressed through SSZ schema limits/lengths,
 *                 which the engine reads directly
 *  - state:       bounds beacon state, not per-slot wire objects
 *  - display:     shown in the UI as context; does not bound the model
 *  - unmodeled:   consciously not modeled — the reason is documented here
 *  - unrelated:   name matches the pattern but is not about sizes
 */

import { describe, expect, it } from 'vitest';
import consensusJson from '../../spec-data/consensus.json';
import elJson from '../../spec-data/el.json';
import type { ConsensusSpec, ElSpec } from './schema';

const SIZE_PATTERN = /SIZE|BYTES|_LIMIT$|PER_BLOCK$|PER_PAYLOAD$|MARGIN|CHUNK/;

const DISPOSITIONS: Record<string, string> = {
  // consensus
  'CL:BYTES_PER_BLOB': 'structural',
  'CL:BYTES_PER_CELL': 'structural',
  'CL:BYTES_PER_COMMITMENT': 'structural',
  'CL:BYTES_PER_FIELD_ELEMENT': 'structural',
  'CL:BYTES_PER_LOGS_BLOOM': 'structural',
  'CL:BYTES_PER_PROOF': 'structural',
  'CL:HISTORICAL_ROOTS_LIMIT': 'state',
  'CL:INCLUSION_LIST_COMMITTEE_SIZE': 'modeled', // FOCIL wire objects per slot
  'CL:MAX_ATTESTER_SLASHING_SIZE': 'unmodeled', // gossip cap for a non-block topic
  'CL:MAX_BLOB_COMMITMENTS_PER_BLOCK': 'structural',
  'CL:MAX_BUILDER_DEPOSIT_REQUESTS_PER_PAYLOAD': 'modeled', // knob cap
  'CL:MAX_BUILDER_EXIT_REQUESTS_PER_PAYLOAD': 'modeled', // knob cap
  'CL:MAX_BYTES_PER_TRANSACTION': 'structural',
  'CL:MAX_CONSOLIDATION_REQUESTS_PER_PAYLOAD': 'modeled', // knob cap
  'CL:MAX_DATA_COLUMN_SIDECAR_SIZE': 'modeled', // sidecar cap check
  'CL:MAX_DEPOSIT_REQUESTS_PER_PAYLOAD': 'modeled', // knob cap
  'CL:MAX_EXECUTION_PROOFS_PER_PAYLOAD': 'unmodeled', // eip8025 feature-fork objects
  'CL:MAX_EXTRA_DATA_BYTES': 'structural',
  'CL:MAX_PARTIAL_DATA_COLUMN_SIDECAR_SIZE': 'unmodeled', // eip8045 partial columns
  'CL:MAX_PROOF_SIZE': 'unmodeled', // eip8025 execution proofs
  'CL:MAX_SET_SWEEP_THRESHOLD_REQUESTS_PER_PAYLOAD': 'modeled', // knob cap (eip8148)
  'CL:MAX_SIGNED_AGGREGATE_AND_PROOF_SIZE': 'unmodeled', // gossip cap, non-block topic
  'CL:MAX_SIGNED_EXECUTION_PAYLOAD_BID_SIZE': 'unmodeled', // bid gossip cap; bid is in the block
  'CL:MAX_SIGNED_EXECUTION_PAYLOAD_BID_SIZE_HEZE': 'unmodeled',
  'CL:MAX_SIGNED_EXECUTION_PROOF_SIZE': 'unmodeled', // eip8025
  'CL:MAX_SIGNED_INCLUSION_LIST_SIZE': 'modeled', // FOCIL per-message cap
  'CL:MAX_TRANSACTIONS_PER_PAYLOAD': 'modeled', // payload plan cap
  'CL:MAX_WITHDRAWALS_PER_PAYLOAD': 'modeled', // knob/envelope cap
  'CL:MAX_WITHDRAWAL_REQUESTS_PER_PAYLOAD': 'modeled', // knob cap
  'CL:PENDING_CONSOLIDATIONS_LIMIT': 'state',
  'CL:PENDING_DEPOSITS_LIMIT': 'state',
  'CL:PENDING_PARTIAL_WITHDRAWALS_LIMIT': 'state',
  'CL:PTC_SIZE': 'structural', // payload attestation bitvector length
  'CL:SYNC_COMMITTEE_SIZE': 'structural',
  'CL:TARGET_COMMITTEE_SIZE': 'unrelated', // committee balancing, not bytes
  'CL:VALIDATOR_REGISTRY_LIMIT': 'state',
  // execution
  'EL:AUTH_TUPLE_BYTES': 'unmodeled', // 7702 auth tuples inside BAL accounting
  'EL:BLOB_COUNT_LIMIT': 'unmodeled', // per-transaction blob cap; block cap comes from the CL schedule
  'EL:BLOB_TARGET_GAS_PER_BLOCK': 'display',
  'EL:MAX_BLOB_GAS_PER_BLOCK': 'display', // block blob cap surfaces via CL schedule
  'EL:MAX_BLOCK_SIZE': 'modeled', // EIP-7934, via MAX_RLP_BLOCK_SIZE
  'EL:MAX_RLP_BLOCK_SIZE': 'modeled', // EIP-7934 payload byte clamp
  'EL:OPCODE_CALLDATASIZE': 'unrelated',
  'EL:OPCODE_CODESIZE': 'unrelated',
  'EL:OPCODE_MSIZE': 'unrelated',
  'EL:OPCODE_RETURNDATASIZE': 'unrelated',
  'EL:SAFETY_MARGIN': 'modeled', // folded into MAX_RLP_BLOCK_SIZE
  'EL:STATE_BYTES_PER_AUTH_BASE': 'unmodeled', // finer BAL accounting than the estimate
  'EL:STATE_BYTES_PER_NEW_ACCOUNT': 'modeled', // per-tx BAL estimate
  'EL:STATE_BYTES_PER_STORAGE_SET': 'modeled', // BAL worst case per entry
  'EL:TX_MAX_GAS_LIMIT': 'modeled', // EIP-7825 per-tx cap
};

describe('size-relevant constants are dispositioned', () => {
  it('every extracted size-ish constant has an explicit disposition', () => {
    const spec = consensusJson as unknown as ConsensusSpec;
    const elSpec = elJson as unknown as ElSpec;
    const found = new Set<string>();
    for (const fork of Object.values(spec.forks)) {
      for (const [name, value] of Object.entries(fork.constants)) {
        if (typeof value !== 'boolean' && SIZE_PATTERN.test(name)) found.add(`CL:${name}`);
      }
    }
    for (const fork of elSpec.forks) {
      for (const name of Object.keys(fork.constants)) {
        if (SIZE_PATTERN.test(name)) found.add(`EL:${name}`);
      }
    }
    const missing = [...found].filter((name) => DISPOSITIONS[name] === undefined).sort();
    expect(
      missing,
      `new size-relevant constants need a disposition (wire into the model or document why not): ${missing.join(', ')}`,
    ).toEqual([]);
    // The scan itself must keep finding things, or the pattern broke.
    expect(found.size).toBeGreaterThan(40);
  });
});
