/**
 * Money is an integer number of minor units (cents) plus an ISO 4217 code.
 * Floats never hold a price: 0.1 + 0.2 is not 0.3, and a till that drifts by a
 * cent a day is wrong by a lot more over a year.
 */
export type Money = {
  readonly minor: number;
  readonly currency: string;
};

export const money = (minor: number, currency: string): Money => {
  if (!Number.isInteger(minor)) {
    throw new RangeError(`money: ${minor} is not a whole number of minor units`);
  }
  return { minor, currency };
};

/** Grams to kilograms. Weights are stored as integer grams. */
export const toKg = (grams: number): number => grams / 1000;

/** Kilograms to integer grams, for building inputs. */
export const kg = (kilos: number): number => Math.round(kilos * 1000);
