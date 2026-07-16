import type { CalldataScenario } from '../lib/el';
import { gasPerByte, isUpcoming } from '../lib/el';
import { formatBytes, formatCount, forkLabel } from '../lib/format';
import type { BlockSizeResult } from '../lib/model';
import type { ConsensusSpec } from '../lib/schema';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface p-4">
      <h3 className="text-sm/6 font-semibold">{title}</h3>
      <div className="mt-2 flex flex-col gap-1 text-sm/6 text-ink-2">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex justify-between gap-4">
      <span>{label}</span>
      <span className="text-right font-mono text-xs/6 text-ink">{value}</span>
    </p>
  );
}

function balRow(result: BlockSizeResult) {
  const bal = result.envelope?.breakdown.find((f) => f.name === 'block_access_list');
  if (bal === undefined) return null;
  return (
    <Row
      label="Block access list (EIP-7928)"
      value={`${formatBytes(bal.bytes)} (worst case ${formatBytes(result.balWorstCase)})`}
    />
  );
}

export function InfoCards({
  spec,
  fork,
  result,
  scenario,
}: {
  spec: ConsensusSpec;
  fork: string;
  result: BlockSizeResult;
  scenario: CalldataScenario;
}) {
  const eips = spec.forks[fork].eips ?? [];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {result.elModel !== null && result.payloadPlan !== null ? (
        <Card
          title={`Execution payload — ${
            result.envelope !== null ? 'builder envelope, ' : ''
          }EL fork: ${forkLabel(result.elModel.fork.name)}${
            isUpcoming(result.elModel.fork) ? ' (upcoming)' : ''
          }`}
        >
          {result.envelope !== null && (
            <p className="text-xs/5 text-ink-muted">
              ePBS (EIP-7732): the block carries only the builder's bid; the builder reveals this
              envelope as its own gossip message mid-slot.
            </p>
          )}
          <Row label="Transactions" value={formatCount(result.payloadPlan.txCount)} />
          <Row label="Calldata" value={formatBytes(result.payloadPlan.totalCalldataBytes)} />
          {balRow(result)}
          <Row
            label={`Gas per calldata byte (${scenario})`}
            value={gasPerByte(result.elModel, scenario).toFixed(1)}
          />
          <Row
            label="Calldata pricing"
            value={
              result.elModel.floorTokenCost !== null
                ? `floor ${result.elModel.floorTokenCost}/token (EIP-7623)`
                : `standard ${result.elModel.standardTokenCost}/token`
            }
          />
          {result.elModel.txMaxGasLimit !== null && (
            <Row
              label="Per-tx gas cap (EIP-7825)"
              value={formatCount(result.elModel.txMaxGasLimit)}
            />
          )}
          {result.elModel.maxBlockBytes !== null && (
            <Row
              label="RLP block cap (EIP-7934)"
              value={formatBytes(result.elModel.maxBlockBytes)}
            />
          )}
          {result.envelope !== null && (
            <>
              <Row label="Envelope raw SSZ" value={formatBytes(result.envelope.sszBytes)} />
              <Row
                label="Envelope gossip (measured)"
                value={formatBytes(result.envelope.gossipBytes)}
              />
            </>
          )}
        </Card>
      ) : (
        <Card title="Execution payload">
          <p>Not part of the beacon block at this fork.</p>
        </Card>
      )}

      <Card title="Beacon block wire sizes">
        <Row label="Raw SSZ" value={formatBytes(result.sszBytes)} />
        <Row label="Gossip (Snappy, measured)" value={formatBytes(result.gossipBytes)} />
        <Row label="Req/resp (framed, measured)" value={formatBytes(result.framedBytes)} />
        <Row label="Snappy analytic ceiling" value={formatBytes(result.snappyCeiling)} />
        {result.gossipLimit !== null && (
          <Row label="Gossip message limit" value={formatBytes(result.gossipLimit)} />
        )}
        <Row label="Spec max (unconstrained SSZ)" value={formatBytes(result.specMaxBytes)} />
      </Card>

      {result.sidecars.length > 0 && (
        <Card title="Gossiped alongside the block">
          {result.sidecars.map((s) => (
            <div key={s.container} className="flex flex-col gap-1">
              <Row
                label={`${s.container}${s.note !== undefined ? ` — ${s.note}` : ''}`}
                value={`${formatCount(s.count)} × ${formatBytes(s.bytesEach)}`}
              />
              <Row label="Total" value={formatBytes(s.totalBytes)} />
              {s.gossipCap !== null && (
                <Row
                  label={
                    s.bytesEach > BigInt(s.gossipCap)
                      ? '⚠ exceeds per-message gossip cap'
                      : 'Per-message gossip cap'
                  }
                  value={formatBytes(s.gossipCap)}
                />
              )}
            </div>
          ))}
        </Card>
      )}

      {eips.length > 0 && (
        <Card title={`${forkLabel(fork)} EIPs (from spec markdown)`}>
          <p className="flex flex-wrap gap-1.5">
            {eips.map((eip) => (
              <a
                key={eip}
                href={`https://eips.ethereum.org/EIPS/eip-${eip}`}
                className="rounded-sm border border-hairline px-1.5 py-0.5 font-mono text-xs/5 hover:border-ink-muted hover:text-ink"
              >
                {eip}
              </a>
            ))}
          </p>
        </Card>
      )}
    </div>
  );
}
