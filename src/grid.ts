import { z } from 'zod';

/**
 * A carrier's published tariff card.
 *
 * Every number is the carrier's to set. An empty field means "none": no
 * minimum, no flat fee, just kilos times the price per kilo. Nothing in the
 * pricing code assumes any particular rate.
 */
export const TariffGrid = z.object({
  /** ISO 4217 code, e.g. "EUR". */
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** Price per kilogram in minor units: 3 €/kg is 300. */
  perKgMinor: z.number().int().nonnegative().default(0),

  /** Minimum billable weight when the customer brings the parcel in. 0 = none. */
  agencyMinKg: z.number().nonnegative().default(0),
  /** Flat fee charged below that minimum. */
  agencyFlatMinor: z.number().int().nonnegative().default(0),

  /** Minimum billable weight for delivery to the door. 0 = none. */
  homeMinKg: z.number().nonnegative().default(0),
  homeFlatMinor: z.number().int().nonnegative().default(0),

  /** Bulky goods are a negotiated flat amount; per-kilo pricing does not apply. */
  bulkyIsManual: z.boolean().default(true),

  /** Extra charge for door delivery, by zone and by city. City wins over zone. */
  homeSurchargeByZoneMinor: z.record(z.string(), z.number().int()).default({}),
  homeSurchargeByCityMinor: z.record(z.string(), z.number().int()).default({}),

  /** What a kilo costs the carrier to move. 0 = not known yet, so no margin is shown. */
  costPerKgMinor: z.number().int().nonnegative().default(0),
});

export type TariffGrid = z.infer<typeof TariffGrid>;

export type DeliveryMode = 'agency' | 'home';

/** Validate untrusted config (a settings form, a JSON file) into a grid. */
export const parseGrid = (input: unknown): TariffGrid => TariffGrid.parse(input);
