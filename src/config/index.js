require('dotenv').config();

const config = {
  llm: {
    provider: process.env.LLM_PROVIDER || 'openai',
    fallbackProvider: process.env.LLM_FALLBACK_PROVIDER || 'anthropic',
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4-turbo',
      visionModel: process.env.OPENAI_VISION_MODEL || 'gpt-4o'  // Updated vision model
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || 'claude-3-sonnet-20240229'
    }
  },

  airtable: {
    apiKey: process.env.AIRTABLE_API_KEY,
    baseId: process.env.AIRTABLE_BASE_ID,
    tableName: process.env.AIRTABLE_TABLE_NAME || 'Latest Arrivals'
  },

  browser: {
    headless: process.env.HEADLESS !== 'false',
    timeout: parseInt(process.env.BROWSER_TIMEOUT) || 30000,
    viewport: { width: 1920, height: 1080 },
    userAgents: [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
    ]
  },

  agent: {
    maxRetries: 3,
    confidenceThreshold: 0.7,
    enableLearning: true,
    maxScreenshots: 5,
    delayBetweenSites: 5000,
    delayBetweenPages: 2000
  },

  scheduler: {
    cronExpression: process.env.CRON_SCHEDULE || '0 6 * * 1',
    timezone: process.env.TIMEZONE || 'America/New_York'
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    directory: './logs'
  },

  paths: {
    patterns: './data/patterns',
    screenshots: './data/screenshots',
    cache: './data/cache'
  }
};

module.exports = config;