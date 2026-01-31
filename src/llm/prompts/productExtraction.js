function productExtractionPrompt(category) {
  return `You are a product data extractor for a fashion e-commerce site. 
  
Analyze this screenshot showing ${category} products.

## CRITICAL: What IS a product
- Has a specific descriptive name like "Vintage Rock Band Graphic Tee" or "Oversized LA Print T-Shirt"
- Shows an actual item for sale with a visible image
- Usually has a price displayed

## CRITICAL: What is NOT a product (SKIP THESE)
- Navigation menu items (Home, Shop, Account, Cart)
- Category headers ("Women", "Tops", "Graphic Tees", "New Arrivals")  
- Buttons or CTAs ("Shop Now", "View All", "Add to Bag", "Quick View")
- Promotional banners ("Free Shipping", "50% Off", "Sale")
- Page titles or section headers
- Footer links (About Us, Contact, Privacy Policy)
- Social media links
- Size/color selectors
- Filter or sort options

## Extract these fields for REAL PRODUCTS ONLY:

1. **name**: The specific product name (e.g., "Nirvana Oversized Band Tee")
   - Must be 5+ characters
   - Must describe a specific item, not a category
   - Should NOT be just "Graphic Tee" or "T-Shirt" - needs specifics

2. **price**: The price with currency symbol (e.g., "$29.99")
   - Use the current/sale price if multiple shown
   - Set to null if not visible

3. **imageDescription**: Brief description of the product appearance
   - Color, print/graphic, style details

## Quality Check Before Including:
Ask yourself: "Would a customer add THIS SPECIFIC ITEM to their cart?"
- YES: "Metallica World Tour '89 Graphic Tee" ✓
- NO: "Shop Graphic Tees" ✗
- NO: "Women's Tops" ✗
- NO: "View All" ✗

Return ONLY a valid JSON array:
[
  {
    "name": "Metallica World Tour '89 Oversized Tee",
    "price": "$34.99",
    "imageDescription": "Black oversized t-shirt with vintage Metallica tour graphic in white"
  }
]

If no valid products are visible, return: []

Return ONLY the JSON array. No explanation, no markdown.`;
}



function productValidationPrompt(products, category) {
  return `Verify this list of ${category} products extracted from a fashion website.

Extracted products:
${JSON.stringify(products.slice(0, 10), null, 2)}

Looking at the data:
1. Do these look like valid product names?
2. Are the prices reasonable for clothing?
3. Are there any obvious errors or duplicates?

Return a JSON object:
{
  "isValid": true/false,
  "confidence": 0.0-1.0,
  "issues": ["list of any issues found"],
  "suggestions": ["any suggestions for improvement"]
}

Return ONLY the JSON, no explanation.`;
}

function enrichmentPrompt(product, imageDescription) {
  return `Based on this product information:
Name: ${product.name}
Image description: ${imageDescription}

Suggest:
1. Category tags (e.g., "vintage", "band tee", "graphic", "cropped")
2. Color(s)
3. Style (casual, streetwear, etc.)

Return as JSON:
{
  "tags": ["tag1", "tag2"],
  "colors": ["color1", "color2"],
  "style": "style name"
}`;
}

module.exports = {
  productExtractionPrompt,
  productValidationPrompt,
  enrichmentPrompt
};