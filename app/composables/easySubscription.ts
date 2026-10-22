export interface EsSellingPlan {
  id: string
  name: string
  description?: string | null
  interval: string
  intervalCount: number
  adjustmentType: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'PRICE' | null
  discountPercentage: number
  discountAmount?: { amount: string, currencyCode: string } | null
  recurringAdjustmentType?: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'PRICE' | null
  recurringDiscountPercentage?: number | null
  recurringDiscountAmount?: { amount: string, currencyCode: string } | null
}

export interface EsSellingPlanGroup {
  id: string
  name: string
  description?: string | null
  sellingPlans: EsSellingPlan[]
}

export interface EsVariantAllocation {
  sellingPlanId: string
  sellingPlanName: string
  discountPercentage: number
  discountAmount?: { amount: string, currencyCode: string } | null
}

export interface EsQuantityBreakTier {
  id: number | string
  name?: string
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT' | string
  discount: string | number
  quantity: string | number
  offerTitle?: string
  purchase_type?: 'ONE_TIME' | 'SUBSCRIPTION' | 'BOTH' | string
}

export interface EsQuantityBreakSettings {
  primaryTextColor: string
  secondaryTextColor: string
  badgeTextColor: string
  badgeBgColor: string
  tierBgColor: string
  hoverBgColor: string
  borderColor: string
  hoverBorderColor: string
  badgeFontSize: string
  fontSize: string
  borderRadius: string
  showBadge: boolean
  showSubscriptionSection: boolean
  defaultQuantity: string
  isResetDefaultValue: boolean
}

export interface EsWidgetSettings {
  default_purchase_option: 'one-time' | 'subscription'
  purchase_option_position: 'one-time-first' | 'subscription-first' | string
  widget_border_color?: string
  widget_background_color?: string
  widget_text_color?: string
  widget_inner_background_color?: string
  widget_outer_text_color?: string
  widget_outer_border_thickness?: string
  widget_inner_border_thickness?: string
  widget_style?: string
  badge_background_color?: string
  badge_text_color?: string
  badge_placement?: string
  discount_badge_background_color?: string
  discount_badge_text_color?: string
  discount_badge_placement?: string
  easyDetailsText?: string
  easyDetailsTitle?: string
}

export interface EsCartPayloadGuide {
  sellingPlanIdKey: string
  bundleLineLabel: string
  bundleLineItems: string
  giftProductLineLabel: string
  giftProductLineItems: string
  quantityBreakerLineItems: string
  customAttributes: Array<{ key: string, value: string }>
}

export interface EsGiftProductItem {
  id: string
  variantId: string
  title: string
  displayName?: string
  price?: string
  productType?: string
  images?: {
    node?: {
      preview?: {
        image?: {
          id?: string
          url?: string
          altText?: string | null
        }
      }
    }
  }
}

export interface EsGiftProductOffer {
  id: number | string
  type?: string
  amount_type?: string
  product_type: 'fixed_product' | 'choice_list' | string
  product_limit: number
  place_order_type?: string
  place_order_count?: number
  place_order_amount?: number
  selected_frequency?: Array<number | string>
  gift_product_items: EsGiftProductItem[]
  gift_product_variant_ids: string[]
}

export interface EsGiftProductsForPlan {
  selling_plan_id: string
  gift_product_items: EsGiftProductOffer[]
  gift_seleted_frequency?: string[]
}

export interface EsWidgetData {
  shop: { permanentDomain: string, currency: string }
  product: {
    id: string
    numericId: string
    title: string
    requiresSellingPlan: boolean
    hasOnlyDefaultVariant: boolean
    defaultVariantId: string
  }
  productVariant: { id: string, sellingPlanGroupsCount: number }
  sellingPlanGroups: EsSellingPlanGroup[]
  sellingPlanGroupsCount: number
  activeVariantAllocations: EsVariantAllocation[]
  widgetState: {
    hasSellingPlans: boolean
    orderLimitValid: boolean
    isManualSubscription: boolean
    isBundleHide: boolean
    defaultVariantId: string
  }
  widgetSettings: EsWidgetSettings
  quantityBreakSettings: EsQuantityBreakSettings
  quantityBreaks: {
    activeTiers: { tiers?: EsQuantityBreakTier[] } | null
    productTiers: { tiers?: EsQuantityBreakTier[] } | null
    settings: EsQuantityBreakSettings
  }
  giftProducts?: EsGiftProductsForPlan[] | null
  cartPayloadGuide: EsCartPayloadGuide
}

interface EsApiResponse {
  status: boolean
  message?: string
  result: EsWidgetData
}

const toNumericId = (gid?: string) => gid?.split('/').pop() ?? ''

export const useEasySubscriptionData = (
  productId: Ref<string | undefined>,
  variantId: Ref<string | undefined>,
) => {
  const config = useRuntimeConfig()
  const pub = config.public as { easySubscriptionApi?: string, shopifyShopName?: string } | undefined
  // Private runtimeConfig.shopify.name is server-only; read the handle from public.
  // Fallback to config.shopify.name for SSR, then to a safe literal to avoid "<empty>.myshopify.com".
  const shopName = pub?.shopifyShopName
    ?? (config as { shopify?: { name?: string } }).shopify?.name
    ?? ''
  const shop = shopName ? `${shopName}.myshopify.com` : ''
  const apiBase = pub?.easySubscriptionApi ?? 'http://localhost:3000'

  const key = computed(() =>
    `es-widget:${shop}:${toNumericId(productId.value)}:${toNumericId(variantId.value)}`,
  )

  const url = computed(() => {
    const pId = toNumericId(productId.value)
    const vId = toNumericId(variantId.value)
    if (!pId || !shop) return null
    const params = new URLSearchParams({ shop, productId: pId })
    if (vId) params.set('variantId', vId)
    return `${apiBase}/api/storefront/widget-data?${params.toString()}`
  })

  const { data, status, refresh, error } = useFetch<EsApiResponse>(
    () => url.value ?? '',
    {
      key: key.value,
      server: false,
      lazy: true,
      immediate: computed(() => Boolean(url.value)).value,
      watch: [url],
      onRequest({ request }) {
        console.log('[easy-subscription] GET', request)
      },
      onResponse({ request, response }) {
        console.log('[easy-subscription] response', request, response.status, response._data)
      },
      onResponseError({ request, response }) {
        console.error('[easy-subscription] error', request, response.status, response._data)
      },
    },
  )

  const widgetData = computed<EsWidgetData | undefined>(() =>
    data.value?.status ? data.value.result : undefined,
  )

  return {
    widgetData,
    status,
    error,
    refresh,
  }
}
