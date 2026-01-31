const axios = require('axios');
const logger = require('../utils/logger');

class NotificationService {
  constructor() {
    this.slackWebhook = process.env.SLACK_WEBHOOK_URL;
    this.enabled = !!this.slackWebhook;
  }

  async sendSlack(message, options = {}) {
    if (!this.enabled) {
      logger.debug('Slack notifications not configured');
      return;
    }

    const { type = 'info', details = {} } = options;

    const colors = {
      info: '#36a64f',
      warning: '#ffcc00',
      error: '#ff0000',
      success: '#00ff00'
    };

    const payload = {
      attachments: [
        {
          color: colors[type] || colors.info,
          title: 'Fashion Tee Agent',
          text: message,
          fields: Object.entries(details).map(([key, value]) => ({
            title: key,
            value: String(value),
            short: true
          })),
          footer: 'Fashion Tee Agent',
          ts: Math.floor(Date.now() / 1000)
        }
      ]
    };

    try {
      await axios.post(this.slackWebhook, payload);
      logger.debug('Slack notification sent');
    } catch (error) {
      logger.warn(`Failed to send Slack notification: ${error.message}`);
    }
  }

  async notifyStart(sites) {
    await this.sendSlack('🚀 Starting scrape run', {
      type: 'info',
      details: {
        'Sites': sites.length,
        'Started': new Date().toLocaleString()
      }
    });
  }

  async notifyComplete(stats) {
    await this.sendSlack('✅ Scrape run complete', {
      type: 'success',
      details: {
        'Total Scraped': stats.totalScraped,
        'New Products': stats.newProducts,
        'Updated': stats.updated,
        'Errors': stats.errors,
        'Duration': `${stats.duration}s`
      }
    });
  }

  async notifyError(error, context = {}) {
    await this.sendSlack(`❌ Error: ${error.message}`, {
      type: 'error',
      details: {
        'Site': context.site || 'Unknown',
        'Category': context.category || 'Unknown',
        'Error': error.message
      }
    });
  }
}

module.exports = new NotificationService();