const Airtable = require('airtable');
const config = require('../config');
const logger = require('../utils/logger');
const { chunkArray, delay } = require('../utils/helpers');

class AirtableClient {
  constructor() {
    if (!config.airtable.apiKey || !config.airtable.baseId) {
      logger.warn('Airtable not configured - running in dry-run mode');
      this.dryRun = true;
      return;
    }

    this.base = new Airtable({ apiKey: config.airtable.apiKey })
      .base(config.airtable.baseId);
    this.tableName = config.airtable.tableName;
    this.dryRun = false;
    this.rateLimitDelay = 200;
  }

  getTable() {
    return this.base(this.tableName);
  }

  async getAllRecords() {
    if (this.dryRun) {
      logger.info('[DRY RUN] Would fetch records');
      return [];
    }

    const table = this.getTable();
    const records = [];

    return new Promise((resolve, reject) => {
      table.select({
        view: 'Grid view',
        pageSize: 100
      }).eachPage(
        (pageRecords, fetchNextPage) => {
          records.push(...pageRecords);
          fetchNextPage();
        },
        (error) => {
          if (error) {
            logger.error(`Error fetching records: ${error.message}`);
            reject(error);
          } else {
            logger.info(`Fetched ${records.length} records`);
            resolve(records);
          }
        }
      );
    });
  }

  async createRecords(products) {
    if (this.dryRun) {
      logger.info(`[DRY RUN] Would create ${products.length} records`);
      return [];
    }

    if (products.length === 0) return [];

    const table = this.getTable();
    const results = [];

    const batches = chunkArray(products, 10);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const records = batch.map(product => ({
        fields: this.formatForAirtable(product)
      }));

      try {
        const created = await table.create(records, { typecast: true });
        results.push(...created);
        logger.info(`Created batch ${i + 1}/${batches.length} (${created.length} records)`);

        if (i < batches.length - 1) {
          await delay(this.rateLimitDelay);
        }
      } catch (error) {
        logger.error(`Error creating records: ${error.message}`);
        throw error;
      }
    }

    logger.info(`Created ${results.length} total records`);
    return results;
  }

  async updateRecords(products) {
    if (this.dryRun) {
      logger.info(`[DRY RUN] Would update ${products.length} records`);
      return [];
    }

    if (products.length === 0) return [];

    const table = this.getTable();
    const results = [];

    const batches = chunkArray(products, 10);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const records = batch.map(product => ({
        id: product.recordId,
        fields: this.formatForAirtable(product)
      }));

      try {
        const updated = await table.update(records, { typecast: true });
        results.push(...updated);

        if (i < batches.length - 1) {
          await delay(this.rateLimitDelay);
        }
      } catch (error) {
        logger.error(`Error updating records: ${error.message}`);
        throw error;
      }
    }

    logger.info(`Updated ${results.length} records`);
    return results;
  }

  /**
   * Format product for YOUR Airtable table structure:
   * 
   * Fields in your table:
   * - Store (Single Select): Anthropologie, Abercrombie, River Island, etc.
   * - Category (Single Select): Women, Men, Boys, Girls
   * - Style Name (Single Line Text): Product name
   * - Product URL (URL): Link to product
   * - Image (Attachment): Product image
   * - Date Added (DateTime): When scraped
   * - Unique ID (Formula): Auto-generated
   */
  formatForAirtable(product) {
    const fields = {
      'Store': product.source || product.store || '',
      'Category': product.category || 'Women',
      'Style Name': product.name || '',
      'Product URL': product.productUrl || '',
      'Date Added': new Date().toISOString()
    };

    // Handle image attachment
    if (product.imageUrl) {
      fields['Image'] = [{ url: product.imageUrl }];
    }

    return fields;
  }

  /**
   * Generate unique ID matching your formula: Store-ProductURL
   */
  generateUniqueId(product) {
    return `${product.source || ''}-${product.productUrl || ''}`;
  }

  async testConnection() {
    if (this.dryRun) {
      logger.info('[DRY RUN] Would test Airtable connection');
      return true;
    }

    try {
      const table = this.getTable();
      await table.select({ maxRecords: 1 }).firstPage();
      logger.info(`✓ Connected to table: ${this.tableName}`);
      return true;
    } catch (error) {
      logger.error(`Airtable connection failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if product already exists by URL
   */
  async findByUrl(productUrl) {
    if (this.dryRun) return null;

    try {
      const table = this.getTable();
      const records = await table.select({
        filterByFormula: `{Product URL} = '${productUrl}'`,
        maxRecords: 1
      }).firstPage();

      return records.length > 0 ? records[0] : null;
    } catch (error) {
      logger.warn(`Error finding by URL: ${error.message}`);
      return null;
    }
  }
}

module.exports = new AirtableClient();