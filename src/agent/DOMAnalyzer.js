const LLMClient = require('../llm/LLMClient');
const { selectorGenerationPrompt } = require('../llm/prompts/selectorGeneration');
const logger = require('../utils/logger');
const { parsePrice, normalizeUrl } = require('../utils/helpers');

class DOMAnalyzer {
  constructor() {
    this.llm = new LLMClient();
  }

  async analyze(page, context) {
    logger.info('Analyzing DOM structure...');
    
    try {
      const domStructure = await this.extractDOMStructure(page);
      const patterns = await this.identifyPatterns(domStructure, context);
      return patterns;
    } catch (error) {
      logger.warn(`DOM analysis failed: ${error.message}`);
      return this.getFallbackPatterns();
    }
  }

  async extractDOMStructure(page) {
    return await page.evaluate(() => {
      function getStructure(el, depth = 0) {
        if (depth > 3 || !el) return null;
        return {
          tag: el.tagName?.toLowerCase() || '',
          classes: Array.from(el.classList || []).slice(0, 5),
          id: el.id || null,
          childCount: el.children?.length || 0,
          hasImage: !!el.querySelector('img'),
          hasPrice: /\$[\d,.]+/.test(el.textContent?.slice(0, 100) || '')
        };
      }

      const containers = [
        ...document.querySelectorAll('[class*="product"]'),
        ...document.querySelectorAll('[class*="item"]'),
        ...document.querySelectorAll('[class*="card"]'),
        ...document.querySelectorAll('[data-product]'),
        ...document.querySelectorAll('article')
      ].slice(0, 15);

      return {
        url: window.location.href,
        title: document.title,
        products: containers.map(el => getStructure(el))
      };
    });
  }

  async identifyPatterns(domStructure, context) {
    try {
      const prompt = selectorGenerationPrompt(domStructure, context.category);
      const response = await this.llm.complete({ 
        prompt, 
        maxTokens: 1000, 
        temperature: 0.2 
      });

      const match = response.match(/\{[\s\S]*\}/);
      if (match) {
        const patterns = JSON.parse(match[0]);
        if (patterns.container) {
          logger.info(`LLM suggested patterns: ${patterns.container}`);
          return patterns;
        }
      }
    } catch (error) {
      logger.warn(`LLM pattern identification failed: ${error.message}`);
    }

    return this.getFallbackPatterns();
  }

  getFallbackPatterns() {
    return {
      container: '[class*="product"], [class*="item-card"], [class*="ProductCard"], article[class*="product"]',
      name: 'h2, h3, h4, [class*="title"], [class*="name"], [class*="Title"], [class*="Name"], a',
      price: '[class*="price"], [class*="Price"], [data-price]',
      image: 'img',
      link: 'a[href]'
    };
  }

  async extractWithPatterns(page, patterns) {
    const baseUrl = page.url();

    const products = await page.evaluate((selectors, base) => {
      const results = [];
      
      // Try each container selector
      const containerSelectors = selectors.container.split(',').map(s => s.trim());
      let containers = [];
      
      for (const selector of containerSelectors) {
        try {
          const found = document.querySelectorAll(selector);
          if (found.length > containers.length) {
            containers = Array.from(found);
          }
        } catch (e) {
          // Invalid selector, skip
        }
      }

      containers.forEach(container => {
        try {
          // Find name
          let name = '';
          const nameSelectors = selectors.name.split(',').map(s => s.trim());
          for (const sel of nameSelectors) {
            try {
              const el = container.querySelector(sel);
              if (el && el.textContent?.trim()) {
                name = el.textContent.trim();
                break;
              }
            } catch (e) {}
          }

          // Find price
          let price = '';
          const priceSelectors = selectors.price.split(',').map(s => s.trim());
          for (const sel of priceSelectors) {
            try {
              const el = container.querySelector(sel);
              if (el && el.textContent?.trim()) {
                price = el.textContent.trim();
                break;
              }
            } catch (e) {}
          }

          // Find image
          let imageUrl = '';
          try {
            const img = container.querySelector(selectors.image);
            imageUrl = img?.src || img?.dataset?.src || img?.dataset?.lazySrc || '';
          } catch (e) {}

          // Find link
          let productUrl = '';
          try {
            const link = container.querySelector(selectors.link);
            productUrl = link?.href || '';
          } catch (e) {}

          if (name || imageUrl) {
            results.push({
              name: name.slice(0, 200),
              price,
              imageUrl,
              productUrl
            });
          }
        } catch (e) {
          // Skip this container
        }
      });

      return results;
    }, patterns, baseUrl);

    logger.info(`DOM extracted ${products.length} products`);
    return products;
  }
}

module.exports = DOMAnalyzer;