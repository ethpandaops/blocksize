/**
 * The semantic layer: maps network conditions (validator count, gas
 * limit, calldata scenario) onto the generic SSZ engine's Assignment.
 *
 * Everything structural comes from the extracted schema; the rules here
 * only encode *physics* the schema cannot express — how full a bitfield
 * realistically gets, how many bytes of calldata a gas limit buys. Rules
 * match by field name so they apply to future forks automatically, and
 * every unmatched dimension falls back to its spec worst case.
 */

import type { PayloadPlan } from './el';
import { TX_ENVELOPE_BYTES } from './el';
import type { Knob } from './knobs';
import { toBigInt } from './schema';
import type { Assignment } from './ssz';

export interface NetworkParams {
  activeValidators: number;
  /** User-set counts for discovered knobs, keyed by knob path. */
  knobValues: Record<string, number>;
  /** Planned execution payload (null pre-merge / post-ePBS bodies). */
  payloadPlan: PayloadPlan | null;
}

export const SLOTS_PER_EPOCH = 32;
export const COMMITTEES_PER_SLOT = 64;

export function validatorsPerSlot(params: NetworkParams): number {
  return Math.floor(params.activeValidators / SLOTS_PER_EPOCH);
}

export function validatorsPerCommittee(params: NetworkParams): number {
  return Math.floor(validatorsPerSlot(params) / COMMITTEES_PER_SLOT);
}

/** Strip element indices so rules match structural paths: `a.[3].b` → `a.[].b`. */
export function normalizePath(path: string): string {
  return path.replace(/\[\d+\]/g, '[]');
}

function lastField(path: string): string {
  const segments = normalizePath(path).split('.');
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i] !== '[]') return segments[i];
  }
  return '';
}

function elementIndex(path: string): number {
  const match = path.match(/\[(\d+)\][^[]*$/);
  return match ? Number(match[1]) : 0;
}

/**
 * Validators covered by one attestation-shaped bitfield. Post-EIP-7549
 * bitlists span a whole slot (limit >= validators/slot), earlier ones a
 * single committee.
 */
function attestationBits(limit: bigint | null, params: NetworkParams): number {
  const slotWide = BigInt(validatorsPerSlot(params));
  if (limit === null || limit >= slotWide) return Number(slotWide);
  return Math.min(Number(limit), validatorsPerCommittee(params));
}

export function buildAssignment(knobs: Knob[], params: NetworkParams): Assignment {
  const knobByPath = new Map(knobs.map((k) => [k.path, k]));

  return {
    listCount(path, node) {
      const normalized = normalizePath(path);
      const knob = knobByPath.get(normalized);
      if (knob !== undefined) {
        return params.knobValues[normalized] ?? 0;
      }
      const field = lastField(normalized);
      if (field === 'transactions') {
        return params.payloadPlan?.txCount ?? 0;
      }
      // Indices lists inside attestations/slashings scale with attesters.
      if (field.endsWith('_indices') || field === 'attesting_indices') {
        return attestationBits(toBigInt(node.limit), params);
      }
      const limit = toBigInt(node.limit);
      return limit === null ? 0 : Number(limit);
    },

    bitlistBits(path, node) {
      const field = lastField(path);
      if (field === 'aggregation_bits' || field.endsWith('_bits')) {
        return attestationBits(toBigInt(node.limit), params);
      }
      const limit = toBigInt(node.limit);
      return limit === null ? 0 : Number(limit);
    },

    byteListBytes(path, node) {
      const normalized = normalizePath(path);
      const field = lastField(normalized);
      if (normalized.endsWith('transactions.[]')) {
        const plan = params.payloadPlan;
        if (plan === null) return 0;
        const index = elementIndex(path);
        return (plan.calldataPerTx[index] ?? 0) + TX_ENVELOPE_BYTES;
      }
      if (field === 'extra_data') {
        const limit = toBigInt(node.limit);
        return limit === null ? 32 : Number(limit);
      }
      const limit = toBigInt(node.limit);
      return limit === null ? 0 : Number(limit);
    },
  };
}
