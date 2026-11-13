import type { DeliveryMode, TariffGrid } from './grid.js';
import { type Money, money, toKg } from './money.js';

/**
 * Pricing for a per-kilo parcel tariff with a minimum weight and a flat fee
 * below it, and the defect that kind of card usually has.
 *
 * Take a card of 3 €/kg, minimum 8 kg, otherwise a flat 30 €. At 7 kg the
 * customer pays 30 €. At 8 kg they pay 24 €. Sending less costs more: that band
 * below the minimum is the dead zone.
 *
 * The code does not fix the card. Customers already know the published rates,
 * and changing them is the carrier's decision. It tells the person at the
 * counter what to offer instead: "add 1 kg and the price drops to 24 €".
 * Every alert is derived from whatever grid is passed in.
 */

export type PricingAlert =
  /** Below the minimum, the flat fee costs more than the per-kilo price at the minimum. */
  | { kind: 'deadZone'; addKg: number; newPrice: Money; saving: Money }
  /** Weight the customer has already paid for: 30 € at 3 €/kg covers 10 kg. */
  | { kind: 'headroom'; freeKg: number; upToKg: number };

export type Quote = {
  /** Null only when a bulky amount is needed and has not been entered yet. */
  price: Money | null;
  basis: 'perKg' | 'flat' | 'bulky' | 'mixed';
  alerts: PricingAlert[];
  /** The per-kilo or flat part, before any bulky amount. */
  ordinaryPart: Money | null;
  /** The negotiated amount for bulky items. */
  bulkyPart: Money | null;
};

export type QuoteInput = {
  /** Total weight in integer grams. */
  weight: number;
  deliveryMode: DeliveryMode;
  /** What is in the shipment, as the carrier's own tags ("bike", "bags", ...). */
  tags?: readonly string[];
  /** Grams belonging to the bulky items, so the rest can still be priced per kilo. */
  bulkyWeight?: number;
  /** Negotiated total for the bulky items. Undefined means "not quoted yet". */
  bulkyFlatMinor?: number;
  /** Treat the shipment as bulky even if no tag says so. */
  bulky?: boolean;
  /** Destination, for the door-delivery surcharge. City wins over zone. */
  cityId?: string;
  zone?: string;
};

/**
 * Does any tag appear in the carrier's bulky list? The list is a required
 * argument on purpose: a built-in default would quietly overrule a carrier who
 * decided differently.
 */
export const isBulky = (tags: readonly string[], bulkyTags: readonly string[]): boolean =>
  tags.some((t) => bulkyTags.includes(t));

/** Door-delivery surcharge for a destination. City beats zone; nothing set means 0. */
export const homeSurcharge = (
  grid: TariffGrid,
  where: { cityId?: string | undefined; zone?: string | undefined },
): number => {
  if (where.cityId !== undefined) {
    const byCity = grid.homeSurchargeByCityMinor[where.cityId];
    if (byCity !== undefined) return byCity;
  }
  if (where.zone !== undefined) {
    const byZone = grid.homeSurchargeByZoneMinor[where.zone];
    if (byZone !== undefined) return byZone;
  }
  return 0;
};

const bandFor = (grid: TariffGrid, mode: DeliveryMode) =>
  mode === 'agency'
    ? { minKg: grid.agencyMinKg, flatMinor: grid.agencyFlatMinor }
    : { minKg: grid.homeMinKg, flatMinor: grid.homeFlatMinor };

const perKgPrice = (grid: TariffGrid, kilos: number): number => Math.round(kilos * grid.perKgMinor);

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Quote a shipment at the grid price.
 *
 * The grid price is a starting point, not a lock: staff can always charge
 * something else, and `priceGap` records the difference.
 */
export const quote = (
  input: QuoteInput,
  grid: TariffGrid,
  /** The carrier's own list of bulky tags. */
  bulkyTags: readonly string[],
): Quote => {
  const hasBulky = input.bulky ?? isBulky(input.tags ?? [], bulkyTags);
  const bulkyFlat = input.bulkyFlatMinor;
  const bulkyPart = bulkyFlat === undefined ? null : money(bulkyFlat, grid.currency);

  // A bike among ten bags is normal. The bulky weight is taken out and the rest
  // is priced per kilo, instead of throwing the whole shipment onto a
  // negotiated price.
  const bulkyWeight = hasBulky ? Math.min(input.bulkyWeight ?? input.weight, input.weight) : 0;
  const ordinaryWeight = input.weight - bulkyWeight;

  if (hasBulky && grid.bulkyIsManual && ordinaryWeight === 0) {
    return { price: bulkyPart, basis: 'bulky', alerts: [], ordinaryPart: null, bulkyPart };
  }

  const kilos = toKg(ordinaryWeight);
  const { minKg, flatMinor } = bandFor(grid, input.deliveryMode);
  const alerts: PricingAlert[] = [];

  // Door delivery only: a parcel collected at the counter has no doorstep.
  const surcharge =
    input.deliveryMode === 'home' ? homeSurcharge(grid, { cityId: input.cityId, zone: input.zone }) : 0;

  const withBulky = (ordinary: Money, basis: Quote['basis']): Quote => {
    if (!hasBulky) return { price: ordinary, basis, alerts, ordinaryPart: ordinary, bulkyPart: null };
    return {
      // No total until the bulky amount is entered; the ordinary part still shows.
      price: bulkyPart === null ? null : money(ordinary.minor + bulkyPart.minor, grid.currency),
      basis: 'mixed',
      alerts,
      ordinaryPart: ordinary,
      bulkyPart,
    };
  };

  if (kilos >= minKg) {
    return withBulky(money(perKgPrice(grid, kilos) + surcharge, grid.currency), 'perKg');
  }

  const atThreshold = perKgPrice(grid, minKg);

  if (atThreshold < flatMinor) {
    alerts.push({
      kind: 'deadZone',
      addKg: round2(minKg - kilos),
      newPrice: money(atThreshold, grid.currency),
      saving: money(flatMinor - atThreshold, grid.currency),
    });
  }

  // What the flat fee already pays for. A zero per-kilo rate would divide by zero.
  if (grid.perKgMinor > 0) {
    const upToKg = flatMinor / grid.perKgMinor;
    const freeKg = round2(upToKg - kilos);
    if (freeKg > 0) {
      alerts.push({ kind: 'headroom', freeKg, upToKg: round2(upToKg) });
    }
  }

  return withBulky(money(flatMinor + surcharge, grid.currency), 'flat');
};

export type Margin = {
  cost: Money;
  margin: Money;
  /** Margin as basis points of the price (1 bp = 0.01%), so no float reaches a percentage. */
  marginBp: number;
};

/**
 * Cost and margin for a priced shipment. Null when the carrier has not entered
 * a cost per kilo, or the shipment has no price yet: a margin computed against
 * a zero cost would read as pure profit, which is worse than showing nothing.
 */
export const marginFor = (input: { weight: number; price: Money | null }, grid: TariffGrid): Margin | null => {
  if (input.price === null || grid.costPerKgMinor <= 0) return null;
  const cost = Math.round(toKg(input.weight) * grid.costPerKgMinor);
  const margin = input.price.minor - cost;
  return {
    cost: money(cost, grid.currency),
    margin: money(margin, grid.currency),
    marginBp: input.price.minor === 0 ? 0 : Math.round((margin / input.price.minor) * 10_000),
  };
};

/**
 * What was charged minus what the grid proposed. Positive: the customer paid
 * more than the grid. Negative: a discount. Null when either side is missing or
 * the currencies differ, rather than guessing an exchange rate.
 */
export const priceGap = (gridPrice: Money | null, actual: Money | null): Money | null => {
  if (gridPrice === null || actual === null) return null;
  if (gridPrice.currency !== actual.currency) return null;
  return money(actual.minor - gridPrice.minor, actual.currency);
};

/** Is this weight inside the dead zone for a delivery mode? */
export const inDeadZone = (weightGrams: number, mode: DeliveryMode, grid: TariffGrid): boolean =>
  quote({ weight: weightGrams, deliveryMode: mode }, grid, []).alerts.some((a) => a.kind === 'deadZone');

/**
 * Every dead-zone band in a grid, as [fromKg, toKg) per delivery mode. Empty
 * when the card has no defect. Useful to audit a card before publishing it.
 */
export const deadZones = (grid: TariffGrid): { mode: DeliveryMode; fromKg: number; toKg: number }[] => {
  const out: { mode: DeliveryMode; fromKg: number; toKg: number }[] = [];
  for (const mode of ['agency', 'home'] as const) {
    const { minKg, flatMinor } = bandFor(grid, mode);
    if (minKg <= 0 || grid.perKgMinor <= 0) continue;
    // If the flat fee is more than the price at the minimum, every weight below
    // the minimum pays more than the minimum itself would.
    if (perKgPrice(grid, minKg) >= flatMinor) continue;
    out.push({ mode, fromKg: 0, toKg: minKg });
  }
  return out;
};
