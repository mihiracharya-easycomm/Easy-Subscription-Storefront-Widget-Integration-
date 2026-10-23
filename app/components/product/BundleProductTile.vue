<script setup lang="ts">
// Compact product card used by the bundle widgets.
// Mirrors ProductCard's look (image, sold-out / discount badges, title, price)
// but swaps the trailing CartAdd for either a read-only quantity badge
// (FIXED bundle) or a +/- picker that drives the parent wizard's state.

type ReadonlyProps = {
  product: EsBundleComponentProduct
  variant?: EsBundleComponentVariant
  mode: 'readonly'
  quantity: number
  fallbackTitle?: string
}

type PickerProps = {
  product: EsBundleComponentProduct
  variant?: EsBundleComponentVariant
  mode: 'picker'
  quantity: number
  disableInc?: boolean
  disableDec?: boolean
  fallbackTitle?: string
}

const props = defineProps<ReadonlyProps | PickerProps>()

const emit = defineEmits<{
  inc: []
  dec: []
}>()

// Prefer the specific variant's image/price, fall back to the product's.
const image = computed(() =>
  props.variant?.image ?? props.product.featuredImage ?? null,
)

const title = computed(() => {
  const base = props.product.title || props.fallbackTitle || ''
  if (!props.variant || props.variant.title === 'Default Title') return base
  return `${base} - ${props.variant.title}`
})

const price = computed(() => props.variant?.price?.amount
  ?? props.product.priceRange?.minVariantPrice?.amount
  ?? '0')

const compareAtPrice = computed(() =>
  props.variant?.compareAtPrice?.amount ?? null,
)

const currencyCode = computed(() => props.variant?.price?.currencyCode
  ?? props.product.priceRange?.minVariantPrice?.currencyCode
  ?? 'USD')

const money = (amount: string | number) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currencyCode.value,
  }).format(Number(amount) || 0)

const discountPct = computed(() => {
  const p = Number(price.value) || 0
  const c = Number(compareAtPrice.value) || 0
  if (!c || c <= p) return 0
  return Math.round(((c - p) / c) * 100)
})

const soldOut = computed(() => {
  if (props.variant) return !props.variant.availableForSale
  return !props.product.availableForSale
})

const lowStockQty = computed(() => {
  const qa = props.variant?.quantityAvailable
  if (typeof qa === 'number' && qa > 0 && qa <= 5) return qa
  return null
})
</script>

<template>
  <div class="es-bundle-tile flex h-full flex-col rounded-md border border-neutral-200 bg-white p-2">
    <div class="relative mb-2 overflow-hidden rounded-md">
      <div class="absolute left-1 top-1 z-10 flex flex-col items-start gap-1">
        <UBadge
          v-if="soldOut"
          color="neutral"
          variant="solid"
          size="xs"
          :label="$t('product.soldOut')"
        />
        <UBadge
          v-else-if="discountPct"
          color="error"
          variant="solid"
          size="xs"
          :label="`-${discountPct}%`"
        />
      </div>

      <img
        v-if="image?.url"
        :src="image.url"
        :alt="image.altText || title"
        class="h-24 w-full object-cover sm:h-32"
        loading="lazy"
      >
      <div
        v-else
        class="flex h-24 w-full items-center justify-center bg-neutral-100 text-xs text-neutral-400 sm:h-32"
      >
        No image
      </div>
    </div>

    <p class="line-clamp-2 text-xs font-medium text-gray-900">
      {{ title }}
    </p>

    <div class="mt-1 flex items-baseline gap-1">
      <span class="text-sm font-bold text-gray-900">{{ money(price) }}</span>
      <span
        v-if="compareAtPrice && Number(compareAtPrice) > Number(price)"
        class="text-xs text-gray-400 line-through"
      >
        {{ money(compareAtPrice) }}
      </span>
    </div>

    <span
      v-if="lowStockQty"
      class="mt-1 text-[10px] text-amber-600"
    >
      Only {{ lowStockQty }} left
    </span>

    <div class="mt-auto pt-2">
      <div
        v-if="props.mode === 'readonly'"
        class="text-right text-xs font-semibold text-gray-700"
      >
        ×{{ quantity }}
      </div>

      <div
        v-else
        class="flex items-center justify-end"
      >
        <div class="inline-flex items-center overflow-hidden rounded border border-neutral-200">
          <button
            type="button"
            class="h-7 w-7 text-sm font-bold text-gray-700 disabled:opacity-50"
            :disabled="quantity === 0 || props.disableDec"
            @click="emit('dec')"
          >
            −
          </button>
          <span class="w-8 text-center text-sm">{{ quantity }}</span>
          <button
            type="button"
            class="h-7 w-7 text-sm font-bold text-gray-700 disabled:opacity-50"
            :disabled="soldOut || props.disableInc"
            @click="emit('inc')"
          >
            +
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
