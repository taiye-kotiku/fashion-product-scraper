function dataValidationPrompt(products) {
  return `Validate this extracted product data:

${JSON.stringify(products.slice(0, 20), null, 2)}

Check for:
1. Valid product names (not navigation text, not placeholder text)
2. Reasonable prices (between $5 and $500 for clothing)
3. Valid image URLs
4. Valid product URLs
5. Duplicates

Return JSON:
{
  "valid": [indices of valid products],
  "invalid": [
    {"index": 0, "reason": "why invalid"}
  ],
  "duplicates": [[0, 5], [1, 3]],
  "overallQuality": 0.0-1.0
}

Return ONLY the JSON.`;
}

function imageValidationPrompt(screenshot) {
  return `Look at this product listing screenshot.

Count the number of products visible and describe the page layout:

Return JSON:
{
  "productCount": number,
  "layout": "grid" | "list" | "mixed",
  "hasLoadMore": true/false,
  "hasPagination": true/false,
  "additionalNotes": "any relevant observations"
}

Return ONLY the JSON.`;
}

module.exports = {
  dataValidationPrompt,
  imageValidationPrompt
};