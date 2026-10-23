<script setup lang="ts">
import type { FormSubmitEvent } from '#ui/types'

const props = defineProps<{
  product?: ProductFieldsFragment
}>()

const selectedVariant = defineModel<ProductVariantFieldsFragment>()

const emit = defineEmits<{
  submit: [FormSubmitEvent<typeof state>]
}>()

const { add } = useCart()
const toast = useToast()
const { t } = useI18n()

const handle = computed(() => selectedVariant.value?.product.handle)

const state = reactive({
  quantity: 1,
  selectedOptions: selectedVariant.value?.selectedOptions,
})

const { params: localization } = useLocalization()

const { data } = await useStorefrontData(localizedKey('product-options', handle), `#graphql
  query FetchProductOptions($handle: String, $language: LanguageCode, $country: CountryCode, $selectedOptions: [SelectedOptionInput!])
  @inContext(language: $language, country: $country) {
    product(handle: $handle) {
      options(first: 250) {
        ...ProductOptionFields
      }

      selectedOrFirstAvailableVariant(selectedOptions: $selectedOptions) {
        ...ProductVariantFields
      }
    }
  }
`, {
  variables: computed(() => productInputSchema.parse({
    handle: handle.value,
    selectedOptions: state.selectedOptions,
    ...localization.value,
  })),
  transform: value => value.product,
  watch: [() => state.selectedOptions],
  cache: 'long',
  lazy: true,
})

const loading = ref(false)

const product = computed(() => data.value ?? props.product)

const soldOut = computed(() => Boolean(props.product && isSoldOut(props.product)))
const unavailable = computed(() => soldOut.value || !selectedVariant.value?.availableForSale)
const lowStock = computed(() => isLowStock(selectedVariant.value))
const subscription = computed(() => Boolean(props.product && hasSellingPlans(props.product)))

const maxQuantity = computed(() => {
  const quantity = selectedVariant.value?.quantityAvailable

  return quantity && quantity > 0 ? Math.min(quantity, 10) : 10
})

watch(() => data.value?.selectedOrFirstAvailableVariant, variant => selectedVariant.value = variant ?? undefined)

// Shared easy-subscription widget data (one fetch per product+variant)
const productId = computed(() => props.product?.id)
const variantId = computed(() => selectedVariant.value?.id)
const { widgetData } = useEasySubscriptionData(productId, variantId)

// Reset quantity when the breaker config asks for it on variant change
watch(variantId, () => {
  if (widgetData.value?.quantityBreakSettings?.isResetDefaultValue) {
    state.quantity = Number(widgetData.value.quantityBreakSettings.defaultQuantity) || 1
  }
})

const subscriptionState = ref<{
  isSubscription: boolean
  sellingPlanId?: string
  attributes?: Array<{ key: string, value: string }>
}>({ isSubscription: false })

const breakerState = ref<{
  selectedTierId?: string | number
  attributes?: Array<{ key: string, value: string }>
}>({})

const giftState = ref<{
  attributes?: Array<{ key: string, value: string }>
}>({})

const bundleState = ref<{
  attributes?: Array<{ key: string, value: string }>
  ownsAddToCart: boolean
}>({ ownsAddToCart: false })

const isBundle = computed(() => Boolean(widgetData.value?.bundle?.isBundle))

// REQUIRED_QUANTITY enforcement — mirrors the Easy Subscription Shopify Function
// client-side because the Checkout Rule isn't wired up on this storefront.
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
// Idempotent on purpose — if the current qty is already a valid multiple of
// the new step we leave it alone, so switching req=10 → req=2 at qty=10 stays
// at 10 instead of jumping. Floor-biased so a plan switch never bumps the
// user up a step; the only time we snap up is from an invalid value below the
// new minimum.
watch([requiredQty, () => state.quantity], ([qty, currentQty]) => {
  if (qty <= 1) return
  if (currentQty >= qty && currentQty % qty === 0) return
  const floored = Math.floor(currentQty / qty) * qty
  const next = floored >= qty ? floored : qty
  if (next !== currentQty) state.quantity = next
}, { flush: 'post' })

const onSubscriptionChange = (payload: typeof subscriptionState.value) => {
  subscriptionState.value = payload
}

const onBreakerChange = (payload: typeof breakerState.value) => {
  breakerState.value = payload
}

const onGiftChange = (payload: typeof giftState.value) => {
  giftState.value = payload
}

const onBundleChange = (payload: typeof bundleState.value) => {
  bundleState.value = payload
}

const mergedAttributes = computed(() => {
  const map = new Map<string, string>()

  if (subscriptionState.value.isSubscription) {
    for (const attr of subscriptionState.value.attributes ?? []) {
      map.set(attr.key, attr.value)
    }
  }

  for (const attr of breakerState.value.attributes ?? []) {
    map.set(attr.key, attr.value)
  }

  for (const attr of giftState.value.attributes ?? []) {
    map.set(attr.key, attr.value)
  }

  // Bundle attributes include _bundle_id, _bundle_type + Items + _esb_data.
  // Only merged when the parent still owns add-to-cart (FIXED bundles).
  if (isBundle.value && !bundleState.value.ownsAddToCart) {
    for (const attr of widgetData.value?.cartPayloadGuide?.customAttributes ?? []) {
      map.set(attr.key, attr.value)
    }
    for (const attr of bundleState.value.attributes ?? []) {
      map.set(attr.key, attr.value)
    }
  }

  return Array.from(map, ([key, value]) => ({ key, value }))
})

const onSubmit = async (event: FormSubmitEvent<typeof state>) => {
  if (!selectedVariant.value) return

  if (requiredQty.value > 1 && event.data.quantity % requiredQty.value !== 0) {
    toast.add({
      title: t('product.requiredQuantity', { quantity: requiredQty.value }),
      color: 'error',
    })
    return
  }

  loading.value = true

  const sellingPlanId = subscriptionState.value.isSubscription
    ? subscriptionState.value.sellingPlanId
    : undefined

  const attributes = mergedAttributes.value.length > 0
    ? mergedAttributes.value
    : undefined

  await add(
    selectedVariant.value.id,
    event.data.quantity,
    sellingPlanId,
    attributes,
  ).finally(() => {
    loading.value = false

    emit('submit', event)
  })
}
</script>

<template>
  <div>
    <div class="flex-col lg:flex pb-6 lg:pb-8">
      <h1 class="text-4xl lg:text-5xl font-extrabold text-gray-900 mb-4">
        {{ selectedVariant?.product?.title }}
      </h1>

      <ProductPrice
        v-if="selectedVariant"
        :price="selectedVariant.price"
        :compare-at-price="selectedVariant.compareAtPrice"
        class="inline-block lg:text-lg lg:mb-0"
        discount
      />

      <div class="flex flex-wrap items-center gap-2 mt-4">
        <UBadge
          v-if="unavailable"
          color="neutral"
          variant="subtle"
          :label="$t('product.soldOut')"
        />

        <UBadge
          v-else-if="lowStock"
          color="warning"
          variant="subtle"
          :label="$t('product.lowStock', { count: selectedVariant?.quantityAvailable ?? 0 })"
        />

        <UBadge
          v-if="subscription"
          color="primary"
          variant="subtle"
          :label="$t('product.subscription')"
        />

        <UBadge
          v-if="props.product?.isGiftCard"
          color="primary"
          variant="subtle"
          :label="$t('product.giftCard')"
        />
      </div>
    </div>

    <USeparator class="mb-6 lg:mb-8" />

    <UForm
      v-if="product"
      :state="state"
      @submit="onSubmit"
    >
      <ProductOptionGroup
        v-model="state.selectedOptions"
        :options="product.options"
        class="order-1 lg:order-2 mb-6 lg:mb-8"
      />

      <ProductSubscriptionWidget
        v-if="props.product"
        :product="props.product"
        :selected-variant="selectedVariant"
        :widget-data="widgetData"
        @change="onSubscriptionChange"
      />

      <ProductBundleWidget
        v-if="props.product && isBundle"
        :product="props.product"
        :selected-variant="selectedVariant"
        :widget-data="widgetData"
        :selling-plan-id="subscriptionState.sellingPlanId"
        :is-subscription="subscriptionState.isSubscription"
        @change="onBundleChange"
      />

      <ProductQuantityBreakerWidget
        v-if="props.product && !isBundle"
        v-model:quantity="state.quantity"
        :product="props.product"
        :selected-variant="selectedVariant"
        :widget-data="widgetData"
        :purchase-type="subscriptionState.isSubscription ? 'subscription' : 'one-time'"
        @change="onBreakerChange"
      />

      <ProductGiftProductsWidget
        v-if="!bundleState.ownsAddToCart"
        :widget-data="widgetData"
        :selling-plan-id="subscriptionState.sellingPlanId"
        :is-subscription="subscriptionState.isSubscription"
        @change="onGiftChange"
      />

      <div
        v-if="!bundleState.ownsAddToCart"
        class="flex justify-between items-center"
      >
        <UFormField
          name="quantity"
          :label="$t('product.quantity')"
          class="-mt-1"
          :ui="{ label: 'hidden' }"
        >
          <UInputNumber
            v-model="state.quantity"
            :min="requiredQty"
            :step="requiredQty"
            :max="maxQuantity"
            class="w-24 lg:w-28"
            size="xl"
          />
        </UFormField>

        <UButton
          type="submit"
          size="xl"
          variant="subtle"
          :disabled="!selectedVariant || unavailable || loading"
          :trailing-icon="loading ? 'i-lucide-loader-circle' : unavailable ? 'i-lucide-ban' : 'i-lucide-shopping-bag'"
          :ui="{ trailingIcon: loading ? 'animate-spin size-5' : 'size-5' }"
          :label="unavailable ? $t('product.soldOut') : subscriptionState.isSubscription ? 'Add Subscription to Cart' : $t('product.add')"
        />
      </div>
    </UForm>
  </div>
</template>
