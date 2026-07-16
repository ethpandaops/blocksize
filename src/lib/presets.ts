/**
 * Fork status and starting values — all derived from the extracted spec
 * data (fork epochs, blob schedule, list limits), never hardcoded per fork.
 */

import type { Knob } from './knobs';
import type { ConsensusSpec, JsonInt } from './schema';
import { FAR_FUTURE_EPOCH, maxBlobsPerBlock, toBigInt } from './schema';

const MAINNET_GENESIS_TIME = 1606824023;
const SECONDS_PER_EPOCH = 384;

export type ForkStatus = 'live' | 'scheduled' | 'development' | 'feature';

export function forkStatus(spec: ConsensusSpec, fork: string, now = Date.now()): ForkStatus {
  if (fork.startsWith('eip')) return 'feature';
  const epochRaw = spec.config[`${fork.toUpperCase()}_FORK_EPOCH`] as JsonInt | undefined;
  const epoch = toBigInt(epochRaw ?? null);
  if (epoch === null || epoch >= FAR_FUTURE_EPOCH) return 'development';
  const currentEpoch = Math.floor((now / 1000 - MAINNET_GENESIS_TIME) / SECONDS_PER_EPOCH);
  return Number(epoch) <= currentEpoch ? 'live' : 'scheduled';
}

/** The newest fork that is live on mainnet — the app's landing fork. */
export function currentMainnetFork(spec: ConsensusSpec): string {
  let current = spec.forkOrder[0];
  for (const fork of spec.forkOrder) {
    if (forkStatus(spec, fork) === 'live') current = fork;
  }
  return current;
}

export interface PresetDefaults {
  activeValidators: number;
  gasLimit: number;
}

export const DEFAULTS: PresetDefaults = {
  activeValidators: 1_100_000,
  gasLimit: 60_000_000,
};

/** Typical-mainnet starting counts: full attestations and withdrawals, blobs at the schedule cap, exceptional operations at zero. */
export function typicalKnobValues(
  spec: ConsensusSpec,
  fork: string,
  knobs: Knob[],
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const knob of knobs) {
    switch (knob.name) {
      case 'attestations':
      case 'payload_attestations':
        values[knob.path] = knob.max;
        break;
      case 'withdrawals':
        // Payload withdrawals run full every block; EL-triggered
        // withdrawal *requests* (execution_requests group) do not.
        values[knob.path] = knob.group === 'execution_payload' ? knob.max : 0;
        break;
      case 'blob_kzg_commitments':
        values[knob.path] = Math.min(knob.max, maxBlobsPerBlock(spec, fork));
        break;
      default:
        values[knob.path] = 0;
    }
  }
  return values;
}

/** Everything at its cap (blobs still bounded by the blob schedule). */
export function worstCaseKnobValues(
  spec: ConsensusSpec,
  fork: string,
  knobs: Knob[],
): Record<string, number> {
  const values: Record<string, number> = {};
  for (const knob of knobs) {
    values[knob.path] =
      knob.name === 'blob_kzg_commitments'
        ? Math.min(knob.max, maxBlobsPerBlock(spec, fork))
        : knob.max;
  }
  return values;
}
