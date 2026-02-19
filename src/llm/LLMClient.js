// src/llm/LLMClient.js
const OpenAIProvider = require('./providers/OpenAIProvider');
const AnthropicProvider = require('./providers/AnthropicProvider');
const config = require('../config');
const logger = require('../utils/logger');

class LLMClient {
  constructor(options = {}) {
    this.providers = {};
    this.primaryProvider = null;
    this.fallbackProvider = null;

    this.callCount = 0;
    this.maxCallsPerRun = options.maxCallsPerRun || 50;
    this.callTimeout = options.callTimeout || 30000;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;

    this.initializeProviders();
  }

  initializeProviders() {
    if (config.llm.openai.apiKey) {
      try { this.providers.openai = new OpenAIProvider(); }
      catch (error) { logger.warn(`Failed to initialize OpenAI: ${error.message}`); }
    }

    if (config.llm.anthropic.apiKey) {
      try { this.providers.anthropic = new AnthropicProvider(); }
      catch (error) { logger.warn(`Failed to initialize Anthropic: ${error.message}`); }
    }

    const primaryName = config.llm.provider;
    this.primaryProvider = this.providers[primaryName];

    if (!this.primaryProvider) {
      this.primaryProvider = this.providers.openai || this.providers.anthropic;
    }

    const fallbackName = config.llm.fallbackProvider;
    this.fallbackProvider = this.providers[fallbackName];

    if (this.fallbackProvider === this.primaryProvider) {
      this.fallbackProvider = null;
    }

    if (!this.primaryProvider) {
      throw new Error('No LLM provider available. Please configure OPENAI_API_KEY or ANTHROPIC_API_KEY');
    }

    logger.info(`LLM Client initialized — primary: ${primaryName || 'auto'}, available: [${Object.keys(this.providers).join(', ')}]`);
  }

  async withTimeout(promise, timeoutMs, label) {
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`LLM ${label} timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutHandle);
      return result;
    } catch (error) {
      clearTimeout(timeoutHandle);
      throw error;
    }
  }

  trackUsage(result) {
    if (!result) return;
    if (result.usage) {
      this.totalInputTokens += result.usage.prompt_tokens || result.usage.input_tokens || 0;
      this.totalOutputTokens += result.usage.completion_tokens || result.usage.output_tokens || 0;
    }
  }

  async complete(options) {
    if (this.callCount >= this.maxCallsPerRun) {
      throw new Error(`LLM call limit reached (${this.maxCallsPerRun}). Total tokens: ${this.totalInputTokens + this.totalOutputTokens}`);
    }

    this.callCount++;
    const timeout = options.timeout || this.callTimeout;

    try {
      const result = await this.withTimeout(this.primaryProvider.complete(options), timeout, 'complete');
      this.trackUsage(result);
      return typeof result === 'string' ? result : result?.text || result?.content || result;
    } catch (error) {
      logger.warn(`Primary LLM failed: ${error.message}`);

      if (this.fallbackProvider) {
        logger.info('Trying fallback LLM provider');
        try {
          const result = await this.withTimeout(this.fallbackProvider.complete(options), timeout, 'complete-fallback');
          this.trackUsage(result);
          return typeof result === 'string' ? result : result?.text || result?.content || result;
        } catch (fallbackError) {
          logger.error(`Fallback LLM also failed: ${fallbackError.message}`);
          throw fallbackError;
        }
      }

      throw error;
    }
  }

  async analyzeImage(options) {
    if (this.callCount >= this.maxCallsPerRun) {
      throw new Error(`LLM call limit reached (${this.maxCallsPerRun}). Total tokens: ${this.totalInputTokens + this.totalOutputTokens}`);
    }

    this.callCount++;
    const timeout = options.timeout || this.callTimeout * 2;

    try {
      const result = await this.withTimeout(this.primaryProvider.analyzeImage(options), timeout, 'analyzeImage');
      this.trackUsage(result);
      return typeof result === 'string' ? result : result?.text || result?.content || result;
    } catch (error) {
      logger.warn(`Primary vision failed: ${error.message}`);

      if (this.fallbackProvider) {
        logger.info('Trying fallback vision provider');
        try {
          const result = await this.withTimeout(this.fallbackProvider.analyzeImage(options), timeout, 'analyzeImage-fallback');
          this.trackUsage(result);
          return typeof result === 'string' ? result : result?.text || result?.content || result;
        } catch (fallbackError) {
          logger.error(`Fallback vision also failed: ${fallbackError.message}`);
          throw fallbackError;
        }
      }

      throw error;
    }
  }

  getUsageStats() {
    return {
      calls: this.callCount,
      maxCalls: this.maxCallsPerRun,
      totalInputTokens: this.totalInputTokens,
      totalOutputTokens: this.totalOutputTokens,
      totalTokens: this.totalInputTokens + this.totalOutputTokens
    };
  }

  resetUsageStats() {
    this.callCount = 0;
    this.totalInputTokens = 0;
    this.totalOutputTokens = 0;
  }
}

module.exports = LLMClient;