/*
 * A1 staged confirmation — suggest a Grailed department/category from the
 * item's vision attributes. The suggestion is ONLY a pre-selection for the
 * confirmation card in DraftEditor: nothing is filled until the user confirms
 * (CLAUDE.md cascade policy — a wrong category cascades into wrong sizes).
 *
 * Department has no reliable vision signal, so we default to Menswear and the
 * card makes that explicit and editable. Category maps from the free-text
 * category/subcategory the pipeline extracted.
 */

import type { ExtractedAttributes } from '@/types';

export interface CategorySuggestion {
  department: string;
  category: string;
  /** What the mapping matched on — shown so the user can judge the suggestion. */
  basedOn: string;
}

// Order matters: more specific garment words before the broad "tops" bucket
// (e.g. "shirt jacket" should hit Outerwear, "sweatpants" Bottoms).
const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/jacket|coat|parka|windbreaker|puffer|fleece|vest|outerwear|anorak|bomber/i, 'Outerwear'],
  [/shoe|sneaker|boot|loafer|sandal|footwear|trainer|cleat/i, 'Footwear'],
  [/pant|jean|trouser|short|chino|sweatpant|cargo|denim bottom|bottom/i, 'Bottoms'],
  [/suit|blazer|tailor|sport ?coat/i, 'Tailoring'],
  [/hat|cap|beanie|bag|belt|scarf|glove|wallet|sunglass|jewelry|watch|accessor|tie\b/i, 'Accessories'],
  [/top|shirt|tee\b|t-shirt|sweater|hoodie|sweatshirt|polo|knit|flannel|henley|jersey|blouse/i, 'Tops'],
];

export function suggestGrailedCategory(attrs: ExtractedAttributes): CategorySuggestion | null {
  // Subcategory first — it's the more specific signal ("denim jacket" beats "menswear").
  for (const source of [attrs.subcategory, attrs.category]) {
    const text = (source || '').trim();
    if (!text) continue;
    for (const [re, category] of CATEGORY_RULES) {
      if (re.test(text)) return { department: 'Menswear', category, basedOn: text };
    }
  }
  return null;
}
