# tariff-dead-zone

Prices parcels on a per-kilo tariff with a minimum weight and a flat fee below it, and finds the weights where **sending less costs more**.

## The problem

Plenty of carriers publish a card like this one (the numbers are made up):

| | Price |
|---|---|
| Per kilo | 3 € |
| Collected at the counter | minimum 8 kg, otherwise a flat 30 € |
| Delivered to the door | minimum 20 kg, otherwise a flat 75 € |

At the counter, 7 kg costs 30 € and 8 kg costs 24 €. A customer with 7 kg pays 6 € more than a customer with 8 kg. Every weight below the minimum is in that dead zone.

The code doesn't change the card. The rates belong to the carrier, and customers already know them. It tells the person at the counter what to say instead: "add 1 kg and it drops to 24 €". It also says how much weight the flat fee already covers (30 € at 3 €/kg covers 10 kg).

## Use

It isn't on npm. Clone the repo and import from `src/`:

```ts
import { kg, parseGrid, quote, deadZones } from './src/index.js';

const grid = parseGrid({
  currency: 'EUR',
  perKgMinor: 300,
  agencyMinKg: 8,
  agencyFlatMinor: 3000,
  homeMinKg: 20,
  homeFlatMinor: 7500,
});

quote({ weight: kg(7), deliveryMode: 'agency' }, grid, []);
// price: 3000 cents, basis: 'flat', alerts:
//   { kind: 'deadZone', addKg: 1, newPrice: 2400, saving: 600 }
//   { kind: 'headroom', freeKg: 3, upToKg: 10 }

deadZones(grid);
// [{ mode: 'agency', fromKg: 0, toKg: 8 }, { mode: 'home', fromKg: 0, toKg: 20 }]
```

It also handles:
- **Mixed shipments.** A bike among ten bags: the bike's weight is taken out, the bags are priced per kilo, and the bike's negotiated amount is added once someone enters it.
- **Door-delivery surcharges** by city or zone. City wins over zone.
- **Cost and margin**, in basis points so no float reaches a percentage. If no cost is set, no margin is shown, because a margin against a zero cost reads as pure profit.
- **Price gap**: what was charged minus what the grid said. A discount is negative. Currencies are never mixed.

Money is integer cents throughout. Weights are integer grams.

## How it's tested

- **Example tests** (`test/pricing.test.ts`): every rule above, plus the edges: zero weight, fractional kilos, a card with no per-kilo rate, a bulky weight larger than the shipment, a city named `undefined`.
- **Property tests** (`test/properties.test.ts`, fast-check): for randomly generated cards and weights, the price is always whole cents and never negative, more weight above the minimum never costs less, and the dead-zone advice is always true. Adding the suggested weight gives exactly the promised price.
- **Mutation testing** (Stryker): Stryker changes the code on purpose, turning a `>` into `>=`, a `+` into `-`, or a condition into `true`, and reruns the tests. If no test fails, that mutant "survived", which means a real bug in that spot would go unnoticed. CI fails if the score drops below 90%.

The current score and the full report are in the latest CI run and on the report page. They are published by CI, not typed here by hand.

Two mutants are known to survive, and they can't be killed. Both replace an empty list `[]` with `["Stryker was here"]` (`src/pricing.ts`, the default tag list and the tag list in `inDeadZone`). A list of tags can only change the result if one of the tags is in the carrier's bulky list. In both places the bulky list is empty or comes from the caller, so the mutant behaves exactly like the original.

## Run it

```sh
npm ci
npm test            # example and property tests
npm run typecheck
npm run mutation    # Stryker; HTML report in reports/mutation/
```

Node 22 or later.

## Where it comes from

The pricing rules of Rihla, a freight and parcel app I'm building. The client's name and real tariff have been taken out, and the example card above is invented.

## Licence

MIT
