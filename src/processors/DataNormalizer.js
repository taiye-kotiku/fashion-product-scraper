const crypto = require('crypto');
const { parsePrice, cleanText } = require('../utils/helpers');
const imageExtractor = require('./ImageExtractor');

class DataNormalizer {
  normalize(product, context) {
    const name = cleanText(product.name);
    
    // Validate name
    if (!name || name.length < 5) {
      return null;
    }

    // Normalize and validate image URL
    let imageUrl = product.imageUrl;
    if (imageUrl) {
      imageUrl = imageExtractor.normalizeUrl(imageUrl, context.url || '');
      if (!imageExtractor.isValidImageUrl(imageUrl)) {
        imageUrl = null; // Clear invalid images
      }
    }

    return {
      name: name,
      source: product.source || context.site,
      category: context.category || 'Women',
      productUrl: product.productUrl || '',
      imageUrl: imageUrl,
      productId: this.generateProductId(product),
      scrapedAt: product.scrapedAt || new Date().toISOString(),
      price: parsePrice(product.price),
      priceFormatted: product.priceFormatted || ''
    };
  }

  normalizeImageUrl(url, baseUrl = '') {
    return imageExtractor.normalizeUrl(url, baseUrl);
  }

  generateProductId(product) {
    const str = `${product.source || ''}|${product.productUrl || product.name}`;
    return crypto.createHash('md5').update(str).digest('hex');
  }

  // Batch normalize with filtering
  normalizeBatch(products, context) {
    return products
      .map(p => this.normalize(p, context))
      .filter(p => p !== null);
  }
}

module.exports = new DataNormalizer();