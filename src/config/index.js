// src/config/index.js
require('dotenv').config();

const isGitHubActions = !!process.env.GITHUB_ACTIONS;
const isCI = isGitHubActions || !!process.env.CI;

const config = {
  llm: {
    provider: process.env.LLM_PROVIDER || 'openai',
    fallbackProvider: process.env.LLM_FALLBACK_PROVIDER || 'anthropic',
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      visionModel: process.env.OPENAI_VISION_MODEL || 'gpt-4o'
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514'
    }
  },

  airtable: {
    apiKey: process.env.AIRTABLE_API_KEY,
    baseId: process.env.AIRTABLE_BASE_ID,
    tableName: process.env.AIRTABLE_TABLE_NAME || 'Latest Arrivals'
  },

  browser: {
    headless: isCI ? true : process.env.HEADLESS !== 'false',
    timeout: parseInt(process.env.BROWSER_TIMEOUT) || (isCI ? 45000 : 30000),
    viewport: { width: 1920, height: 1080 },
    userAgents: [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15'
    ]
  },

  agent: {
    maxRetries: 3,
    confidenceThreshold: 0.7,
    enableLearning: true,
    maxScreenshots: 5,
    delayBetweenSites: isCI ? 8000 : 5000,
    delayBetweenPages: isCI ? 3000 : 2000
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
  },

  isCI,
  isGitHubActions
};

// ─── Validate config at startup ─────────────────────────────────────
function validateConfig(cfg) {
  const errors = [];

  // Browser timeout
  if (isNaN(cfg.browser.timeout) || cfg.browser.timeout < 5000) {
    errors.push(`BROWSER_TIMEOUT must be >= 5000 (got: ${process.env.BROWSER_TIMEOUT || 'default'})`);
    cfg.browser.timeout = 30000;
  }

  // Agent config
  if (cfg.agent.maxRetries < 1 || cfg.agent.maxRetries > 10) {
    errors.push(`agent.maxRetries should be 1-10 (got: ${cfg.agent.maxRetries})`);
  }
  if (cfg.agent.confidenceThreshold < 0 || cfg.agent.confidenceThreshold > 1) {
    errors.push(`agent.confidenceThreshold must be 0-1 (got: ${cfg.agent.confidenceThreshold})`);
  }

  // Cron validation
  try {
    const cron = require('node-cron');
    if (!cron.validate(cfg.scheduler.cronExpression)) {
      errors.push(`Invalid cron expression: "${cfg.scheduler.cronExpression}"`);
    }
  } catch {
    // node-cron may not be available during config load in some setups
  }

  // Warnings for missing optional services
  if (!cfg.llm.openai.apiKey && !cfg.llm.anthropic.apiKey) {
    console.warn('⚠️  No LLM provider configured. Self-healing and vision extraction will not work.');
  }
  if (!cfg.airtable.apiKey || !cfg.airtable.baseId) {
    console.warn('⚠️  Airtable not fully configured — running in dry-run mode');
  }

  if (errors.length > 0) {
    const message = `Configuration errors:\n  - ${errors.join('\n  - ')}`;
    console.error(`❌ ${message}`);
    throw new Error(message);
  }
}

validateConfig(config);

module.exports = config;