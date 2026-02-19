// src/index.js
const path = require('path');
const fs = require('fs').promises;
const AgentOrchestrator = require('./agent/AgentOrchestrator');
const sitesConfig = require('./config/sites');
const airtableClient = require('./integrations/AirtableClient');
const notificationService = require('./integrations/NotificationService');
const DataNormalizer = require('./processors/DataNormalizer');
const Deduplicator = require('./processors/Deduplicator');
const config = require('./config');
const logger = require('./utils/logger');
const { delay } = require('./utils/helpers');

class FashionTeeAgent {
  constructor(options = {}) {
    this.agent = new AgentOrchestrator();
    this.deduplicator = new Deduplicator();
    this.testMode = options.testMode || process.argv.includes('--test');
    this.stats = {
      started: null,
      finished: null,
      sites: {},
      totals: { scraped: 0, new: 0, updated: 0, errors: 0 }
    };
  }

  async run() {
    this.stats.started = new Date();
    logger.section('🤖 Fashion Tee AI Agent Starting');
    logger.info(`Time: ${this.stats.started.toISOString()}`);
    if (this.testMode) logger.info('🧪 RUNNING IN TEST MODE');

    const enabledSites = sitesConfig.getEnabledSites();
    logger.info(`Sites to process: ${enabledSites.length}`);

    await notificationService.notifyStart(enabledSites).catch(() => {});

    try {
      await this.agent.initialize();

      if (!this.testMode) {
        const airtableOk = await airtableClient.testConnection();
        if (!airtableOk && !airtableClient.dryRun) throw new Error('Airtable connection failed');
        await this.deduplicator.loadExistingProducts(airtableClient);
      }

      for (let i = 0; i < enabledSites.length; i++) {
        const site = enabledSites[i];
        try {
          logger.info(`>>> STARTING: ${site.name}`);
          await this.processSite(site);
          logger.info(`>>> COMPLETED: ${site.name}`);
        } catch (error) {
          logger.error(`>>> FAILED: ${site.name} - ${error.message}`);
          logger.error(error.stack);
          this.stats.sites[site.name] = this.stats.sites[site.name] || { categories: {}, errors: [] };
          this.stats.sites[site.name].errors.push({ category: 'SITE_LEVEL', error: error.message });
          this.stats.totals.errors++;
          await notificationService.notifyError(error, { site: site.name, category: 'all' }).catch(() => {});
        }
        if (i < enabledSites.length - 1) await delay(config.agent.delayBetweenSites);
        await this.persistStats();
      }

      this.stats.finished = new Date();
      await this.logSummary();

      const duration = ((this.stats.finished - this.stats.started) / 1000).toFixed(0);
      await notificationService.notifyComplete({
        totalScraped: this.stats.totals.scraped,
        newProducts: this.stats.totals.new,
        updated: this.stats.totals.updated,
        errors: this.stats.totals.errors,
        duration
      }).catch(() => {});
    } catch (error) {
      logger.error(`Fatal error: ${error.message}`);
      await notificationService.notifyError(error, { site: 'global' }).catch(() => {});
      throw error;
    } finally {
      await this.agent.shutdown();
    }
  }

  async processSite(site) {
    logger.subsection(`Processing: ${site.name}`);
    this.stats.sites[site.name] = { categories: {}, errors: [] };

    for (const category of site.categories) {
      try {
        await this.processCategory(site, category);
      } catch (error) {
        logger.error(`Failed: ${category.name} - ${error.message}`);
        this.stats.sites[site.name].errors.push({ category: category.name, error: error.message });
        this.stats.totals.errors++;
        await notificationService.notifyError(error, { site: site.name, category: category.name }).catch(() => {});
      }
      await delay(config.agent.delayBetweenPages);
    }
  }

  async processCategory(site, category) {
    logger.info(`Category: ${category.name}`);

    const products = await this.agent.scrapeSite({ name: site.name, url: category.url, category: category.name });

    if (products.length === 0) {
      logger.warn(`No products found for ${category.name}`);
      this.stats.sites[site.name].categories[category.name] = { scraped: 0, new: 0, updated: 0 };
      return;
    }

    const normalized = products.map(p => DataNormalizer.normalize({ ...p, source: site.name }, category)).filter(p => p !== null);

    if (this.testMode) {
      logger.info(`\n📦 Found ${normalized.length} products:`);
      normalized.slice(0, 5).forEach((p, i) => {
        logger.info(`  ${i + 1}. ${p.name}`);
        logger.info(`     Store: ${p.source}, Category: ${p.category}`);
        logger.info(`     URL: ${p.productUrl ? 'Yes' : 'No'}, Image: ${p.imageUrl ? 'Yes' : 'No'}`);
      });
      if (normalized.length > 5) logger.info(`  ... and ${normalized.length - 5} more`);
      this.stats.sites[site.name].categories[category.name] = { scraped: products.length, new: products.length, updated: 0 };
      this.stats.totals.scraped += products.length;
      this.stats.totals.new += products.length;
      return;
    }

    const { new: newProducts, updated } = this.deduplicator.categorize(normalized);

    if (newProducts.length > 0) {
      const created = await airtableClient.createRecords(newProducts);
      if (Array.isArray(created)) {
        created.forEach((record, index) => {
          if (newProducts[index]?.productUrl && record?.id) {
            this.deduplicator.updateRecordId(newProducts[index].productUrl, record.id);
          }
        });
      }
    }

    if (updated.length > 0) await airtableClient.updateRecords(updated);

    this.stats.sites[site.name].categories[category.name] = { scraped: products.length, new: newProducts.length, updated: updated.length };
    this.stats.totals.scraped += products.length;
    this.stats.totals.new += newProducts.length;
    this.stats.totals.updated += updated.length;
    logger.info(`✓ ${products.length} scraped, ${newProducts.length} new, ${updated.length} updated`);
  }

  async persistStats() {
    try {
      const statsPath = path.join(process.cwd(), 'data', 'last-run-stats.json');
      await fs.mkdir(path.dirname(statsPath), { recursive: true });
      await fs.writeFile(statsPath, JSON.stringify(this.stats, null, 2));
    } catch {}
  }

  async logSummary() {
    const duration = ((this.stats.finished - this.stats.started) / 1000).toFixed(2);
    logger.section('🎉 SCRAPE COMPLETE - SUMMARY');
    logger.info(`Duration: ${duration} seconds`);
    logger.info(`Total scraped: ${this.stats.totals.scraped}`);
    logger.info(`New products: ${this.stats.totals.new}`);
    logger.info(`Updated: ${this.stats.totals.updated}`);
    logger.info(`Errors: ${this.stats.totals.errors}`);

    logger.info('\nBreakdown by site:');
    for (const [siteName, data] of Object.entries(this.stats.sites)) {
      logger.info(`\n  ${siteName}:`);
      for (const [catName, stats] of Object.entries(data.categories)) {
        logger.info(`    ${catName}: ${stats.scraped} scraped, ${stats.new} new, ${stats.updated} updated`);
      }
      if (data.errors.length > 0) {
        logger.info(`    Errors: ${data.errors.map(e => `${e.category}: ${e.error}`).join('; ')}`);
      }
    }
    logger.info('\n' + '='.repeat(60));
    await this.persistStats();
  }
}

if (require.main === module) {
  const testMode = process.argv.includes('--test');
  const agent = new FashionTeeAgent({ testMode });

  let shuttingDown = false;

  const gracefulShutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down gracefully...`);
    try { await agent.agent.shutdown(); } catch (e) { logger.error(`Shutdown error: ${e.message}`); }
    process.exit(signal === 'uncaughtException' ? 1 : 0);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection: ${reason?.message || reason}`);
  });
  process.on('uncaughtException', async (error) => {
    logger.error(`Uncaught exception: ${error.message}\n${error.stack}`);
    await gracefulShutdown('uncaughtException');
  });

  agent.run()
    .then(() => { logger.info('Agent finished successfully'); process.exit(0); })
    .catch(error => { logger.error(`Agent failed: ${error.message}`); process.exit(1); });
}

module.exports = FashionTeeAgent;