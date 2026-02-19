// src/integrations/NotificationService.js
const axios = require('axios');
const logger = require('../utils/logger');

class NotificationService {
  constructor() {
    this.slackWebhook = process.env.SLACK_WEBHOOK_URL;
    this.enabled = !!this.slackWebhook;
    this.requestTimeout = 10000;
  }

  async sendSlack(message, options = {}) {
    if (!this.enabled) {
      logger.debug('Slack notifications not configured');
      return;
    }

    const { type = 'info', details = {} } = options;
    const colors = { info: '#36a64f', warning: '#ffcc00', error: '#ff0000', success: '#00ff00' };

    const payload = {
      attachments: [{
        color: colors[type] || colors.info,
        title: 'Fashion Tee Agent',
        text: message,
        fields: Object.entries(details).map(([key, value]) => ({
          title: key, value: String(value), short: true
        })),
        footer: 'Fashion Tee Agent',
        ts: Math.floor(Date.now() / 1000)
      }]
    };

    try {
      await axios.post(this.slackWebhook, payload, {
        timeout: this.requestTimeout,
        headers: { 'Content-Type': 'application/json' }
      });
      logger.debug('Slack notification sent');
    } catch (error) {
      logger.warn(`Failed to send Slack notification: ${error.message}`);
    }
  }

  async notifyStart(sites) {
    const siteNames = Array.isArray(sites) ? sites.map(s => s.name || s).join(', ') : String(sites);
    await this.sendSlack('🚀 Starting scrape run', {
      type: 'info',
      details: {
        'Sites': Array.isArray(sites) ? sites.length : sites,
        'Site Names': siteNames.substring(0, 100),
        'Started': new Date().toLocaleString()
      }
    });
  }

  async notifyComplete(stats) {
    await this.sendSlack('✅ Scrape run complete', {
      type: 'success',
      details: {
        'Total Scraped': stats.totalScraped || 0,
        'New Products': stats.newProducts || 0,
        'Updated': stats.updated || 0,
        'Errors': stats.errors || 0,
        'Duration': `${stats.duration || 0}s`
      }
    });
  }

  async notifyError(error, context = {}) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await this.sendSlack(`❌ Error: ${errorMessage}`, {
      type: 'error',
      details: {
        'Site': context.site || 'Unknown',
        'Category': context.category || 'Unknown',
        'Error': errorMessage.substring(0, 200)
      }
    });
  }

  async sendError(message) {
    await this.notifyError(new Error(message), { site: 'system' });
  }
}

module.exports = new NotificationService();