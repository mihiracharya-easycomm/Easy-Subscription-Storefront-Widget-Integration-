<script setup lang="ts">
// Variant-based DYNAMIC bundle. 3 steps:
//   1. Pick ONE variant option (e.g. "Red" / "White" / "Purple") —
//      each option already corresponds to a pre-existing Shopify
//      variant on the bundle product (matched via selectedOptions).
//   2. Allocate quantities across the step's eligible products,
//      total <= the picked option's `limit`.
//   3. Review and add to cart — pushes the matched pre-existing
//      bundle variant to cart along with Items / _esb_data properties
//      describing the component selection. No variant-create API
//      call is made here; see BundleDynamicWizard for the branch
//      that materializes a new variant when is_dynamic is true.

interface SelectableVariantOption {
  key: string
  name: string
  limit: number
  price: number
}

const props = defineProps<{
  product: ProductFieldsFragment
  selectedVariant?: ProductVariantFieldsFragment
  widgetData?: EsWidgetData
  sellingPlanId?: string
  isSubscription?: boolean
}>()

const { add, open: cartOpen } = useCart()
const toast = useToast()

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

const options = computed<SelectableVariantOption[]>(() =>
  (bundle.value?.bundleVariantOptions?.variants ?? []).map(v => ({
    key: v.key,
    name: v.name,
    limit: Number(v.limit) || 1,
    price: Number(v.price) || 0,
  })),
)

// Only one dynamic step for a variant-based bundle.
const step = computed(() => bundle.value?.dynamicSteps?.[0])
const componentProductIds = computed(() => step.value?.step_products ?? [])
const allowedVariantIds = computed(() =>
  new Set((step.value?.step_variants ?? []).map(id => String(id))),
)

const { products, variantsByNumericId, status } =
  useEasySubscriptionBundleProducts(componentProductIds)

// All existing variants on the parent bundle product. The option labels
// in bundleVariantOptions.variants (Red/White/Purple) each correspond to
// one of these — matched via selectedOptions below.
const bundleVariants = computed(() =>
  flattenConnection(props.product.variants) as ProductVariantFieldsFragment[],
)

// Match a picked variantoptions `key` ("Frags:Red") against the parent
// bundle product's existing variants and return the first whose
// selectedOptions carry that same option/value pair.
const findBundleVariantByKey = (key: string): ProductVariantFieldsFragment | undefined => {
  const [optionName, optionValue] = key.split(':')
  if (!optionName || !optionValue) return undefined
  return bundleVariants.value.find(v =>
    (v.selectedOptions ?? []).some(
      so => so.name === optionName && so.value === optionValue,
    ),
  )
}

// Flattened list of eligible component variants with their parent product.
const eligibleItems = computed(() =>
  products.value.flatMap(p =>
    p.variants
      .filter(v => allowedVariantIds.value.size === 0
        || allowedVariantIds.value.has(toNumericBundleId(v.id)))
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
      })),
  ),
)

const stepIndex = ref<0 | 1 | 2>(0)
const selectedOptionKey = ref<string>('')
const quantities = ref<Record<string, number>>({})

const selectedOption = computed(() =>
  options.value.find(o => o.key === selectedOptionKey.value),
)

const totalPicked = computed(() =>
  Object.values(quantities.value).reduce((s, n) => s + (n || 0), 0),
)

const canSelectMore = computed(() => {
  const limit = selectedOption.value?.limit ?? 0
  return totalPicked.value < limit
})

const canGoNext = computed(() => {
  if (stepIndex.value === 0) return Boolean(selectedOption.value)
  if (stepIndex.value === 1) return totalPicked.value > 0
  return true
})

const totalPrice = computed(() => Number(selectedOption.value?.price ?? 0))

const inc = (vid: string) => {
  if (!canSelectMore.value) return
  quantities.value[vid] = (quantities.value[vid] ?? 0) + 1
}
const dec = (vid: string) => {
  const next = (quantities.value[vid] ?? 0) - 1
  quantities.value[vid] = next < 0 ? 0 : next
}

watch(selectedOptionKey, () => {
  quantities.value = {}
})

const goNext = () => {
  if (!canGoNext.value) return
  if (stepIndex.value < 2) stepIndex.value = (stepIndex.value + 1) as 0 | 1 | 2
}
const goBack = () => {
  if (stepIndex.value > 0) stepIndex.value = (stepIndex.value - 1) as 0 | 1 | 2
}

const selectedRows = computed(() =>
  eligibleItems.value
    .map(item => ({
      ...item,
      quantity: quantities.value[item.numericVariantId] ?? 0,
    }))
    .filter(r => r.quantity > 0),
)

const bundleAttrs = computed(() =>
  props.widgetData?.cartPayloadGuide?.customAttributes ?? [],
)

const loading = ref(false)

const addToCart = async () => {
  if (loading.value || selectedRows.value.length === 0) return
  loading.value = true

  try {
    const matched = findBundleVariantByKey(selectedOptionKey.value)
    if (!matched) {
      throw new Error(`No bundle variant matches option "${selectedOptionKey.value}"`)
    }

    const itemsLabel = selectedRows.value.map(r => `${r.label} x${r.quantity}`).join(', ')
    const esbData = selectedRows.value.map(r => `${r.numericVariantId}_${r.quantity}`).join(',')

    const attributes = [
      ...bundleAttrs.value,
      { key: 'Items', value: itemsLabel },
      { key: '_esb_data', value: esbData },
    ]

    const sellingPlanId = props.isSubscription ? props.sellingPlanId : undefined

    await add(matched.id, 1, sellingPlanId, attributes)
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

const steps = [
  { label: 'Select a plan' },
  { label: 'Choose products' },
  { label: 'Review' },
]
</script>

<template>
  <div class="es-bundle-variant-picker mb-6">
    <div
      class="rounded-xl bg-white p-4"
      :style="{ border: `2px solid ${borderColor}` }"
    >
      <!-- Header: progress + price + Next -->
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div
            v-for="(s, i) in steps"
            :key="s.label"
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
            v-if="stepIndex < 2"
            size="sm"
            :disabled="!canGoNext"
            @click="goNext"
          >
            Next
          </UButton>
        </div>
      </div>

      <!-- Step 1 — Pick a variant option -->
      <div v-if="stepIndex === 0">
        <p class="mb-3 text-center text-base font-semibold text-gray-900">
          Choose a plan to match your lifestyle
        </p>
        <div class="grid gap-2 sm:grid-cols-3">
          <label
            v-for="opt in options"
            :key="opt.key"
            class="flex cursor-pointer items-center gap-2 rounded-md border p-3"
            :style="{
              borderColor: selectedOptionKey === opt.key ? borderColor : 'var(--ui-color-neutral-200)',
            }"
          >
            <input
              v-model="selectedOptionKey"
              type="radio"
              :value="opt.key"
              name="es-bundle-option"
              :style="{ accentColor: borderColor }"
            >
            <span class="text-sm font-semibold text-gray-900">{{ opt.name }}</span>
          </label>
        </div>
      </div>

      <!-- Step 2 — Choose component products -->
      <div v-else-if="stepIndex === 1">
        <div class="mb-3 text-xs text-gray-700">
          <span class="font-semibold">{{ totalPicked }} of {{ selectedOption?.limit ?? 0 }}</span>
          selected
        </div>

        <div
          v-if="status === 'pending' && eligibleItems.length === 0"
          class="text-xs text-gray-500"
        >
          Loading products…
        </div>

        <div v-else class="grid gap-2 sm:grid-cols-3">
          <ProductBundleProductTile
            v-for="item in eligibleItems"
            :key="item.variantId"
            :product="item.product"
            :variant="item.variant"
            mode="picker"
            :quantity="quantities[item.numericVariantId] ?? 0"
            :disable-inc="!canSelectMore"
            @inc="inc(item.numericVariantId)"
            @dec="dec(item.numericVariantId)"
          />
        </div>
      </div>

      <!-- Step 3 — Review and add to cart -->
      <div v-else>
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
