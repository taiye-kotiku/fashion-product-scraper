const LLMClient = require('../llm/LLMClient');
const ScreenshotManager = require('../browser/ScreenshotManager');
const { productExtractionPrompt } = require('../llm/prompts/productExtraction');
const logger = require('../utils/logger');
const { delay, parsePrice } = require('../utils/helpers');

class VisionAnalyzer {
  constructor() {
    this.llm = new LLMClient();
    this.screenshotManager = new ScreenshotManager();
  }

  async extract(page, context, options = {}) {
    const { maxChunks = 3 } = options;
    
    logger.info('Starting vision-based extraction');

    // Capture screenshots
    let screenshots = [];
    
    try {
      screenshots = await this.screenshotManager.captureFullPage(page, { maxChunks });
    } catch (error) {
      logger.warn(`Full page capture failed, trying viewport: ${error.message}`);
      try {
        const viewport = await this.screenshotManager.captureViewport(page);
        screenshots = [viewport];
      } catch (e) {
        logger.error(`All screenshot methods failed: ${e.message}`);
        return { products: [], confidence: 0, method: 'vision' };
      }
    }

    if (screenshots.length === 0) {
      logger.warn('No screenshots captured');
      return { products: [], confidence: 0, method: 'vision' };
    }

    const allProducts = [];

    for (let i = 0; i < screenshots.length; i++) {
      const screenshot = screenshots[i];
      logger.info(`Analyzing screenshot ${i + 1}/${screenshots.length}`);

      try {
        const products = await this.analyzeScreenshot(screenshot.data, context);
        allProducts.push(...products);

        // Rate limiting between API calls
        if (i < screenshots.length - 1) {
          await delay(1000);
        }
      } catch (error) {
        logger.warn(`Screenshot ${i + 1} analysis failed: ${error.message}`);
      }
    }

    // Deduplicate
    const unique = this.deduplicateProducts(allProducts);

    return {
      products: unique,
      confidence: this.calculateConfidence(unique),
      method: 'vision',
      screenshotCount: screenshots.length
    };
  }

  async extractFull(page, context) {
    return await this.extract(page, context, { maxChunks: 5 });
  }

  async analyzeScreenshot(imageData, context) {
    const prompt = productExtractionPrompt(context.category);

    try {
      logger.info('Sending screenshot to LLM for analysis...');
      
      const response = await this.llm.analyzeImage({
        image: imageData,
        prompt,
        maxTokens: 4000
      });

      logger.info('Received LLM response');
      
      const products = this.parseResponse(response);
      logger.info(`Parsed ${products.length} products from response`);
      
      return products;

    } catch (error) {
      logger.error(`Vision analysis error: ${error.message}`);
      return [];
    }
  }

  parseResponse(response) {
    try {
      const jsonMatch = response.match(/\[[\s\S]*?\]/);
      
      if (jsonMatch) {
        const products = JSON.parse(jsonMatch[0]);
        
        if (Array.isArray(products)) {
          return products
            .map(p => this.normalizeProduct(p))
            .filter(p => p !== null && p.name); // Filter out nulls
        }
      }

      try {
        const parsed = JSON.parse(response);
        if (Array.isArray(parsed)) {
          return parsed
            .map(p => this.normalizeProduct(p))
            .filter(p => p !== null && p.name);
        }
      } catch (e) {}

      logger.warn('Could not parse products from LLM response');
      return [];
      
    } catch (error) {
      logger.warn(`Failed to parse vision response: ${error.message}`);
      return [];
    }
  }

  normalizeProduct(product) {
    const name = (product.name || product.title || '').trim();
    
    // Quick validation - skip obvious non-products
    if (!name || name.length < 5) return null;
    
    const invalidPatterns = [
      /^(shop|view|see|load|more|all|home|menu|cart|account)$/i,
      /^(women|men|boys|girls|kids|sale|new|trending)$/i,
      /^(filter|sort|size|color|category|collection)s?$/i,
      /^(add to|quick view|shop now|view all)/i,
      /^\$?\d+(\.\d{2})?$/, // Just a price
    ];
    
    if (invalidPatterns.some(p => p.test(name))) {
      return null;
    }

    return {
      name: name,
      price: parsePrice(product.price),
      priceFormatted: product.price || '',
      imageDescription: product.imageDescription || product.description || '',
      needsUrlExtraction: true,
      extractionMethod: 'vision'
    };
  }

  deduplicateProducts(products) {
    const seen = new Map();

    for (const product of products) {
      if (!product.name) continue;
      
      const key = product.name.toLowerCase().trim();
      
      if (!seen.has(key)) {
        seen.set(key, product);
      }
    }

    return Array.from(seen.values());
  }

  calculateConfidence(products) {
    if (!products || products.length === 0) return 0;

    let totalScore = 0;
    
    for (const product of products) {
      let score = 0;
      if (product.name && product.name.length > 3) score += 0.5;
      if (product.price !== null) score += 0.3;
      if (product.imageDescription) score += 0.2;
      totalScore += score;
    }

    return Math.min(totalScore / products.length, 1);
  }
}

module.exports = VisionAnalyzer;