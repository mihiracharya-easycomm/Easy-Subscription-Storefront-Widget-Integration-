// Shared helpers for the Bundle widget. Keeps GraphQL fetching + id normalization
// out of the Vue component so BundleWidget stays focused on UI/UX.

export interface EsBundleComponentVariant {
  id: string
  title: string
  availableForSale: boolean
  quantityAvailable?: number | null
  currentlyNotInStock?: boolean | null
  price: { amount: string, currencyCode: string }
  compareAtPrice?: { amount: string, currencyCode: string } | null
  image?: { url: string, altText?: string | null, width?: number | null, height?: number | null } | null
}

export interface EsBundleComponentProduct {
  id: string
  handle: string
  title: string
  description?: string | null
  productType?: string | null
  availableForSale: boolean
  totalInventory?: number | null
  featuredImage?: { url: string, altText?: string | null, width?: number | null, height?: number | null } | null
  priceRange?: {
    minVariantPrice: { amount: string, currencyCode: string }
    maxVariantPrice: { amount: string, currencyCode: string }
  } | null
  variants: EsBundleComponentVariant[]
}

const toProductGid = (id: string | number) =>
  String(id).startsWith('gid://') ? String(id) : `gid://shopify/Product/${id}`

export const toNumericBundleId = (gidOrNumeric: string | number | undefined) => {
  if (gidOrNumeric === undefined || gidOrNumeric === null) return ''
  const str = String(gidOrNumeric)
  const parts = str.split('/')
  return parts[parts.length - 1] ?? str
}

// Fetches the full product + variant data for every product id referenced by a bundle.
// Pass numeric or gid ids — both are normalized to gids before the query.
export const useEasySubscriptionBundleProducts = (
  productIds: Ref<Array<string | number> | undefined>,
) => {
  const { params: localization } = useLocalization()

  const gids = computed(() =>
    (productIds.value ?? []).map(toProductGid).filter(Boolean),
  )

  const key = computed(() =>
    `es-bundle-products:${gids.value.join(',')}`,
  )

  const { data, status, refresh, error } = useStorefrontData(
    key,
    `#graphql
      query BundleComponentProducts($ids: [ID!]!, $language: LanguageCode, $country: CountryCode)
      @inContext(language: $language, country: $country) {
        nodes(ids: $ids) {
          __typename
          ... on Product {
            id
            handle
            title
            description
            productType
            availableForSale
            totalInventory
            featuredImage {
              url
              altText
              width
              height
            }
            priceRange {
              minVariantPrice {
                amount
                currencyCode
              }
              maxVariantPrice {
                amount
                currencyCode
              }
            }
            variants(first: 100) {
              nodes {
                id
                title
                availableForSale
                quantityAvailable
                currentlyNotInStock
                price {
                  amount
                  currencyCode
                }
                compareAtPrice {
                  amount
                  currencyCode
                }
                image {
                  url
                  altText
                  width
                  height
                }
              }
            }
          }
        }
      }
    `,
    {
      variables: computed(() => ({
        ids: gids.value,
        ...localization.value,
      })),
      watch: [gids],
      cache: 'long',
      lazy: true,
    },
  )

  const products = computed<EsBundleComponentProduct[]>(() => {
    const nodes = (data.value as { nodes?: Array<unknown> } | undefined)?.nodes ?? []
    return nodes
      .filter((n): n is {
        __typename: 'Product'
        id: string
        handle: string
        title: string
        description?: string | null
        productType?: string | null
        availableForSale: boolean
        totalInventory?: number | null
        featuredImage?: EsBundleComponentProduct['featuredImage']
        priceRange?: EsBundleComponentProduct['priceRange']
        variants: { nodes: EsBundleComponentVariant[] }
      } => Boolean(n) && (n as { __typename?: string }).__typename === 'Product')
      .map(n => ({
        id: n.id,
        handle: n.handle,
        title: n.title,
        description: n.description ?? null,
        productType: n.productType ?? null,
        availableForSale: n.availableForSale,
        totalInventory: n.totalInventory ?? null,
        featuredImage: n.featuredImage ?? null,
        priceRange: n.priceRange ?? null,
        variants: n.variants?.nodes ?? [],
      }))
  })

  const productsByNumericId = computed(() => {
    const map = new Map<string, EsBundleComponentProduct>()
    for (const p of products.value) map.set(toNumericBundleId(p.id), p)
    return map
  })

  const variantsByNumericId = computed(() => {
    const map = new Map<string, { product: EsBundleComponentProduct, variant: EsBundleComponentVariant }>()
    for (const p of products.value) {
      for (const v of p.variants) {
        map.set(toNumericBundleId(v.id), { product: p, variant: v })
      }
    }
    return map
  })

  return {
    products,
    productsByNumericId,
    variantsByNumericId,
    status,
    error,
    refresh,
  }
}
