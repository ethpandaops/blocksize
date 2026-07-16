const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'];

export function formatBytes(value: bigint | number, digits = 2): string {
  let n = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isFinite(n)) return '∞';
  if (n < 1024) return `${Math.round(n).toLocaleString()} B`;
  let unit = 0;
  while (n >= 1024 && unit < UNITS.length - 1) {
    n /= 1024;
    unit += 1;
  }
  return `${n.toFixed(digits)} ${UNITS[unit]}`;
}

export function formatCount(value: number | bigint): string {
  return value.toLocaleString('en-US');
}

export function formatGas(gas: number): string {
  if (gas >= 1_000_000_000) return `${(gas / 1_000_000_000).toFixed(1)}G`;
  return `${Math.round(gas / 1_000_000)}M`;
}

/** Human name for a snake_case schema field. */
export function fieldLabel(name: string): string {
  return name.replaceAll('_', ' ').replace(/\bkzg\b/i, 'KZG').replace(/\bbls\b/i, 'BLS');
}

export function forkLabel(fork: string): string {
  if (fork.startsWith('eip')) return `EIP-${fork.slice(3)}`;
  return fork.charAt(0).toUpperCase() + fork.slice(1);
}
