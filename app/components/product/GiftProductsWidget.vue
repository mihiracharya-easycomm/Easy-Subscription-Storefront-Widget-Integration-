<script setup lang="ts">
const props = defineProps<{
  widgetData?: EsWidgetData
  sellingPlanId?: string
  isSubscription?: boolean
}>()

const emit = defineEmits<{
  (e: 'change', payload: {
    attributes: Array<{ key: string, value: string }>
  }): void
}>()

const toNumericId = (gid?: string) => gid?.split('/').pop() ?? ''

const giftOffers = computed<EsGiftProductOffer[]>(() => {
  if (!props.isSubscription || !props.sellingPlanId) return []
  const numericId = toNumericId(props.sellingPlanId)
  const match = props.widgetData?.giftProducts?.find(g => g.selling_plan_id === numericId)
  return match?.gift_product_items ?? []
})

const show = computed(() => giftOffers.value.length > 0)

const selections = ref<Record<string, string[]>>({})

const offerKey = (offer: EsGiftProductOffer) => String(offer.id)

watch(giftOffers, (offers) => {
  const next: Record<string, string[]> = {}
  for (const offer of offers) {
    const key = offerKey(offer)
    if (offer.product_type === 'fixed_product') {
      next[key] = offer.gift_product_items.map(it => it.variantId)
    }
    else {
      const prev = selections.value[key] ?? []
      next[key] = prev.filter(v => offer.gift_product_items.some(it => it.variantId === v))
    }
  }
  selections.value = next
}, { immediate: true, deep: true })

const isSelected = (offer: EsGiftProductOffer, variantId: string) =>
  (selections.value[offerKey(offer)] ?? []).includes(variantId)

const canSelectMore = (offer: EsGiftProductOffer) => {
  const current = selections.value[offerKey(offer)] ?? []
  return current.length < (offer.product_limit || 1)
}

const toggleChoice = (offer: EsGiftProductOffer, variantId: string) => {
  if (offer.product_type !== 'choice_list') return
  const key = offerKey(offer)
  const current = selections.value[key] ?? []
  if (current.includes(variantId)) {
    selections.value[key] = current.filter(v => v !== variantId)
    return
  }
  if (current.length >= (offer.product_limit || 1)) return
  selections.value[key] = [...current, variantId]
}

watch([selections, giftOffers], () => {
  if (!show.value) {
    emit('change', { attributes: [] })
    return
  }

  const names: string[] = []
  const ids: string[] = []

  for (const offer of giftOffers.value) {
    const selected = selections.value[offerKey(offer)] ?? []
    for (const vId of selected) {
      const item = offer.gift_product_items.find(it => it.variantId === vId)
      if (!item) continue
      names.push(item.displayName || item.title)
      ids.push(toNumericId(vId))
    }
  }

  if (ids.length === 0) {
    emit('change', { attributes: [] })
    return
  }

  emit('change', {
    attributes: [
      { key: 'Free Gift Items', value: names.join(',') },
      { key: '_esa_gift_data', value: ids.join(',') },
    ],
  })
}, { immediate: true, deep: true })

const settings = computed(() => props.widgetData?.widgetSettings)
const borderColor = computed(() => settings.value?.widget_border_color || '#874ad6')
const outerThickness = computed(() => settings.value?.widget_outer_border_thickness || '2px')
</script>

<template>
  <div v-if="show" class="es-gift-products-widget mb-6">
    <div
      class="rounded-xl bg-white p-4"
      :style="{ border: `${outerThickness} solid ${borderColor}` }"
    >
      <div class="mb-3 flex items-center gap-2">
        <UIcon name="i-lucide-gift" class="h-5 w-5" :style="{ color: borderColor }" />
        <span class="text-sm font-bold text-gray-900">Free Gift Products</span>
      </div>

      <div class="space-y-4">
        <div
          v-for="offer in giftOffers"
          :key="offer.id"
          class="space-y-2"
        >
          <p
            v-if="offer.product_type === 'choice_list'"
            class="text-xs text-gray-600"
          >
            Pick up to {{ offer.product_limit }}
            {{ offer.product_limit === 1 ? 'gift' : 'gifts' }}.
          </p>

          <label
            v-for="item in offer.gift_product_items"
            :key="item.variantId"
            class="flex cursor-pointer items-center gap-3 rounded-md border p-2 transition-colors"
            :class="{
              'cursor-not-allowed opacity-60':
                offer.product_type === 'choice_list'
                  && !isSelected(offer, item.variantId)
                  && !canSelectMore(offer),
            }"
            :style="{
              borderColor: isSelected(offer, item.variantId)
                ? borderColor
                : 'var(--ui-color-neutral-200)',
            }"
          >
            <input
              v-if="offer.product_type === 'choice_list'"
              type="checkbox"
              class="h-4 w-4"
              :style="{ accentColor: borderColor }"
              :checked="isSelected(offer, item.variantId)"
              :disabled="!isSelected(offer, item.variantId) && !canSelectMore(offer)"
              @change="toggleChoice(offer, item.variantId)"
            >
            <span
              v-else
              class="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm"
              :style="{ background: borderColor }"
            >
              <UIcon name="i-lucide-check" class="h-3 w-3 text-white" />
            </span>

            <img
              v-if="item.images?.node?.preview?.image?.url"
              :src="item.images.node.preview.image.url"
              :alt="item.images.node.preview.image.altText || item.title"
              class="h-10 w-10 rounded object-cover"
              loading="lazy"
            >

            <span class="flex-1 text-sm text-gray-900">
              {{ item.displayName || item.title }}
            </span>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>
