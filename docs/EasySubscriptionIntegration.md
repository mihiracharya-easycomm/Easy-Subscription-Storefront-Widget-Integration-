# Easy Subscription — Nuxt storefront integration

How this Nuxt storefront talks to the Easy Subscription app and renders its four widgets (Subscription, Quantity Breaker, Free Gift Products, Bundle) on the product page and cart drawer.

Share this with another developer or your client to understand what's wired up, what's enforced client-side, and where the extension points live.

---

## 1. Runtime config

The Easy Subscription credentials are kept **private** so the storefront API token never ships to the browser.

```ts
// nuxt.config.ts
runtimeConfig: {
  shopify: { name: 'best-fitness-store-9395' /* ... */ },

  easySubscription: {
    apiUrl:            process.env.EASY_SUBSCRIPTION_API_URL           || 'http://localhost:3000',
    storefrontApiToken: process.env.EASY_SUBSCRIPTION_STOREFRONT_API_TOKEN || '',
  },

  public: {
    shopifyShopName: process.env.NUXT_SHOPIFY_NAME || 'Nuxt Shopify Demo Store',
  },
},
```

Env vars (`.env.example`):

```
EASY_SUBSCRIPTION_API_URL="https://apps.easysubscription.io"
EASY_SUBSCRIPTION_STOREFRONT_API_TOKEN="YOUR_EASY_SUBSCRIPTION_STOREFRONT_API_TOKEN"
```

- `EASY_SUBSCRIPTION_API_URL` — the deployed Easy Subscription app host.
- `EASY_SUBSCRIPTION_STOREFRONT_API_TOKEN` — the secret token from the Easy Subscription dashboard (**Settings → API**). Sent only from Nitro routes on the server, never exposed to the browser.

The `shop` parameter is derived from `runtimeConfig.shopify.name` as `${name}.myshopify.com`.

---

## 2. Server proxy routes

The Nuxt storefront never calls `apps.easysubscription.io` directly from the browser. Two Nitro routes (`server/api/es/*`) sit in front of the Easy Subscription API and attach the storefront token server-side.

### `GET /api/es/widget-data` — `server/api/es/widget-data.get.ts`

Forwards every query parameter (`shop`, `productId`, `variantId`) and adds the token header:

```ts
import type { H3Event } from 'h3'

export default defineEventHandler(async (event: H3Event) => {
  const { easySubscription } = useRuntimeConfig(event)
  const query = getQuery(event)

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    params.set(key, String(value))
  }

  return await $fetch(`${easySubscription.apiUrl}/api/storefront/widget-data?${params}`, {
    method: 'GET',
    headers: { 'X-Storefront-Access-Token': easySubscription.storefrontApiToken },
  })
})
```

### `POST /api/es/bundle-variant` — `server/api/es/bundle-variant.post.ts`

Forwards the dynamic-bundle create-variant POST. **Does not** send `X-Storefront-Access-Token` because the Easy Subscription external bundle endpoint doesn't require it.

```ts
export default defineEventHandler(async (event) => {
  const { easySubscription } = useRuntimeConfig(event)
  const { shop } = getQuery(event) as { shop?: string }
  const body = await readBody(event)

  const url = `${easySubscription.apiUrl}/api/external/bundle/variant?shop=${encodeURIComponent(shop ?? '')}`
  return await $fetch(url, { method: 'POST', body })
})
```

---

## 3. API endpoints (as seen from the browser)

```
GET  /api/es/widget-data?shop=…&productId=…&variantId=…
POST /api/es/bundle-variant?shop=…
```

The upstream endpoints they proxy to:

- `GET  {apiUrl}/api/storefront/widget-data?shop=…&productId=…&variantId=…`
- `POST {apiUrl}/api/external/bundle/variant?shop=…`

**Numeric IDs**, not gids. The composable strips `gid://shopify/Product/…` and `gid://shopify/ProductVariant/…` automatically.

Response envelope for `widget-data`:

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
| `widgetState.isBundleHide` | hide bundle UI |
| `product.requiresSellingPlan` | if true, hide the "one-time" option |
| `sellingPlanGroups[].sellingPlans[]` | plans to render in the frequency selector |
| `sellingPlanGroups[].sellingPlans[].requiredQuantity` | `{ enabled, quantity }` — enforced client-side |
| `activeVariantAllocations[]` | per-variant pricing (sellingPlanId, discountPercentage, discountAmount) |
| `widgetSettings` | styling + ordering (`default_purchase_option`, colors, …) |
| `quantityBreaks.productTiers.tiers` | tiered discounts for the Quantity Breaker |
| `quantityBreakSettings` | breaker colors / `defaultQuantity` / `isResetDefaultValue` / `showBadge` |
| `giftProducts[]` | per-selling-plan gift offers for the Gift Products widget |
| `bundle` | bundle descriptor — `isBundle`, `bundleType`, `bundleId`, `fixedVariantsWithQuantity`, `dynamicSteps[]`, `bundleVariantOptions`, pricing fields |
| `cartPayloadGuide.customAttributes` | bundle-level attributes (`_bundle_id`, `_bundle_type`) merged onto the parent bundle cart line |

Full type definitions live in `app/composables/easySubscription.ts` (`EsWidgetData`, `EsSellingPlan`, `EsQuantityBreakTier`, `EsBundle`, …).

---

## 4. Shared composable

```ts
import { useEasySubscriptionData } from '#imports' // auto-imported

const productId = computed(() => props.product?.id)       // gid is fine
const variantId = computed(() => selectedVariant.value?.id)

const { widgetData, status, refresh } = useEasySubscriptionData(productId, variantId)
```

- Fetches `GET /api/es/widget-data?...` (which the Nitro route proxies with the storefront token).
- Deduplicates via the `useFetch` key `es-widget:{shop}:{productNumericId}:{variantNumericId}`.
- `server: false, lazy: true` — never blocks SSR / navigation.
- Refetches automatically on `variantId` change.

Call it once in `ProductConfigurator`, pass the result down via `:widget-data="widgetData"` to child widgets; the children fall back to their own fetch only when the prop is missing.

---

## 5. Widgets

### 5.1 Subscription — `app/components/product/SubscriptionWidget.vue`

Props: `product`, `selectedVariant`, `widgetData?`

Behavior:
- Hidden when `widgetState.hasSellingPlans` is false.
- One-time option is hidden when `product.requiresSellingPlan === true`.
- Default selection follows `widgetSettings.default_purchase_option`.
- Visual order follows `widgetSettings.purchase_option_position`.
- Prices per plan derived from `plan.adjustmentType`:
  - `PERCENTAGE` → `base * (1 - pct/100)` and badge `Save X%`
  - `FIXED_AMOUNT` → `base - amount` and badge `Save $X`
  - `PRICE` → `amount` (fixed), badge `Save $(base - amount)` if positive
- Styling honours `widgetSettings.widget_border_color`, `widget_inner_background_color`, `widget_text_color`, `widget_outer_border_thickness`.

Emits:

```ts
emit('change', {
  isSubscription: boolean,
  sellingPlanId?: string,                              // gid://shopify/SellingPlan/...
  attributes?: Array<{ key: string, value: string }>,  // cartPayloadGuide.customAttributes
})
```

### 5.2 Quantity Breaker — `app/components/product/QuantityBreakerWidget.vue`

Props: `product`, `selectedVariant`, `widgetData?`, `purchaseType?`.
`v-model:quantity` is **two-way** — clicking a tier updates the parent's quantity input.

Behavior:
- Hidden when there are no compatible tiers.
- Filters tiers by `tier.purchase_type`:
  - `BOTH` → always
  - `SUBSCRIPTION` → only when subscription is active
  - `ONE_TIME` → only when one-time is active
- Highlights the "best" tier for the current quantity (largest `tier.quantity <= qty`).
- Clicking a tier sets `quantity = tier.quantity`.
- Honours `quantityBreakSettings.isResetDefaultValue` + `defaultQuantity` on variant change.
- Styling honours `showBadge`, `badgeBgColor`, `badgeTextColor`, `tierBgColor`, `borderColor`, `hoverBorderColor`, `fontSize`, `badgeFontSize`, `borderRadius`.

Emits:

```ts
emit('change', {
  selectedTierId?: string | number,
  attributes?: Array<{ key: '_selected_tier', value: string }>,
})
```

### 5.3 Free Gift Products — `app/components/product/GiftProductsWidget.vue`

Props: `widgetData?`, `sellingPlanId?` (gid), `isSubscription?`.

Behavior:
- Hidden unless `isSubscription === true` and the resolved selling plan has at least one gift offer in `widgetData.giftProducts[]`.
- Looks up the matching offer group by stripping the gid: `giftProducts.find(g => g.selling_plan_id === numericId(sellingPlanId))`.
- Renders each outer `gift_product_items[]` entry based on `product_type`:
  - `fixed_product` — all inner items auto-selected, non-toggleable.
  - `choice_list` — checkboxes; user picks up to `product_limit`; remaining boxes disable once the limit is hit.
- Resets selections when the selling plan changes.
- Styling honours `widgetSettings.widget_border_color` + `widget_outer_border_thickness`.
- **Also shown on FIXED bundles** when the chosen plan has gift offers — the Configurator gates on `!bundleState.ownsAddToCart` (true for non-bundle and FIXED bundle, false for DYNAMIC bundle flows).

Emits:

```ts
emit('change', {
  attributes: Array<
    | { key: 'Free Gift Items', value: string }   // comma-joined displayNames
    | { key: '_esa_gift_data', value: string }    // comma-joined numeric variant IDs
  >,
})
```

Both attributes are emitted together, or `attributes: []` when nothing is selected (e.g. an empty `choice_list`).

### 5.4 Bundle — `app/components/product/BundleWidget.vue` (dispatcher)

Mounted from `ProductConfigurator` when `widgetData.bundle.isBundle === true`. Picks the sub-view:

| Condition | Sub-view | Variant-create API? |
|---|---|---|
| `bundleType === 'FIXED'` | `ProductBundleFixed` | no |
| `bundleType === 'DYNAMIC'` AND `bundleVariantOptions.options.length > 0` | `ProductBundleVariantPicker` | no — the picked option maps to an **existing** variant on the bundle product |
| `bundleType === 'DYNAMIC'` AND no option set | `ProductBundleDynamicWizard` | only when `bundle.isDynamic === true` (dynamic-priced BYOB) |

Emits `{ attributes, ownsAddToCart }` so:

- FIXED → `ownsAddToCart: false`, parent still owns the quantity input and submit. Gift widget is shown.
- Both DYNAMIC paths → `ownsAddToCart: true`, Configurator hides its own submit row and the wizard renders its own Add-to-cart.

Bundles still render the Subscription widget. The Quantity Breaker is hidden for bundle products. The Gift widget shows on FIXED bundles (above), is hidden on DYNAMIC bundles.

#### 5.4.1 Shared product fetcher — `app/composables/easySubscriptionBundle.ts`

`useEasySubscriptionBundleProducts(productIds)` wraps a Storefront `nodes(ids: [ID!]!)` query so every component product/variant is fetched in one trip. Normalises numeric or gid ids to gids before querying. Exposes `products`, `productsByNumericId`, `variantsByNumericId`.

#### 5.4.2 Fixed bundle — `ProductBundleFixed`

- Reads `bundle.fixedProducts` + `bundle.fixedVariantsWithQuantity`.
- Renders a "Content of this bundle" grid via `ProductBundleProductTile` (readonly mode).
- Emits `change` with the cart attributes:
  - `Items` = joined `"Title xN, Title xN"`
  - `_esb_data` = joined `"variantId_qty,variantId_qty"`

Configurator merges those + `cartPayloadGuide.customAttributes` into the normal `useCart.add(bundleVariantId, 1, undefined, attributes)` call. One cart line, the bundle variant, with the component listing attached as line-item properties.

#### 5.4.3 Variant-based dynamic bundle — `ProductBundleVariantPicker`

Three-step wizard matching the Variant / Products / Review mockups.

1. **Select a plan** — radio over `bundle.bundleVariantOptions.variants[]`. Each entry has `{ key, name, limit, price }`. `key` is `"<OptionName>:<OptionValue>"` (e.g. `"Frags:Red"`); `limit` caps step 2's total; `price` is shown everywhere.
2. **Choose products** — quantity ± per eligible component variant (filtered through `step_variants[]` of `bundle.dynamicSteps[0]`). Counter uses the picked option's `limit`.
3. **Review** — summary + Add to cart.

On Add to cart the widget does **not** call the variant-create API. It:

1. Finds the first variant on the bundle product whose `selectedOptions` matches the picked key.
2. Calls `useCart.add(matched.id, 1, sellingPlanId, attributes)` with the merged bundle attributes (`_subscription_app`, `_bundle_id`, `_bundle_type`, `Items`, `_esb_data`).
3. Opens the cart drawer.

If no matching variant exists on the bundle product the submit aborts with a toast — this is a merchant-configuration error.

#### 5.4.4 BYOB dynamic bundle — `ProductBundleDynamicWizard`

Walks the user through every entry in `bundle.dynamicSteps[]` plus a final Review step. Each step enforces `step_limit_min ≤ total ≤ step_limit_max`; Next is disabled until the current step is valid.

Submit branches on `bundle.isDynamic`:

- `isDynamic === false` → add the bundle's own default variant (`props.selectedVariant.id`) with the aggregated `Items` + `_esb_data` properties.
- `isDynamic === true` → **create variant** via the Easy Subscription API, **wait for the new variant to be visible** on the Shopify Storefront API, then add to cart.

```
POST /api/es/bundle-variant?shop={shop}

{
  "bundle_id":  "<bundle.bundleId>",
  "product_id": "<numeric parent product id>",
  "products": [
    { "id": "<component product id>", "quantity": N, "variant_id": "<component variant id>" }
  ]
}

→ { "status": true, "result": { "variant_id": "<new>", "price": "110.00" } }
```

After the API returns, the wizard **polls** `node(id: variantGid)` via the Storefront API until `availableForSale: true`:

```ts
// up to 6 attempts with progressive backoff — ~8.4s budget total.
const waitForVariantReady = async (variantGid: string) => {
  for (let i = 0; i < 6; i++) {
    const { data } = await storefront.request(`#graphql
      query BundleVariantReady($id: ID!) {
        node(id: $id) {
          ... on ProductVariant { id availableForSale }
        }
      }
    `, { variables: { id: variantGid } })

    const node = data?.node
    if (node?.id && node.availableForSale) return true
    await new Promise(r => setTimeout(r, 400 * (i + 1)))
  }
  return false
}
```

Only then does `useCart.add(newVariantGid, 1, sellingPlanId, attributes)` run. The Add-to-cart button's `:loading` and `:disabled` stay bound to the same `loading` ref across the entire create → poll → cart-add sequence, so the user sees one continuous spinner. If the variant never becomes available within the budget, a toast is shown and the cart stays untouched.

**Why the poll is required.** Shopify's Storefront API has a brief cache window after a product/variant mutation. If `cartLinesAdd` fires inside that window, the resulting line's merchandise node reads as `availableForSale: false`, cascading into "sold out" UI in the cart drawer and a rejected checkout URL. Fetching `node(id)` first warms the cache under the same spinner the user already sees.

Pricing display:

- `isDynamic === true` AND `fixedPrice > 0`: `fixedPrice + dynamicPrice × extraUnits` beyond the summed `step_limit_min` across every step.
- `fixedPrice > 0`: flat `fixedPrice`.
- otherwise: sum of `item.price * item.quantity`.

---

## 6. Cart contract

Easy Subscription expects certain **cart line item properties** / selling plan ids / cart custom attributes. The Nuxt storefront uses Shopify's Cart API (not AJAX form POSTs), so the mapping is:

| Easy Subscription expectation (`cartPayloadGuide`) | Shopify Cart API field |
|---|---|
| `selling_plan=<id>` | `lines[].sellingPlanId` |
| `properties[_selected_tier]=<tier id>` | `lines[].attributes[]` |
| `properties[Free Gift Items]=<pretty labels>` | `lines[].attributes[]` |
| `properties[_esa_gift_data]=<variantId,variantId>` | `lines[].attributes[]` |
| `properties[Items]=<pretty bundle labels>` | `lines[].attributes[]` |
| `properties[_esb_data]=<variantId_qty,variantId_qty>` | `lines[].attributes[]` |
| `properties[_bundle_id]=<uuid>` | `lines[].attributes[]` (from `cartPayloadGuide.customAttributes`) |
| `properties[_bundle_type]=FIXED \| DYNAMIC` | `lines[].attributes[]` (from `cartPayloadGuide.customAttributes`) |

Merge logic lives in `ProductConfigurator.vue`:

```ts
const mergedAttributes = computed(() => {
  const map = new Map<string, string>()

  if (subscriptionState.value.isSubscription)
    for (const a of subscriptionState.value.attributes ?? []) map.set(a.key, a.value)

  for (const a of breakerState.value.attributes ?? []) map.set(a.key, a.value)
  for (const a of giftState.value.attributes ?? [])    map.set(a.key, a.value)

  if (isBundle.value && !bundleState.value.ownsAddToCart) {
    for (const a of widgetData.value?.cartPayloadGuide?.customAttributes ?? []) map.set(a.key, a.value)
    for (const a of bundleState.value.attributes ?? []) map.set(a.key, a.value)
  }

  return Array.from(map, ([key, value]) => ({ key, value }))
})

await add(selectedVariant.value.id, qty, sellingPlanId, mergedAttributes.value)
```

For FIXED bundles the Configurator does the merging; for DYNAMIC bundles the wizard assembles the full attributes array itself and calls `useCart.add` directly.

> `widgetData.cartPayloadGuide.customAttributes` ships a generic `{ key: "_subscription_app", value: "easy_subscription" }` marker. On the Nuxt storefront we don't attach it to non-bundle lines because the Easy Subscription backend already recognises subscription lines via the `sellingPlanId`. For bundle lines we do include it (merged from `cartPayloadGuide`).

`useCart.add` + the zod schemas in `shared/utils/cart.ts` already accept `sellingPlanId` and `attributes` per line.

---

## 7. Cart drawer display

`app/components/cart/LineItem.vue` renders rich context so the shopper can see what they're buying.

What's shown on each line:

- Product title + variant.
- **Selling plan name** (small primary-coloured text under the title), read from `line.sellingPlanAllocation.sellingPlan.name`.
- **Bundle items**, if present, as a bulleted list. Parsed by splitting the `Items` line attribute on `,`.
- Any **other non-underscore line attribute** (`Free Gift Items`, …) rendered as `key: value`. Internal `_bundle_id`, `_bundle_type`, `_esb_data`, `_esa_gift_data`, `_subscription_app`, `_selected_tier` stay hidden.
- Quantity input (step/min constrained by the required-quantity rule — see §8).
- Red inline warning when the quantity breaks the required-quantity rule.

The cart fragment pulls everything needed in one go:

```graphql
# graphql/cart.ts
fragment CartLineFields on CartLine {
  id
  quantity
  merchandise { ... on ProductVariant { ...ProductVariantFields product { id handle title vendor } } }

  sellingPlanAllocation {
    sellingPlan {
      id
      name
      metafield(namespace: "easy_subscription_app", key: "REQUIRED_QUANTITY") {
        value
      }
    }
  }

  attributes { key value }
  cost { amountPerQuantity { ...PriceFields } }
}
```

---

## 8. REQUIRED_QUANTITY enforcement

Some selling plans carry a metafield that forces the ordered quantity to be a multiple of a configured number:

```jsonc
{
  "namespace": "easy_subscription_app",
  "key": "REQUIRED_QUANTITY",
  "value": "{\"enabled\":true,\"quantity\":2}",
  "jsonValue": { "enabled": true, "quantity": 2 }
}
```

### 8.1 Why we enforce it client-side

In the main Easy Subscription app this is enforced by a Shopify Function (`extensions/cart-checkout-validation/src/cart_validations_generate_run.js`) and attached via a Checkout Rule. Per [Shopify docs](https://shopify.dev/docs/apps/build/checkout/cart-checkout-validation), Validation functions do run on custom storefronts, **but** the merchant must install the app's validation extension AND turn on a Checkout Rule from Settings → Checkout → Checkout rules. Until that's done, no server-side block exists.

The Storefront API's `cart.warnings` field isn't the surface for Function-raised errors (per [cart-warnings](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/cart/cart-warnings)) — those surface on `userErrors` of the cart mutation and are hard to distinguish from unrelated errors.

**So the Nuxt storefront enforces the rule client-side as defence in depth** across two gates. The widget-data API returns `plan.requiredQuantity: { enabled, quantity } | null` on every selling plan; the cart line fetches the same metafield directly.

### 8.2 Shared helpers — `app/composables/easySubscription.ts`

```ts
// Shared by both gates. Returns 1 when disabled/missing — i.e., "no step".
export const esRequiredQty = (
  plan: Pick<EsSellingPlan, 'requiredQuantity'> | null | undefined,
): number => {
  const rq = plan?.requiredQuantity
  return rq?.enabled && rq.quantity > 0 ? rq.quantity : 1
}

// Cart-side parser for the metafield's JSON value string.
export const parseRequiredQtyMetafield = (value?: string | null): number => {
  if (!value) return 1
  try {
    const parsed = JSON.parse(value) as { enabled?: boolean, quantity?: number }
    return parsed.enabled && typeof parsed.quantity === 'number' && parsed.quantity > 0
      ? parsed.quantity
      : 1
  }
  catch { return 1 }
}
```

### 8.3 Gate A — product page (`app/components/product/Configurator.vue`)

```ts
const activePlan = computed(() => {
  if (!subscriptionState.value.isSubscription) return undefined
  const id = subscriptionState.value.sellingPlanId
  if (!id) return undefined
  return widgetData.value?.sellingPlanGroups
    ?.flatMap(g => g.sellingPlans)
    .find(p => p.id === id)
})

const requiredQty = computed(() => esRequiredQty(activePlan.value))

// Snap state.quantity to the required-quantity grid when either side changes.
// Idempotent — if the current quantity is already a valid multiple of the new
// step we leave it alone (so req=10 → req=2 at qty=10 stays at 10 instead of
// jumping). Floor-biased so a plan switch never bumps the user up a step.
watch([requiredQty, () => state.quantity], ([qty, currentQty]) => {
  if (qty <= 1) return
  if (currentQty >= qty && currentQty % qty === 0) return
  const floored = Math.floor(currentQty / qty) * qty
  const next = floored >= qty ? floored : qty
  if (next !== currentQty) state.quantity = next
}, { flush: 'post' })
```

The `UInputNumber` gets `:min="requiredQty"` and `:step="requiredQty"` so the +/– buttons move in the right increments. If the user somehow submits with an invalid quantity, `onSubmit` blocks with an error toast and no cart mutation runs.

### 8.4 Gate B — cart drawer (`LineItem.vue` + `Modal.vue`)

Per-line, inside `LineItem.vue`:

```ts
const requiredQty = computed(() => parseRequiredQtyMetafield(
  props.line.sellingPlanAllocation?.sellingPlan?.metafield?.value,
))

const requiredQtyInvalid = computed(() =>
  requiredQty.value > 1 && props.line.quantity % requiredQty.value !== 0,
)
```

- `UInputNumber` for the line gets `:min` and `:step` driven by `requiredQty`.
- When `requiredQtyInvalid` is true, a red inline message renders under the row.

Globally, `Modal.vue`:

```ts
const hasInvalidRequiredQty = computed(() =>
  lines.value.some((line) => {
    const qty = parseRequiredQtyMetafield(
      line.sellingPlanAllocation?.sellingPlan?.metafield?.value,
    )
    return qty > 1 && line.quantity % qty !== 0
  }),
)
```

The Checkout button `:disabled` is wired to `loading || lines.length === 0 || hasInvalidRequiredQty`.

### 8.5 Why both gates

- Gate A gives a close-to-the-field error (user is still on the product form) and prevents the bad quantity from ever hitting the cart.
- Gate B catches two edge cases Gate A can't: (1) lines added before this validation shipped, (2) a user who changed the line quantity from inside the cart drawer. It's also the last line of defence before Shopify's hosted checkout, where (if the merchant hasn't enabled the Checkout Rule) nothing else would block them.

### 8.6 i18n

Localised message lives at `product.requiredQuantity` across `en`, `fr`, `es`, `de`, `it`:

```
"requiredQuantity": "This subscription plan requires a quantity that is a multiple of {quantity}. Please update the quantity to proceed."
```

---

## 9. End-to-end flow (recap)

1. User opens `/product/[handle]`.
2. `ProductConfigurator` fetches `/api/es/widget-data` (Nitro route forwards to Easy Subscription with the storefront token).
3. `ProductQuantityBreakerWidget` renders tiers (if any) and can bump `state.quantity`.
4. `ProductSubscriptionWidget` renders purchase options; its `change` event records whether we're adding a subscription + which selling plan.
5. `ProductGiftProductsWidget` watches the selected plan; when the plan has gift offers it renders them and emits `Free Gift Items` + `_esa_gift_data` attributes. Shown on non-bundle AND FIXED bundle products.
6. For FIXED bundles, `ProductBundleFixed` renders the content grid and emits `Items` + `_esb_data`.
7. For DYNAMIC bundles the respective wizard renders its own Add-to-cart; for the BYOB (`isDynamic`) path it calls `/api/es/bundle-variant`, polls `node(id)` until the new variant is ready, then adds to cart.
8. On submit, Configurator (or the DYNAMIC wizard) merges all attributes and calls `useCart.add(variantId, quantity, sellingPlanId?, attributes?)`.
9. Shopify's `cartLinesAdd` attaches `sellingPlanId` and `attributes[]` to the line → values appear in checkout as line-item properties and the Easy Subscription app recognises them.
10. Cart drawer shows product title + plan name + bundle items + any other visible attributes; required-quantity rule is re-validated per line and gates the Checkout button.

---

## 10. Testing checklist

### Core widgets

- Simple product (no subscription, no tiers) → neither widget renders; cart line has no attributes beyond base.
- Subscription product → widget renders with correct default option / ordering; selecting "Subscribe & Save" + a frequency and adding → line has `sellingPlanId` set.
- Quantity breaker product → tiers render; clicking a tier updates qty input and best tier gets highlighted; added line carries `_selected_tier`.
- Variant change on a multi-variant product → widget data refetches; quantity resets to configured default when `isResetDefaultValue` is true.
- Subscription-required product (`requiresSellingPlan: true`) → one-time option hidden; default plan selected.
- Gift products (`fixed_product`) → switching to the plan that owns the offer shows the card with all items pre-selected; added line carries `Free Gift Items` + `_esa_gift_data`.
- Gift products (`choice_list`, `product_limit: N`) → user can tick up to N items; extra checkboxes disabled; added line carries only the ticked variant ids.

### Required quantity

- Plan with `requiredQuantity.enabled=true, quantity=2`, qty 2 or 4 → add-to-cart succeeds.
- Same plan, qty 1 or 3 → Gate A blocks submit, shows the i18n message, cart unchanged.
- Switch plan: req=10 at qty=10, then pick req=2 → qty stays 10 (10 is a valid multiple of 2); switch back to req=10 → qty stays 10.
- Line already in the cart at qty 3 (invalid) → Gate B shows the warning on that line and disables Checkout.
- Plan with `requiredQuantity.enabled=false` or metafield absent → neither gate fires.

### Bundles

- FIXED bundle → Quantity Breaker hidden; Subscription widget still renders if `widgetState.hasSellingPlans`; Gift widget renders when the chosen plan has offers; "Content of this bundle" grid lists the fixed variants with quantities; one cart line is added against the bundle variant with `Items`, `_esb_data`, `_bundle_id`, `_bundle_type` (+ gift props if any) and the chosen `sellingPlanId`.
- Variant-based DYNAMIC bundle → 3-step wizard; picking an option matches a pre-existing variant on the bundle product via `selectedOptions`; **no** variant-create API call; Add to cart pushes that variant GID with `Items` + `_esb_data`.
- Dynamic-priced BYOB bundle → N-step wizard; Next disabled until the current step's min/max is satisfied; final Add to cart hits `/api/es/bundle-variant`, then polls the new variant until it's `availableForSale: true`, then adds to cart with the returned variant_id. Spinner stays on the Add-to-cart button for the whole create → poll → cart-add sequence.
- Non-dynamic BYOB bundle (no options, `is_dynamic` false) → same wizard, but Add to cart uses the bundle's default variant with no API call.
- Variant-create API failure or variant never becomes available → toast is shown with the error message and no line is added to the cart.
- Switching variants on a non-bundle product that was previously showing the bundle widget → no leftover bundle UI.

### Cart drawer

- Any subscription line → the plan name appears below the product title.
- FIXED bundle line → bundle items appear as a bulleted list beneath the title.
- Gift line (`Free Gift Items` attribute present) → appears as `Free Gift Items: ...` beneath the title.
- Internal attributes (`_bundle_id`, `_esb_data`, `_subscription_app`, `_selected_tier`, …) never appear in the drawer.
- Line in violation of required-quantity → inline red warning on the row and Checkout button disabled; fixing all violating lines re-enables Checkout.
