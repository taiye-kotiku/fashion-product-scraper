const BaseStrategy = require('./BaseStrategy');
const logger = require('../utils/logger');
const { parsePrice } = require('../utils/helpers');

class SemanticStrategy extends BaseStrategy {
  constructor() {
    super();
    this.name = 'semantic';
  }

  async extract(page, context) {
    logger.info('Using semantic strategy');

    let products = [];

    // Try Schema.org JSON-LD first
    try {
      products = await this.extractSchemaOrg(page);
      if (products.length > 0) {
        logger.info(`Found ${products.length} products via Schema.org`);
      }
    } catch (e) {
      logger.warn(`Schema.org extraction failed: ${e.message}`);
    }

    // Try microdata if no products found
    if (products.length === 0) {
      try {
        products = await this.extractMicrodata(page);
        if (products.length > 0) {
          logger.info(`Found ${products.length} products via microdata`);
        }
      } catch (e) {
        logger.warn(`Microdata extraction failed: ${e.message}`);
      }
    }

    return {
      products,
      confidence: this.calculateConfidence(products),
      method: 'semantic'
    };
  }

  async extractSchemaOrg(page) {
    return await page.evaluate(() => {
      const products = [];

      document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
        try {
          const data = JSON.parse(script.textContent);

          const processProduct = (p) => {
            if (p && p.name) {
              products.push({
                name: p.name,
                price: p.offers?.price || p.offers?.[0]?.price || null,
                priceFormatted: p.offers?.priceCurrency ? 
                  `${p.offers.priceCurrency} ${p.offers.price}` : null,
                imageUrl: Array.isArray(p.image) ? p.image[0] : p.image,
                productUrl: p.url || null
              });
            }
          };

          if (data['@type'] === 'Product') {
            processProduct(data);
          }

          if (data['@type'] === 'ItemList' && data.itemListElement) {
            data.itemListElement.forEach(item => {
              const p = item.item || item;
              if (p['@type'] === 'Product') {
                processProduct(p);
              }
            });
          }

          if (data['@graph']) {
            data['@graph'].forEach(item => {
              if (item['@type'] === 'Product') {
                processProduct(item);
              }
            });
          }
        } catch (e) {
          // Ignore JSON parse errors
        }
      });

      return products;
    });
  }

  async extractMicrodata(page) {
    return await page.evaluate(() => {
      const products = [];

      document.querySelectorAll('[itemtype*="Product"]').forEach(el => {
        const name = el.querySelector('[itemprop="name"]')?.textContent?.trim();
        const price = el.querySelector('[itemprop="price"]')?.textContent?.trim() ||
                      el.querySelector('[itemprop="price"]')?.getAttribute('content');
        const imageUrl = el.querySelector('[itemprop="image"]')?.src ||
                         el.querySelector('[itemprop="image"]')?.getAttribute('content');
        const productUrl = el.querySelector('[itemprop="url"]')?.href ||
                           el.querySelector('a')?.href;

        if (name) {
          products.push({ name, price, imageUrl, productUrl });
        }
      });

      return products;
    });
  }
}

module.exports = SemanticStrategy;