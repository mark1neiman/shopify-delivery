export type ShippingMethod = "smartposti" | "wolt" | "pickup";

export type ShippingSelection = {
  method: ShippingMethod;
  pickupPointId?: string | null;
};

export type ShippingLine = {
  title: string;
  price: number;
};

const SHIPPING_RATES: Record<ShippingMethod, { title: string; price: number }> = {
  smartposti: { title: "Smartposti delivery", price: 4.99 },
  wolt: { title: "Wolt delivery", price: 8.99 },
  pickup: { title: "Pickup", price: 0 },
};

export function calculateShippingLine(selection: ShippingSelection | null): ShippingLine | null {
  if (!selection) return null;
  const rate = SHIPPING_RATES[selection.method];
  if (!rate) return null;

  return {
    title: rate.title,
    price: rate.price,
  };
}
