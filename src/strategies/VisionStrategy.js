const BaseStrategy = require('./BaseStrategy');
const VisionAnalyzer = require('../agent/VisionAnalyzer');
const logger = require('../utils/logger');

class VisionStrategy extends BaseStrategy {
  constructor() {
    super();
    this.name = 'vision';
    this.visionAnalyzer = new VisionAnalyzer();
  }

  async extract(page, context) {
    logger.info('Using vision strategy');
    
    try {
      const result = await this.visionAnalyzer.extract(page, context);
      return {
        products: result.products || [],
        confidence: result.confidence || 0,
        method: 'vision'
      };
    } catch (error) {
      logger.error(`Vision extraction error: ${error.message}`);
      return {
        products: [],
        confidence: 0,
        method: 'vision',
        error: error.message
      };
    }
  }
}

module.exports = VisionStrategy;