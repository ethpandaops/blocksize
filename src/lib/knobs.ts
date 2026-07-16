/**
 * Knob discovery: walks a fork's block body schema and derives the set of
 * user-adjustable dimensions. New forks get knobs for their new fields
 * with zero code changes; caps come from the SSZ limit or, for
 * progressive (unlimited) lists, from the fork's processing-limit
 * constants (MAX_<FIELD>, latest fork-suffixed variant wins).
 */

import type { ConsensusSpec, ForkData, SszNode } from './schema';
import { maxBlobsPerBlock, toBigInt, toNumber } from './schema';
import type { Registry } from './ssz';
import { isFixedSize, joinPath, resolve } from './ssz';

export interface Knob {
  /** Normalized path from the root, e.g. `message.body.attestations`. */
  path: string;
  /** Field name, e.g. `attestations`. */
  name: string;
  /** Parent group under body for display, e.g. `execution_requests`. */
  group: string | null;
  max: number;
  /** True when the SSZ type is unbounded and max came from a processing constant. */
  progressive: boolean;
}

/** Paths managed by the EL payload model rather than exposed as knobs. */
const MANAGED_FIELDS = new Set(['transactions', 'extra_data']);

/** Ceiling for unbounded lists with no matching processing constant. */
const UNBOUNDED_DEFAULT_MAX = 256;

/** Knob caps above this are UI-hostile and get flagged, not sliderized. */
const KNOB_LIMIT_CEILING = 1n << 20n;

/**
 * Resolve the processing-limit constant for a field. Candidate names are
 * tried in order: the plain MAX_<FIELD> form and the EIP-7685 style
 * MAX_<FIELD-singular>_REQUESTS_PER_PAYLOAD form (preferred inside an
 * execution-requests container, where the bare name may collide with an
 * unrelated body constant, e.g. deposits vs MAX_DEPOSITS).
 *
 * Within one candidate, the variant suffixed with the latest fork at or
 * before the current one wins: MAX_ATTESTATIONS_ELECTRA beats
 * MAX_ATTESTATIONS when fork >= electra.
 */
export function processingLimit(
  spec: ConsensusSpec,
  fork: string,
  fieldName: string,
  requestsContext = false,
): number | null {
  const upper = fieldName.toUpperCase();
  const singular = upper.endsWith('S') ? upper.slice(0, -1) : upper;
  const plain = `MAX_${upper}`;
  const perPayload = `MAX_${upper}_PER_PAYLOAD`;
  const requests = `MAX_${singular}_REQUESTS_PER_PAYLOAD`;
  const candidates = requestsContext
    ? [requests, plain, perPayload]
    : [plain, perPayload, requests];
  for (const base of candidates) {
    const value = resolveConstant(spec, fork, base);
    if (value !== null) return value;
  }
  return null;
}

function resolveConstant(spec: ConsensusSpec, fork: string, base: string): number | null {
  const constants = spec.forks[fork].constants;
  const forkIndex = spec.forkOrder.indexOf(fork);
  let best: { value: number; rank: number } | null = null;
  for (const [name, value] of Object.entries(constants)) {
    if (typeof value === 'boolean') continue;
    if (name !== base && !name.startsWith(`${base}_`)) continue;
    let rank = 0;
    if (name !== base) {
      const suffix = name.slice(base.length + 1).toLowerCase();
      const suffixIndex = spec.forkOrder.indexOf(suffix);
      if (suffixIndex === -1 || suffixIndex > forkIndex) continue;
      rank = suffixIndex + 1;
    }
    if (best === null || rank > best.rank) {
      best = { value: toNumber(value), rank };
    }
  }
  return best?.value ?? null;
}

export function discoverKnobs(
  spec: ConsensusSpec,
  fork: string,
  rootContainer = 'BeaconBlockBody',
  rootPath = 'message.body',
): Knob[] {
  const forkData: ForkData = spec.forks[fork];
  const registry: Registry = forkData.containers;
  const root = registry[rootContainer];
  if (!root) return [];

  const knobs: Knob[] = [];
  const walk = (node: SszNode, path: string, group: string | null) => {
    node = resolve(node, registry);
    if (node.kind !== 'container') return;
    for (const [name, field] of node.fields) {
      if (MANAGED_FIELDS.has(name)) continue;
      const resolved = resolve(field, registry);
      const fieldPath = joinPath(path, name);
      if (resolved.kind === 'list') {
        const limit = toBigInt(resolved.limit);
        let max: number;
        if (limit !== null) {
          // For bounded lists the SSZ limit IS the protocol cap: body
          // lists are declared as List[X, MAX_X] in the spec.
          max = limit <= KNOB_LIMIT_CEILING ? Number(limit) : Number(KNOB_LIMIT_CEILING);
        } else {
          // Progressive lists carry no SSZ bound; the cap lives in a
          // processing-limit constant.
          const requestsContext = group !== null && group.includes('execution_requests');
          max = processingLimit(spec, fork, name, requestsContext) ?? UNBOUNDED_DEFAULT_MAX;
        }
        if (name === 'blob_kzg_commitments') {
          // Blob throughput is governed by the config blob schedule, not
          // the SSZ commitment-list ceiling.
          max = Math.min(max, maxBlobsPerBlock(spec, fork));
        }
        knobs.push({ path: fieldPath, name, group, max, progressive: limit === null });
      } else if (resolved.kind === 'container' && !isFixedSize(resolved, registry)) {
        // Variable nested containers (execution_requests, payload bids)
        // contribute their own list knobs.
        walk(resolved, fieldPath, group === null ? name : `${group}.${name}`);
      }
    }
  };
  walk(root, rootPath, null);
  return knobs;
}
