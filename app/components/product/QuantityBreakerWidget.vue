<script setup lang="ts">
const props = defineProps<{
  product: ProductFieldsFragment
  selectedVariant?: ProductVariantFieldsFragment
  widgetData?: EsWidgetData
  purchaseType?: 'one-time' | 'subscription'
}>()

const quantity = defineModel<number>('quantity', { required: true })

const emit = defineEmits<{
  (e: 'change', payload: {
    selectedTierId?: string | number
    attributes?: Array<{ key: string, value: string }>
  }): void
}>()

const productId = computed(() => props.product.id)
const variantId = computed(() => props.selectedVariant?.id)

const fallback = useEasySubscriptionData(productId, variantId)
const widgetData = computed(() => props.widgetData ?? fallback.widgetData.value)

const settings = computed(() => widgetData.value?.quantityBreakSettings)

const rawTiers = computed<EsQuantityBreakTier[]>(() => {
  const tiers = widgetData.value?.quantityBreaks?.productTiers?.tiers
    ?? widgetData.value?.quantityBreaks?.activeTiers?.tiers
    ?? []
  return [...tiers].sort((a, b) => Number(a.quantity) - Number(b.quantity))
})

const compatibleTiers = computed(() =>
  rawTiers.value.filter((t) => {
    const pt = (t.purchase_type ?? 'BOTH').toUpperCase()
    if (pt === 'BOTH') return true
    if (props.purchaseType === 'subscription') return pt === 'SUBSCRIPTION'
    return pt === 'ONE_TIME'
  }),
)

const show = computed(() => compatibleTiers.value.length > 0)

const bestTier = computed<EsQuantityBreakTier | undefined>(() => {
  const qty = quantity.value
  return [...compatibleTiers.value]
    .reverse()
    .find(t => qty >= Number(t.quantity))
})

const variantPrice = computed(() => Number(props.selectedVariant?.price?.amount ?? 0))
const currencyCode = computed(() =>
  props.selectedVariant?.price?.currencyCode ?? widgetData.value?.shop?.currency ?? 'USD',
)

const formatMoney = (amount: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode.value }).format(amount)

const tierUnitPrice = (tier: EsQuantityBreakTier) => {
  const discount = Number(tier.discount) || 0
  if (tier.discountType === 'PERCENTAGE') {
    return variantPrice.value * (1 - discount / 100)
  }
  if (tier.discountType === 'FIXED_AMOUNT') {
    return Math.max(0, variantPrice.value - discount)
  }
  return variantPrice.value
}

const tierTotal = (tier: EsQuantityBreakTier) =>
  tierUnitPrice(tier) * Number(tier.quantity)

const tierOriginalTotal = (tier: EsQuantityBreakTier) =>
  variantPrice.value * Number(tier.quantity)

const tierSavingsPct = (tier: EsQuantityBreakTier) => {
  if (tier.discountType === 'PERCENTAGE') return Number(tier.discount) || 0
  const original = tierOriginalTotal(tier)
  if (original <= 0) return 0
  return Math.round(((original - tierTotal(tier)) / original) * 100)
}

const activate = (tier: EsQuantityBreakTier) => {
  quantity.value = Number(tier.quantity)
}

watch(bestTier, (tier) => {
  emit('change', {
    selectedTierId: tier?.id,
    attributes: tier
      ? [{ key: '_selected_tier', value: String(tier.id) }]
      : [],
  })
}, { immediate: true })

const borderRadius = computed(() => `${settings.value?.borderRadius ?? '10'}px`)
const fontSize = computed(() => `${settings.value?.fontSize ?? '16'}px`)
const badgeFontSize = computed(() => `${settings.value?.badgeFontSize ?? '12'}px`)
</script>

<template>
  <div
    v-if="show"
    class="quantity-breaker-widget mb-6 space-y-2"
    :style="{ fontSize }"
  >
    <div
      v-for="tier in compatibleTiers"
      :key="tier.id"
      class="relative flex cursor-pointer items-center justify-between gap-3 border p-3 transition-colors"
      :class="bestTier?.id === tier.id ? 'ring-2 ring-primary-500' : ''"
      :style="{
        borderRadius,
        borderColor: bestTier?.id === tier.id
          ? (settings?.hoverBorderColor || settings?.borderColor || 'var(--ui-color-primary-500)')
          : (settings?.borderColor || 'var(--ui-color-neutral-200)'),
        background: bestTier?.id === tier.id
          ? (settings?.hoverBgColor || settings?.tierBgColor || '#fff')
          : (settings?.tierBgColor || '#fff'),
        color: settings?.primaryTextColor,
      }"
      role="button"
      :aria-pressed="bestTier?.id === tier.id"
      @click="activate(tier)"
    >
      <div class="flex items-center gap-3">
        <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2"
              :style="{ borderColor: bestTier?.id === tier.id
                ? (settings?.hoverBorderColor || 'var(--ui-color-primary-500)')
                : (settings?.borderColor || 'var(--ui-color-neutral-300)') }"
        >
          <span
            v-if="bestTier?.id === tier.id"
            class="h-2.5 w-2.5 rounded-full"
            :style="{ background: settings?.hoverBorderColor || 'var(--ui-color-primary-500)' }"
          />
        </span>

        <span class="font-semibold">
          {{ tier.offerTitle || `${tier.discount}${tier.discountType === 'PERCENTAGE' ? '%' : ''} off on ${tier.quantity} qty` }}
        </span>

        <span
          v-if="settings?.showBadge && tierSavingsPct(tier) > 0"
          class="rounded px-1.5 py-0.5 font-bold leading-none"
          :style="{
            fontSize: badgeFontSize,
            background: settings?.badgeBgColor || '#000',
            color: settings?.badgeTextColor || '#fff',
          }"
        >
          -{{ tierSavingsPct(tier) }}%
        </span>
      </div>

      <div v-if="selectedVariant" class="text-right">
        <div class="font-bold" :style="{ color: settings?.primaryTextColor }">
          {{ formatMoney(tierTotal(tier)) }}
        </div>
        <div
          v-if="tierUnitPrice(tier) < variantPrice"
          class="text-xs line-through opacity-70"
          :style="{ color: settings?.secondaryTextColor }"
        >
          {{ formatMoney(tierOriginalTotal(tier)) }}
        </div>
      </div>
    </div>
  </div>
</template>
