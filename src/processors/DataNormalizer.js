// src/processors/DataNormalizer.js
const crypto = require('crypto');
const { parsePrice, cleanText } = require('../utils/helpers');
const imageExtractor = require('./ImageExtractor');

class DataNormalizer {
  normalize(product, context) {
    if (!product) return null;

    const name = cleanText(product.name);
    if (!name || name.length < 5) return null;

    let imageUrl = product.imageUrl || null;
    if (imageUrl) {
      imageUrl = imageExtractor.normalizeUrl(imageUrl, context.url || '');
      if (!imageExtractor.isValidImageUrl(imageUrl)) imageUrl = null;
    }

    let productUrl = product.productUrl || '';
    if (productUrl && !productUrl.startsWith('http')) {
      try { productUrl = new URL(productUrl, context.url || '').href; }
      catch {}
    }

    return {
<<<<<<< HEAD
      name,
      source: product.source || context.site || '',
      category: context.category || 'Women',
      productUrl,
      imageUrl,
=======
      name: name,
      source: product.source || context.site,
      category: context.category || 'Unspecified',
      productUrl: product.productUrl || '',
      imageUrl: imageUrl,
>>>>>>> ffd8e263480b2dfdbce54319bd3dfe8fab3b5a09
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
    const source = (product.source || '').toLowerCase().replace(/\s+/g, '');

    let url = product.productUrl || '';
    try {
      const parsed = new URL(url);
      url = (parsed.origin + parsed.pathname).replace(/\/+$/, '').toLowerCase();
    } catch {
      url = url.toLowerCase().split('?')[0].split('#')[0].replace(/\/+$/, '');
    }

    const key = url || (product.name || '').toLowerCase().trim();
    return crypto.createHash('md5').update(`${source}|${key}`).digest('hex');
  }

  normalizeBatch(products, context) {
    return products.map(p => this.normalize(p, context)).filter(p => p !== null);
  }
}

module.exports = new DataNormalizer();