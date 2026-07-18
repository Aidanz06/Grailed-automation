/*
 * Size options per Grailed category — a typing aid for the editor's size
 * field, NOT selectors (grailed-selectors.json owns those). Grailed's sell
 * form repopulates its size dropdown from the chosen category; these lists
 * mirror its US size tokens (the driver matches the stored string against
 * Grailed's compound labels with the anchored "US {size} /" form). The lists
 * are best-effort, so the editor keeps a custom-entry escape — any string
 * still fills exactly as before.
 */

const LETTER_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
const WAIST_SIZES = ['26', '27', '28', '29', '30', '31', '32', '33', '34', '35', '36', '38', '40', '42', '44'];
const SHOE_SIZES = ['5', '5.5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '13', '14', '15'];
const TAILORING_SIZES = ['34S', '34R', '36S', '36R', '36L', '38S', '38R', '38L', '40S', '40R', '40L', '42S', '42R', '42L', '44S', '44R', '44L', '46S', '46R', '46L'];

const SIZES_BY_CATEGORY: Record<string, string[]> = {
  Tops: LETTER_SIZES,
  Outerwear: LETTER_SIZES,
  Bottoms: WAIST_SIZES,
  Footwear: SHOE_SIZES,
  Tailoring: TAILORING_SIZES,
  Accessories: ['One Size'],
  Dresses: LETTER_SIZES,
};

/** Size options for a confirmed Grailed category; empty = free-text only. */
export function sizeOptionsFor(category: string | null | undefined): string[] {
  return (category && SIZES_BY_CATEGORY[category]) || [];
}
