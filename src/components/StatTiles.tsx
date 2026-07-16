import { formatBytes } from '../lib/format';
import type { BlockSizeResult } from '../lib/model';

function Tile({
  label,
  value,
  sub,
  alert,
}: {
  label: string;
  value: string;
  sub: string;
  alert?: boolean;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-surface p-4">
      <p className="text-xs/5 text-ink-2">{label}</p>
      <p className={`mt-1 text-2xl/8 font-semibold ${alert ? 'text-status-critical' : ''}`}>
        {value}
      </p>
      <p className="mt-0.5 text-xs/5 text-ink-muted">{sub}</p>
    </div>
  );
}

export function StatTiles({ result }: { result: BlockSizeResult }) {
  // The gossip limit binds on the UNCOMPRESSED payload (compressed size
  // is malleable, so the spec only derives a snappy-expansion bound
  // from it).
  const limit = result.gossipLimit;
  const blockOver = limit !== null && result.sszBytes > BigInt(limit);
  const envelopeOver =
    limit !== null && result.envelope !== null && result.envelope.sszBytes > BigInt(limit);
  const blobSidecars = result.sidecars.filter((s) => s.container.includes('Sidecar'));
  const blobTotal = blobSidecars.reduce((a, s) => a + s.totalBytes, 0n);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile
        label="Beacon block (gossip)"
        value={formatBytes(result.gossipBytes)}
        sub={
          blockOver
            ? `⚠ raw SSZ ${formatBytes(result.sszBytes)} exceeds ${formatBytes(limit!)} gossip limit`
            : `raw SSZ ${formatBytes(result.sszBytes)}`
        }
        alert={blockOver}
      />
      <Tile
        label="Payload envelope (gossip)"
        value={result.envelope !== null ? formatBytes(result.envelope.gossipBytes) : '—'}
        sub={
          result.envelope !== null
            ? envelopeOver
              ? `⚠ raw SSZ ${formatBytes(result.envelope.sszBytes)} exceeds ${formatBytes(limit!)} gossip limit`
              : `raw SSZ ${formatBytes(result.envelope.sszBytes)} · builder, mid-slot`
            : 'payload rides inside the block at this fork'
        }
        alert={envelopeOver}
      />
      <Tile
        label="Blob data (DAS)"
        value={formatBytes(blobTotal)}
        sub={
          blobSidecars.length > 0
            ? `${blobSidecars[0].count}× ${blobSidecars[0].container}, gossiped separately`
            : 'no blobs at this fork'
        }
      />
      <Tile
        label="Slot total (gossip)"
        value={formatBytes(result.slotGossipBytes)}
        sub="block + envelope + blob sidecars"
      />
    </div>
  );
}
