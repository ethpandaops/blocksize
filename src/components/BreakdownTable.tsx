import { fieldLabel, formatBytes, formatCount } from '../lib/format';
import type { BlockSizeResult } from '../lib/model';

export function BreakdownTable({
  result,
  knobValues,
}: {
  result: BlockSizeResult;
  knobValues: Record<string, number>;
}) {
  const rows = [...result.breakdown]
    .filter((f) => f.bytes > 0n)
    .sort((a, b) => (a.bytes > b.bytes ? -1 : 1));
  const total = rows.reduce((a, f) => a + f.bytes, 0n) + result.envelopeBytes;

  const countFor = (name: string): string => {
    const path = Object.keys(knobValues).find((p) => p.endsWith(`.${name}`));
    if (path !== undefined) return formatCount(knobValues[path]);
    if (name === 'execution_payload') return formatCount(result.payloadPlan?.txCount ?? 0);
    return '—';
  };

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
          {rows.map((f) => (
            <tr key={f.name} className="border-b border-hairline last:border-0">
              <td className="px-4 py-1.5">{fieldLabel(f.name)}</td>
              <td className="px-4 py-1.5 text-right text-ink-2">{countFor(f.name)}</td>
              <td className="px-4 py-1.5 text-right">{formatCount(f.bytes)}</td>
              <td className="px-4 py-1.5 text-right">{formatBytes(f.bytes)}</td>
              <td className="px-4 py-1.5 text-right text-ink-2">
                {(Number((f.bytes * 10000n) / total) / 100).toFixed(1)}%
              </td>
            </tr>
          ))}
          <tr className="border-t border-hairline text-ink-2">
            <td className="px-4 py-1.5">envelope (header, signature, offsets)</td>
            <td className="px-4 py-1.5 text-right">—</td>
            <td className="px-4 py-1.5 text-right">{formatCount(result.envelopeBytes)}</td>
            <td className="px-4 py-1.5 text-right">{formatBytes(result.envelopeBytes)}</td>
            <td className="px-4 py-1.5 text-right">
              {(Number((result.envelopeBytes * 10000n) / total) / 100).toFixed(1)}%
            </td>
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
