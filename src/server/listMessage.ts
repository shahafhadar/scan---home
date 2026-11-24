export type ListLine = { name: string; quantity: number; unit: string | null; identified: boolean; barcode: string | null };

// An SMS in Hebrew is 70 characters a piece and each piece is billed, so the
// list is cut off after a few: the rest is one line saying how many more.
const MAX_CHARS = 330;

/** What a line of the list says: the name, how many, and a plain label for a scan nobody has named yet. */
export const lineText = (item: ListLine): string => {
  const name = item.identified || !item.barcode ? item.name : `מוצר לא מזוהה (…${item.barcode.slice(-4)})`;
  const many = item.quantity !== 1 || item.unit;
  return `• ${name}${many ? ` ×${item.quantity}${item.unit ? ` ${item.unit}` : ""}` : ""}`;
};

/** The text that goes to the person's phone. Null when there is nothing to send. */
export const formatListSms = (items: ListLine[]): string | null => {
  if (items.length === 0) return null;
  const head = `רשימת הקניות (${items.length}):`;
  const lines: string[] = [];
  let length = head.length;
  for (const item of items) {
    const line = lineText(item);
    // Leave room for the "and N more" line unless this is the last item.
    const reserve = lines.length + 1 < items.length ? 24 : 0;
    if (length + 1 + line.length + reserve > MAX_CHARS) break;
    lines.push(line);
    length += 1 + line.length;
  }
  const left = items.length - lines.length;
  return [head, ...lines, ...(left > 0 ? [`ועוד ${left} באפליקציה`] : [])].join("\n");
};
