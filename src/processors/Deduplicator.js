// src/processors/Deduplicator.js
const logger = require('../utils/logger');

class Deduplicator {
  constructor() {
    this.seenProducts = new Map();
    this.loaded = false;
  }

  normalizeUrl(url) {
    if (!url || typeof url !== 'string') return null;
    try {
      const parsed = new URL(url);
      return (parsed.origin + parsed.pathname)
        .replace(/\/+$/, '')
        .toLowerCase();
    } catch {
      return url.toLowerCase().split('?')[0].split('#')[0].replace(/\/+$/, '');
    }
  }

  async loadExistingProducts(airtableClient) {
    try {
      const existingRecords = await airtableClient.getAllRecords();

      for (const record of existingRecords) {
        const productUrl = record.fields['Product URL'] || '';
        const normalizedUrl = this.normalizeUrl(productUrl);

        if (normalizedUrl) {
          const imageField = record.fields['Image'];
          this.seenProducts.set(normalizedUrl, {
            recordId: record.id,
            store: record.fields['Store'] || '',
            styleName: record.fields['Style Name'] || '',
            hasImage: !!(imageField && Array.isArray(imageField) && imageField.length > 0),
            originalUrl: productUrl
          });
        }
      }

      this.loaded = true;
      logger.info(`Deduplicator loaded ${this.seenProducts.size} existing products`);
    } catch (error) {
      this.loaded = false;
      logger.error(`Failed to load existing products: ${error.message}`);
      throw new Error(`Cannot proceed without dedup data: ${error.message}`);
    }
  }

  categorize(products) {
    if (!this.loaded) {
      logger.warn('Deduplicator not loaded — treating all products as new (risky)');
    }

    const results = { new: [], updated: [], unchanged: [] };

    for (const product of products) {
      const normalizedUrl = this.normalizeUrl(product.productUrl);
      if (!normalizedUrl) {
        logger.debug(`Skipping product with no valid URL: ${product.name}`);
        continue;
      }

      const existing = this.seenProducts.get(normalizedUrl);

      if (!existing) {
        results.new.push(product);
        this.seenProducts.set(normalizedUrl, {
          recordId: null,
          store: product.source || '',
          styleName: product.name || '',
          hasImage: !!product.imageUrl,
          originalUrl: product.productUrl
        });
      } else if (this.hasChanged(product, existing)) {
        results.updated.push({ ...product, recordId: existing.recordId });
        this.seenProducts.set(normalizedUrl, {
          ...existing,
          styleName: product.name || existing.styleName,
          hasImage: !!product.imageUrl || existing.hasImage
        });
      } else {
        results.unchanged.push({ ...product, recordId: existing.recordId });
      }
    }

    logger.info(`Categorized: ${results.new.length} new, ${results.updated.length} updated, ${results.unchanged.length} unchanged`);
    return results;
  }

  hasChanged(newProduct, existing) {
    if (newProduct.name && newProduct.name !== existing.styleName) return true;
    if (newProduct.imageUrl && !existing.hasImage) return true;
    if (newProduct.source && newProduct.source !== existing.store) return true;
    return false;
  }

  updateRecordId(productUrl, recordId) {
    const normalizedUrl = this.normalizeUrl(productUrl);
    if (!normalizedUrl) return;
    const existing = this.seenProducts.get(normalizedUrl);
    if (existing) existing.recordId = recordId;
  }

  get size() {
    return this.seenProducts.size;
  }

  clear() {
    this.seenProducts.clear();
    this.loaded = false;
  }
}

module.exports = Deduplicator;