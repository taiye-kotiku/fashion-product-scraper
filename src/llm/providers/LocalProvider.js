const axios = require('axios');
const logger = require('../../utils/logger');

/**
 * Local LLM Provider using Ollama
 * Fallback option when cloud APIs are not available
 */
class LocalProvider {
  constructor() {
    this.baseUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
    this.model = process.env.OLLAMA_MODEL || 'llama2';
    this.visionModel = process.env.OLLAMA_VISION_MODEL || 'llava';
  }

  async complete({ prompt, maxTokens = 2000, temperature = 0.7 }) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/generate`, {
        model: this.model,
        prompt,
        stream: false,
        options: {
          temperature,
          num_predict: maxTokens
        }
      });

      return response.data.response;
    } catch (error) {
      logger.error(`Ollama completion error: ${error.message}`);
      throw error;
    }
  }

  async analyzeImage({ image, prompt, maxTokens = 4000 }) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/generate`, {
        model: this.visionModel,
        prompt,
        images: [image],
        stream: false,
        options: {
          num_predict: maxTokens
        }
      });

      return response.data.response;
    } catch (error) {
      logger.error(`Ollama vision error: ${error.message}`);
      throw error;
    }
  }

  async isAvailable() {
    try {
      await axios.get(`${this.baseUrl}/api/tags`);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = LocalProvider;