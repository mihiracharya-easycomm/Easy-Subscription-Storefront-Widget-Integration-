export const CART_LINE_FRAGMENT = `#graphql
  fragment CartLineFields on CartLine {
    id
    quantity
    merchandise {
      ... on ProductVariant {
        ...ProductVariantFields

        product {
          id
          handle
          title
          vendor
        }
      }
    }
    sellingPlanAllocation {
      sellingPlan {
        id
        name
        metafield(namespace: "easy_subscription_app", key: "REQUIRED_QUANTITY") {
          value
        }
      }
    }
    attributes {
      key
      value
    }
    cost {
      amountPerQuantity {
        ...PriceFields
      }
    }
  }
`

export const CART_LINE_CONNECTION_FRAGMENT = `#graphql
  fragment CartLineConnectionFields on BaseCartLineConnection {
    edges {
      cursor
      node {
        ...CartLineFields
      }
    }
  }
`

export const CART_FRAGMENT = `#graphql
  fragment CartFields on Cart {
    id
    updatedAt
    checkoutUrl
    totalQuantity
    lines(first: 250) {
      ...CartLineConnectionFields
    }
    cost {
      totalAmount {
        ...PriceFields
      }
    }
  }
`

export const CART_USER_ERRORS_FRAGMENT = `#graphql
  fragment CartUserErrorFields on CartUserError {
    code
    field
    message
  }
`
