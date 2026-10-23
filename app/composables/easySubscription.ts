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
  requiredQuantity?: { enabled: boolean, quantity: number } | null
}

// Returns the required-quantity step for a plan: the metafield's quantity when
// enabled, otherwise 1. Shared between the product page (reads the plan from
// widget-data) and the cart (reads it off sellingPlanAllocation metafield).
export const esRequiredQty = (
  plan: Pick<EsSellingPlan, 'requiredQuantity'> | null | undefined,
): number => {
  const rq = plan?.requiredQuantity
  return rq?.enabled && rq.quantity > 0 ? rq.quantity : 1
}

// Parses the JSON string stored on the REQUIRED_QUANTITY metafield. Returns 1
// when disabled, missing, or malformed.
export const parseRequiredQtyMetafield = (value?: string | null): number => {
  if (!value) return 1
  try {
    const parsed = JSON.parse(value) as { enabled?: boolean, quantity?: number }
    return parsed.enabled && typeof parsed.quantity === 'number' && parsed.quantity > 0
      ? parsed.quantity
      : 1
  }
  catch {
    return 1
  }
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

export interface EsBundleDynamicStep {
  id: number | string
  step_name?: string
  step_title?: string
  step_description?: string
  step_icon_url?: string
  step_limit_min: number
  step_limit_max: number
  step_limit_type?: 'QUANTITY' | 'PRICE' | string
  step_limit_type_condition?: 'AND' | 'OR' | string
  step_price_min?: number
  step_price_max?: number
  step_products: Array<string | number>
  step_variants: Array<string | number>
}

export interface EsBundleVariantOption {
  id?: number | string
  key: string
  name: string
  limit: string | number
  price: string | number
  products?: Array<string | number>
}

export interface EsBundleVariantOptions {
  options: Array<{ name: string, values: string[] }>
  variants: EsBundleVariantOption[]
}

export interface EsBundleProductSettings {
  isTaxable?: boolean
  image_slider?: boolean
  is_show_price?: boolean
  is_sync_product?: boolean
  bundle_cross_sells?: unknown[]
  inventoryQuantities?: { locationId?: string, availableQuantity?: number }
  is_outofstock_track?: boolean
}

export interface EsBundle {
  isBundle: boolean
  bundleId: string | null
  bundleType: 'FIXED' | 'DYNAMIC' | string | null
  bundleTag?: string | null
  isDynamic: boolean
  dynamicSteps: EsBundleDynamicStep[]
  allProductsList: string[]
  dynamicPrice?: string | number | null
  fixedPrice?: string | number | null
  fixedProducts: Array<string | number>
  fixedVariants: Array<string | number>
  fixedVariantsWithQuantity: Array<{ variant_id: string | number, quantity: number }>
  bundleVariantOptions: EsBundleVariantOptions
  maxVariantChooseLimit: number
  showProductDescriptionModal: boolean
  bundleProductSettings: EsBundleProductSettings
  bundleCrossSells?: unknown[]
  subscriptionMetaPmd?: unknown
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
  bundle?: EsBundle | null
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
  const pub = config.public as { shopifyShopName?: string } | undefined
  // Private runtimeConfig.shopify.name is server-only; read the handle from public.
  // Fallback to config.shopify.name for SSR, then to a safe literal to avoid "<empty>.myshopify.com".
  const shopName = pub?.shopifyShopName
    ?? (config as { shopify?: { name?: string } }).shopify?.name
    ?? ''
  const shop = shopName ? `${shopName}.myshopify.com` : ''

  const key = computed(() =>
    `es-widget:${shop}:${toNumericId(productId.value)}:${toNumericId(variantId.value)}`,
  )

  const url = computed(() => {
    const pId = toNumericId(productId.value)
    const vId = toNumericId(variantId.value)
    if (!pId || !shop) return null
    const params = new URLSearchParams({ shop, productId: pId })
    if (vId) params.set('variantId', vId)
    return `/api/es/widget-data?${params.toString()}`
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

export interface EsBundleVariantCreateInput {
  bundleId: string
  productId: string
  products: Array<{ id: string | number, quantity: number, variant_id: string | number }>
}

export interface EsBundleVariantCreateResult {
  status: boolean
  message?: string
  result?: {
    variant_id: string | number
    price?: string | number
  }
}

// POST /api/es/bundle-variant?shop=<shop>
// Proxied through Nitro to Easy Subscription's /api/external/bundle/variant.
// Backend creates a new product variant for a DYNAMIC bundle with a specific
// component selection and returns its id + computed price.
export const createEasySubscriptionBundleVariant = async (
  input: EsBundleVariantCreateInput,
): Promise<EsBundleVariantCreateResult> => {
  const config = useRuntimeConfig()
  const pub = config.public as { shopifyShopName?: string } | undefined
  const shopName = pub?.shopifyShopName
    ?? (config as { shopify?: { name?: string } }).shopify?.name
    ?? ''
  const shop = shopName ? `${shopName}.myshopify.com` : ''

  const url = `/api/es/bundle-variant?shop=${encodeURIComponent(shop)}`

  return await $fetch<EsBundleVariantCreateResult>(url, {
    method: 'POST',
    body: {
      bundle_id: input.bundleId,
      product_id: input.productId,
      products: input.products.map(p => ({
        id: p.id ?? '',
        quantity: p.quantity ?? 0,
        variant_id: p.variant_id ?? '',
      })),
    },
  })
}
