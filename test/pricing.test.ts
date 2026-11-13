import { describe, expect, it } from 'vitest';
import {
  type TariffGrid,
  deadZones,
  homeSurcharge,
  inDeadZone,
  isBulky,
  kg,
  marginFor,
  money,
  parseGrid,
  priceGap,
  quote,
} from '../src/index.js';

/** An example card, made up for these tests: 3 €/kg, 8 kg minimum at the counter, 20 kg to the door. */
const EXAMPLE: TariffGrid = {
  currency: 'EUR',
  perKgMinor: 300,
  agencyMinKg: 8,
  agencyFlatMinor: 3000,
  homeMinKg: 20,
  homeFlatMinor: 7500,
  bulkyIsManual: true,
  homeSurchargeByZoneMinor: {},
  homeSurchargeByCityMinor: {},
  costPerKgMinor: 0,
};

const BULKY = ['bike', 'fridge'] as const;
const minor = (q: ReturnType<typeof quote>) => q.price?.minor ?? null;

describe('the example card, as published', () => {
  it.each([
    [7, 'agency', 3000],
    [8, 'agency', 2400],
    [12, 'agency', 3600],
    [19, 'home', 7500],
    [20, 'home', 6000],
    [50, 'home', 15000],
  ] as const)('%i kg %s costs %i cents', (weightKg, mode, expected) => {
    expect(minor(quote({ weight: kg(weightKg), deliveryMode: mode }, EXAMPLE, BULKY))).toBe(expected);
  });

  it('calls a price below the minimum flat, and one above it per kilo', () => {
    expect(quote({ weight: kg(7), deliveryMode: 'agency' }, EXAMPLE, BULKY).basis).toBe('flat');
    expect(quote({ weight: kg(8), deliveryMode: 'agency' }, EXAMPLE, BULKY).basis).toBe('perKg');
  });
});

describe('the dead zone', () => {
  it('charges more at 7 kg than at 8 kg', () => {
    const at7 = minor(quote({ weight: kg(7), deliveryMode: 'agency' }, EXAMPLE, BULKY))!;
    const at8 = minor(quote({ weight: kg(8), deliveryMode: 'agency' }, EXAMPLE, BULKY))!;
    expect(at7 - at8).toBe(600);
  });

  it('tells the counter exactly what to offer', () => {
    const q = quote({ weight: kg(18), deliveryMode: 'home' }, EXAMPLE, BULKY);
    expect(q.alerts.find((a) => a.kind === 'deadZone')).toEqual({
      kind: 'deadZone',
      addKg: 2,
      newPrice: money(6000, 'EUR'),
      saving: money(1500, 'EUR'),
    });
  });

  it('fires everywhere below the minimum and nowhere at or above it', () => {
    for (let g = 0; g < kg(8); g += 250) expect(inDeadZone(g, 'agency', EXAMPLE)).toBe(true);
    for (let g = kg(8); g <= kg(30); g += 250) expect(inDeadZone(g, 'agency', EXAMPLE)).toBe(false);
  });

  it('does not fire when the flat fee is cheaper than the minimum', () => {
    const fair = { ...EXAMPLE, agencyFlatMinor: 2000 };
    expect(inDeadZone(kg(5), 'agency', fair)).toBe(false);
  });

  it('does not fire when the flat fee equals the price at the minimum', () => {
    const equal = { ...EXAMPLE, agencyFlatMinor: 2400 };
    const q = quote({ weight: kg(5), deliveryMode: 'agency' }, equal, BULKY);
    expect(q.alerts.some((a) => a.kind === 'deadZone')).toBe(false);
  });

  it('follows another carrier’s card, in another currency', () => {
    const other: TariffGrid = { ...EXAMPLE, currency: 'USD', perKgMinor: 450, agencyMinKg: 5, agencyFlatMinor: 2500 };
    const q = quote({ weight: kg(4), deliveryMode: 'agency' }, other, BULKY);
    expect(q.price).toEqual(money(2500, 'USD'));
    expect(q.alerts[0]).toEqual({ kind: 'deadZone', addKg: 1, newPrice: money(2250, 'USD'), saving: money(250, 'USD') });
  });
});

describe('weight already paid for by the flat fee', () => {
  it('30 € at 3 €/kg covers 10 kg', () => {
    const q = quote({ weight: kg(7), deliveryMode: 'agency' }, EXAMPLE, BULKY);
    expect(q.alerts.find((a) => a.kind === 'headroom')).toEqual({ kind: 'headroom', freeKg: 3, upToKg: 10 });
  });

  it('75 € at 3 €/kg covers 25 kg', () => {
    const q = quote({ weight: kg(19), deliveryMode: 'home' }, EXAMPLE, BULKY);
    expect(q.alerts.find((a) => a.kind === 'headroom')).toEqual({ kind: 'headroom', freeKg: 6, upToKg: 25 });
  });

  it('rounds to two decimals', () => {
    const fair = { ...EXAMPLE, agencyFlatMinor: 2000 };
    const q = quote({ weight: kg(5), deliveryMode: 'agency' }, fair, BULKY);
    expect(q.alerts).toEqual([{ kind: 'headroom', freeKg: 1.67, upToKg: 6.67 }]);
  });

  it('says nothing above the minimum', () => {
    expect(quote({ weight: kg(9), deliveryMode: 'agency' }, EXAMPLE, BULKY).alerts).toEqual([]);
  });

  it('says nothing once the flat fee covers no more weight', () => {
    const tight = { ...EXAMPLE, agencyMinKg: 12, agencyFlatMinor: 3000 }; // covers exactly 10 kg
    const q = quote({ weight: kg(10), deliveryMode: 'agency' }, tight, BULKY);
    expect(q.alerts.some((a) => a.kind === 'headroom')).toBe(false);
  });

  it('survives a card with no per-kilo rate without dividing by zero', () => {
    const flatOnly = { ...EXAMPLE, perKgMinor: 0 };
    const q = quote({ weight: kg(5), deliveryMode: 'agency' }, flatOnly, BULKY);
    expect(q.price).toEqual(money(3000, 'EUR'));
    expect(q.alerts.some((a) => a.kind === 'headroom')).toBe(false);
  });
});

describe('edge weights', () => {
  it('prices fractional kilos without float drift', () => {
    expect(minor(quote({ weight: kg(10.25), deliveryMode: 'agency' }, EXAMPLE, BULKY))).toBe(3075);
  });

  it('quotes an empty shipment at the flat fee rather than nothing', () => {
    expect(minor(quote({ weight: 0, deliveryMode: 'agency' }, EXAMPLE, BULKY))).toBe(3000);
  });

  it('prices every weight per kilo when the card has no minimum', () => {
    const noMin = { ...EXAMPLE, agencyMinKg: 0, agencyFlatMinor: 0 };
    expect(minor(quote({ weight: kg(1), deliveryMode: 'agency' }, noMin, BULKY))).toBe(300);
  });
});

describe('bulky goods are negotiated, not computed', () => {
  it('recognises the carrier’s bulky tags', () => {
    expect(isBulky(['bags', 'bike'], BULKY)).toBe(true);
    expect(isBulky(['bags'], BULKY)).toBe(false);
    expect(isBulky([], BULKY)).toBe(false);
  });

  it('honours a carrier who declares a rug bulky', () => {
    const q = quote({ weight: kg(10), deliveryMode: 'home', tags: ['rug'] }, EXAMPLE, ['rug']);
    expect(q.basis).toBe('bulky');
  });

  it('honours a carrier who does not consider a bike bulky', () => {
    const q = quote({ weight: kg(25), deliveryMode: 'home', tags: ['bike'] }, EXAMPLE, ['fridge']);
    expect(q).toMatchObject({ basis: 'perKg', price: money(7500, 'EUR') });
  });

  it('has no price until someone enters one, when the whole shipment is bulky', () => {
    const q = quote({ weight: kg(30), deliveryMode: 'home', tags: ['fridge'] }, EXAMPLE, BULKY);
    expect(q).toEqual({ price: null, basis: 'bulky', alerts: [], ordinaryPart: null, bulkyPart: null });
  });

  it('takes the negotiated amount once entered', () => {
    const q = quote({ weight: kg(30), deliveryMode: 'home', tags: ['fridge'], bulkyFlatMinor: 4000 }, EXAMPLE, BULKY);
    expect(q.price).toEqual(money(4000, 'EUR'));
    expect(q.bulkyPart).toEqual(money(4000, 'EUR'));
  });

  it('can be forced even when no tag says so', () => {
    const q = quote({ weight: kg(30), deliveryMode: 'home', bulky: true, bulkyFlatMinor: 4000 }, EXAMPLE, BULKY);
    expect(q.basis).toBe('bulky');
  });

  it('can be switched off for one shipment even when a tag says so', () => {
    const q = quote({ weight: kg(25), deliveryMode: 'home', tags: ['bike'], bulky: false }, EXAMPLE, BULKY);
    expect(q.basis).toBe('perKg');
  });

  it('falls through to normal pricing when the card does not treat bulky goods by hand', () => {
    const auto = { ...EXAMPLE, bulkyIsManual: false };
    const q = quote({ weight: kg(10), deliveryMode: 'home', tags: ['bike'], bulkyFlatMinor: 1000 }, auto, BULKY);
    expect(q).toMatchObject({ basis: 'mixed', ordinaryPart: money(7500, 'EUR'), price: money(8500, 'EUR') });
  });
});

describe('mixed shipments: a bike among the bags', () => {
  const mixed = { weight: kg(40), deliveryMode: 'home' as const, tags: ['bags', 'bike'], bulkyWeight: kg(10) };

  it('prices the 30 kg of bags per kilo and adds the bike', () => {
    const q = quote({ ...mixed, bulkyFlatMinor: 5000 }, EXAMPLE, BULKY);
    expect(q).toMatchObject({ basis: 'mixed', ordinaryPart: money(9000, 'EUR'), bulkyPart: money(5000, 'EUR'), price: money(14000, 'EUR') });
  });

  it('shows the per-kilo part before the bike is priced', () => {
    const q = quote(mixed, EXAMPLE, BULKY);
    expect(q).toMatchObject({ price: null, ordinaryPart: money(9000, 'EUR'), bulkyPart: null });
  });

  it('puts a light ordinary part on the flat fee and warns about the dead zone', () => {
    const q = quote({ ...mixed, weight: kg(25) }, EXAMPLE, BULKY);
    expect(q.ordinaryPart).toEqual(money(7500, 'EUR'));
    expect(q.alerts.find((a) => a.kind === 'deadZone')).toMatchObject({ addKg: 5 });
  });

  it('treats everything as bulky when the split is unknown', () => {
    const q = quote({ weight: kg(40), deliveryMode: 'home', tags: ['bike'] }, EXAMPLE, BULKY);
    expect(q.basis).toBe('bulky');
  });

  it('never lets the bulky weight exceed the shipment', () => {
    const q = quote({ weight: kg(10), deliveryMode: 'home', tags: ['bike'], bulkyWeight: kg(20) }, EXAMPLE, BULKY);
    expect(q.basis).toBe('bulky');
  });

  it('ignores a bulky weight on a shipment with nothing bulky', () => {
    const q = quote({ weight: kg(40), deliveryMode: 'home', tags: ['bags'], bulkyWeight: kg(10) }, EXAMPLE, BULKY);
    expect(q).toEqual({ price: money(12000, 'EUR'), basis: 'perKg', alerts: [], ordinaryPart: money(12000, 'EUR'), bulkyPart: null });
  });
});

describe('door-delivery surcharge', () => {
  const grid: TariffGrid = {
    ...EXAMPLE,
    homeSurchargeByCityMinor: { 'city-a': 500 },
    homeSurchargeByZoneMinor: { north: 300 },
  };

  it('adds the city surcharge to the per-kilo price', () => {
    expect(minor(quote({ weight: kg(20), deliveryMode: 'home', cityId: 'city-a' }, grid, BULKY))).toBe(6500);
  });

  it('adds it to the flat fee too', () => {
    expect(minor(quote({ weight: kg(19), deliveryMode: 'home', cityId: 'city-a' }, grid, BULKY))).toBe(8000);
  });

  it('falls back to the zone when the city has no entry', () => {
    expect(homeSurcharge(grid, { cityId: 'city-b', zone: 'north' })).toBe(300);
  });

  it('lets the city win when both are set', () => {
    expect(homeSurcharge(grid, { cityId: 'city-a', zone: 'north' })).toBe(500);
  });

  it('adds nothing when neither is in the table', () => {
    expect(homeSurcharge(grid, { cityId: 'city-b', zone: 'south' })).toBe(0);
    expect(homeSurcharge(grid, {})).toBe(0);
  });

  it('does not look up a missing city or zone as the key "undefined"', () => {
    const odd = { ...EXAMPLE, homeSurchargeByCityMinor: { undefined: 999 }, homeSurchargeByZoneMinor: { undefined: 888 } };
    expect(homeSurcharge(odd, {})).toBe(0);
  });

  it('never applies to a parcel collected at the counter', () => {
    expect(minor(quote({ weight: kg(8), deliveryMode: 'agency', cityId: 'city-a' }, grid, BULKY))).toBe(2400);
  });
});

describe('price gap: negotiation is recorded, never blocked', () => {
  it('reports a discount as negative', () => {
    expect(priceGap(money(6000, 'EUR'), money(5500, 'EUR'))).toEqual(money(-500, 'EUR'));
  });

  it('reports an uplift as positive', () => {
    expect(priceGap(money(6000, 'EUR'), money(6200, 'EUR'))).toEqual(money(200, 'EUR'));
  });

  it('refuses to compare across currencies', () => {
    expect(priceGap(money(6000, 'EUR'), money(6000, 'USD'))).toBeNull();
  });

  it('has no opinion when either side is missing', () => {
    expect(priceGap(null, money(6000, 'EUR'))).toBeNull();
    expect(priceGap(money(6000, 'EUR'), null)).toBeNull();
  });
});

describe('cost and margin', () => {
  const costed = { ...EXAMPLE, costPerKgMinor: 100 };

  it('computes cost, margin and basis points', () => {
    expect(marginFor({ weight: kg(20), price: money(6000, 'EUR') }, costed)).toEqual({
      cost: money(2000, 'EUR'),
      margin: money(4000, 'EUR'),
      marginBp: 6667,
    });
  });

  it('shows nothing rather than a fake margin when no cost is set', () => {
    expect(marginFor({ weight: kg(20), price: money(6000, 'EUR') }, EXAMPLE)).toBeNull();
  });

  it('shows nothing when the shipment has no price yet', () => {
    expect(marginFor({ weight: kg(20), price: null }, costed)).toBeNull();
  });

  it('reports a negative margin instead of hiding it', () => {
    const dear = { ...EXAMPLE, costPerKgMinor: 700 };
    expect(marginFor({ weight: kg(5), price: money(3000, 'EUR') }, dear)).toEqual({
      cost: money(3500, 'EUR'),
      margin: money(-500, 'EUR'),
      marginBp: -1667,
    });
  });

  it('gives a zero ratio for a free shipment rather than dividing by zero', () => {
    expect(marginFor({ weight: kg(1), price: money(0, 'EUR') }, costed)?.marginBp).toBe(0);
  });
});

describe('auditing a whole card', () => {
  it('lists the dead-zone band for each delivery mode', () => {
    expect(deadZones(EXAMPLE)).toEqual([
      { mode: 'agency', fromKg: 0, toKg: 8 },
      { mode: 'home', fromKg: 0, toKg: 20 },
    ]);
  });

  it('is empty for a card without the defect', () => {
    expect(deadZones({ ...EXAMPLE, agencyFlatMinor: 2000, homeFlatMinor: 6000 })).toEqual([]);
  });

  it('skips a mode with no minimum or no per-kilo rate', () => {
    expect(deadZones({ ...EXAMPLE, agencyMinKg: 0 })).toEqual([{ mode: 'home', fromKg: 0, toKg: 20 }]);
    expect(deadZones({ ...EXAMPLE, perKgMinor: 0 })).toEqual([]);
  });
});

describe('reading a card from config', () => {
  it('fills empty fields with "none"', () => {
    expect(parseGrid({ currency: 'EUR', perKgMinor: 300 })).toEqual({
      currency: 'EUR',
      perKgMinor: 300,
      agencyMinKg: 0,
      agencyFlatMinor: 0,
      homeMinKg: 0,
      homeFlatMinor: 0,
      bulkyIsManual: true,
      homeSurchargeByZoneMinor: {},
      homeSurchargeByCityMinor: {},
      costPerKgMinor: 0,
    });
  });

  it('rejects a currency that is not an ISO code', () => {
    expect(() => parseGrid({ currency: 'eur' })).toThrow();
    expect(() => parseGrid({ currency: 'EURO' })).toThrow();
  });

  it('rejects a negative or fractional price', () => {
    expect(() => parseGrid({ currency: 'EUR', perKgMinor: -1 })).toThrow();
    expect(() => parseGrid({ currency: 'EUR', perKgMinor: 2.5 })).toThrow();
  });
});

describe('money', () => {
  it('refuses a fraction of a cent', () => {
    expect(() => money(10.5, 'EUR')).toThrow(new RangeError('money: 10.5 is not a whole number of minor units'));
  });
});
