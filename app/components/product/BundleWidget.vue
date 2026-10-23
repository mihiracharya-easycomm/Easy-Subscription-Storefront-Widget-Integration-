<script setup lang="ts">
// Top-level bundle orchestrator. Delegates to the sub-view that matches the
// product's bundle shape:
//   - FIXED                     → static list of included products.
//   - DYNAMIC + variantoptions  → 3-step wizard that maps a picked option
//                                 ("Frags:Red") to an EXISTING Shopify
//                                 variant on the bundle product. No API call.
//   - DYNAMIC + no options      → N-step BYOB wizard. When bundle.isDynamic
//                                 is true, the submit calls the Easy
//                                 Subscription variant-create API before
//                                 adding to cart.
// For FIXED we emit the cart-line attributes upward; the parent Configurator
// merges them into the normal add-to-cart. For DYNAMIC we own the add flow,
// but still accept the current selling plan + subscription toggle from the
// parent SubscriptionWidget so bundle lines can be sold on subscription too.

const props = defineProps<{
  product: ProductFieldsFragment
  selectedVariant?: ProductVariantFieldsFragment
  widgetData?: EsWidgetData
  sellingPlanId?: string
  isSubscription?: boolean
}>()

const emit = defineEmits<{
  (e: 'change', payload: {
    attributes?: Array<{ key: string, value: string }>
    // When true, the parent must NOT render its own add-to-cart —
    // the bundle widget owns it (DYNAMIC wizards).
    ownsAddToCart: boolean
  }): void
}>()

const bundle = computed(() => props.widgetData?.bundle)
const isBundle = computed(() => Boolean(bundle.value?.isBundle))
const bundleType = computed(() => bundle.value?.bundleType)

const isVariantBasedDynamic = computed(() =>
  bundleType.value === 'DYNAMIC'
  && (bundle.value?.bundleVariantOptions?.options?.length ?? 0) > 0,
)

const mode = computed<'FIXED' | 'DYNAMIC_VARIANT' | 'DYNAMIC_BYOB' | null>(() => {
  if (!isBundle.value) return null
  if (bundleType.value === 'FIXED') return 'FIXED'
  if (isVariantBasedDynamic.value) return 'DYNAMIC_VARIANT'
  if (bundleType.value === 'DYNAMIC') return 'DYNAMIC_BYOB'
  return null
})

watch(mode, (m) => {
  // Signal to parent whether we're taking over the add-to-cart button.
  emit('change', {
    attributes: [],
    ownsAddToCart: m === 'DYNAMIC_VARIANT' || m === 'DYNAMIC_BYOB',
  })
}, { immediate: true })

const onFixedChange = (payload: { attributes: Array<{ key: string, value: string }> }) => {
  emit('change', { attributes: payload.attributes, ownsAddToCart: false })
}
</script>

<template>
  <template v-if="mode === 'FIXED'">
    <ProductBundleFixed
      :product="product"
      :widget-data="widgetData"
      @change="onFixedChange"
    />
  </template>

  <template v-else-if="mode === 'DYNAMIC_VARIANT'">
    <ProductBundleVariantPicker
      :product="product"
      :selected-variant="selectedVariant"
      :widget-data="widgetData"
      :selling-plan-id="sellingPlanId"
      :is-subscription="isSubscription"
    />
  </template>

  <template v-else-if="mode === 'DYNAMIC_BYOB'">
    <ProductBundleDynamicWizard
      :product="product"
      :selected-variant="selectedVariant"
      :widget-data="widgetData"
      :selling-plan-id="sellingPlanId"
      :is-subscription="isSubscription"
    />
  </template>
</template>
