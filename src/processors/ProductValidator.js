// src/processors/ProductValidator.js
const logger = require('../utils/logger');

class ProductValidator {
  constructor() {
    // Patterns that indicate NOT a product
    this.invalidNamePatterns = [
      // Help/info pages (what we're seeing)
      /products?\s+sizing/i,
      /products?\s+recalls?/i,
      /products?\s+information/i,
      /sizing\s+(and|&)\s+stock/i,
      /delivery\s+information/i,
      /returns?\s+(policy|information)/i,
      
      // Navigation/UI elements
      /^(home|shop now|menu|cart|bag|wishlist|account|login|sign in|search)$/i,
      /^(filter|sort|view all|load more|show more|see all|back|next|close)$/i,
      
      // Category-only names
      /^(women|men|kids|boys|girls|baby|unisex)$/i,
      /^(tops?|bottoms?|dresses?|shoes?|bags?|accessories|clothing)$/i,
      /^(new arrivals?|best sellers?|on sale|clearance|sale)$/i,
      /^new\s+(tops?|bottoms?|dresses?|arrivals?|in|collection)$/i,
      
      // Generic category combos
      /^(dresses?\s*[&+]\s*rompers?)$/i,
      /^(coats?\s*[&+]\s*jackets?)$/i,
      
      // UI text
      /^(add to|remove from|quick view|view details|see more)$/i,
      /^(size guide|delivery|returns|contact|help|faq)$/i,
      /^(subscribe|newsletter|follow us)$/i,
      
      // Just numbers, prices, or sizes
      /^[\$£€₦\d\s,.-]+$/,
      /^\d+-\d+\s*(years?|yrs?)/i,
      /^(xs|s|m|l|xl|xxl|\d+)$/i,
      
      // Too short
      /^.{1,4}$/,
      
      // Product count
      /^\d+\s*products?$/i,
      
      // Footer/policy pages
      /privacy\s*policy/i,
      /terms\s*(and|&)\s*conditions/i,
      /cookie\s*policy/i,
    ];
    
    // URL patterns that are NOT product pages
    this.invalidUrlPatterns = [
      /\/product-recalls/i,
      /\/products-sizing/i,
      /\/sizing-and-stock/i,
      /\/delivery-information/i,
      /\/returns-policy/i,
      /\/how-can-we-help/i,
      /\/customer-service/i,
      /\/help\//i,
      /\/faq/i,
      /\/about-us/i,
      /\/contact/i,
      /\/stores/i,
      /\/careers/i,
    ];
  }

  isValidProduct(product) {
    if (!product.name || typeof product.name !== 'string') {
      return { valid: false, reason: 'Missing name' };
    }

    const name = product.name.trim();

    // Length checks
    if (name.length < 5) {
      return { valid: false, reason: `Name too short: "${name}"` };
    }

    if (name.length > 200) {
      return { valid: false, reason: 'Name too long' };
    }

    // Check name against invalid patterns
    for (const pattern of this.invalidNamePatterns) {
      if (pattern.test(name)) {
        return { valid: false, reason: `Invalid name pattern: "${name}"` };
      }
    }
    
    // Check URL against invalid patterns
    if (product.productUrl) {
      for (const pattern of this.invalidUrlPatterns) {
        if (pattern.test(product.productUrl)) {
          return { valid: false, reason: `Invalid URL pattern: ${product.productUrl}` };
        }
      }
      
      // For River Island: product URLs must contain /p/
      if (product.productUrl.includes('riverisland.com') && !product.productUrl.includes('/p/')) {
        return { valid: false, reason: 'River Island URL missing /p/' };
      }
    }

    // Must have enough letters
    const letterCount = (name.match(/[a-zA-Z]/g) || []).length;
    if (letterCount < 5) {
      return { valid: false, reason: 'Too few letters in name' };
    }

    return { valid: true };
  }

  filterProducts(products) {
    const valid = [];
    const invalid = [];

    for (const product of products) {
      const result = this.isValidProduct(product);
      
      if (result.valid) {
        valid.push(product);
      } else {
        invalid.push({ name: product.name, reason: result.reason });
      }
    }

    if (invalid.length > 0) {
      logger.debug(`Filtered out ${invalid.length} non-products`);
      invalid.slice(0, 5).forEach(({ name, reason }) => {
        logger.debug(`  ✗ "${name?.substring(0, 50)}" - ${reason}`);
      });
    }

    logger.info(`Valid products: ${valid.length}/${products.length}`);
    return valid;
  }
}

module.exports = new ProductValidator();