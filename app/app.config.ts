export default defineAppConfig({
  shopify: {
    shopName: process.env.NUXT_SHOPIFY_NAME || 'Nuxt Shopify Demo Store',

    collection: {
      perPage: 12,
    },
  },

  ui: {
    colors: {
      primary: 'purple',
    },
  },
})
