const logger = require('../utils/logger');

class Deduplicator {
  constructor() {
    this.seenProducts = new Map();
  }

  async loadExistingProducts(airtableClient) {
    try {
      const existingRecords = await airtableClient.getAllRecords();

      for (const record of existingRecords) {
        // Use Product URL as the unique key
        const productUrl = record.fields['Product URL'];
        if (productUrl) {
          this.seenProducts.set(productUrl, {
            recordId: record.id,
            store: record.fields['Store'],
            styleName: record.fields['Style Name']
          });
        }
      }

      logger.info(`Loaded ${this.seenProducts.size} existing products from Airtable`);
    } catch (error) {
      logger.error(`Failed to load existing products: ${error.message}`);
    }
  }

  categorize(products) {
    const results = {
      new: [],
      updated: [],
      unchanged: []
    };

    for (const product of products) {
      const existing = this.seenProducts.get(product.productUrl);

      if (!existing) {
        results.new.push(product);
      } else {
        // Product exists - check if needs update
        if (this.hasChanged(product, existing)) {
          results.updated.push({
            ...product,
            recordId: existing.recordId
          });
        } else {
          results.unchanged.push({
            ...product,
            recordId: existing.recordId
          });
        }
      }
    }

    logger.info(`Categorized: ${results.new.length} new, ${results.updated.length} updated, ${results.unchanged.length} unchanged`);

    return results;
  }

  hasChanged(newProduct, existing) {
    // Check if name changed
    if (newProduct.name !== existing.styleName) {
      return true;
    }
    return false;
  }

  clear() {
    this.seenProducts.clear();
  }
}

module.exports = Deduplicator;