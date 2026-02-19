// src/processors/ProductValidator.js
const logger = require('../utils/logger');

class ProductValidator {
  constructor(options = {}) {
    this.minNameLength = options.minNameLength || 5;
    this.maxNameLength = options.maxNameLength || 200;
    this.minLetterCount = options.minLetterCount || 3;
    this.minPrice = options.minPrice || 1;
    this.maxPrice = options.maxPrice || 10000;

    this.invalidNamePatterns = [
      // Help/info pages
      /^products?\s+sizing$/i,
      /^products?\s+recalls?$/i,
      /^products?\s+information$/i,
      /^sizing\s+(and|&)\s+stock$/i,
      /^delivery\s+information$/i,
      /^returns?\s+(policy|information)$/i,

      // Navigation/UI elements (must be exact match with ^ and $)
      /^(home|shop now|menu|cart|bag|wishlist|account|login|sign in|search)$/i,
      /^(filter|sort|view all|load more|show more|see all|back|next|close)$/i,

      // Category-only names (exact match only)
      /^(women|men|kids|boys|girls|baby|unisex)$/i,
      /^(tops?|bottoms?|dresses?|shoes?|bags?|accessories|clothing)$/i,
      /^(new arrivals?|best sellers?|on sale|clearance|sale)$/i,

      // UI actions
      /^(add to|remove from|quick view|view details|see more)/i,
      /^(size guide|delivery|returns|contact|help|faq)$/i,
      /^(subscribe|newsletter|follow us)$/i,

      // Just numbers/prices/sizes
      /^[\$£€₦\d\s,.-]+$/,
      /^(xs|s|m|l|xl|xxl|\d+)$/i,

      // Product count text
      /^\d+\s*products?$/i,

      // Footer/policy pages
      /^privacy\s*policy$/i,
      /^terms\s*(and|&)\s*conditions$/i,
      /^cookie\s*policy$/i,
    ];

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
      /\/stores\b/i,
      /\/careers/i,
      /\/cart/i,
      /\/login/i,
      /\/account/i,
      /\/wishlist/i,
    ];
  }

  isValidProduct(product) {
    if (!product.name || typeof product.name !== 'string') {
      return { valid: false, reason: 'Missing name' };
    }

    const name = product.name.trim();

    if (name.length < this.minNameLength) {
      return { valid: false, reason: `Name too short (${name.length}): "${name}"` };
    }
    if (name.length > this.maxNameLength) {
      return { valid: false, reason: 'Name too long' };
    }

    // Check name against invalid patterns
    for (const pattern of this.invalidNamePatterns) {
      if (pattern.test(name)) {
        return { valid: false, reason: `Matches invalid pattern: "${name}"` };
      }
    }

    // Validate product URL
    if (product.productUrl) {
      try {
        const url = new URL(product.productUrl);
        if (!['http:', 'https:'].includes(url.protocol)) {
          return { valid: false, reason: `Invalid URL protocol: ${url.protocol}` };
        }
      } catch {
        if (!product.productUrl.startsWith('/') && !product.productUrl.startsWith('http')) {
          return { valid: false, reason: `Malformed URL: ${product.productUrl}` };
        }
      }

      for (const pattern of this.invalidUrlPatterns) {
        if (pattern.test(product.productUrl)) {
          return { valid: false, reason: `Invalid URL: ${product.productUrl.substring(0, 80)}` };
        }
      }
    }

    // Validate price if present
    if (product.price !== null && product.price !== undefined) {
      if (typeof product.price === 'number' && !isNaN(product.price)) {
        if (product.price < this.minPrice || product.price > this.maxPrice) {
          return { valid: false, reason: `Price out of range: $${product.price}` };
        }
      }
    }

    // Must have enough letters (not just numbers/symbols)
    const letterCount = (name.match(/[a-zA-Z]/g) || []).length;
    if (letterCount < this.minLetterCount) {
      return { valid: false, reason: `Too few letters (${letterCount}): "${name}"` };
    }

    return { valid: true };
  }

  filterProducts(products) {
    if (!products || !Array.isArray(products)) return [];

    const valid = [];
    const invalid = [];

    for (const product of products) {
      const result = this.isValidProduct(product);
      if (result.valid) {
        valid.push(product);
      } else {
        invalid.push({ name: product.name, url: product.productUrl, reason: result.reason });
      }
    }

    if (invalid.length > 0) {
      logger.debug(`Filtered out ${invalid.length} non-products:`);
      // Show more items in debug to diagnose issues
      invalid.slice(0, 10).forEach(({ name, url, reason }) => {
        logger.debug(`  ✗ "${(name || '').substring(0, 60)}" → ${reason}`);
      });
      if (invalid.length > 10) {
        logger.debug(`  ... and ${invalid.length - 10} more filtered`);
      }
    }

    // If everything got filtered, log a warning with details
    if (valid.length === 0 && products.length > 0) {
      logger.warn(`ALL ${products.length} products were filtered out! First 3 rejections:`);
      invalid.slice(0, 3).forEach(({ name, url, reason }) => {
        logger.warn(`  ✗ name="${(name || '').substring(0, 60)}" url="${(url || '').substring(0, 80)}" → ${reason}`);
      });
    }

    logger.info(`Valid products: ${valid.length}/${products.length}`);
    return valid;
  }
}

const defaultInstance = new ProductValidator();
module.exports = defaultInstance;
module.exports.ProductValidator = ProductValidator;