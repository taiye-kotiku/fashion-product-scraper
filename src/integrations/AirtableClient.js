// src/integrations/AirtableClient.js
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
    this.rateLimitDelay = 250;
    this.maxRetries = 3;
  }

  getTable() {
    return this.base(this.tableName);
  }

  async executeWithRetry(operation, label = 'operation') {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const isRateLimit =
          error.statusCode === 429 ||
          error.message?.includes('RATE_LIMIT') ||
          error.message?.includes('Too many requests');

        if (isRateLimit && attempt < this.maxRetries) {
          const backoff = Math.pow(2, attempt) * 1000;
          logger.warn(`Airtable rate limited on ${label}, retrying in ${backoff}ms (attempt ${attempt}/${this.maxRetries})`);
          await delay(backoff);
          continue;
        }

        logger.error(`Airtable ${label} failed (attempt ${attempt}): ${error.message}`);
        throw error;
      }
    }
  }

  escapeForFormula(value) {
    if (!value) return '';
    return String(value).replace(/'/g, "\\'");
  }

  async getAllRecords() {
    if (this.dryRun) {
      logger.info('[DRY RUN] Would fetch records');
      return [];
    }

    return this.executeWithRetry(async () => {
      const table = this.getTable();
      const records = [];

      return new Promise((resolve, reject) => {
        table.select({ view: 'Grid view', pageSize: 100 }).eachPage(
          (pageRecords, fetchNextPage) => {
            records.push(...pageRecords);
            fetchNextPage();
          },
          (error) => {
            if (error) {
              logger.error(`Error fetching records: ${error.message}`);
              reject(error);
            } else {
              logger.info(`Fetched ${records.length} records from Airtable`);
              resolve(records);
            }
          }
        );
      });
    }, 'getAllRecords');
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
      const records = batch.map(product => ({ fields: this.formatForAirtable(product) }));

      const created = await this.executeWithRetry(
        () => table.create(records, { typecast: true }),
        `createRecords batch ${i + 1}/${batches.length}`
      );

      results.push(...created);
      logger.info(`Created batch ${i + 1}/${batches.length} (${created.length} records)`);

      if (i < batches.length - 1) await delay(this.rateLimitDelay);
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
      const records = batch
        .filter(product => product.recordId)
        .map(product => ({ id: product.recordId, fields: this.formatForAirtable(product) }));

      if (records.length === 0) continue;

      const updated = await this.executeWithRetry(
        () => table.update(records, { typecast: true }),
        `updateRecords batch ${i + 1}/${batches.length}`
      );

      results.push(...updated);
      if (i < batches.length - 1) await delay(this.rateLimitDelay);
    }

    logger.info(`Updated ${results.length} records`);
    return results;
  }

  formatForAirtable(product) {
    const fields = {
      'Store': product.source || product.store || '',
      'Category': product.category || 'Women',
      'Style Name': product.name || '',
      'Product URL': product.productUrl || '',
      'Date Added': new Date().toISOString()
    };

    if (product.imageUrl) {
      fields['Image'] = [{ url: product.imageUrl }];
    }

    return fields;
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

  async findByUrl(productUrl) {
    if (this.dryRun) return null;

    try {
      const escaped = this.escapeForFormula(productUrl);
      const table = this.getTable();
      const records = await this.executeWithRetry(
        () => table.select({
          filterByFormula: `{Product URL} = '${escaped}'`,
          maxRecords: 1
        }).firstPage(),
        'findByUrl'
      );
      return records.length > 0 ? records[0] : null;
    } catch (error) {
      logger.warn(`Error finding by URL: ${error.message}`);
      return null;
    }
  }
}

module.exports = new AirtableClient();