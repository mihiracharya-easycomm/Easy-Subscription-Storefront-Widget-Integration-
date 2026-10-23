<script setup lang="ts">
import { z } from 'zod'

const props = defineProps<{
  line: CartLineFieldsFragment
}>()

const { update, remove } = useCart()
const localePath = useLocalePath()

const variant = computed(() => props.line.merchandise)
const to = computed(() => localePath(`/product/${variant.value.product.handle}`))

const sellingPlanName = computed(() =>
  props.line.sellingPlanAllocation?.sellingPlan?.name ?? '',
)

// Cart-line properties the merchant/app sees ("_" prefixed) are hidden; the
// human-readable ones (Items, Free Gift Items, ...) are shown to the shopper.
const visibleAttributes = computed(() =>
  (props.line.attributes ?? []).filter(a => a.key && !a.key.startsWith('_')),
)

const bundleItems = computed(() => {
  const items = visibleAttributes.value.find(a => a.key === 'Items')?.value
  if (!items) return []
  return items.split(',').map(s => s.trim()).filter(Boolean)
})

const otherAttributes = computed(() =>
  visibleAttributes.value.filter(a => a.key !== 'Items'),
)

const requiredQty = computed(() => parseRequiredQtyMetafield(
  props.line.sellingPlanAllocation?.sellingPlan?.metafield?.value,
))

const requiredQtyInvalid = computed(() =>
  requiredQty.value > 1 && props.line.quantity % requiredQty.value !== 0,
)

const schema = computed(() => z.object({
  quantity: z.number().min(requiredQty.value).max(10),
}))

const state = reactive<z.infer<typeof schema.value>>({
  quantity: props.line.quantity,
})

watch(state, state => update(props.line.id, state.quantity))
</script>

<template>
  <UCard :ui="{ body: 'relative flex justify-between gap-8' }">
    <NuxtLink
      :to="to"
      :aria-label="`${$t('product.view')}: '${variant.product.title}'`"
    >
      <NuxtImg
        provider="shopify"
        :src="variant.image?.url"
        :alt="variant.image?.altText ?? variant.product.title"
        width="160"
        height="160"
        class="size-24 lg:size-28"
      />
    </NuxtLink>

    <div class="flex flex-col justify-between grow min-h-24 lg:min-h-28">
      <div class="pt-2.5">
        <NuxtLink
          :to="to"
          class="font-medium"
        >
          {{ variant.product.title }} - {{ variant.title }}
        </NuxtLink>

        <p
          v-if="sellingPlanName"
          class="text-xs font-medium text-primary-600 mt-0.5"
        >
          {{ sellingPlanName }}
        </p>

        <ul
          v-if="bundleItems.length"
          class="mt-1 text-xs text-gray-600 space-y-0.5"
        >
          <li
            v-for="item in bundleItems"
            :key="item"
          >
            · {{ item }}
          </li>
        </ul>

        <p
          v-for="attr in otherAttributes"
          :key="attr.key"
          class="text-xs text-gray-600 mt-1"
        >
          <span class="font-medium">{{ attr.key }}:</span> {{ attr.value }}
        </p>
      </div>

      <div class="flex justify-between gap-4 pt-3">
        <UForm
          :state="state"
          :schema="schema"
          :validate-on="['change']"
        >
          <UFormField name="quantity">
            <UInputNumber
              v-model="state.quantity"
              :min="requiredQty"
              :step="requiredQty"
              :max="10"
              class="w-24"
            />
          </UFormField>
        </UForm>

        <ProductPrice
          :price="variant.price"
          class="font-semibold leading-8"
        />
      </div>

      <p
        v-if="requiredQtyInvalid"
        class="mt-1 text-xs text-red-600"
      >
        {{ $t('product.requiredQuantity', { quantity: requiredQty }) }}
      </p>
    </div>

    <UButton
      variant="ghost"
      color="neutral"
      icon="i-lucide-x"
      size="sm"
      class="absolute top-0 right-0 p-2 rounded-none rounded-bl-md"
      @click="() => { remove(props.line.id) }"
    />
  </UCard>
</template>
