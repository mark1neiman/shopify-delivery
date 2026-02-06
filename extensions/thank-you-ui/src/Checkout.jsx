// @ts-nocheck
import "@shopify/ui-extensions/preact";
import { render } from "preact";

export default function extension() {
  render(<PickupInfo />, document.body);
}

function PickupInfo() {
  const attrs = shopify.attributes?.value ?? [];
  const get = (key) => attrs.find((a) => a.key === key)?.value || "";

  const country = get("itella_pickup_country");
  const provider = get("itella_pickup_provider");
  const deliveryTitle = get("itella_delivery_title");
  const deliveryPrice = get("itella_delivery_price");
  const id = get("itella_pickup_id");
  const name = get("itella_pickup_name");
  const address = get("itella_pickup_address");

  if (!id && !name && !deliveryTitle) return null;

  return (
    <s-banner heading="Delivery selection">
      <s-stack gap="base">
        {deliveryTitle ? (
          <s-text emphasis="bold">
            {deliveryTitle}
            {deliveryPrice ? ` — ${deliveryPrice}` : ""}
          </s-text>
        ) : null}
        {provider ? (
          <s-text type="small">Provider: {provider}</s-text>
        ) : null}
        {name || id ? (
          <s-text type="small">
            {country ? `${country} — ` : ""}{name || id}
          </s-text>
        ) : null}
        {address ? <s-text type="small">{address}</s-text> : null}
      </s-stack>
    </s-banner>
  );
}
