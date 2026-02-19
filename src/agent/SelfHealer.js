// src/agent/SelfHealer.js
const LLMClient = require('../llm/LLMClient');
const DOMAnalyzer = require('./DOMAnalyzer');
const { healingPrompt } = require('../llm/prompts/healingPrompts');
const logger = require('../utils/logger');
const { parsePrice } = require('../utils/helpers');

class SelfHealer {
  constructor(options = {}) {
    this.llm = options.llm || new LLMClient();
    this.domAnalyzer = new DOMAnalyzer();
    this.maxHtmlSize = 30000;
  }

  async heal(page, failedExtraction, context) {
    logger.info('Starting self-healing cascade');

    const strategies = [
      { name: 'alternative-selectors', fn: () => this.tryAlternativeSelectors(page) },
      { name: 'semantic-html', fn: () => this.trySemanticExtraction(page) },
      { name: 'schema-org', fn: () => this.trySchemaOrgExtraction(page) },
      { name: 'llm-extraction', fn: () => this.tryLLMExtraction(page, context) }
    ];

    for (const strategy of strategies) {
      try {
        logger.debug(`Trying healing strategy: ${strategy.name}`);
        const result = await strategy.fn();
        if (result.success && result.products.length > 0) {
          logger.info(`Healing succeeded with "${strategy.name}": ${result.products.length} products`);
          return result;
        }
        logger.debug(`Strategy "${strategy.name}" returned 0 products`);
      } catch (error) {
        logger.warn(`Strategy "${strategy.name}" failed: ${error.message}`);
      }
    }

    logger.warn('All healing strategies exhausted');
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
      if (valid.length > 0) return { success: true, products: valid };
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

          const processProduct = (p) => {
            if (p['@type'] === 'Product') {
              items.push({
                name: p.name,
                price: p.offers?.price,
                imageUrl: Array.isArray(p.image) ? p.image[0] : p.image,
                productUrl: p.url
              });
            }
          };

          if (data['@type'] === 'ItemList' && data.itemListElement) {
            data.itemListElement.forEach(item => processProduct(item.item || item));
          }
          if (data['@type'] === 'Product') processProduct(data);
          if (data['@graph']) data['@graph'].forEach(processProduct);
        } catch {}
      });
      return items;
    });
    return { success: products.length > 0, products };
  }

  async tryLLMExtraction(page, context) {
    const pageData = await page.evaluate((maxSize) => {
      const area = document.querySelector('main, [class*="product"], #content') || document.body;
      const clone = area.cloneNode(true);
      clone.querySelectorAll('script, style, iframe, svg, noscript, header, footer, nav').forEach(el => el.remove());

      const html = clone.innerHTML;
      if (html.length <= maxSize) return html;

      const products = [];
      clone.querySelectorAll('a[href]').forEach(a => {
        const href = a.href || a.getAttribute('href') || '';
        if (href.includes('/p/') || href.includes('/product/') || href.includes('.html')) {
          const text = a.innerText?.trim().substring(0, 200) || '';
          const img = a.querySelector('img');
          const imgSrc = img?.src || img?.dataset?.src || '';
          if (text.length > 5) products.push({ href, text, img: imgSrc });
        }
      });

      if (products.length > 0) return JSON.stringify(products.slice(0, 50));
      return html.slice(0, maxSize);
    }, this.maxHtmlSize);

    const prompt = healingPrompt(pageData, context.category);

    try {
      const response = await this.llm.complete({ prompt, maxTokens: 3000, temperature: 0.2, timeout: 45000 });
      const responseText = typeof response === 'string' ? response : response?.text || response?.content || '';
      const match = responseText.match(/\[[\s\S]*\]/);

      if (!match) return { success: false, products: [] };

      let parsed;
      try { parsed = JSON.parse(match[0]); }
      catch { logger.warn('LLM returned invalid JSON'); return { success: false, products: [] }; }

      if (!Array.isArray(parsed)) return { success: false, products: [] };

      const products = parsed
        .filter(p => p && typeof p === 'object' && p.name && typeof p.name === 'string')
        .map(p => ({
          name: String(p.name).trim(),
          productUrl: p.productUrl || p.url || '',
          imageUrl: p.imageUrl || p.image || '',
          price: parsePrice(p.price),
          priceFormatted: p.price ? String(p.price) : ''
        }))
        .filter(p => p.name.length >= 5);

      logger.info(`LLM extraction parsed ${products.length} valid products`);
      return { success: products.length > 0, products };
    } catch (error) {
      logger.warn(`LLM extraction failed: ${error.message}`);
      return { success: false, products: [] };
    }
  }
}

module.exports = SelfHealer;