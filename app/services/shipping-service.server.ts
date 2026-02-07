export type ShippingSelection =
  | { method: "smartposti"; pickupPointId: string | null }
  | { method: "pickup"; pickupPointId: string | null }
  | { method: "wolt"; pickupPointId: null };

export type ShippingLine = {
  title: string;
  price: number; // amount (presentment currency)
};

export function calculateShippingLine(selection: ShippingSelection | null): ShippingLine | null {
  if (!selection) return null;

  // TODO: подключить реальные цены из pickup-config / настроек
  if (selection.method === "smartposti") {
    return { title: "SmartPosti Parcel Locker", price: 3.99 };
  }
  if (selection.method === "wolt") {
    return { title: "Wolt delivery", price: 6.99 };
  }
  if (selection.method === "pickup") {
    return { title: "Store pickup", price: 0 };
  }

  return null;
}
