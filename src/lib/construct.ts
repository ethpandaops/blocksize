/**
 * Constructs the actual serialized bytes of a container instance, so
 * compression can be measured on real data instead of estimated with
 * ratios. Layout follows SSZ exactly (fixed parts, 4-byte offsets,
 * variable tails); leaf content is filled by entropy class:
 *
 *  - cryptographic material (signatures, roots, pubkeys, KZG objects)
 *    is seeded-random — indistinguishable from random on the wire
 *  - counters and indices are small varying integers, like reality
 *  - bitfields are fully-packed aggregates
 *  - transaction calldata follows the selected scenario
 */

import type { CalldataScenario } from './el';
import { TX_ENVELOPE_BYTES } from './el';
import type { SszNode } from './schema';
import type { Assignment, Registry } from './ssz';
import { isFixedSize, joinPath, resolve, sizeOf } from './ssz';

/** Deterministic PRNG so identical inputs give identical wire sizes. */
export function makePrng(seed = 0x9e3779b9): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state & 0xff;
  };
}

const CRYPTO_FIELD = /(signature|randao|pubkey|root|hash|kzg|commitment|proof|bloom|graffiti|address|column|blob|cell)/;

export function constructBytes(
  node: SszNode,
  registry: Registry,
  assignment: Assignment,
  scenario: CalldataScenario,
  rootPath = '',
): Uint8Array {
  const total = Number(sizeOf(node, registry, assignment, rootPath));
  const buf = new Uint8Array(total);
  const prng = makePrng();
  let uintCounter = 1;

  const fillRandom = (start: number, length: number) => {
    for (let i = 0; i < length; i++) buf[start + i] = prng();
  };

  const fillCalldata = (start: number, length: number) => {
    switch (scenario) {
      case 'zeros':
        return; // buffer is zero-initialized
      case 'random':
        fillRandom(start, length);
        return;
      case 'mixed':
        for (let i = 0; i < length; i++) {
          buf[start + i] = prng() < 74 ? 0 : prng(); // ~29% zero bytes
        }
        return;
    }
  };

  const fieldName = (path: string): string => {
    const segments = path.split('.');
    for (let i = segments.length - 1; i >= 0; i--) {
      if (!segments[i].startsWith('[')) return segments[i];
    }
    return '';
  };

  // Serializes `node` at buffer offset `at`, returns bytes written.
  const write = (n: SszNode, path: string, at: number): number => {
    n = resolve(n, registry);
    switch (n.kind) {
      case 'uint': {
        // Small varying values: slots, indices, amounts. High bytes stay
        // zero, like real chain data.
        let value = uintCounter++;
        for (let i = 0; i < n.size && value > 0; i++) {
          buf[at + i] = value & 0xff;
          value >>>= 8;
        }
        return n.size;
      }
      case 'bool':
        buf[at] = 1;
        return 1;
      case 'byteVector': {
        if (CRYPTO_FIELD.test(fieldName(path)) || CRYPTO_FIELD.test(n.alias?.toLowerCase() ?? '')) {
          fillRandom(at, n.length);
        }
        return n.length;
      }
      case 'bitvector': {
        const bytes = Math.ceil(n.length / 8);
        buf.fill(0xff, at, at + bytes);
        if (n.length % 8 !== 0) buf[at + bytes - 1] = (1 << n.length % 8) - 1;
        return bytes;
      }
      case 'bitlist': {
        const bits = assignment.bitlistBits(path, n);
        const bytes = Math.floor(bits / 8) + 1;
        buf.fill(0xff, at, at + bytes - 1);
        buf[at + bytes - 1] = (1 << bits % 8) | ((1 << bits % 8) - 1);
        return bytes;
      }
      case 'byteList': {
        const length = assignment.byteListBytes(path, n);
        if (fieldName(path) === 'transactions' || path.includes('transactions.')) {
          // A transaction's envelope (signature, addresses, gas fields)
          // is high-entropy regardless of what the calldata looks like.
          const envelope = Math.min(TX_ENVELOPE_BYTES, length);
          fillRandom(at, envelope);
          fillCalldata(at + envelope, length - envelope);
        } else if (CRYPTO_FIELD.test(fieldName(path))) {
          fillRandom(at, length);
        }
        return length;
      }
      case 'vector':
      case 'list': {
        const count =
          n.kind === 'vector' ? n.length : assignment.listCount(path, n as SszNode & { kind: 'list' });
        if (isFixedSize(n.elem, registry)) {
          let pos = at;
          for (let i = 0; i < count; i++) {
            pos += write(n.elem, `${path}.[]`, pos);
          }
          return pos - at;
        }
        // Variable elements: offset table, then element data.
        let dataPos = at + 4 * count;
        for (let i = 0; i < count; i++) {
          writeUint32(buf, at + 4 * i, dataPos - at);
          dataPos += write(n.elem, `${path}.[${i}]`, dataPos);
        }
        return dataPos - at;
      }
      case 'union': {
        const idx = assignment.unionSelector?.(path, n) ?? 0;
        buf[at] = idx;
        const selected = n.options[idx];
        return 1 + (selected === null ? 0 : write(selected, joinPath(path, `@${idx}`), at + 1));
      }
      case 'container': {
        const variable: [string, SszNode][] = [];
        let fixedLen = 0;
        for (const [name, field] of n.fields) {
          if (isFixedSize(field, registry)) {
            fixedLen += Number(sizeOf(field, registry, assignment, joinPath(path, name)));
          } else {
            fixedLen += 4;
            variable.push([name, field]);
          }
        }
        let fixedPos = at;
        let dataPos = at + fixedLen;
        for (const [name, field] of n.fields) {
          const fieldPath = joinPath(path, name);
          if (isFixedSize(field, registry)) {
            fixedPos += write(field, fieldPath, fixedPos);
          } else {
            writeUint32(buf, fixedPos, dataPos - at);
            fixedPos += 4;
            dataPos += write(field, fieldPath, dataPos);
          }
        }
        return dataPos - at;
      }
      case 'ref':
        throw new Error('unresolved ref');
    }
  };

  const written = write(node, rootPath, 0);
  if (written !== total) {
    throw new Error(`construct mismatch: wrote ${written}, sized ${total}`);
  }
  return buf;
}

function writeUint32(buf: Uint8Array, at: number, value: number): void {
  buf[at] = value & 0xff;
  buf[at + 1] = (value >>> 8) & 0xff;
  buf[at + 2] = (value >>> 16) & 0xff;
  buf[at + 3] = (value >>> 24) & 0xff;
}
