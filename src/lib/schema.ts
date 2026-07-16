/**
 * Types mirroring the JSON emitted by extractor/extract.py.
 *
 * Integer values that can exceed 2^53 (list limits, container max sizes)
 * are serialized as strings by the extractor and normalized to bigint here.
 */

export type JsonInt = number | string;

export type SszNode =
  | { kind: 'uint'; size: number }
  | { kind: 'bool' }
  | { kind: 'byteVector'; length: number; alias?: string }
  | { kind: 'byteList'; limit: JsonInt | null; alias?: string }
  | { kind: 'bitvector'; length: number }
  | { kind: 'bitlist'; limit: JsonInt | null }
  | { kind: 'vector'; length: number; elem: SszNode }
  | { kind: 'list'; limit: JsonInt | null; elem: SszNode }
  | { kind: 'union'; options: (SszNode | null)[] }
  | { kind: 'ref'; name: string }
  | ContainerNode;

export interface ContainerNode {
  kind: 'container';
  progressive?: boolean;
  fields: [string, SszNode][];
  minSize: JsonInt;
  maxSize: JsonInt;
}

export interface ForkData {
  previous: string | null;
  eips?: number[];
  containers: Record<string, ContainerNode>;
  constants: Record<string, JsonInt | boolean>;
}

export interface ConsensusSpec {
  source: string;
  tag: string;
  preset: string;
  forkOrder: string[];
  config: Record<string, unknown>;
  forks: Record<string, ForkData>;
}

export interface ElFork {
  name: string;
  criteria: { kind: string; value: number | null };
  constants: Record<string, JsonInt>;
}

export interface ElSpec {
  source: string;
  version: string;
  forks: ElFork[];
}

export function toBigInt(value: JsonInt | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  return BigInt(value);
}

export function toNumber(value: JsonInt | boolean | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  throw new Error(`expected numeric constant, got ${value}`);
}

/** Epoch value used by mainnet config for unscheduled forks. */
export const FAR_FUTURE_EPOCH = 2n ** 64n - 1n;

export interface BlobScheduleEntry {
  EPOCH: number;
  MAX_BLOBS_PER_BLOCK: number;
}

/** Max blobs per block for a fork, honoring the BPO blob schedule. */
export function maxBlobsPerBlock(spec: ConsensusSpec, fork: string): number {
  const config = spec.config as Record<string, unknown>;
  const forkEpochRaw = config[`${fork.toUpperCase()}_FORK_EPOCH`];
  const schedule = (config['BLOB_SCHEDULE'] ?? []) as BlobScheduleEntry[];
  const constants = spec.forks[fork].constants;

  // Fall back through fork-suffixed preset constants, oldest naming first.
  let base = 0;
  for (const name of ['MAX_BLOBS_PER_BLOCK', 'MAX_BLOBS_PER_BLOCK_ELECTRA', 'MAX_BLOBS_PER_BLOCK_FULU']) {
    if (config[name] !== undefined) base = toNumber(config[name] as JsonInt);
    if (constants[name] !== undefined) base = toNumber(constants[name]);
  }

  if (schedule.length === 0 || forkEpochRaw === undefined) return base;
  const forkEpoch = toBigInt(forkEpochRaw as JsonInt);
  if (forkEpoch === null || forkEpoch >= FAR_FUTURE_EPOCH) {
    // Unscheduled forks inherit the latest announced schedule entry.
    return Math.max(base, ...schedule.map((e) => e.MAX_BLOBS_PER_BLOCK));
  }
  // A fork's ceiling is the highest value it can ever see: the schedule
  // value in effect when it activates, or any BPO bump that lands after.
  let atActivation = base;
  let peak = 0;
  for (const entry of [...schedule].sort((a, b) => a.EPOCH - b.EPOCH)) {
    if (BigInt(entry.EPOCH) <= forkEpoch) atActivation = entry.MAX_BLOBS_PER_BLOCK;
    else peak = Math.max(peak, entry.MAX_BLOBS_PER_BLOCK);
  }
  return Math.max(atActivation, peak);
}
