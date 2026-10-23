export default defineEventHandler(async (event) => {
  const { easySubscription } = useRuntimeConfig(event)
  const query = getQuery(event)

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    params.set(key, String(value))
  }

  const url = `${easySubscription.apiUrl}/api/storefront/widget-data?${params.toString()}`

  return await $fetch(url, {
    method: 'GET',
    headers: {
      'X-Storefront-Access-Token': easySubscription.storefrontApiToken,
    },
  })
})
