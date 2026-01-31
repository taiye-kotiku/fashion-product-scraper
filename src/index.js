const AgentOrchestrator = require('./agent/AgentOrchestrator');
const sitesConfig = require('./config/sites');
const airtableClient = require('./integrations/AirtableClient');
const notificationService = require('./integrations/NotificationService');
const DataNormalizer = require('./processors/DataNormalizer');
const Deduplicator = require('./processors/Deduplicator');
const imageValidator = require('./processors/ImageValidator');
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
      totals: {
        scraped: 0,
        new: 0,
        updated: 0,
        errors: 0
      }
    };
  }

  async run() {
    this.stats.started = new Date();

    logger.section('🤖 Fashion Tee AI Agent Starting');
    logger.info(`Time: ${this.stats.started.toISOString()}`);
    
    if (this.testMode) {
      logger.info('🧪 RUNNING IN TEST MODE - Airtable will be skipped');
    }

    const enabledSites = sitesConfig.getEnabledSites();
    logger.info(`Sites to process: ${enabledSites.length}`);

    try {
      // Initialize
      await this.agent.initialize();

      // Test Airtable connection (skip in test mode)
      if (!this.testMode) {
        const airtableOk = await airtableClient.testConnection();
        if (!airtableOk && !airtableClient.dryRun) {
          throw new Error('Airtable connection failed');
        }
        
        // Load existing products for deduplication
        await this.deduplicator.loadExistingProducts(airtableClient);
      }

      // Process each site
      for (const site of enabledSites) {
        logger.info(`>>> STARTING: ${site.name}`);
        await this.processSite(site);
        logger.info(`>>> ENDING: ${site.name}`);

        if (enabledSites.indexOf(site) < enabledSites.length - 1) {
          await delay(config.agent.delayBetweenSites);
        }
      }

      this.stats.finished = new Date();
      await this.logSummary();

    } catch (error) {
      logger.error(`Fatal error: ${error.message}`);
      throw error;
    } finally {
      await this.agent.shutdown();
    }
  }

  async processSite(site) {
    logger.subsection(`Processing: ${site.name}`);

    this.stats.sites[site.name] = {
      categories: {},
      errors: []
    };

    for (const category of site.categories) {
      try {
        await this.processCategory(site, category);
      } catch (error) {
        logger.error(`Failed: ${category.name} - ${error.message}`);
        this.stats.sites[site.name].errors.push({
          category: category.name,
          error: error.message
        });
        this.stats.totals.errors++;
      }

      await delay(config.agent.delayBetweenPages);
    }
  }

  async processCategory(site, category) {
    logger.info(`Category: ${category.name}`);

    // Scrape products
    const products = await this.agent.scrapeSite({
      name: site.name,
      url: category.url,
      category: category.name
    });

    if (products.length === 0) {
      logger.warn(`No products found for ${category.name}`);
      this.stats.sites[site.name].categories[category.name] = {
        scraped: 0,
        new: 0,
        updated: 0
      };
      return;
    }

    // Normalize products - pass site name as source
    const normalized = products.map(p => 
      DataNormalizer.normalize({
        ...p,
        source: site.name  // This becomes "Store" in Airtable
      }, category)
    );

    // In test mode, just log results
    if (this.testMode) {
      logger.info(`\n📦 Found ${normalized.length} products:`);
      normalized.slice(0, 5).forEach((p, i) => {
        logger.info(`  ${i + 1}. ${p.name}`);
        logger.info(`     Store: ${p.source}, Category: ${p.category}`);
        logger.info(`     URL: ${p.productUrl ? 'Yes' : 'No'}, Image: ${p.imageUrl ? 'Yes' : 'No'}`);
      });
      if (normalized.length > 5) {
        logger.info(`  ... and ${normalized.length - 5} more`);
      }
      
      this.stats.sites[site.name].categories[category.name] = {
        scraped: products.length,
        new: products.length,
        updated: 0
      };
      this.stats.totals.scraped += products.length;
      this.stats.totals.new += products.length;
      return;
    }

    // Deduplicate against existing records
    const { new: newProducts, updated } = this.deduplicator.categorize(normalized);

    // Save to Airtable
    if (newProducts.length > 0) {
      await airtableClient.createRecords(newProducts);
    }

    if (updated.length > 0) {
      await airtableClient.updateRecords(updated);
    }

    // Update stats
    this.stats.sites[site.name].categories[category.name] = {
      scraped: products.length,
      new: newProducts.length,
      updated: updated.length
    };

    this.stats.totals.scraped += products.length;
    this.stats.totals.new += newProducts.length;
    this.stats.totals.updated += updated.length;

    logger.info(`✓ ${products.length} scraped, ${newProducts.length} new, ${updated.length} updated`);
  }

  async logSummary() {
    const duration = ((this.stats.finished - this.stats.started) / 1000).toFixed(2);

    logger.section('🎉 SCRAPE COMPLETE - SUMMARY');
    logger.info(`Duration: ${duration} seconds`);
    logger.info(`Total products scraped: ${this.stats.totals.scraped}`);
    logger.info(`New products added: ${this.stats.totals.new}`);
    logger.info(`Products updated: ${this.stats.totals.updated}`);
    logger.info(`Errors: ${this.stats.totals.errors}`);

    logger.info('\nBreakdown by site:');

    for (const [siteName, data] of Object.entries(this.stats.sites)) {
      logger.info(`\n  ${siteName}:`);

      for (const [catName, stats] of Object.entries(data.categories)) {
        logger.info(`    ${catName}: ${stats.scraped} scraped, ${stats.new} new, ${stats.updated} updated`);
      }

      if (data.errors.length > 0) {
        logger.info(`    Errors: ${data.errors.map(e => e.category).join(', ')}`);
      }
    }

    logger.info('\n' + '='.repeat(60));
  }
}

// CLI execution
if (require.main === module) {
  const testMode = process.argv.includes('--test');
  const agent = new FashionTeeAgent({ testMode });

  agent.run()
    .then(() => {
      logger.info('Agent finished successfully');
      process.exit(0);
    })
    .catch(error => {
      logger.error(`Agent failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = FashionTeeAgent;