/**
 * Orchestrates the engine: given a fork and network conditions, produce
 * every size the UI displays — raw SSZ, gossip/req-resp wire sizes,
 * per-field breakdown, blob sidecar footprint, and analytic bounds.
 */

import { buildAssignment, type NetworkParams } from './constraints';
import { constructBytes } from './construct';
import type { CalldataScenario, ElModel } from './el';
import { elModelFor, planPayload } from './el';
import { discoverKnobs, processingLimit, type Knob } from './knobs';
import type { ConsensusSpec, ElSpec, JsonInt } from './schema';
import { FAR_FUTURE_EPOCH, toBigInt } from './schema';
import type { Assignment } from './ssz';
import { fieldBreakdown, maxSize, sizeOf } from './ssz';
import { framedSize, gossipSize, snappyWorstCase } from './snappy';

/**
 * Beacon chain genesis timestamp (mainnet). A chain datum rather than a
 * spec parameter; used only to pair CL forks with the EL fork live at
 * the same time.
 */
const MAINNET_GENESIS_TIME = 1606824023;
const SECONDS_PER_SLOT = 12;
const SLOTS_PER_EPOCH = 32;

/**
 * Gas consumed per deposit made through the deposit contract. An
 * empirical contract-execution cost, not a protocol constant: it bounds
 * how many DepositRequests one payload's gas can produce (EIP-6110).
 */
export const GAS_PER_DEPOSIT_REQUEST = 31500;

export interface UserState {
  fork: string;
  activeValidators: number;
  gasLimit: number;
  scenario: CalldataScenario;
  knobValues: Record<string, number>;
  /** Block access list bytes (EIP-7928), when the fork's payload has one. */
  balBytes?: number;
}

/**
 * Bytes per worst-case block-access-list entry: a 32-byte storage key
 * plus a 32-byte value (EIP-7928 encoding). An approximation until EELS
 * ships the BAL containers, at which point this becomes extracted.
 */
const BAL_BYTES_PER_ENTRY = 64;

/** Does this fork's execution payload carry a block access list? */
export function hasBalField(spec: ConsensusSpec, fork: string): boolean {
  return hasField(spec, fork, 'ExecutionPayload', 'block_access_list');
}

/**
 * Worst-case BAL size: every unit of gas spent on cold storage accesses
 * (GAS_COLD_SLOAD, extracted from EELS), each producing one entry.
 */
export function balWorstCaseBytes(elModel: ElModel, gasLimit: number): number {
  const coldSload = elModel.fork.constants['GAS_COLD_SLOAD'];
  if (coldSload === undefined) return 0;
  return Math.floor(gasLimit / Number(coldSload)) * BAL_BYTES_PER_ENTRY;
}

export interface SidecarInfo {
  container: string;
  count: number;
  bytesEach: bigint;
  totalBytes: bigint;
  /** Sidecars propagated per block for DAS (columns) vs per blob. */
  perBlock: boolean;
}

/** One gossip-propagated object, constructed and measured. */
export interface WireMeasure {
  container: string;
  sszBytes: bigint;
  gossipBytes: number;
  framedBytes: number;
  breakdown: { name: string; bytes: bigint }[];
}

export interface BlockSizeResult {
  knobs: Knob[];
  /** Raw SSZ size of the SignedBeaconBlock instance. */
  sszBytes: bigint;
  /** Actual Snappy (gossip) wire size of the constructed block. */
  gossipBytes: number;
  /** Framed Snappy (req/resp) wire size. */
  framedBytes: number;
  /** Analytic ceiling on gossip size for this SSZ size. */
  snappyCeiling: number;
  /** Spec-theoretical max SSZ size (unconstrained worst case). */
  specMaxBytes: bigint;
  /** Per-body-field byte totals, descending. */
  breakdown: { name: string; bytes: bigint }[];
  /** Bytes outside the body: header fields, signature, offsets. */
  envelopeBytes: bigint;
  elModel: ElModel | null;
  payloadPlan: ReturnType<typeof planPayload> | null;
  /** ePBS: the builder's payload envelope, gossiped mid-slot (EIP-7732). */
  envelope: WireMeasure | null;
  balWorstCase: number;
  sidecars: SidecarInfo[];
  /** Everything the slot puts on gossip: block + envelope + sidecars. */
  slotGossipBytes: bigint;
  /** Gossip limit from config (MAX_PAYLOAD_SIZE), if published. */
  gossipLimit: number | null;
}

export function clForkTimestamp(spec: ConsensusSpec, fork: string): number | null {
  const epochRaw = spec.config[`${fork.toUpperCase()}_FORK_EPOCH`] as JsonInt | undefined;
  const epoch = toBigInt(epochRaw ?? null);
  if (epoch === null || epoch >= FAR_FUTURE_EPOCH) return null;
  return MAINNET_GENESIS_TIME + Number(epoch) * SLOTS_PER_EPOCH * SECONDS_PER_SLOT;
}

/** The EL fork live at a CL fork's activation (latest for unscheduled forks). */
export function elForkForClFork(spec: ConsensusSpec, elSpec: ElSpec, fork: string): ElModel {
  const timestamp = clForkTimestamp(spec, fork);
  let chosen = elSpec.forks[elSpec.forks.length - 1];
  if (timestamp !== null) {
    for (const elFork of elSpec.forks) {
      const { kind, value } = elFork.criteria;
      if (value === null) continue;
      if (kind === 'ByTimestamp' && value > timestamp) break;
      chosen = elFork;
    }
  }
  return elModelFor(chosen);
}

function hasField(spec: ConsensusSpec, fork: string, container: string, field: string): boolean {
  const c = spec.forks[fork].containers[container];
  return c !== undefined && c.fields.some(([name]) => name === field);
}

export function computeBlockSize(
  spec: ConsensusSpec,
  elSpec: ElSpec,
  state: UserState,
): BlockSizeResult {
  const { fork } = state;
  const registry = spec.forks[fork].containers;
  const root = registry['SignedBeaconBlock'];
  const body = registry['BeaconBlockBody'];
  const knobs = discoverKnobs(spec, fork);

  // Pre-ePBS the body carries the execution payload; from gloas the
  // builder gossips it separately as a payload envelope mid-slot.
  const bodyHasPayload = hasField(spec, fork, 'BeaconBlockBody', 'execution_payload');
  const envelopeContainer =
    registry['SignedExecutionPayloadEnvelope'] !== undefined
      ? 'SignedExecutionPayloadEnvelope'
      : registry['ExecutionPayloadEnvelope'] !== undefined
        ? 'ExecutionPayloadEnvelope'
        : null;
  const elModel =
    bodyHasPayload || envelopeContainer !== null ? elForkForClFork(spec, elSpec, fork) : null;

  // EIP-6110 deposit requests consume payload gas, shrinking calldata room.
  const depositKnob = knobs.find((k) => k.group === 'execution_requests' && k.name === 'deposits');
  const depositCount = depositKnob ? (state.knobValues[depositKnob.path] ?? 0) : 0;
  const calldataGas = Math.max(0, state.gasLimit - depositCount * GAS_PER_DEPOSIT_REQUEST);

  const txLimit = maxTransactionsPerPayload(spec, fork);
  const payloadPlan =
    elModel === null ? null : planPayload(elModel, calldataGas, state.scenario, txLimit);

  const params: NetworkParams = {
    activeValidators: state.activeValidators,
    knobValues: state.knobValues,
    payloadPlan,
    balBytes: state.balBytes ?? 0,
    // Unbounded lists outside the block body (envelope payload
    // withdrawals, envelope execution requests) fall back to the user's
    // matching request knobs, then to processing-limit constants.
    listLimit: (field) => {
      const requestKnob = knobs.find(
        (k) => k.name === field && k.group !== null && k.group.includes('execution_requests'),
      );
      if (requestKnob !== undefined) return state.knobValues[requestKnob.path] ?? 0;
      return processingLimit(spec, fork, field);
    },
  };
  const assignment = buildAssignment(knobs, params);

  const sszBytes = sizeOf(root, registry, assignment);
  const bytes = constructBytes(root, registry, assignment, state.scenario);
  const gossipBytes = gossipSize(bytes);
  const framedBytes = framedSize(bytes);

  let envelope: WireMeasure | null = null;
  if (envelopeContainer !== null) {
    const envelopeRoot = registry[envelopeContainer];
    const envelopeSsz = sizeOf(envelopeRoot, registry, assignment);
    const envelopeBytes = constructBytes(envelopeRoot, registry, assignment, state.scenario);
    const payloadNode = registry['ExecutionPayload'];
    envelope = {
      container: envelopeContainer,
      sszBytes: envelopeSsz,
      gossipBytes: gossipSize(envelopeBytes),
      framedBytes: framedSize(envelopeBytes),
      breakdown:
        payloadNode !== undefined
          ? fieldBreakdown(payloadNode, registry, assignment, 'message.payload')
          : [],
    };
  }

  // Schema field order — stable across knob changes so UI colors can
  // follow the field, not its current size rank.
  const bodyBreakdown = fieldBreakdown(body, registry, assignment, 'message.body');
  const bodyBytes = bodyBreakdown.reduce((a, f) => a + f.bytes, 0n);

  const sidecars = sidecarInfo(spec, fork, state, assignment, knobs);
  const slotGossipBytes =
    BigInt(gossipBytes) +
    BigInt(envelope?.gossipBytes ?? 0) +
    sidecars.reduce((a, s) => a + s.totalBytes, 0n);

  return {
    knobs,
    sszBytes,
    gossipBytes,
    framedBytes,
    snappyCeiling: snappyWorstCase(Number(sszBytes)),
    specMaxBytes: maxSize(root, registry),
    breakdown: bodyBreakdown,
    envelopeBytes: sszBytes - bodyBytes,
    elModel,
    payloadPlan,
    envelope,
    balWorstCase: elModel !== null ? balWorstCaseBytes(elModel, state.gasLimit) : 0,
    sidecars,
    slotGossipBytes,
    gossipLimit: numericConfig(spec, 'MAX_PAYLOAD_SIZE'),
  };
}

function numericConfig(spec: ConsensusSpec, key: string): number | null {
  const value = spec.config[key];
  return typeof value === 'number' ? value : null;
}

function maxTransactionsPerPayload(spec: ConsensusSpec, fork: string): number {
  const payload = spec.forks[fork].containers['ExecutionPayload'];
  const txField = payload?.fields.find(([name]) => name === 'transactions')?.[1];
  if (txField !== undefined && txField.kind === 'list') {
    const limit = toBigInt(txField.limit);
    if (limit !== null && limit <= 1n << 24n) return Number(limit);
  }
  return 1 << 20;
}

/** Blob sidecar footprint: per-blob sidecars (deneb+) or DAS columns (fulu+). */
function sidecarInfo(
  spec: ConsensusSpec,
  fork: string,
  state: UserState,
  blockAssignment: Assignment,
  knobs: Knob[],
): SidecarInfo[] {
  const registry = spec.forks[fork].containers;
  // Located by name, not path: gloas moves the commitments list from the
  // body into the builder bid.
  const blobKnob = knobs.find((k) => k.name === 'blob_kzg_commitments');
  const blobCount = blobKnob !== undefined ? (state.knobValues[blobKnob.path] ?? 0) : 0;
  if (blobCount === 0) return [];

  const out: SidecarInfo[] = [];
  const columnCount = numericConfig(spec, 'NUMBER_OF_COLUMNS') ?? columnConstant(spec, fork);

  if (registry['DataColumnSidecar'] !== undefined && columnCount !== null) {
    // Every list inside a column sidecar (cells, commitments, proofs)
    // scales with blob count.
    const assignment: Assignment = {
      listCount: () => blobCount,
      bitlistBits: (p, n) => blockAssignment.bitlistBits(p, n),
      byteListBytes: (p, n) => blockAssignment.byteListBytes(p, n),
    };
    const bytesEach = sizeOf(registry['DataColumnSidecar'], registry, assignment);
    out.push({
      container: 'DataColumnSidecar',
      count: columnCount,
      bytesEach,
      totalBytes: bytesEach * BigInt(columnCount),
      perBlock: true,
    });
  } else if (registry['BlobSidecar'] !== undefined) {
    const bytesEach = sizeOf(registry['BlobSidecar'], registry, blockAssignment);
    out.push({
      container: 'BlobSidecar',
      count: blobCount,
      bytesEach,
      totalBytes: bytesEach * BigInt(blobCount),
      perBlock: false,
    });
  }
  return out;
}

function columnConstant(spec: ConsensusSpec, fork: string): number | null {
  const value = spec.forks[fork].constants['NUMBER_OF_COLUMNS'];
  return value !== undefined && typeof value !== 'boolean' ? Number(value) : null;
}
