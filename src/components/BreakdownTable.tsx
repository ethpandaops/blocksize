import { fieldLabel, formatBytes, formatCount } from '../lib/format';

export interface BreakdownRow {
  name: string;
  count: string;
  bytes: bigint;
}

export function BreakdownTable({
  rows,
  residualLabel,
  residualBytes,
}: {
  rows: BreakdownRow[];
  residualLabel: string;
  residualBytes: bigint;
}) {
  const visible = [...rows]
    .filter((f) => f.bytes > 0n)
    .sort((a, b) => (a.bytes > b.bytes ? -1 : 1));
  const total = rows.reduce((a, f) => a + f.bytes, 0n) + residualBytes;
  if (total === 0n) return null;
  const percent = (bytes: bigint) => (Number((bytes * 10000n) / total) / 100).toFixed(1);

  return (
    <div className="overflow-x-auto rounded-lg border border-hairline bg-surface">
      <table className="w-full text-sm/6">
        <thead>
          <tr className="border-b border-hairline text-left text-xs/5 text-ink-2">
            <th className="px-4 py-2 font-medium">Component</th>
            <th className="px-4 py-2 text-right font-medium">Count</th>
            <th className="px-4 py-2 text-right font-medium">Bytes</th>
            <th className="px-4 py-2 text-right font-medium">Size</th>
            <th className="px-4 py-2 text-right font-medium">Share</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {visible.map((f) => (
            <tr key={f.name} className="border-b border-hairline last:border-0">
              <td className="px-4 py-1.5">{fieldLabel(f.name)}</td>
              <td className="px-4 py-1.5 text-right text-ink-2">{f.count}</td>
              <td className="px-4 py-1.5 text-right">{formatCount(f.bytes)}</td>
              <td className="px-4 py-1.5 text-right">{formatBytes(f.bytes)}</td>
              <td className="px-4 py-1.5 text-right text-ink-2">{percent(f.bytes)}%</td>
            </tr>
          ))}
          <tr className="border-t border-hairline text-ink-2">
            <td className="px-4 py-1.5">{residualLabel}</td>
            <td className="px-4 py-1.5 text-right">—</td>
            <td className="px-4 py-1.5 text-right">{formatCount(residualBytes)}</td>
            <td className="px-4 py-1.5 text-right">{formatBytes(residualBytes)}</td>
            <td className="px-4 py-1.5 text-right">{percent(residualBytes)}%</td>
          </tr>
          <tr className="border-t border-hairline font-semibold">
            <td className="px-4 py-2">total</td>
            <td className="px-4 py-2 text-right">—</td>
            <td className="px-4 py-2 text-right">{formatCount(total)}</td>
            <td className="px-4 py-2 text-right">{formatBytes(total)}</td>
            <td className="px-4 py-2 text-right">100%</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
