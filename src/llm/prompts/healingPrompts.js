function healingPrompt(html, category) {
  return `The automated extraction failed for this ${category} product listing page.

Analyze this HTML and manually extract the products:

HTML (truncated):
${html.substring(0, 30000)}

Find all products and extract:
- name: Product name
- price: Price string
- imageUrl: Full image URL (look for img src, data-src, or srcset)
- productUrl: Link to product page

Return a JSON array:
[
  {
    "name": "Product Name",
    "price": "$29.99",
    "imageUrl": "https://...",
    "productUrl": "https://..."
  }
]

If you cannot find products, return: []

Return ONLY the JSON array.`;
}

function selectorHealingPrompt(failedSelectors, html) {
  return `These CSS selectors failed to extract products:
${JSON.stringify(failedSelectors, null, 2)}

Analyze this HTML and suggest new selectors:
${html.substring(0, 20000)}

The website may have changed. Look for:
1. New class names or structure
2. Different element types
3. Data attributes that might work

Return improved selectors:
{
  "container": "new container selector",
  "name": "new name selector",
  "price": "new price selector", 
  "image": "new image selector",
  "link": "new link selector",
  "explanation": "what changed and why these should work"
}

Return ONLY the JSON.`;
}

function recoveryPrompt(context, error) {
  return `The scraper failed with this error:
${error}

Context:
- Site: ${context.site}
- Category: ${context.category}
- URL: ${context.url}

Suggest recovery steps:
{
  "possibleCauses": ["list of possible causes"],
  "suggestedFixes": ["list of things to try"],
  "shouldRetry": true/false,
  "alternativeApproach": "description of alternative approach"
}

Return ONLY the JSON.`;
}

module.exports = {
  healingPrompt,
  selectorHealingPrompt,
  recoveryPrompt
};