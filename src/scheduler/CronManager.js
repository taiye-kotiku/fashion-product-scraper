const cron = require('node-cron');
const config = require('../config');
const logger = require('../utils/logger');
const FashionTeeAgent = require('../index');

class CronManager {
  constructor() {
    this.jobs = [];
    this.isRunning = false;
  }

  start() {
    logger.section('Starting Scheduler');
    logger.info(`Cron expression: ${config.scheduler.cronExpression}`);
    logger.info(`Timezone: ${config.scheduler.timezone}`);

    const job = cron.schedule(
      config.scheduler.cronExpression,
      async () => {
        await this.runScraper();
      },
      {
        scheduled: true,
        timezone: config.scheduler.timezone
      }
    );

    this.jobs.push(job);
    logger.info('Scheduler started - waiting for next scheduled run');
    logger.info(`Next run: ${this.getNextRun()}`);
  }

  async runScraper() {
    if (this.isRunning) {
      logger.warn('Scraper already running, skipping');
      return;
    }

    this.isRunning = true;
    logger.section('Scheduled Scrape Starting');

    try {
      const agent = new FashionTeeAgent();
      await agent.run();
      logger.info('Scheduled scrape completed');
    } catch (error) {
      logger.error(`Scheduled scrape failed: ${error.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  stop() {
    this.jobs.forEach(job => job.stop());
    this.jobs = [];
    logger.info('Scheduler stopped');
  }

  getNextRun() {
    // Parse cron expression to get next run time
    const interval = cron.validate(config.scheduler.cronExpression);
    if (interval) {
      return 'Valid cron - check system time';
    }
    return 'Invalid cron expression';
  }

  async runNow() {
    logger.info('Running scraper immediately');
    await this.runScraper();
  }
}

// If run directly
if (require.main === module) {
  const manager = new CronManager();
  
  // Handle shutdown
  process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down...');
    manager.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down...');
    manager.stop();
    process.exit(0);
  });

  manager.start();

  // Keep process alive
  setInterval(() => {}, 1000);
}

module.exports = CronManager;