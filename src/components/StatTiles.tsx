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
  const ratio = Number(result.sszBytes) / Math.max(1, result.gossipBytes);
  const overLimit = result.gossipLimit !== null && result.gossipBytes > result.gossipLimit;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile
        label="Block (raw SSZ)"
        value={formatBytes(result.sszBytes)}
        sub="serialized SignedBeaconBlock"
      />
      <Tile
        label="Gossip wire size"
        value={formatBytes(result.gossipBytes)}
        sub={
          overLimit
            ? `⚠ exceeds ${formatBytes(result.gossipLimit!)} gossip limit`
            : 'Snappy, measured on constructed bytes'
        }
        alert={overLimit}
      />
      <Tile
        label="Compression"
        value={`${ratio.toFixed(2)}×`}
        sub={`req/resp framed: ${formatBytes(result.framedBytes)}`}
      />
      <Tile
        label="Blob data (DAS)"
        value={formatBytes(result.sidecars.reduce((a, s) => a + s.totalBytes, 0n))}
        sub={
          result.sidecars.length > 0
            ? `${result.sidecars[0].count}× ${result.sidecars[0].container}, gossiped separately`
            : 'no blobs at this fork'
        }
      />
    </div>
  );
}
