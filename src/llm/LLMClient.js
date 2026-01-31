const OpenAIProvider = require('./providers/OpenAIProvider');
const AnthropicProvider = require('./providers/AnthropicProvider');
const config = require('../config');
const logger = require('../utils/logger');

class LLMClient {
  constructor() {
    this.providers = {};
    this.primaryProvider = null;
    this.fallbackProvider = null;
    this.initializeProviders();
  }

  initializeProviders() {
    // Initialize OpenAI if configured
    if (config.llm.openai.apiKey) {
      try {
        this.providers.openai = new OpenAIProvider();
      } catch (error) {
        logger.warn(`Failed to initialize OpenAI: ${error.message}`);
      }
    }

    // Initialize Anthropic if configured
    if (config.llm.anthropic.apiKey) {
      try {
        this.providers.anthropic = new AnthropicProvider();
      } catch (error) {
        logger.warn(`Failed to initialize Anthropic: ${error.message}`);
      }
    }

    // Set primary provider
    const primaryName = config.llm.provider;
    this.primaryProvider = this.providers[primaryName];

    // If primary not available, use any available provider
    if (!this.primaryProvider) {
      this.primaryProvider = this.providers.openai || this.providers.anthropic;
    }

    // Set fallback provider
    const fallbackName = config.llm.fallbackProvider;
    this.fallbackProvider = this.providers[fallbackName];

    // Make sure fallback is different from primary
    if (this.fallbackProvider === this.primaryProvider) {
      this.fallbackProvider = null;
    }

    if (!this.primaryProvider) {
      throw new Error('No LLM provider available. Please configure OPENAI_API_KEY or ANTHROPIC_API_KEY');
    }

    logger.info(`LLM Client initialized with primary: ${primaryName || 'auto'}`);
  }

  async complete(options) {
    try {
      return await this.primaryProvider.complete(options);
    } catch (error) {
      logger.warn(`Primary LLM failed: ${error.message}`);
      
      if (this.fallbackProvider) {
        logger.info('Trying fallback LLM provider');
        try {
          return await this.fallbackProvider.complete(options);
        } catch (fallbackError) {
          logger.error(`Fallback LLM also failed: ${fallbackError.message}`);
          throw fallbackError;
        }
      }
      
      throw error;
    }
  }

  async analyzeImage(options) {
    try {
      return await this.primaryProvider.analyzeImage(options);
    } catch (error) {
      logger.warn(`Primary vision failed: ${error.message}`);
      
      if (this.fallbackProvider) {
        logger.info('Trying fallback vision provider');
        try {
          return await this.fallbackProvider.analyzeImage(options);
        } catch (fallbackError) {
          logger.error(`Fallback vision also failed: ${fallbackError.message}`);
          throw fallbackError;
        }
      }
      
      throw error;
    }
  }
}

module.exports = LLMClient;