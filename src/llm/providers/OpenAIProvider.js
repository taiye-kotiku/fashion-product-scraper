const OpenAI = require('openai');
const config = require('../../config');
const logger = require('../../utils/logger');

class OpenAIProvider {
  constructor() {
    this.client = new OpenAI({
      apiKey: config.llm.openai.apiKey
    });
    // Updated models - gpt-4-vision-preview is deprecated
    this.model = config.llm.openai.model || 'gpt-4-turbo';
    this.visionModel = 'gpt-4o';  // New vision model
    
    logger.debug('OpenAI provider initialized');
  }

  async complete({ prompt, maxTokens = 2000, temperature = 0.7, systemPrompt = null }) {
    try {
      const messages = [
        {
          role: 'system',
          content: systemPrompt || 'You are an expert web scraping assistant. Always respond with valid JSON when asked for structured data.'
        },
        { role: 'user', content: prompt }
      ];

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        max_tokens: maxTokens,
        temperature
      });

      return response.choices[0].message.content;
    } catch (error) {
      logger.error(`OpenAI completion error: ${error.message}`);
      throw error;
    }
  }

  async analyzeImage({ image, prompt, maxTokens = 4000 }) {
    try {
      const response = await this.client.chat.completions.create({
        model: this.visionModel,  // Using gpt-4o for vision
        messages: [
          {
            role: 'system',
            content: 'You are an expert at analyzing e-commerce screenshots. Always respond with valid JSON arrays containing product data. Do not include any text before or after the JSON array.'
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${image}`,
                  detail: 'high'
                }
              }
            ]
          }
        ],
        max_tokens: maxTokens
      });

      return response.choices[0].message.content;
    } catch (error) {
      logger.error(`OpenAI vision error: ${error.message}`);
      throw error;
    }
  }
}

module.exports = OpenAIProvider;