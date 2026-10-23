export default defineEventHandler(async (event) => {
  const { easySubscription } = useRuntimeConfig(event)
  const { shop } = getQuery(event) as { shop?: string }
  const body = await readBody(event)

  const url = `${easySubscription.apiUrl}/api/external/bundle/variant?shop=${encodeURIComponent(shop ?? '')}`

  return await $fetch(url, {
    method: 'POST',
    body,
  })
})
