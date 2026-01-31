const LLMClient = require('../llm/LLMClient');
const DOMAnalyzer = require('./DOMAnalyzer');
const { healingPrompt } = require('../llm/prompts/healingPrompts');
const logger = require('../utils/logger');
const { parsePrice } = require('../utils/helpers');

class SelfHealer {
  constructor() {
    this.llm = new LLMClient();
    this.domAnalyzer = new DOMAnalyzer();
  }

  async heal(page, failedExtraction, context) {
    logger.info('Starting self-healing');

    const strategies = [
      () => this.tryAlternativeSelectors(page),
      () => this.trySemanticExtraction(page),
      () => this.trySchemaOrgExtraction(page),
      () => this.tryLLMExtraction(page, context)
    ];

    for (const strategy of strategies) {
      try {
        const result = await strategy();
        if (result.success && result.products.length > 0) {
          logger.info(`Healing succeeded: ${result.products.length} products`);
          return result;
        }
      } catch (error) {
        logger.warn(`Healing strategy failed: ${error.message}`);
      }
    }

    return { success: false, products: [] };
  }

  async tryAlternativeSelectors(page) {
    const patterns = [
      {
        container: '.product-tile, .product-card, [data-component="product"]',
        name: '.product-title, .product-name, h3 a',
        price: '.product-price, .price',
        image: 'img.product-image, img[data-src]',
        link: 'a.product-link, a[href*="/product"]'
      },
      {
        container: '[class*="ProductCard"], [class*="product-item"]',
        name: '[class*="title"], [class*="name"]',
        price: '[class*="price"]',
        image: 'img',
        link: 'a'
      }
    ];

    for (const pattern of patterns) {
      const products = await this.domAnalyzer.extractWithPatterns(page, pattern);
      const valid = products.filter(p => p.name && (p.imageUrl || p.productUrl));

      if (valid.length > 0) {
        return { success: true, products: valid };
      }
    }

    return { success: false, products: [] };
  }

  async trySemanticExtraction(page) {
    const products = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll('[itemtype*="Product"]').forEach(el => {
        items.push({
          name: el.querySelector('[itemprop="name"]')?.textContent?.trim(),
          price: el.querySelector('[itemprop="price"]')?.textContent?.trim(),
          imageUrl: el.querySelector('[itemprop="image"]')?.src,
          productUrl: el.querySelector('[itemprop="url"]')?.href
        });
      });
      return items;
    });

    const valid = products.filter(p => p.name);
    return { success: valid.length > 0, products: valid };
  }

  async trySchemaOrgExtraction(page) {
    const products = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
        try {
          const data = JSON.parse(script.textContent);

          if (data['@type'] === 'ItemList' && data.itemListElement) {
            data.itemListElement.forEach(item => {
              const p = item.item || item;
              if (p['@type'] === 'Product') {
                items.push({
                  name: p.name,
                  price: p.offers?.price,
                  imageUrl: Array.isArray(p.image) ? p.image[0] : p.image,
                  productUrl: p.url
                });
              }
            });
          }

          if (data['@type'] === 'Product') {
            items.push({
              name: data.name,
              price: data.offers?.price,
              imageUrl: Array.isArray(data.image) ? data.image[0] : data.image,
              productUrl: data.url
            });
          }
        } catch {}
      });
      return items;
    });

    return { success: products.length > 0, products };
  }

  async tryLLMExtraction(page, context) {
    const html = await page.evaluate(() => {
      const area = document.querySelector('main, [class*="product"], #content') || document.body;
      const clone = area.cloneNode(true);
      clone.querySelectorAll('script, style, iframe').forEach(el => el.remove());
      return clone.innerHTML.slice(0, 50000);
    });

    const prompt = healingPrompt(html, context.category);

    try {
      const response = await this.llm.complete({ prompt, maxTokens: 3000, temperature: 0.2 });
      const match = response.match(/\[[\s\S]*\]/);

      if (match) {
        const products = JSON.parse(match[0]).map(p => ({
          ...p,
          price: parsePrice(p.price)
        }));
        return { success: products.length > 0, products };
      }
    } catch (error) {
      logger.warn(`LLM extraction failed: ${error.message}`);
    }

    return { success: false, products: [] };
  }
}

module.exports = SelfHealer;