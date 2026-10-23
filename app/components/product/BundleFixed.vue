<script setup lang="ts">
// FIXED bundle: static list of included products at a fixed total price.
// Doesn't own add-to-cart — just renders the "Content of this bundle" grid
// and emits the Items / _esb_data properties that the parent Configurator
// attaches to the single bundle line it creates on submit.

const props = defineProps<{
  product: ProductFieldsFragment
  widgetData?: EsWidgetData
}>()

const emit = defineEmits<{
  (e: 'change', payload: {
    attributes: Array<{ key: string, value: string }>
  }): void
}>()

const bundle = computed(() => props.widgetData?.bundle)

const fixedVariantsWithQty = computed(() =>
  bundle.value?.fixedVariantsWithQuantity ?? [],
)

const componentProductIds = computed(() =>
  bundle.value?.fixedProducts ?? [],
)

const { productsByNumericId, variantsByNumericId, status } =
  useEasySubscriptionBundleProducts(componentProductIds)

// Rows actually rendered: one per fixed variant, in bundle-defined order.
const rows = computed(() => {
  return fixedVariantsWithQty.value
    .map((entry) => {
      const found = variantsByNumericId.value.get(String(entry.variant_id))
      if (!found) return null
      const { product, variant } = found
      const title = variant.title === 'Default Title'
        ? product.title
        : `${product.title} - ${variant.title}`
      return {
        variantId: variant.id,
        numericVariantId: String(entry.variant_id),
        title,
        quantity: entry.quantity ?? 1,
        product,
        variant,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
})

// Emit cart-line attributes any time the rows change.
watch(rows, (list) => {
  if (list.length === 0) {
    emit('change', { attributes: [] })
    return
  }
  const itemsLabel = list.map(r => `${r.title} x${r.quantity}`).join(', ')
  const esbData = list.map(r => `${r.numericVariantId}_${r.quantity}`).join(',')
  emit('change', {
    attributes: [
      { key: 'Items', value: itemsLabel },
      { key: '_esb_data', value: esbData },
    ],
  })
}, { immediate: true, deep: true })

const settings = computed(() => props.widgetData?.widgetSettings)
const borderColor = computed(() => settings.value?.widget_border_color || '#874ad6')
</script>

<template>
  <div class="es-bundle-fixed mb-6">
    <div
      class="rounded-xl bg-white p-4"
      :style="{ border: `2px solid ${borderColor}` }"
    >
      <div class="mb-3 flex items-center gap-2">
        <UIcon name="i-lucide-package" class="h-5 w-5" :style="{ color: borderColor }" />
        <span class="text-sm font-bold text-gray-900">Content of this bundle</span>
      </div>

      <div
        v-if="status === 'pending' && rows.length === 0"
        class="text-xs text-gray-500"
      >
        Loading bundle items…
      </div>

      <div
        v-else
        class="grid grid-cols-2 gap-3 sm:grid-cols-3"
      >
        <ProductBundleProductTile
          v-for="row in rows"
          :key="row.variantId"
          :product="row.product"
          :variant="row.variant"
          mode="readonly"
          :quantity="row.quantity"
        />
      </div>
    </div>
  </div>
</template>
