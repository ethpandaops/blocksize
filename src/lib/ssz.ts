/**
 * Schema-driven SSZ size engine.
 *
 * Computes static min/max byte lengths from container schemas (mirroring
 * remerkleable, which the test suite verifies against the extractor's
 * dumped ground truth), and exact serialized sizes for concrete instance
 * shapes described by an Assignment.
 */

import type { ContainerNode, SszNode } from './schema';
import { toBigInt } from './schema';

export type Registry = Record<string, ContainerNode>;

const OFFSET_BYTES = 4n;

/**
 * remerkleable treats progressive (unlimited) collections as bounded by
 * the 32-bit offset space for byte-length purposes.
 */
const PROGRESSIVE_MAX_BYTES = 2n ** 32n;

export function resolve(node: SszNode, registry: Registry): SszNode {
  return node.kind === 'ref' ? registry[node.name] : node;
}

export function isFixedSize(node: SszNode, registry: Registry): boolean {
  node = resolve(node, registry);
  switch (node.kind) {
    case 'uint':
    case 'bool':
    case 'byteVector':
    case 'bitvector':
      return true;
    case 'byteList':
    case 'bitlist':
    case 'list':
    case 'union':
      return false;
    case 'vector':
      return isFixedSize(node.elem, registry);
    case 'container':
      return node.fields.every(([, f]) => isFixedSize(f, registry));
    default:
      throw new Error(`unresolved node`);
  }
}

export function minSize(node: SszNode, registry: Registry): bigint {
  node = resolve(node, registry);
  switch (node.kind) {
    case 'ref':
      throw new Error('unresolved ref');
    case 'uint':
      return BigInt(node.size);
    case 'bool':
      return 1n;
    case 'byteVector':
      return BigInt(node.length);
    case 'bitvector':
      return BigInt(Math.ceil(node.length / 8));
    case 'byteList':
      return 0n;
    case 'bitlist':
      return 1n; // just the length-delimiter bit
    case 'list':
      return 0n;
    case 'vector': {
      const per = minSize(node.elem, registry);
      const n = BigInt(node.length);
      return isFixedSize(node.elem, registry) ? per * n : (per + OFFSET_BYTES) * n;
    }
    case 'union': {
      const sizes = node.options.map((o) => (o === null ? 0n : minSize(o, registry)));
      return 1n + sizes.reduce((a, b) => (b < a ? b : a));
    }
    case 'container': {
      let total = 0n;
      for (const [, field] of node.fields) {
        total += isFixedSize(field, registry)
          ? minSize(field, registry)
          : OFFSET_BYTES + minSize(field, registry);
      }
      return total;
    }
  }
}

export function maxSize(node: SszNode, registry: Registry): bigint {
  node = resolve(node, registry);
  switch (node.kind) {
    case 'ref':
      throw new Error('unresolved ref');
    case 'uint':
      return BigInt(node.size);
    case 'bool':
      return 1n;
    case 'byteVector':
      return BigInt(node.length);
    case 'bitvector':
      return BigInt(Math.ceil(node.length / 8));
    case 'byteList':
      return toBigInt(node.limit) ?? PROGRESSIVE_MAX_BYTES;
    case 'bitlist': {
      const limit = toBigInt(node.limit);
      if (limit === null) return PROGRESSIVE_MAX_BYTES;
      return limit / 8n + 1n;
    }
    case 'list': {
      const limit = toBigInt(node.limit);
      const per = maxSize(node.elem, registry);
      if (limit === null) return PROGRESSIVE_MAX_BYTES;
      return isFixedSize(node.elem, registry) ? per * limit : (per + OFFSET_BYTES) * limit;
    }
    case 'vector': {
      const per = maxSize(node.elem, registry);
      const n = BigInt(node.length);
      return isFixedSize(node.elem, registry) ? per * n : (per + OFFSET_BYTES) * n;
    }
    case 'union': {
      const sizes = node.options.map((o) => (o === null ? 0n : maxSize(o, registry)));
      return 1n + sizes.reduce((a, b) => (b > a ? b : a));
    }
    case 'container': {
      let total = 0n;
      for (const [, field] of node.fields) {
        total += isFixedSize(field, registry)
          ? maxSize(field, registry)
          : OFFSET_BYTES + maxSize(field, registry);
      }
      return total;
    }
  }
}

/**
 * Describes the concrete shape of one instance of a schema: how many
 * elements each list holds, how many bits/bytes each bitlist/bytelist
 * carries. Paths are dot-joined field names from the root, with `[]`
 * marking list elements, e.g. `message.body.attestations.[].aggregation_bits`.
 */
export interface Assignment {
  /** Element count for lists at this path. */
  listCount(path: string, node: SszNode & { kind: 'list' }): number;
  /** Bit count for bitlists at this path (excluding the delimiter bit). */
  bitlistBits(path: string, node: SszNode & { kind: 'bitlist' }): number;
  /** Byte count for byteLists at this path. */
  byteListBytes(path: string, node: SszNode & { kind: 'byteList' }): number;
  /** Selected option index for unions at this path. */
  unionSelector?(path: string, node: SszNode & { kind: 'union' }): number;
}

/** Exact serialized byte size of an instance described by `assignment`. */
export function sizeOf(
  node: SszNode,
  registry: Registry,
  assignment: Assignment,
  path = '',
): bigint {
  node = resolve(node, registry);
  switch (node.kind) {
    case 'ref':
      throw new Error('unresolved ref');
    case 'uint':
    case 'bool':
    case 'byteVector':
    case 'bitvector':
      return minSize(node, registry);
    case 'byteList':
      return BigInt(assignment.byteListBytes(path, node));
    case 'bitlist':
      return BigInt(assignment.bitlistBits(path, node)) / 8n + 1n;
    case 'list': {
      const count = assignment.listCount(path, node);
      if (isFixedSize(node.elem, registry)) {
        return BigInt(count) * sizeOf(node.elem, registry, assignment, `${path}.[]`);
      }
      let total = 0n;
      for (let i = 0; i < count; i++) {
        total += OFFSET_BYTES + sizeOf(node.elem, registry, assignment, `${path}.[${i}]`);
      }
      return total;
    }
    case 'vector': {
      const elemPath = `${path}.[]`;
      const per = sizeOf(node.elem, registry, assignment, elemPath);
      const n = BigInt(node.length);
      return isFixedSize(node.elem, registry) ? per * n : (per + OFFSET_BYTES) * n;
    }
    case 'union': {
      const idx = assignment.unionSelector?.(path, node) ?? 0;
      const selected = node.options[idx];
      return 1n + (selected === null ? 0n : sizeOf(selected, registry, assignment, joinPath(path, `@${idx}`)));
    }
    case 'container': {
      let total = 0n;
      for (const [name, field] of node.fields) {
        const fieldPath = joinPath(path, name);
        total += isFixedSize(field, registry)
          ? sizeOf(field, registry, assignment, fieldPath)
          : OFFSET_BYTES + sizeOf(field, registry, assignment, fieldPath);
      }
      return total;
    }
  }
}

export function joinPath(path: string, segment: string): string {
  return path === '' ? segment : `${path}.${segment}`;
}

/** Per-field size breakdown of a container instance (offsets included). */
export function fieldBreakdown(
  container: ContainerNode,
  registry: Registry,
  assignment: Assignment,
  path = '',
): { name: string; bytes: bigint }[] {
  return container.fields.map(([name, field]) => {
    const fieldPath = joinPath(path, name);
    const overhead = isFixedSize(field, registry) ? 0n : OFFSET_BYTES;
    return { name, bytes: overhead + sizeOf(field, registry, assignment, fieldPath) };
  });
}
