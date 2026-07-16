/**
 * Wire-size measurement. Consensus gossip compresses SSZ with raw
 * (block-format) Snappy; req/resp uses the framed format. Both are
 * measured by actually compressing the constructed bytes.
 */

import { compress } from 'snappyjs';

/** Gossip wire size: raw Snappy over the full message. */
export function gossipSize(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  return compress(bytes).length;
}

const FRAME_CHUNK = 65536;
const STREAM_HEADER = 10; // "sNaPpY" stream identifier frame
const CHUNK_OVERHEAD = 8; // 4-byte chunk header + 4-byte CRC-32C

/**
 * Req/resp wire size: framed Snappy — each 64 KiB chunk compressed
 * independently, falling back to an uncompressed chunk when compression
 * doesn't help.
 */
export function framedSize(bytes: Uint8Array): number {
  let total = STREAM_HEADER;
  for (let at = 0; at < bytes.length; at += FRAME_CHUNK) {
    const chunk = bytes.subarray(at, Math.min(at + FRAME_CHUNK, bytes.length));
    const compressed = compress(chunk).length;
    total += CHUNK_OVERHEAD + Math.min(compressed, chunk.length);
  }
  return total;
}

/**
 * Snappy's documented worst-case output for n input bytes — the analytic
 * ceiling on wire size regardless of content.
 */
export function snappyWorstCase(n: number): number {
  return 32 + n + Math.floor(n / 6);
}
