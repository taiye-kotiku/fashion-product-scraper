const logger = require('../utils/logger');

class BaseStrategy {
  constructor() {
    this.name = 'base';
    this.selectors = null;
  }

  setSelectors(selectors) {
    this.selectors = selectors;
  }

  async extract(page, context) {
    throw new Error('extract() must be implemented by subclass');
  }

  validateProduct(product) {
    return !!(product && product.name && product.name.length > 2);
  }

  calculateConfidence(products) {
    if (!products || products.length === 0) return 0;

    let total = 0;
    for (const p of products) {
      let score = 0;
      if (p.name) score += 0.3;
      if (p.price) score += 0.2;
      if (p.imageUrl) score += 0.3;
      if (p.productUrl) score += 0.2;
      total += score;
    }

    return Math.min(total / products.length, 1);
  }
}

module.exports = BaseStrategy;