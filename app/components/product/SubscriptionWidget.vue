<script setup lang="ts">
interface PlanWithQty extends EsSellingPlan {
  requiredQuantity?: { enabled: boolean, quantity: number } | null
  billingPolicy?: { interval?: string, intervalCount?: number } | null
  deliveryPolicy?: { interval?: string, intervalCount?: number } | null
}

const props = defineProps<{
  product: ProductFieldsFragment
  selectedVariant?: ProductVariantFieldsFragment
  widgetData?: EsWidgetData
}>()

const emit = defineEmits<{
  (e: 'change', payload: {
    isSubscription: boolean
    sellingPlanId?: string
    attributes?: Array<{ key: string, value: string }>
  }): void
}>()

const productId = computed(() => props.product.id)
const variantId = computed(() => props.selectedVariant?.id)

const fallback = useEasySubscriptionData(productId, variantId)
const widgetData = computed(() => props.widgetData ?? fallback.widgetData.value)

const settings = computed(() => widgetData.value?.widgetSettings)
const group = computed(() => widgetData.value?.sellingPlanGroups?.[0])
const requiresSubscription = computed(() =>
  props.product.requiresSellingPlan || widgetData.value?.product?.requiresSellingPlan === true,
)

const hasSellingPlans = computed(() =>
  Boolean(widgetData.value?.widgetState?.hasSellingPlans
    && (widgetData.value?.sellingPlanGroups?.length ?? 0) > 0),
)

const allPlans = computed<PlanWithQty[]>(() =>
  (widgetData.value?.sellingPlanGroups?.flatMap(g => g.sellingPlans) ?? []) as PlanWithQty[],
)

const purchaseType = ref<'one-time' | 'subscription'>('one-time')
const selectedPlanId = ref<string>('')

const currentPlan = computed<PlanWithQty | undefined>(() =>
  allPlans.value.find(p => p.id === selectedPlanId.value) ?? allPlans.value[0],
)

const allocationFor = (planId: string) =>
  widgetData.value?.activeVariantAllocations?.find(a => a.sellingPlanId === planId)

const variantPrice = computed(() => Number(props.selectedVariant?.price?.amount ?? 0))

const currencyCode = computed(() =>
  props.selectedVariant?.price?.currencyCode ?? widgetData.value?.shop?.currency ?? 'USD',
)

const money = (amount: number) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currencyCode.value,
    minimumFractionDigits: 2,
  }).format(amount)

const moneyWithCode = (amount: number) => `${money(amount)} ${currencyCode.value}`

const unitPrice = (plan: PlanWithQty) => {
  const base = variantPrice.value
  const pct = allocationFor(plan.id)?.discountPercentage ?? plan.discountPercentage ?? 0

  switch (plan.adjustmentType) {
    case 'PRICE':
      return Number(plan.discountAmount?.amount ?? base)
    case 'FIXED_AMOUNT':
      return Math.max(0, base - Number(plan.discountAmount?.amount ?? 0))
    case 'PERCENTAGE':
      return base * (1 - pct / 100)
    default:
      return pct > 0 ? base * (1 - pct / 100) : base
  }
}

// How many deliveries fall inside one billing cycle for a prepaid plan.
// Only well-defined when billing and delivery share the same interval unit.
const deliveriesPerBilling = (plan: PlanWithQty) => {
  const b = plan.billingPolicy
  const d = plan.deliveryPolicy
  if (!b?.interval || !d?.interval || b.interval !== d.interval) return 1
  const count = (b.intervalCount ?? 1) / (d.intervalCount ?? 1)
  return count >= 1 ? count : 1
}

// Total paid per billing cycle = unit price * required qty (or 1) * deliveries per billing.
const totalPerBilling = (plan: PlanWithQty) => {
  const qty = plan.requiredQuantity?.enabled && plan.requiredQuantity?.quantity > 0
    ? plan.requiredQuantity.quantity
    : 1
  return unitPrice(plan) * qty * deliveriesPerBilling(plan)
}

const originalPerBilling = (plan: PlanWithQty) => {
  const qty = plan.requiredQuantity?.enabled && plan.requiredQuantity?.quantity > 0
    ? plan.requiredQuantity.quantity
    : 1
  return variantPrice.value * qty * deliveriesPerBilling(plan)
}

const savingsLabel = (plan: PlanWithQty) => {
  const pct = allocationFor(plan.id)?.discountPercentage ?? plan.discountPercentage ?? 0

  switch (plan.adjustmentType) {
    case 'PERCENTAGE':
      return pct > 0 ? `SAVE ${pct}%` : null
    case 'FIXED_AMOUNT':
      return plan.discountAmount
        ? `SAVE ${money(Number(plan.discountAmount.amount))}`
        : null
    case 'PRICE':
      return plan.discountAmount
        ? `FLAT OFF ${money(Number(plan.discountAmount.amount))}`
        : null
    default:
      return pct > 0 ? `SAVE ${pct}%` : null
  }
}

// Strip the "(save X%)" / "($160.00)" suffix the merchant adds to plan names.
const cleanName = (name: string) =>
  name.replace(/,?\s*\(.*\)\s*$/, '').trim()

const fromPrice = computed(() => {
  if (allPlans.value.length === 0) return variantPrice.value
  return Math.min(...allPlans.value.map(p => unitPrice(p)))
})

const cartAttributes = computed(() =>
  widgetData.value?.cartPayloadGuide?.customAttributes ?? [],
)

// Human description shown under the plan list for the currently-selected plan.
const planDescription = computed(() => {
  const p = currentPlan.value
  if (!p) return ''
  return p.description || cleanName(p.name)
})

const payCycleLabel = computed(() => {
  const p = currentPlan.value
  if (!p?.billingPolicy?.interval) return ''
  const count = p.billingPolicy.intervalCount ?? 1
  const unit = p.billingPolicy.interval.toLowerCase()
  return count === 1 ? unit : `${count} ${unit}s`
})

watch(widgetData, (d) => {
  if (!d) return

  if (requiresSubscription.value || settings.value?.default_purchase_option === 'subscription') {
    purchaseType.value = 'subscription'
  }
  else {
    purchaseType.value = 'one-time'
  }

  if (allPlans.value.length > 0 && !selectedPlanId.value) {
    selectedPlanId.value = allPlans.value[0]!.id
  }
}, { immediate: true })

watch([purchaseType, selectedPlanId, widgetData], () => {
  if (!hasSellingPlans.value) {
    emit('change', { isSubscription: false })
    return
  }

  const isSub = purchaseType.value === 'subscription'
  emit('change', {
    isSubscription: isSub,
    sellingPlanId: isSub ? (selectedPlanId.value || allPlans.value[0]?.id) : undefined,
    attributes: isSub ? cartAttributes.value : undefined,
  })
}, { immediate: true })

const detailsOpen = ref(false)

// Style tokens (fall back to purple theme like the reference)
const outerBorder = computed(() => settings.value?.widget_border_color || '#874ad6')
const outerBg = computed(() => settings.value?.widget_background_color || '#ddc8fb')
const innerBg = computed(() => settings.value?.widget_inner_background_color || '#ffffff')
const outerThickness = computed(() => settings.value?.widget_outer_border_thickness || '2px')
const innerThickness = computed(() => settings.value?.widget_inner_border_thickness || '2px')
const badgeBg = computed(() => settings.value?.badge_background_color || '#863ce6')
const badgeText = computed(() => settings.value?.badge_text_color || '#ffffff')
</script>

<template>
  <div v-if="hasSellingPlans" class="easy-subscription-widget mb-6 space-y-3">
    <!-- One-time option (hidden when subscription is required) -->
    <label
      v-if="!requiresSubscription"
      class="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-white p-4 transition-colors"
      :style="{
        border: `${outerThickness} solid ${purchaseType === 'one-time' ? outerBorder : 'var(--ui-color-neutral-200)'}`,
      }"
    >
      <div class="flex items-center gap-3">
        <input
          v-model="purchaseType"
          type="radio"
          value="one-time"
          name="es_purchase_type"
          class="h-4 w-4 accent-current"
          :style="{ accentColor: outerBorder }"
        >
        <span class="text-sm font-semibold text-gray-900">
          One-time purchase
        </span>
      </div>
      <span class="text-sm font-semibold text-gray-900">
        {{ moneyWithCode(variantPrice) }}
      </span>
    </label>

    <!-- Subscription card -->
    <div
      class="rounded-xl overflow-hidden"
      :style="{
        border: `${outerThickness} solid ${outerBorder}`,
        background: purchaseType === 'subscription' ? outerBg : '#ffffff',
      }"
    >
      <!-- Header -->
      <label class="flex cursor-pointer items-start justify-between gap-3 p-4">
        <div class="flex items-start gap-3">
          <input
            v-model="purchaseType"
            type="radio"
            value="subscription"
            name="es_purchase_type"
            class="mt-1 h-4 w-4"
            :style="{ accentColor: outerBorder }"
          >
          <span class="text-base font-bold leading-tight text-gray-900">
            {{ group?.name || 'Subscribe & Save' }}
          </span>
        </div>
        <div class="text-right">
          <div class="text-sm text-gray-700">
            from <span class="font-bold text-gray-900">{{ moneyWithCode(fromPrice) }}</span>
          </div>
          <div class="text-xs text-gray-500">
            /each
          </div>
        </div>
      </label>

      <!-- Plans + description (only when subscription selected) -->
      <div
        v-if="purchaseType === 'subscription'"
        class="mx-3 mb-3 rounded-lg p-3"
        :style="{ background: innerBg, border: `${innerThickness} solid transparent` }"
      >
        <p class="mb-3 text-sm font-semibold text-gray-900">
          Delivery Frequency
        </p>

        <div class="space-y-2">
          <label
            v-for="plan in allPlans"
            :key="plan.id"
            class="flex cursor-pointer items-start justify-between gap-3 rounded-md p-3 transition-colors"
            :style="{
              border: `1px solid ${selectedPlanId === plan.id ? outerBorder : 'var(--ui-color-neutral-200)'}`,
              background: selectedPlanId === plan.id ? '#ffffff' : '#ffffff',
            }"
          >
            <div class="flex min-w-0 flex-1 items-start gap-3">
              <input
                v-model="selectedPlanId"
                type="radio"
                :value="plan.id"
                name="es_plan"
                class="mt-0.5 h-4 w-4 shrink-0"
                :style="{ accentColor: outerBorder }"
              >
              <div class="min-w-0 flex-1 space-y-1.5">
                <div class="text-sm font-semibold text-gray-900">
                  {{ cleanName(plan.name) }}
                </div>
                <span
                  v-if="savingsLabel(plan)"
                  class="inline-block rounded px-2 py-0.5 text-xs font-bold leading-tight"
                  :style="{ background: badgeBg, color: badgeText }"
                >
                  {{ savingsLabel(plan) }}
                </span>
              </div>
            </div>

            <div class="shrink-0 text-right">
              <div class="text-sm font-bold text-gray-900">
                {{ moneyWithCode(totalPerBilling(plan)) }}
              </div>
              <div
                v-if="totalPerBilling(plan) < originalPerBilling(plan)"
                class="text-xs text-gray-400 line-through"
              >
                {{ moneyWithCode(originalPerBilling(plan)) }}
              </div>
            </div>
          </label>
        </div>

        <!-- Description -->
        <div v-if="currentPlan" class="mt-4 space-y-1 text-xs text-gray-700">
          <p>{{ planDescription }}</p>
          <p>
            Your subscription payment will be
            <span class="font-semibold">{{ moneyWithCode(totalPerBilling(currentPlan)) }}</span>
            every {{ payCycleLabel }}. Auto-renews, skip or cancel anytime.
          </p>
        </div>

        <!-- Subscription Details toggle -->
        <button
          type="button"
          class="mt-3 flex w-full items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
          @click.prevent="detailsOpen = !detailsOpen"
        >
          <UIcon name="i-lucide-info" class="h-4 w-4" :style="{ color: outerBorder }" />
          <span>Subscription Details</span>
          <UIcon
            :name="detailsOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
            class="ml-auto h-4 w-4 text-gray-400"
          />
        </button>

        <div
          v-if="detailsOpen"
          class="mt-2 rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-600 space-y-1"
        >
          <p v-if="settings?.easyDetailsTitle" class="font-semibold text-gray-900">
            {{ settings.easyDetailsTitle }}
          </p>
          <p v-if="settings?.easyDetailsText">
            {{ settings.easyDetailsText }}
          </p>
          <ul class="list-disc space-y-0.5 pl-4">
            <li>Automatic renewals until you cancel.</li>
            <li>Skip, swap, or cancel any time from your account.</li>
            <li>Your card will be charged each billing cycle.</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>
