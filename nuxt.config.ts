// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxtjs/shopify',
    './modules/markets',
    '@nuxtjs/critters',
    '@nuxtjs/i18n',
    '@nuxt/image',
    '@nuxt/ui',
  ],

  css: ['~/assets/main.css'],

  ui: {
    colorMode: false,
  },

  runtimeConfig: {
    shopify: {
      name: process.env.NUXT_SHOPIFY_NAME || 'nuxt-module-store',

      clients: {
        storefront: {
          apiVersion: process.env.NUXT_SHOPIFY_CLIENTS_STOREFRONT_API_VERSION || '2026-04',
          publicAccessToken: process.env.NUXT_SHOPIFY_CLIENTS_STOREFRONT_PUBLIC_ACCESS_TOKEN || '40d025de5a3421a960e8d7970b922901',
        },

        customerAccount: {
          apiVersion: process.env.NUXT_SHOPIFY_CLIENTS_CUSTOMER_ACCOUNT_API_VERSION || '2026-04',
          clientId: process.env.NUXT_SHOPIFY_CLIENTS_CUSTOMER_ACCOUNT_CLIENT_ID || '5d5e8bd8-ce5f-4cdb-9556-bf330ade1e9b',
        },
      },

      analytics: {
        storefrontId: '187932',

        consent: {
          banner: true,
        },
      },
    },

    public: {
      easySubscriptionApi: process.env.EASY_SUBSCRIPTION_API_URL || 'http://localhost:3000',
      shopifyShopName: process.env.NUXT_SHOPIFY_NAME || 'Nuxt Shopify Demo Store',
    },
  },

  routeRules: {
    '/account/**': { headers: { 'cache-control': 'no-store' } },
    '/*/account/**': { headers: { 'cache-control': 'no-store' } },
  },

  compatibilityDate: '2026-08-09',

  fonts: {
    families: [
      {
        name: 'Source Sans 3',
        provider: 'google',
      },
    ],
  },

  i18n: {
    strategy: 'prefix_except_default',
  },

  image: {
    provider: 'shopify',
  },
})
