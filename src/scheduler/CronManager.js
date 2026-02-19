// src/scheduler/CronManager.js
const path = require('path');
const fs = require('fs').promises;
const cron = require('node-cron');
const config = require('../config');
const logger = require('../utils/logger');

class CronManager {
  constructor() {
    this.jobs = [];
    this.isRunning = false;
    this.currentRun = null;
    this.lastRunTime = null;
    this.lastRunResult = null;
    this.heartbeatInterval = null;
  }

  start() {
    logger.section('Starting Scheduler');
    logger.info(`Cron expression: ${config.scheduler.cronExpression}`);
    logger.info(`Timezone: ${config.scheduler.timezone}`);

    if (!cron.validate(config.scheduler.cronExpression)) {
      throw new Error(`Invalid cron expression: ${config.scheduler.cronExpression}`);
    }

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

    // Start heartbeat
    this.startHeartbeat();

    logger.info('Scheduler started - waiting for next scheduled run');
    logger.info(`Schedule: ${config.scheduler.cronExpression} (${config.scheduler.timezone})`);
  }

  async runScraper() {
    if (this.isRunning) {
      logger.warn('Scraper already running, skipping scheduled run');
      return;
    }

    this.isRunning = true;
    this.lastRunTime = new Date().toISOString();
    const runId = Date.now().toString(36);

    logger.section(`Scheduled Scrape Starting [${runId}]`);

    try {
      // Dynamic import to get fresh instance each run
      const FashionTeeAgent = require('../index');
      const agent = new FashionTeeAgent();
      this.currentRun = agent.run();
      await this.currentRun;

      this.lastRunResult = 'success';
      logger.info(`Scheduled scrape [${runId}] completed successfully`);
    } catch (error) {
      this.lastRunResult = `failed: ${error.message}`;
      logger.error(`Scheduled scrape [${runId}] failed: ${error.message}`);

      // Try to send error notification
      try {
        const notificationService = require('../integrations/NotificationService');
        await notificationService.notifyError(error, { site: 'scheduler', category: 'scheduled-run' });
      } catch (notifError) {
        logger.error(`Failed to send error notification: ${notifError.message}`);
      }
    } finally {
      this.isRunning = false;
      this.currentRun = null;
    }
  }

  /**
   * Write heartbeat file every 60 seconds for external monitoring.
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(async () => {
      try {
        const heartbeat = {
          pid: process.pid,
          uptime: Math.floor(process.uptime()),
          memory: process.memoryUsage(),
          isRunning: this.isRunning,
          lastRunTime: this.lastRunTime,
          lastRunResult: this.lastRunResult,
          schedule: config.scheduler.cronExpression,
          timezone: config.scheduler.timezone,
          timestamp: new Date().toISOString()
        };

        const heartbeatPath = path.join(process.cwd(), 'data', 'heartbeat.json');
        await fs.mkdir(path.dirname(heartbeatPath), { recursive: true });
        await fs.writeFile(heartbeatPath, JSON.stringify(heartbeat, null, 2));
      } catch {
        // Heartbeat is best-effort
      }
    }, 60000);

    // Don't let the heartbeat interval prevent clean exit
    if (this.heartbeatInterval.unref) {
      this.heartbeatInterval.unref();
    }
  }

  async stop() {
    logger.info('Stopping scheduler...');

    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Wait for current run to finish (with timeout)
    if (this.currentRun) {
      logger.info('Waiting for current scrape to complete (max 60s)...');
      try {
        await Promise.race([
          this.currentRun,
          new Promise(resolve => setTimeout(resolve, 60000))
        ]);
      } catch {
        // Run may have failed, that's fine
      }
    }

    // Stop all cron jobs
    this.jobs.forEach(job => job.stop());
    this.jobs = [];

    logger.info('Scheduler stopped');
  }

  async runNow() {
    logger.info('Running scraper immediately (manual trigger)');
    await this.runScraper();
  }
}

// If run directly
if (require.main === module) {
  const manager = new CronManager();

  const gracefulShutdown = async (signal) => {
    logger.info(`Received ${signal}, shutting down scheduler...`);
    await manager.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection in scheduler: ${reason?.message || reason}`);
  });
  process.on('uncaughtException', async (error) => {
    logger.error(`Uncaught exception in scheduler: ${error.message}\n${error.stack}`);
    await manager.stop();
    process.exit(1);
  });

  manager.start();
}

module.exports = CronManager;