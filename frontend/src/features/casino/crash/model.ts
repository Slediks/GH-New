// Same input domain as rooms.py / money.minor; this validates the visual comparison only.
const AUTO_MIN = 101n;
const AUTO_MAX = 9_000_000_000_000_000n;
export function autoThreshold(value: string, enabled: boolean): number | null {
  if (!enabled || !/^\d{1,14}(?:[.,]\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.replace(',', '.').split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return minor >= AUTO_MIN && minor <= AUTO_MAX ? Number(minor) : null;
}
export function getResultStatus(result: number | undefined, threshold: number | null) {
  if (threshold === null || result === undefined || !Number.isFinite(result)) return 'neutral';
  // rooms.py gives crash priority on equality; changing this would misrepresent payouts.
  return result > threshold ? 'high' : 'low';
}

export const FLIGHT = {
  left: 30,
  right: 550,
  bottom: 260,
  top: 60,
  horizontalHalfAt: 2,
  samples: 40,
};
export function flightPoint(multiplier: number) {
  const m = Math.max(1, Number.isFinite(multiplier) ? multiplier / 100 : 1);
  const growth = Math.log(m);
  return {
    x:
      FLIGHT.left +
      ((FLIGHT.right - FLIGHT.left) * growth) / (growth + Math.log(FLIGHT.horizontalHalfAt)),
    y: FLIGHT.bottom - (FLIGHT.bottom - FLIGHT.top) * (1 - 1 / m),
  };
}
export function flightPath(multiplier: number) {
  const log = Math.log(Math.max(100, multiplier) / 100);
  return Array.from({ length: FLIGHT.samples + 1 }, (_, i) => {
    const point = flightPoint(
      i === FLIGHT.samples ? multiplier : 100 * Math.exp((log * i) / FLIGHT.samples),
    );
    return `${point.x},${point.y}`;
  }).join(' ');
}
