const Anthropic = require('@anthropic-ai/sdk');
const config = require('../../config');
const logger = require('../../utils/logger');

class AnthropicProvider {
  constructor() {
    if (!config.llm.anthropic.apiKey) {
      logger.warn('Anthropic API key not configured');
      this.client = null;
    } else {
      this.client = new Anthropic({
        apiKey: config.llm.anthropic.apiKey
      });
    }
    this.model = config.llm.anthropic.model || 'claude-3-sonnet-20240229';
    
    logger.debug('Anthropic provider initialized');
  }

  async complete({ prompt, maxTokens = 2000, temperature = 0.7, systemPrompt = null }) {
    if (!this.client) {
      throw new Error('Anthropic client not initialized - API key missing');
    }

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        system: systemPrompt || 'You are an expert web scraping assistant. Always respond with valid JSON when asked for structured data.',
        messages: [{ role: 'user', content: prompt }]
      });

      return response.content[0].text;
    } catch (error) {
      logger.error(`Anthropic completion error: ${error.message}`);
      throw error;
    }
  }

  async analyzeImage({ image, prompt, maxTokens = 4000 }) {
    if (!this.client) {
      throw new Error('Anthropic client not initialized - API key missing');
    }

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        system: 'You are an expert at analyzing e-commerce screenshots. Always respond with valid JSON arrays containing product data. Do not include any text before or after the JSON array.',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: image
                }
              },
              { type: 'text', text: prompt }
            ]
          }
        ]
      });

      return response.content[0].text;
    } catch (error) {
      logger.error(`Anthropic vision error: ${error.message}`);
      throw error;
    }
  }
}

module.exports = AnthropicProvider;