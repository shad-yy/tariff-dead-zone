import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type TariffGrid, quote } from '../src/index.js';

/** Any sane card: whole-cent prices, minimums up to 50 kg. */
const gridArb: fc.Arbitrary<TariffGrid> = fc.record({
  currency: fc.constantFrom('EUR', 'USD', 'MAD'),
  perKgMinor: fc.integer({ min: 1, max: 2000 }),
  agencyMinKg: fc.integer({ min: 0, max: 50 }),
  agencyFlatMinor: fc.integer({ min: 0, max: 50_000 }),
  homeMinKg: fc.integer({ min: 0, max: 50 }),
  homeFlatMinor: fc.integer({ min: 0, max: 50_000 }),
  bulkyIsManual: fc.constant(true),
  homeSurchargeByZoneMinor: fc.constant({}),
  homeSurchargeByCityMinor: fc.constant({}),
  costPerKgMinor: fc.constant(0),
});

const modeArb = fc.constantFrom('agency' as const, 'home' as const);
const gramsArb = fc.integer({ min: 0, max: 200_000 });

describe('properties that hold for any card', () => {
  it('always returns a whole, non-negative number of cents', () => {
    fc.assert(
      fc.property(gridArb, modeArb, gramsArb, (grid, mode, grams) => {
        const p = quote({ weight: grams, deliveryMode: mode }, grid, []).price!;
        expect(Number.isInteger(p.minor)).toBe(true);
        expect(p.minor).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('never charges less for more weight at or above the minimum', () => {
    fc.assert(
      fc.property(gridArb, modeArb, gramsArb, gramsArb, (grid, mode, a, b) => {
        const min = (mode === 'agency' ? grid.agencyMinKg : grid.homeMinKg) * 1000;
        const [lo, hi] = [Math.max(a, min), Math.max(b, min)].sort((x, y) => x - y) as [number, number];
        const pLo = quote({ weight: lo, deliveryMode: mode }, grid, []).price!.minor;
        const pHi = quote({ weight: hi, deliveryMode: mode }, grid, []).price!.minor;
        expect(pHi).toBeGreaterThanOrEqual(pLo);
      }),
    );
  });

  it('dead-zone advice is always true: adding the suggested weight gives the promised, lower price', () => {
    fc.assert(
      fc.property(gridArb, modeArb, gramsArb, (grid, mode, grams) => {
        const q = quote({ weight: grams, deliveryMode: mode }, grid, []);
        const alert = q.alerts.find((a) => a.kind === 'deadZone');
        if (!alert || alert.kind !== 'deadZone') return;
        const min = mode === 'agency' ? grid.agencyMinKg : grid.homeMinKg;
        const after = quote({ weight: min * 1000, deliveryMode: mode }, grid, []);
        expect(after.price).toEqual(alert.newPrice);
        expect(q.price!.minor - after.price!.minor).toBe(alert.saving.minor);
        expect(alert.saving.minor).toBeGreaterThan(0);
      }),
    );
  });

  it('fires the dead-zone alert exactly when the flat fee beats the price at the minimum', () => {
    fc.assert(
      fc.property(gridArb, modeArb, gramsArb, (grid, mode, grams) => {
        const [minKg, flat] = mode === 'agency' ? [grid.agencyMinKg, grid.agencyFlatMinor] : [grid.homeMinKg, grid.homeFlatMinor];
        const expected = grams < minKg * 1000 && Math.round(minKg * grid.perKgMinor) < flat;
        const fired = quote({ weight: grams, deliveryMode: mode }, grid, []).alerts.some((a) => a.kind === 'deadZone');
        expect(fired).toBe(expected);
      }),
    );
  });
});
