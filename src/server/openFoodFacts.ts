import { one } from "./db";

/**
 * Asks Open Food Facts for a name, but only when it is switched on and
 * nothing we already hold knows the barcode. A third party must never hold
 * up a scan: four seconds, then we move on and the item is listed by barcode.
 */
export const lookupOnline = async (barcode: string): Promise<string | null> => {
  if (process.env.OPEN_FOOD_FACTS !== "true") return null;

  const known = await one(
    `SELECT 1 FROM public.products WHERE barcode = ANY (public.barcode_variants($1))
      UNION ALL
     SELECT 1 FROM public.household_products WHERE barcode = ANY (public.barcode_variants($1))
     LIMIT 1`,
    [barcode],
  );
  if (known) return null;

  const url =
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json` +
    `?fields=product_name,product_name_he,brands`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      product?: { product_name?: string; product_name_he?: string; brands?: string };
    };
    const name = body.product?.product_name_he?.trim() || body.product?.product_name?.trim();
    if (!name) return null;
    const brand = body.product?.brands?.split(",")[0]?.trim();
    return brand && !name.includes(brand) ? `${name} ${brand}` : name;
  } catch {
    return null;
  }
};
