// src/integrations/ScrapingBeeClient.js
const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');
const { parsePrice } = require('../utils/helpers');

class ScrapingBeeClient {
  constructor() {
    this.apiKey = process.env.SCRAPINGBEE_API_KEY;
    this.baseUrl = 'https://app.scrapingbee.com/api/v1';
  }

  isConfigured() {
    return !!this.apiKey;
  }

  async getPage(url, options = {}) {
    if (!this.apiKey) {
      throw new Error('SCRAPINGBEE_API_KEY not configured');
    }

    logger.info(`ScrapingBee: Fetching ${url}`);

    try {
      const response = await axios.get(this.baseUrl, {
        params: {
          api_key: this.apiKey,
          url: url,
          render_js: true,
          premium_proxy: true,
          country_code: 'us',
          wait: options.wait || 5000,
          ...options.params
        },
        timeout: 90000
      });

      logger.info(`ScrapingBee: Success (${response.data.length} bytes)`);
      return response.data;
      
    } catch (error) {
      const status = error.response?.status;
      const message = error.response?.data || error.message;
      logger.error(`ScrapingBee error (${status}): ${message}`);
      throw new Error(`ScrapingBee failed: ${status} - ${message}`);
    }
  }

  async extractProducts(url, siteName) {
    const html = await this.getPage(url);
    const $ = cheerio.load(html);
    
    let products = [];

    switch (siteName.toLowerCase()) {
      case 'snipes':
        products = this.extractSnipes($, url);
        break;
      case 'abercrombie':
        products = this.extractAbercrombie($, url);
        break;
      case 'anthropologie':
        products = this.extractAnthropologie($, url);
        break;
      default:
        products = this.extractGeneric($, url);
    }

    logger.info(`ScrapingBee: Extracted ${products.length} products from ${siteName}`);
    return products;
  }

  extractSnipes($, baseUrl) {
    const products = [];
    const seen = new Set();

    $('.product-tile, .product-card, [data-product-id], .grid-tile').each((i, el) => {
      try {
        const $el = $(el);
        
        const link = $el.find('a[href*="/product"], a[href*=".html"]').first();
        const href = link.attr('href');
        if (!href || seen.has(href)) return;
        
        let name = $el.find('.product-name, .product-title, [class*="name"], h2, h3').first().text().trim();
        if (!name) {
          name = link.attr('title') || link.text().trim();
        }
        
        const priceText = $el.find('.price, [class*="price"]').first().text().trim();
        
        const img = $el.find('img').first();
        let imageUrl = img.attr('data-src') || img.attr('src') || '';
        if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
        
        if (name && name.length >= 5) {
          seen.add(href);
          products.push({
            name,
            productUrl: href.startsWith('http') ? href : new URL(href, baseUrl).href,
            imageUrl,
            priceFormatted: priceText,
            price: parsePrice(priceText)
          });
        }
      } catch (e) {}
    });

    return products;
  }

  extractAbercrombie($, baseUrl) {
    const products = [];
    const seen = new Set();
    const baseOrigin = 'https://www.abercrombie.com';

    // Find all product links with /p/ pattern
    $('a[href*="/p/"]').each((i, el) => {
      try {
        const $link = $(el);
        let href = $link.attr('href');
        if (!href) return;
        
        // Clean URL and dedupe
        const cleanUrl = href.split('?')[0].toLowerCase();
        if (seen.has(cleanUrl)) return;
        
        // Get parent container (the product card wrapper)
        const $container = $link.closest('[class*="productCard"], [class*="hasHoverImage"]');
        if (!$container.length) return;
        
        // Extract product name from URL: /p/stranger-things-graphic-tee-61693321
        let name = '';
        const urlMatch = href.match(/\/p\/([a-z0-9-]+)-(\d{8,})/i);
        if (urlMatch) {
          // Convert "stranger-things-graphic-tee" to "Stranger Things Graphic Tee"
          name = urlMatch[1]
            .split('-')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
        }
        
        if (!name || name.length < 3) return;
        
        // Get product ID
        const productId = urlMatch ? urlMatch[2] : '';
        
        // Get image from container
        let imageUrl = '';
        const $img = $container.find('img').first();
        if ($img.length) {
          imageUrl = $img.attr('src') || $img.attr('data-src') || '';
        }
        
        // Normalize URLs
        if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
        if (href.startsWith('/')) href = baseOrigin + href;
        
        seen.add(cleanUrl);
        products.push({
          name,
          productUrl: href.split('?')[0],
          imageUrl,
          priceFormatted: '',
          price: null,
          productId
        });
      } catch (e) {
        // Skip errors
      }
    });

    return products;
  }

  extractAnthropologie($, baseUrl) {
    const products = [];
    const seen = new Set();

    $('.product-card, [class*="product-tile"]').each((i, el) => {
      try {
        const $el = $(el);
        
        const link = $el.find('a[href*="/shop/"]').first();
        const href = link.attr('href');
        if (!href || seen.has(href)) return;
        
        const name = $el.find('[class*="product-name"], [class*="title"]').first().text().trim();
        const priceText = $el.find('[class*="price"]').first().text().trim();
        
        const img = $el.find('img').first();
        let imageUrl = img.attr('data-src') || img.attr('src') || '';
        if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
        
        if (name && name.length >= 5) {
          seen.add(href);
          products.push({
            name,
            productUrl: href.startsWith('http') ? href : new URL(href, baseUrl).href,
            imageUrl,
            priceFormatted: priceText,
            price: parsePrice(priceText)
          });
        }
      } catch (e) {}
    });

    return products;
  }

  extractGeneric($, baseUrl) {
    const products = [];
    const seen = new Set();

    $('[class*="product"], article, .card').each((i, el) => {
      try {
        const $el = $(el);
        
        const link = $el.find('a[href]').first();
        const href = link.attr('href');
        if (!href || seen.has(href)) return;
        
        if (href.includes('/cart') || href.includes('/login') || href.includes('/account')) return;
        
        const name = $el.find('h2, h3, h4, [class*="name"], [class*="title"]').first().text().trim();
        const priceText = $el.find('[class*="price"]').first().text().trim();
        
        const img = $el.find('img').first();
        let imageUrl = img.attr('data-src') || img.attr('src') || '';
        if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
        
        if (name && name.length >= 5 && name.length <= 200) {
          seen.add(href);
          products.push({
            name,
            productUrl: href.startsWith('http') ? href : new URL(href, baseUrl).href,
            imageUrl,
            priceFormatted: priceText,
            price: parsePrice(priceText)
          });
        }
      } catch (e) {}
    });

    return products;
  }
}

module.exports = ScrapingBeeClient;