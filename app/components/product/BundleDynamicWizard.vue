<script setup lang="ts">
// BYOB (step-based) DYNAMIC bundle. Walks the user through dynamic_steps[]
// one at a time, enforcing step_limit_min/max per step, and on submit adds
// a single cart line with the aggregated Items / _esb_data properties.
//
// When bundle.isDynamic === true (dynamic pricing), submit calls the
// Easy Subscription "create variant" API first and uses the returned
// variant_id as the cart merchandise. Otherwise the bundle's own default
// variant is used — the merchant's app recognises it via the attached
// _bundle_id/_bundle_type properties.

const props = defineProps<{
  product: ProductFieldsFragment
  selectedVariant?: ProductVariantFieldsFragment
  widgetData?: EsWidgetData
  sellingPlanId?: string
  isSubscription?: boolean
}>()

const { add, open: cartOpen } = useCart()
const toast = useToast()
const storefront = useStorefront()

// Shopify needs a moment after we create a brand-new variant via the Easy
// Subscription API before the Storefront API will serve it with
// availableForSale=true. If we rush straight into cartLinesAdd the line is
// created against a merchandise node that still reads as sold-out, which
// then breaks checkout. Poll node(id) until the variant is visible and
// available (or we give up and surface a toast).
const waitForVariantReady = async (variantGid: string) => {
  const maxAttempts = 6
  const baseDelayMs = 400

  for (let i = 0; i < maxAttempts; i++) {
    const { data } = await storefront.request(`#graphql
      query BundleVariantReady($id: ID!) {
        node(id: $id) {
          ... on ProductVariant {
            id
            availableForSale
          }
        }
      }
    `, { variables: { id: variantGid } })

    const node = (data as { node?: { id?: string, availableForSale?: boolean } } | undefined)?.node
    if (node?.id && node.availableForSale) return true

    await new Promise(resolve => setTimeout(resolve, baseDelayMs * (i + 1)))
  }
  return false
}

const bundle = computed(() => props.widgetData?.bundle)
const settings = computed(() => props.widgetData?.widgetSettings)
const borderColor = computed(() => settings.value?.widget_border_color || '#874ad6')
const currencyCode = computed(() =>
  props.selectedVariant?.price?.currencyCode
  ?? props.widgetData?.shop?.currency
  ?? 'USD',
)
const money = (n: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode.value }).format(n)

const steps = computed(() => bundle.value?.dynamicSteps ?? [])
const stepIndex = ref(0)

// Union of every product referenced across every step — one fetch is enough.
const allProductIds = computed(() => {
  const ids = new Set<string>()
  for (const s of steps.value) {
    for (const pid of s.step_products ?? []) ids.add(String(pid))
  }
  // Fall back to bundle.allProductsList if steps don't specify products.
  if (ids.size === 0) {
    for (const pid of bundle.value?.allProductsList ?? []) ids.add(String(pid))
  }
  return Array.from(ids)
})

const { products, variantsByNumericId, status } =
  useEasySubscriptionBundleProducts(allProductIds)

const itemsForStep = (step: EsBundleDynamicStep) => {
  const allowedVariants = new Set((step.step_variants ?? []).map(id => String(id)))
  const allowedProducts = new Set((step.step_products ?? []).map(id => String(id)))

  return products.value
    .filter(p => allowedProducts.size === 0 || allowedProducts.has(toNumericBundleId(p.id)))
    .flatMap(p => p.variants
      .filter(v => allowedVariants.size === 0 || allowedVariants.has(toNumericBundleId(v.id)))
      .map(v => ({
        productId: p.id,
        numericProductId: toNumericBundleId(p.id),
        variantId: v.id,
        numericVariantId: toNumericBundleId(v.id),
        label: v.title === 'Default Title' ? p.title : `${p.title} - ${v.title}`,
        image: p.featuredImage,
        price: Number(v.price?.amount ?? 0),
        availableForSale: v.availableForSale,
        product: p,
        variant: v,
      })))
}

// quantities[stepId][variantNumericId] = qty
const quantities = ref<Record<string, Record<string, number>>>({})

const stepKey = (step: EsBundleDynamicStep) => String(step.id)

const currentStep = computed(() => steps.value[stepIndex.value])
const currentItems = computed(() =>
  currentStep.value ? itemsForStep(currentStep.value) : [],
)

const stepTotal = (step: EsBundleDynamicStep) => {
  const map = quantities.value[stepKey(step)] ?? {}
  return Object.values(map).reduce((s, n) => s + (n || 0), 0)
}

const canPickMoreInStep = (step: EsBundleDynamicStep) =>
  stepTotal(step) < (step.step_limit_max ?? 0)

const stepIsValid = (step: EsBundleDynamicStep) => {
  const total = stepTotal(step)
  return total >= (step.step_limit_min ?? 0) && total <= (step.step_limit_max ?? Infinity)
}

const canGoNext = computed(() =>
  currentStep.value ? stepIsValid(currentStep.value) : false,
)

const isLastStep = computed(() => stepIndex.value === steps.value.length - 1)
const isReview = computed(() => stepIndex.value === steps.value.length)

const goNext = () => {
  if (!canGoNext.value) return
  if (stepIndex.value < steps.value.length) stepIndex.value += 1
}
const goBack = () => {
  if (stepIndex.value > 0) stepIndex.value -= 1
}

const inc = (step: EsBundleDynamicStep, vid: string) => {
  if (!canPickMoreInStep(step)) return
  const k = stepKey(step)
  const inner = quantities.value[k] ?? {}
  inner[vid] = (inner[vid] ?? 0) + 1
  quantities.value[k] = inner
}
const dec = (step: EsBundleDynamicStep, vid: string) => {
  const k = stepKey(step)
  const inner = quantities.value[k] ?? {}
  const next = (inner[vid] ?? 0) - 1
  inner[vid] = next < 0 ? 0 : next
  quantities.value[k] = inner
}

// Flatten every picked line across every step for the review + cart payload.
const selectedRows = computed(() => {
  const out: Array<{
    variantId: string
    numericVariantId: string
    label: string
    quantity: number
    price: number
    product: EsBundleComponentProduct
    variant: EsBundleComponentVariant
  }> = []

  for (const step of steps.value) {
    const inner = quantities.value[stepKey(step)] ?? {}
    for (const [vid, qty] of Object.entries(inner)) {
      if (!qty) continue
      const match = variantsByNumericId.value.get(vid)
      if (!match) continue
      const { product, variant } = match
      out.push({
        variantId: variant.id,
        numericVariantId: vid,
        label: variant.title === 'Default Title' ? product.title : `${product.title} - ${variant.title}`,
        quantity: qty,
        price: Number(variant.price?.amount ?? 0),
        product,
        variant,
      })
    }
  }
  return out
})

// Dynamic pricing: base `fixedPrice` + `dynamicPrice` per extra selected unit
// past the minimum. Falls back to the per-item sum when the merchant hasn't
// configured a fixed base.
const totalPrice = computed(() => {
  const totalQty = selectedRows.value.reduce((s, r) => s + r.quantity, 0)
  const fixed = Number(bundle.value?.fixedPrice ?? 0)
  const dynamic = Number(bundle.value?.dynamicPrice ?? 0)

  if (bundle.value?.isDynamic && fixed > 0) {
    // Minimum total across all steps determines the base-price allowance.
    const baseAllowance = (steps.value ?? []).reduce(
      (s, step) => s + (Number(step.step_limit_min) || 0),
      0,
    )
    const extra = Math.max(0, totalQty - baseAllowance)
    return fixed + extra * dynamic
  }

  if (fixed > 0) return fixed
  return selectedRows.value.reduce((s, r) => s + r.price * r.quantity, 0)
})

const bundleAttrs = computed(() =>
  props.widgetData?.cartPayloadGuide?.customAttributes ?? [],
)

const loading = ref(false)

const addToCart = async () => {
  if (loading.value || selectedRows.value.length === 0) return
  loading.value = true

  try {
    let merchandiseGid = props.selectedVariant?.id

    // Dynamic-priced bundles need a brand-new variant per selection so the
    // price can match what the user sees. The Easy Subscription app owns
    // the create endpoint; we just send it the picked components and it
    // returns a variant id to use on the cart line.
    if (bundle.value?.isDynamic) {
      const bundleId = bundle.value?.bundleId
      if (!bundleId) throw new Error('Missing bundle id')

      const createResp = await createEasySubscriptionBundleVariant({
        bundleId,
        productId: toNumericBundleId(props.product.id),
        products: selectedRows.value.map(r => ({
          id: r.product.id ? toNumericBundleId(r.product.id) : '',
          quantity: r.quantity,
          variant_id: r.numericVariantId,
        })),
      })
      const createdVariantId = createResp?.result?.variant_id
      if (!createResp?.status || !createdVariantId) {
        throw new Error(createResp?.message || 'Failed to create bundle variant')
      }
      merchandiseGid = `gid://shopify/ProductVariant/${toNumericBundleId(createdVariantId)}`

      const ready = await waitForVariantReady(merchandiseGid)
      if (!ready) throw new Error('Bundle variant isn\'t available yet. Please try again in a moment.')
    }

    if (!merchandiseGid) throw new Error('Missing bundle variant id')

    const itemsLabel = selectedRows.value.map(r => `${r.label} x${r.quantity}`).join(', ')
    const esbData = selectedRows.value.map(r => `${r.numericVariantId}_${r.quantity}`).join(',')

    const attributes = [
      ...bundleAttrs.value,
      { key: 'Items', value: itemsLabel },
      { key: '_esb_data', value: esbData },
    ]

    const sellingPlanId = props.isSubscription ? props.sellingPlanId : undefined

    await add(merchandiseGid, 1, sellingPlanId, attributes)
    cartOpen.value = true
  }
  catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to add bundle'
    toast.add({ title: 'Bundle error', description: message, color: 'error' })
  }
  finally {
    loading.value = false
  }
}

const headerSteps = computed(() => [
  ...steps.value.map((s, i) => ({ label: s.step_title || `Step ${i + 1}` })),
  { label: 'Review' },
])
</script>

<template>
  <div class="es-bundle-dynamic-wizard mb-6">
    <div
      class="rounded-xl bg-white p-4"
      :style="{ border: `2px solid ${borderColor}` }"
    >
      <!-- Progress header -->
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-3">
          <div
            v-for="(s, i) in headerSteps"
            :key="i"
            class="flex items-center gap-2"
          >
            <span
              class="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold"
              :style="{
                background: i <= stepIndex ? borderColor : '#e5e7eb',
                color: i <= stepIndex ? '#fff' : '#6b7280',
              }"
            >
              <UIcon v-if="i < stepIndex" name="i-lucide-check" class="h-3 w-3" />
              <span v-else>{{ i + 1 }}</span>
            </span>
            <span
              class="text-xs font-semibold"
              :class="i <= stepIndex ? 'text-gray-900' : 'text-gray-500'"
            >
              {{ s.label }}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <span class="text-sm font-bold text-gray-900">{{ money(totalPrice) }}</span>
          <UButton
            v-if="!isReview"
            size="sm"
            :disabled="!canGoNext"
            @click="goNext"
          >
            {{ isLastStep ? 'Review' : 'Next' }}
          </UButton>
        </div>
      </div>

      <!-- Current step picker -->
      <div v-if="currentStep">
        <p
          v-if="currentStep.step_title"
          class="mb-1 text-center text-base font-semibold text-gray-900"
        >
          {{ currentStep.step_title }}
        </p>
        <p
          v-if="currentStep.step_description"
          class="mb-3 text-center text-xs text-gray-600"
        >
          {{ currentStep.step_description }}
        </p>

        <div class="mb-3 text-xs text-gray-700">
          <span class="font-semibold">{{ stepTotal(currentStep) }}</span>
          selected
          <span v-if="currentStep.step_limit_min === currentStep.step_limit_max">
            (need {{ currentStep.step_limit_max }})
          </span>
          <span v-else>
            (min {{ currentStep.step_limit_min }}, max {{ currentStep.step_limit_max }})
          </span>
        </div>

        <div
          v-if="status === 'pending' && currentItems.length === 0"
          class="text-xs text-gray-500"
        >
          Loading products…
        </div>

        <div v-else class="grid gap-2 sm:grid-cols-3">
          <ProductBundleProductTile
            v-for="item in currentItems"
            :key="item.variantId"
            :product="item.product"
            :variant="item.variant"
            mode="picker"
            :quantity="quantities[stepKey(currentStep)]?.[item.numericVariantId] ?? 0"
            :disable-inc="!canPickMoreInStep(currentStep)"
            @inc="inc(currentStep, item.numericVariantId)"
            @dec="dec(currentStep, item.numericVariantId)"
          />
        </div>
      </div>

      <!-- Review -->
      <div v-else-if="isReview">
        <p class="mb-3 text-center text-base font-semibold text-gray-900">
          Review your order
        </p>

        <div class="mb-3 flex items-center justify-between">
          <span class="text-sm font-bold text-gray-900">{{ product.title }}</span>
          <span class="text-sm font-bold text-gray-900">{{ money(totalPrice) }}</span>
        </div>

        <div class="grid gap-2 sm:grid-cols-3">
          <ProductBundleProductTile
            v-for="r in selectedRows"
            :key="r.variantId"
            :product="r.product"
            :variant="r.variant"
            mode="readonly"
            :quantity="r.quantity"
          />
        </div>

        <div class="mt-4 flex items-center justify-between border-t border-neutral-200 pt-3">
          <span class="text-sm font-bold text-gray-900">Order total:</span>
          <span class="text-sm font-bold text-gray-900">{{ money(totalPrice) }}</span>
        </div>

        <div class="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            class="text-xs underline"
            @click="goBack"
          >
            Go back
          </button>
          <UButton
            :loading="loading"
            :disabled="selectedRows.length === 0 || loading"
            @click="addToCart"
          >
            Add to cart
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
