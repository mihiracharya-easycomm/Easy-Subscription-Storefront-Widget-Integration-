# Easy Subscription — Nuxt storefront integration

This doc covers how the Nuxt storefront consumes the Easy Subscription widget API and renders the Subscription + Quantity Breaker widgets on a product page. Bundles (fixed / variant-based / BYOB dynamic) are a planned next pass and are only summarized at the bottom.

---

## 1. Runtime config

`nuxt.config.ts` exposes the Easy Subscription API base URL under `runtimeConfig.public.easySubscriptionApi`:

```ts
runtimeConfig: {
  shopify: { name: 'best-fitness-store-9395' /* ... */ },
  public: {
    easySubscriptionApi: process.env.EASY_SUBSCRIPTION_API_URL || 'http://localhost:3000',
  },
}
```

Set `EASY_SUBSCRIPTION_API_URL` in `.env` to your deployed (or tunnelled) app host — e.g. `https://worcester-microphone-entity-experience.trycloudflare.com`.

The `shop` parameter is derived from `runtimeConfig.shopify.name` as `${name}.myshopify.com`.

---

## 2. API endpoint

```
GET {easySubscriptionApi}/api/storefront/widget-data
  ?shop={shop}.myshopify.com
  &productId={numeric product id}
  &variantId={numeric variant id}
```

**Numeric IDs**, not gids. The composable strips `gid://shopify/Product/` / `gid://shopify/ProductVariant/` automatically.

Response envelope:

```jsonc
{
  "status": true,
  "message": "Data Fetched.",
  "result": { /* EsWidgetData */ }
}
```

Key fields the storefront reads from `result`:

| path | purpose |
|---|---|
| `widgetState.hasSellingPlans` | gate for showing the Subscription widget |
| `widgetState.isBundleHide` | hide bundle UI (bundles pass) |
| `product.requiresSellingPlan` | if true, hide the "one-time" option |
| `sellingPlanGroups[].sellingPlans[]` | plans to render in the frequency selector |
| `activeVariantAllocations[]` | per-variant `{ sellingPlanId, discountPercentage, discountAmount }` for pricing |
| `widgetSettings` | styling + ordering (`default_purchase_option`, `purchase_option_position`, colors) |
| `quantityBreaks.productTiers.tiers` | tiered discounts for the Quantity Breaker |
| `quantityBreakSettings` | breaker colors / `defaultQuantity` / `isResetDefaultValue` / `showBadge` |
| `giftProducts[]` | per-selling-plan gift offers (`{ selling_plan_id, gift_product_items[] }`) for the Gift Products widget |
| `cartPayloadGuide.customAttributes` | reserved for bundle-level attributes (bundles pass); the generic `_subscription_app` marker is intentionally **not** applied by the Nuxt storefront |

Full type definitions live in `app/composables/easySubscription.ts` (`EsWidgetData`, `EsSellingPlan`, `EsQuantityBreakTier`, etc.).

---

## 3. Shared composable

```ts
import { useEasySubscriptionData } from '#imports' // auto-imported

const productId = computed(() => props.product?.id)       // gid is fine
const variantId = computed(() => selectedVariant.value?.id)

const { widgetData, status, refresh } = useEasySubscriptionData(productId, variantId)
```

- Deduplicates via the `useFetch` key `es-widget:{shop}:{productNumericId}:{variantNumericId}`.
- `server: false, lazy: true` — never blocks SSR / navigation.
- Refetches automatically on `variantId` change.

Call it once in `ProductConfigurator`, pass the result down via `:widget-data="widgetData"` to child widgets; the children fall back to their own fetch only when the prop is missing.

---

## 4. Widgets

### 4.1 `ProductSubscriptionWidget`

File: `app/components/product/SubscriptionWidget.vue`

Props: `product`, `selectedVariant`, `widgetData?`

Behavior:
- Hidden when `widgetState.hasSellingPlans` is false.
- One-time option is hidden when `product.requiresSellingPlan === true`.
- Default selection follows `widgetSettings.default_purchase_option` (`'one-time'` | `'subscription'`).
- Visual order follows `widgetSettings.purchase_option_position` (`'one-time-first'` | `'subscription-first'`).
- Prices per plan are derived from `pricingPolicies.adjustmentType`:
  - `PERCENTAGE` → `base * (1 - pct/100)` and badge `Save X%`
  - `FIXED_AMOUNT` → `base - amount` and badge `Save $X`
  - `PRICE` → `amount` (fixed), badge `Save $(base - amount)` if positive
- Styling honors `widgetSettings.widget_border_color`, `widget_inner_background_color`, `widget_text_color`, `widget_outer_border_thickness`.

Emits:
```ts
emit('change', {
  isSubscription: boolean,
  sellingPlanId?: string,                 // gid://shopify/SellingPlan/...
  attributes?: Array<{ key: string, value: string }>,  // cartPayloadGuide.customAttributes
})
```

### 4.2 `ProductQuantityBreakerWidget`

File: `app/components/product/QuantityBreakerWidget.vue`

Props: `product`, `selectedVariant`, `widgetData?`, `purchaseType?`.
`v-model:quantity` is **two-way** — clicking a tier updates the parent's quantity input.

Behavior:
- Hidden when there are no compatible tiers.
- Filters tiers by `tier.purchase_type` vs the parent's current `purchaseType`:
  - `BOTH` → always shown
  - `SUBSCRIPTION` → only when subscription is active
  - `ONE_TIME` → only when one-time is active
- Highlights the "best" tier for the current quantity (largest `tier.quantity <= qty`).
- Clicking a tier sets `quantity = tier.quantity`.
- Honors `quantityBreakSettings.isResetDefaultValue` + `defaultQuantity` on variant change (reset handled in Configurator).
- Honors `showBadge`, `badgeBgColor`, `badgeTextColor`, `tierBgColor`, `borderColor`, `hoverBorderColor`, `fontSize`, `badgeFontSize`, `borderRadius`.

Emits:
```ts
emit('change', {
  selectedTierId?: string | number,
  attributes?: Array<{ key: '_selected_tier', value: string }>,
})
```

### 4.3 `ProductGiftProductsWidget`

File: `app/components/product/GiftProductsWidget.vue`

Props: `widgetData?`, `sellingPlanId?` (gid), `isSubscription?`.

Behavior:
- Hidden unless `isSubscription === true` and the resolved selling plan has at least one gift offer in `widgetData.giftProducts[]`.
- Looks up the matching offer group by stripping the gid: `giftProducts.find(g => g.selling_plan_id === numericId(sellingPlanId))`.
- Renders each outer `gift_product_items[]` entry based on `product_type`:
  - `fixed_product` — all inner items auto-selected, shown with a filled check indicator (not toggleable).
  - `choice_list` — inner items rendered as checkboxes; user may pick up to `product_limit`; remaining checkboxes are disabled once the limit is reached.
- Resets selections when the selling plan (and therefore `giftOffers`) changes.
- Styling honors `widgetSettings.widget_border_color` + `widget_outer_border_thickness`.

Emits:
```ts
emit('change', {
  attributes: Array<
    | { key: 'Free Gift Items', value: string }   // comma-joined displayNames
    | { key: '_esa_gift_data', value: string }    // comma-joined numeric variant IDs
  >,
})
```

Both attributes are emitted together, or `attributes: []` when nothing is selected (e.g. an empty `choice_list`). The Configurator merges these into the single parent cart line's `attributes[]`.

---

## 5. Cart contract

Easy Subscription expects certain **cart line item properties** / selling_plan ids / cart custom attributes so its backend can recognize and track lines. The Nuxt storefront uses Shopify's Cart API (not AJAX form POSTs), so the mapping is:

| Easy Subscription expectation (`cartPayloadGuide`) | Shopify Cart API field |
|---|---|
| `selling_plan=<id>` | `lines[].sellingPlanId` |
| `properties[_selected_tier]=<tier id>` | `lines[].attributes[]` |
| `properties[Free Gift Items]=<pretty gift labels>` (gifts) | `lines[].attributes[]` |
| `properties[_esa_gift_data]=<variant_id,variant_id>` (gifts) | `lines[].attributes[]` |
| `properties[_esb_data]=<bundle data>` (bundles) | `lines[].attributes[]` *(next pass)* |
| `properties[Items]=<pretty labels>` (bundles) | `lines[].attributes[]` *(next pass)* |

The merge logic lives in `ProductConfigurator.vue`:

```ts
const mergedAttributes = computed(() => {
  const map = new Map<string, string>()

  if (subscriptionState.value.isSubscription)
    for (const a of subscriptionState.value.attributes ?? []) map.set(a.key, a.value)

  for (const a of breakerState.value.attributes ?? []) map.set(a.key, a.value)
  for (const a of giftState.value.attributes ?? []) map.set(a.key, a.value)

  return Array.from(map, ([key, value]) => ({ key, value }))
})

await add(selectedVariant.value.id, qty, sellingPlanId, mergedAttributes.value)
```

> Note: `widgetData.cartPayloadGuide.customAttributes` is intentionally **not** merged. The widget-data API ships a generic `{ key: "_subscription_app", value: "easy_subscription" }` marker there for Liquid/AJAX storefronts; on the Nuxt storefront we don't attach it to lines because the Easy Subscription backend already recognizes subscription lines via the `sellingPlanId` on the cart line.

`useCart.add` + the zod schemas in `shared/utils/cart.ts` already accept `sellingPlanId` and `attributes` per line, so no changes were needed there.

---

## 6. End-to-end flow (recap)

1. User opens `/product/[handle]`.
2. `ProductConfigurator` fetches `widget-data` for `(productId, variantId)`.
3. `ProductQuantityBreakerWidget` renders tiers (if any) and can bump `state.quantity`.
4. `ProductSubscriptionWidget` renders purchase options; its `change` event records whether we're adding a subscription + which selling plan.
5. `ProductGiftProductsWidget` watches the selected plan; when the plan has gift offers it renders them (fixed or choice-list) and emits `Free Gift Items` + `_esa_gift_data` attributes.
6. On submit, Configurator merges all attributes and calls `useCart.add(variantId, quantity, sellingPlanId?, attributes?)`.
6. Shopify's Storefront `cartLinesAdd` mutation attaches `sellingPlanId` and `attributes[]` to the line → values appear in checkout as line-item properties and the Easy Subscription app recognizes them.

---

## 7. Testing checklist

- Simple product (no subscription, no tiers) → neither widget renders; cart line has no attributes beyond base.
- Subscription product → widget renders with correct default option / ordering; selecting "Subscribe & Save" + a frequency and adding → line has `sellingPlanId` set (no `_subscription_app` attribute is attached).
- Quantity breaker product → tiers render; clicking a tier updates qty input and best tier gets highlighted; added line carries `_selected_tier` attribute.
- Variant change on a multi-variant product → widget data refetches; quantity resets to configured default when `isResetDefaultValue` is true.
- Subscription-required product (`requiresSellingPlan: true`) → one-time option is hidden; default plan is selected.
- Gift products (`fixed_product`) → switching to the plan that owns the offer shows the Free Gift Products card with all items pre-selected; added line carries `Free Gift Items` + `_esa_gift_data` with every inner variant id.
- Gift products (`choice_list`, `product_limit: N`) → user can tick up to N items; extra checkboxes are disabled; added line carries only the ticked variant ids; switching back to one-time or to a plan with no gifts hides the card and strips the two attributes from the next add.

---

## 8. Required-quantity validation (`REQUIRED_QUANTITY` metafield)

Some selling plans carry a metafield that forces the ordered quantity to be a multiple of a configured number:

```jsonc
{
  "id": "gid://shopify/Metafield/191181124108456",
  "namespace": "easy_subscription_app",
  "key": "REQUIRED_QUANTITY",
  "value": "{\"enabled\":true,\"quantity\":2}",
  "jsonValue": { "enabled": true, "quantity": 2 }
}
```

### 8.1 How this is enforced in the Shopify checkout today

In the main Easy Subscription app this is enforced by a Shopify Function (Cart and Checkout Validation API) at
`extensions/cart-checkout-validation/src/cart_validations_generate_run.js`. It reads the metafield off each line's `sellingPlanAllocation.sellingPlan.metafield(namespace:"easy_subscription_app", key:"REQUIRED_QUANTITY")` and emits an error whenever `line.quantity % requiredQty !== 0`.

Important facts about where that Function runs:

- Per Shopify's docs, Validation functions are "available for online store carts, carts built for custom storefronts, and throughout the checkout process" ([Cart and checkout validation](https://shopify.dev/docs/apps/build/checkout/cart-checkout-validation)). "Custom storefronts" includes a Nuxt storefront that mutates the cart via the Storefront API.
- Enforcement is **not automatic** — the merchant must install the app's validation extension and then add a **Checkout Rule** from Settings → Checkout → Checkout rules that activates it. Until that rule is turned on, no server-side block exists.
- The current reference page at [Cart Checkout Validation Function API](https://shopify.dev/docs/api/functions/latest/cart-checkout-validation) notes the API isn't supported on the latest API version — this app pins an older Function API version. Treat server-side enforcement as "best-effort, depends on merchant setup."

### 8.2 Nuxt support status

The Storefront API cart `warnings` field is **not** the surface for Function validation errors — per [Cart warnings](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/cart-warnings) it only reports automatic mutations like `MERCHANDISE_OUT_OF_STOCK`. Function-raised blocking errors surface on the `userErrors` of the cart mutation (and at checkout), but a Nuxt storefront has no reliable way to tell these apart from unrelated cart errors, and nothing fires if the merchant hasn't enabled the Checkout Rule.

Therefore the Nuxt storefront enforces the rule client-side, as **defense in depth** on top of the Shopify Function. The widget-data API already returns the parsed metafield on every selling plan as:

```ts
plan.requiredQuantity: { enabled: boolean, quantity: number } | null
```

(See `EsSellingPlan`-with-`requiredQuantity` typing in `app/components/product/SubscriptionWidget.vue:1-6`.)

### 8.3 Two client-side gates

**Gate A — pre-add (product page).** Enforced in `ProductConfigurator.onSubmit` (`app/components/product/Configurator.vue:131`). Before calling `useCart.add`, when `subscriptionState.isSubscription` is true, resolve the currently selected plan from `widgetData.sellingPlanGroups[].sellingPlans[]` by `subscriptionState.sellingPlanId` and short-circuit the submit if `plan.requiredQuantity?.enabled && state.quantity % plan.requiredQuantity.quantity !== 0`. Mirror the Function's message:

```
This subscription plan requires a quantity that is a multiple of {N}
(e.g. {N}, {2N}, {3N}...). Please update the quantity to proceed.
```

(Strings for `en`, `fr`, `es`, `de`, `it` live in `extensions/cart-checkout-validation/src/cart_validations_generate_run.js` — port them into `i18n/locales/*.json` under `product.requiredQuantity` so both surfaces stay in sync.)

Also push the constraint into the quantity input so users can't pick a bad value in the first place:

```vue
<UInputNumber
  v-model="state.quantity"
  :min="requiredQty || 1"
  :step="requiredQty || 1"
  :max="maxQuantity"
/>
```

where `requiredQty` is a computed derived from the currently-selected plan when subscription is active, falling back to `1` otherwise.

**Gate B — pre-checkout (cart drawer).** Enforced in `app/components/cart/Modal.vue`. For each line with a selling plan, read the same metafield and disable the "Checkout" button + show the error inline when any line fails the modulo check. The cart GraphQL fragment needs to fetch the metafield directly off the line's selling plan — same selection the Function uses:

```graphql
# shared/graphql/CartFields.fragment.graphql (or wherever CartFields lives)
fragment CartLineFields on CartLine {
  id
  quantity
  merchandise { ... }
  sellingPlanAllocation {
    sellingPlan {
      id
      metafield(namespace: "easy_subscription_app", key: "REQUIRED_QUANTITY") {
        value
      }
    }
  }
}
```

Parse `metafield.value` as JSON (`{ enabled, quantity }`) and apply the same `line.quantity % quantity !== 0` check as the Function.

### 8.4 Why both gates

- Gate A gives a close-to-the-field error (user is already on the product form) and prevents the bad quantity from ever hitting the cart.
- Gate B catches two edge cases Gate A can't: (1) lines added before this validation shipped, (2) a user who changed the line quantity from inside the cart drawer. It also provides the "last line of defense" before we send a shopper to Shopify's hosted checkout, where (if the merchant hasn't enabled the Checkout Rule) nothing else would block them.

### 8.5 Testing checklist — required-quantity

Add to Section 7:

- Plan with `requiredQuantity.enabled=true, quantity=2`, qty 2 or 4 → add-to-cart succeeds.
- Same plan, qty 1 or 3 → Gate A blocks submit, shows the i18n message, cart unchanged.
- Line already in the cart at qty 3 → Gate B disables "Checkout" + renders the message on that line.
- Plan with `requiredQuantity.enabled=false` or metafield absent → neither gate fires.
- Switch purchase type from subscription to one-time while qty is 3 → neither gate fires (rule only applies to subscription lines, matching the Function which skips lines without `sellingPlanAllocation`).

---

## 9. Next pass — Bundles (not yet implemented)

The widget-data endpoint already returns a `bundle` object for bundle products:

- `bundle.isBundle === true`
- `bundle.bundleType` ∈ `'FIXED' | 'DYNAMIC' | ... (variant-based uses DYNAMIC + bundleVariantOptions)`
- `bundle.dynamicSteps[]` (BYOB wizard steps)
- `bundle.bundleVariantOptions.options[]` + `variants[]` (variant-based picker)
- `bundle.fixedVariantsWithQuantity[]` (fixed bundle contents)

Planned components:
- `ProductBundleFixed.vue` — read-only grid, single Add-to-cart emits N lines.
- `ProductBundleVariantPicker.vue` — single-page option selector matching `VariantChooseScreen` ref image.
- `ProductBundleDynamic.vue` (BYOB) — 3-step wizard: Plan → Products → Review (matches `ProductChooseScreen` / `ReviewScreen`).
- `useCart.addMany(lines)` — new cart composable that supports a single `cartLinesAdd` with multiple lines, plus a `cartAttributesUpdate` call to attach `_bundle_id` / `_bundle_type` from `cartPayloadGuide.customAttributes` to the cart itself.
- Each bundle line carries `properties[_esb_data]=<variantId_qty,...>` and `properties[Items]=<title xN, title xN>` per the cart payload guide.

Entry point tbd: either a `/product/[handle]/bundle` sub-route (matching the Shopify demo's `?_psq=` deep link) or an in-place swap inside `[handle].vue` when `widgetData.bundle.isBundle === true`.
