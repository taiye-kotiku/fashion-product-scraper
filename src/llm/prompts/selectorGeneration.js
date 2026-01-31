function selectorGenerationPrompt(domStructure, category) {
  return `Analyze this DOM structure from an e-commerce page showing ${category}.

DOM Structure:
${JSON.stringify(domStructure, null, 2)}

Your task is to identify the best CSS selectors to extract product data.

Look for:
1. A repeating container element for each product (usually a div or article)
2. Elements containing product names/titles
3. Elements containing prices
4. Product images
5. Links to product detail pages

Common patterns to look for:
- Classes containing "product", "item", "card"
- Data attributes like data-product-id, data-item
- Semantic HTML like article, itemtype="Product"

Return a JSON object with CSS selectors:
{
  "container": "main selector for product containers (e.g., '.product-card')",
  "name": "selector for name, relative to container (e.g., '.product-title')",
  "price": "selector for price, relative to container (e.g., '.price')",
  "image": "selector for image, relative to container (e.g., 'img.product-image')",
  "link": "selector for link, relative to container (e.g., 'a.product-link')",
  "confidence": 0.8
}

Important:
- The container selector should match ALL product items
- Child selectors should work WITHIN each container
- Use specific classes when available
- Avoid dynamically generated class names (random strings)

Return ONLY the JSON object, no explanation.`;
}

function selectorRefinementPrompt(currentSelectors, extractionResults, issues) {
  return `The current selectors are not working well.

Current selectors:
${JSON.stringify(currentSelectors, null, 2)}

Extraction results: ${extractionResults.length} products found
Issues: ${issues.join(', ')}

Suggest improved selectors that might work better:
{
  "container": "improved container selector",
  "name": "improved name selector",
  "price": "improved price selector",
  "image": "improved image selector",
  "link": "improved link selector",
  "changes": ["list of changes made and why"]
}

Return ONLY the JSON.`;
}

module.exports = {
  selectorGenerationPrompt,
  selectorRefinementPrompt
};