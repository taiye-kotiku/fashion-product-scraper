// src/integrations/ScrapingBeeClient.js
const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');
const { parsePrice } = require('../utils/helpers');

class ScrapingBeeClient {
  constructor() {
    this.apiKey = process.env.SCRAPINGBEE_API_KEY;
    this.baseUrl = 'https://app.scrapingbee.com/api/v1';
    this.requestTimeout = 120000;
  }

  isConfigured() {
    return !!this.apiKey;
  }

  async getPage(url, options = {}) {
    if (!this.apiKey) throw new Error('SCRAPINGBEE_API_KEY not configured');
    logger.info(`ScrapingBee: Fetching ${url}`);

    const params = {
      api_key: this.apiKey,
      url,
      render_js: true,
      premium_proxy: options.premiumProxy !== false,
      country_code: 'us',
      wait: options.wait || 5000,
      wait_browser: options.waitBrowser || 'domcontentloaded',
      ...options.params
    };

    try {
      const response = await axios.get(this.baseUrl, {
        params,
        timeout: this.requestTimeout
      });

      const html = response.data;
      if (!html || typeof html !== 'string') throw new Error('Empty response');
      if (html.length < 500) throw new Error(`Response too short: ${html.length} bytes`);

      const lowerHtml = html.substring(0, 3000).toLowerCase();
      const errorIndicators = ['access denied', 'please verify you are', 'bot detected', '403 forbidden'];
      for (const indicator of errorIndicators) {
        if (lowerHtml.includes(indicator)) {
          const hasContent = lowerHtml.includes('product') || lowerHtml.includes('item') ||
                            lowerHtml.includes('price') || lowerHtml.includes('graphic') ||
                            lowerHtml.includes('shirt') || lowerHtml.includes('tee');
          if (!hasContent) throw new Error(`Error page (contains "${indicator}")`);
        }
      }

      logger.info(`ScrapingBee: Success (${html.length} bytes)`);
      return html;
    } catch (error) {
      if (error.response) {
        const status = error.response.status;
        const data = typeof error.response.data === 'string' ? error.response.data.substring(0, 200) : '';
        throw new Error(`ScrapingBee HTTP ${status}: ${data || error.message}`);
      }
      throw error;
    }
  }

  async extractProducts(url, siteName) {
    const siteKey = siteName.toLowerCase().replace(/\s+/g, '');

    const siteConfig = {
      boohooman: { wait: 8000, waitBrowser: 'networkidle2', premiumProxy: true },
      boohoo:    { wait: 8000, waitBrowser: 'networkidle2', premiumProxy: true },
      snipes:    { wait: 6000, waitBrowser: 'networkidle0', premiumProxy: true },
      next:      { wait: 6000, waitBrowser: 'networkidle2', premiumProxy: true },
      abercrombie: { wait: 6000, waitBrowser: 'networkidle2', premiumProxy: true },
      anthropologie: { wait: 5000, waitBrowser: 'networkidle2', premiumProxy: true }
    };

    const config = siteConfig[siteKey] || { wait: 5000 };
    const html = await this.getPage(url, config);
    const $ = cheerio.load(html);
    let products = [];

    if (siteKey === 'snipes') {
      products = this.extractSnipes($, url, html);
    } else if (siteKey === 'abercrombie') {
      products = this.extractAbercrombie($, url, html);
    } else if (siteKey === 'next') {
      products = this.extractNext($, url, html);
    } else if (siteKey === 'boohooman' || siteKey === 'boohoo') {
      products = this.extractBoohoo($, url, html);
    } else {
      products = this.extractGeneric($, url, {
        container: '[class*="product"], article, .card',
        link: 'a[href]',
        name: 'h2, h3, h4, [class*="name"], [class*="title"]',
        price: '[class*="price"]',
        skipUrls: ['/cart', '/login', '/account']
      });
    }

    logger.info(`ScrapingBee: Extracted ${products.length} products from ${siteName}`);
    return products;
  }

  // ─── Boohoo Man ─────────────────────────────────────────────────────

  extractBoohoo($, baseUrl, html) {
    const products = [];
    const seenUrls = new Set();
    const seenNames = new Set();

    // Strategy 1: Product tiles with data attributes
    $('[data-product-id], [data-pid], .product-tile, .b-product_tile').each((i, el) => {
      try {
        const $el = $(el);
        const $link = $el.find('a[href*=".html"]').first();
        if (!$link.length) return;

        let href = $link.attr('href') || '';
        if (href.startsWith('/')) href = 'https://www.boohooman.com' + href;
        if (!href.includes('.html')) return;

        const cleanUrl = href.split('?')[0].toLowerCase();
        if (seenUrls.has(cleanUrl)) return;

        const skuMatch = href.match(/([A-Z]{2,6}\d{3,8})\.html/i);
        const sku = skuMatch ? skuMatch[1].toUpperCase() : '';

        let name = $el.find('.b-product_tile-name, .product-name, [class*="productName"]').first().text().trim();
        if (!name) name = $link.attr('title') || $link.attr('aria-label') || '';
        if (!name && sku) {
          const slugMatch = href.match(/\/([a-z0-9-]{10,})\/[A-Z]/i);
          if (slugMatch) name = slugMatch[1].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        }

        if (!name || name.length < 5) return;
        const normalizedName = name.toLowerCase().trim();
        if (seenNames.has(normalizedName)) return;

        let imageUrl = '';
        const $img = $el.find('img').first();
        if ($img.length) {
          imageUrl = $img.attr('data-src') || $img.attr('src') || '';
          if (imageUrl.startsWith('data:')) imageUrl = '';
        }
        if (!imageUrl && sku) {
          imageUrl = `https://media.boohooman.com/i/boohooman/${sku.toLowerCase()}_xl?fmt=auto`;
        }
        if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;

        const priceText = $el.find('.b-price, .price, [class*="price"]').first().text().trim().split('\n')[0];

        seenUrls.add(cleanUrl);
        seenNames.add(normalizedName);
        products.push({ name, productUrl: href.split('?')[0], imageUrl, priceFormatted: priceText, price: parsePrice(priceText), sku });
      } catch {}
    });

    // Strategy 2: Any anchor with SKU pattern
    if (products.length === 0) {
      $('a[href*=".html"]').each((i, el) => {
        try {
          const $link = $(el);
          let href = $link.attr('href') || '';
          if (href.startsWith('/')) href = 'https://www.boohooman.com' + href;

          const skuMatch = href.match(/([A-Z]{2,6}\d{3,8})\.html/i);
          if (!skuMatch) return;

          const sku = skuMatch[1].toUpperCase();
          const cleanUrl = href.split('?')[0].toLowerCase();
          if (seenUrls.has(cleanUrl)) return;
          if (href.match(/\/(customer-service|help|delivery|returns|wishlist|login|account|page\/)/i)) return;

          let name = $link.attr('title') || $link.attr('aria-label') || '';
          if (!name) {
            const slugMatch = href.match(/\/([a-z0-9-]{10,})\/[A-Z]/i);
            if (slugMatch) name = slugMatch[1].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          }
          if (!name || name.length < 5) return;
          const normalizedName = name.toLowerCase().trim();
          if (seenNames.has(normalizedName)) return;

          const imageUrl = `https://media.boohooman.com/i/boohooman/${sku.toLowerCase()}_xl?fmt=auto`;

          seenUrls.add(cleanUrl);
          seenNames.add(normalizedName);
          products.push({ name, productUrl: href.split('?')[0], imageUrl, priceFormatted: '', price: null, sku });
        } catch {}
      });
    }

    // Strategy 3: JSON-LD
    if (products.length === 0) {
      this.extractFromJsonLd($, products, seenUrls, seenNames, 'https://www.boohooman.com');
    }

    if (products.length === 0) {
      logger.warn(`Boohoo: 0 products from ${html.length} bytes`);
      const allLinks = [];
      $('a[href*="/us/"]').slice(0, 10).each((i, el) => {
        allLinks.push($(el).attr('href')?.substring(0, 80) || '');
      });
      logger.debug(`Boohoo sample links: ${allLinks.join(', ')}`);
    }

    return products;
  }

  // ─── Next ────────────────────────────────────────────────────────────

  extractNext($, baseUrl, html) {
    const products = [];
    const seenUrls = new Set();

    // Strategy 1: Product cards
    $('[class*="MuiCard"], [class*="ProductCard"], article[class*="product"], [data-testid*="product"]').each((i, el) => {
      try {
        const $card = $(el);
        const $link = $card.find('a[href*="/style/"]').first();
        if (!$link.length) return;

        let href = $link.attr('href');
        if (!href) return;
        const cleanUrl = href.split('#')[0].split('?')[0].toLowerCase();
        if (seenUrls.has(cleanUrl)) return;

        const itemCodeMatch = href.match(/\/([a-z]\d{5,})/i);
        const itemCode = itemCodeMatch ? itemCodeMatch[1].toUpperCase() : '';

        let name = '';
        $card.find('h2, h3, h4, [class*="Title"], [class*="title"], [class*="Name"]').each((j, nameEl) => {
          const text = $(nameEl).text().trim();
          if (text.length >= 10 && text.length <= 200 && !name) {
            if (!text.match(/^\$/) && !text.match(/^(NEW IN|SALE)/i)) {
              name = text;
              return false;
            }
          }
        });

        if (!name) {
          const lines = $card.text().split('\n').map(l => l.trim()).filter(l => l.length > 0);
          for (const line of lines) {
            if (line.match(/^(NEW IN|SALE|BESTSELLER|LOW STOCK)/i)) continue;
            if (line.match(/^\$[\d,.]+/) || line.match(/^[\d]+ for \$/)) continue;
            if (line.match(/^\(\d+.*reviews?\)/i)) continue;
            if (line.length >= 10 && line.length <= 200) { name = line; break; }
          }
        }

        if (!name || name.length < 5) return;

        let priceText = '';
        const $price = $card.find('[class*="rice"]').first();
        if ($price.length) priceText = $price.text().trim().split('\n')[0];

        let imageUrl = '';
        $card.find('img').each((j, imgEl) => {
          const src = $(imgEl).attr('src') || $(imgEl).attr('data-src') || '';
          if (!src) return;
          if (src.includes('/ph.jpg') || src.includes('placeholder') || src.includes('21x21') || src.includes('Swatch') || src.startsWith('data:')) return;
          if (src.length > 30) { imageUrl = src; return false; }
        });

        if (!imageUrl && itemCode) {
          imageUrl = `https://xcdn.next.co.uk/Common/Items/Default/Default/ItemImages/3_4Ratio/SearchINT/Lge/${itemCode}.jpg`;
        }

        if (href.startsWith('/')) href = 'https://www.next.us' + href;

        seenUrls.add(cleanUrl);
        products.push({ name, productUrl: href.split('#')[0].split('?')[0], imageUrl, priceFormatted: priceText, price: parsePrice(priceText), itemCode });
      } catch {}
    });

    // Strategy 2: Direct /style/ links
    if (products.length < 5) {
      $('a[href*="/style/"]').each((i, el) => {
        try {
          const $link = $(el);
          let href = $link.attr('href');
          if (!href) return;
          const cleanUrl = href.split('#')[0].split('?')[0].toLowerCase();
          if (seenUrls.has(cleanUrl)) return;

          const itemCodeMatch = href.match(/\/([a-z]\d{5,})/i);
          const itemCode = itemCodeMatch ? itemCodeMatch[1].toUpperCase() : '';

          let name = $link.attr('title') || $link.attr('aria-label') || '';
          if (!name || name.length < 5) {
            const $parent = $link.parent().parent().parent();
            const parentText = $parent.text().trim().split('\n').map(l => l.trim()).filter(l => l.length >= 10);
            for (const line of parentText) {
              if (line.match(/^(NEW|SALE|\$)/i)) continue;
              if (line.length <= 200) { name = line; break; }
            }
          }
          if (!name || name.length < 5) return;

          let imageUrl = '';
          if (itemCode) {
            imageUrl = `https://xcdn.next.co.uk/Common/Items/Default/Default/ItemImages/3_4Ratio/SearchINT/Lge/${itemCode}.jpg`;
          }

          if (href.startsWith('/')) href = 'https://www.next.us' + href;

          seenUrls.add(cleanUrl);
          products.push({ name, productUrl: href.split('#')[0].split('?')[0], imageUrl, priceFormatted: '', price: null, itemCode });
        } catch {}
      });
    }

    // Strategy 3: __NEXT_DATA__ JSON
    if (products.length === 0) {
      try {
        const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (match) {
          const nextData = JSON.parse(match[1]);
          this.extractFromNextData(nextData, products, seenUrls);
        }
      } catch (e) {
        logger.debug(`Next __NEXT_DATA__ fallback failed: ${e.message}`);
      }
    }

    return products;
  }

  extractFromNextData(data, products, seenUrls, depth = 0) {
    if (!data || typeof data !== 'object' || depth > 15) return;

    if (data.name && typeof data.name === 'string' &&
        data.name.length >= 10 && data.name.length <= 200 &&
        (data.url || data.href || data.slug || data.itemCode)) {
      const url = data.url || data.href || (data.slug ? `/style/${data.slug}` : (data.itemCode ? `/style/${data.itemCode}` : ''));
      const cleanUrl = url.split('?')[0].toLowerCase();

      if (!seenUrls.has(cleanUrl)) {
        seenUrls.add(cleanUrl);
        products.push({
          name: data.name,
          productUrl: url.startsWith('http') ? url : `https://www.next.us${url}`,
          imageUrl: data.image || data.imageUrl || data.thumbnail || '',
          priceFormatted: data.price || data.formattedPrice || '',
          price: parsePrice(data.price || data.formattedPrice)
        });
      }
    }

    if (Array.isArray(data)) {
      for (const item of data.slice(0, 200)) this.extractFromNextData(item, products, seenUrls, depth + 1);
    } else {
      for (const key of Object.keys(data)) {
        if (typeof data[key] === 'object' && data[key] !== null) this.extractFromNextData(data[key], products, seenUrls, depth + 1);
      }
    }
  }

  
  extractFromNextData(data, products, seenUrls, seenNames, depth = 0) {
    if (!data || typeof data !== 'object' || depth > 15) return;

    if (data.name && typeof data.name === 'string' &&
        data.name.length >= 10 && data.name.length <= 200 &&
        (data.url || data.href || data.slug || data.itemCode)) {
      const url = data.url || data.href || (data.slug ? `/style/${data.slug}` : (data.itemCode ? `/style/${data.itemCode}` : ''));
      const cleanUrl = url.split('?')[0].toLowerCase();
      const normalizedName = data.name.toLowerCase().replace(/\s+/g, ' ').trim();

      if (!seenUrls.has(cleanUrl) && !seenNames.has(normalizedName)) {
        seenUrls.add(cleanUrl);
        seenNames.add(normalizedName);
        products.push({
          name: data.name,
          productUrl: url.startsWith('http') ? url : `https://www.next.us${url}`,
          imageUrl: data.image || data.imageUrl || data.thumbnail || '',
          priceFormatted: data.price || data.formattedPrice || '',
          price: parsePrice(data.price || data.formattedPrice)
        });
      }
    }

    if (Array.isArray(data)) {
      for (const item of data.slice(0, 200)) this.extractFromNextData(item, products, seenUrls, seenNames, depth + 1);
    } else {
      for (const key of Object.keys(data)) {
        if (typeof data[key] === 'object' && data[key] !== null) this.extractFromNextData(data[key], products, seenUrls, seenNames, depth + 1);
      }
    }
  }

  // ─── Abercrombie ─────────────────────────────────────────────────────

  extractAbercrombie($, baseUrl, html) {
    const products = [];
    const seenUrls = new Set();
    const seenNames = new Set();
    const baseOrigin = 'https://www.abercrombie.com';

    $('a[href*="/p/"]').each((i, el) => {
      try {
        const $link = $(el);
        let href = $link.attr('href') || '';
        if (!href) return;

        const cleanUrl = href.split('?')[0].toLowerCase();
        if (seenUrls.has(cleanUrl)) return;

        const urlMatch = href.match(/\/p\/([a-z0-9-]+?)(?:-(\d{6,}))?(?:\?|$)/i);
        if (!urlMatch) return;

        let name = urlMatch[1].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        if (name.length < 3) return;

        const $card = $link.closest('[class*="productCard"], [class*="product-card"], [class*="ProductCard"]');
        if ($card.length) {
          const $nameEl = $card.find('[class*="productName"], [class*="product-name"], [class*="titleText"]').first();
          if ($nameEl.length) {
            const cardName = $nameEl.text().trim();
            if (cardName.length >= 3) name = cardName;
          }
        }

        const normalizedName = name.toLowerCase().replace(/\s+/g, ' ').trim();
        if (seenNames.has(normalizedName)) return;

        let imageUrl = '';
        const $ctx = $card.length ? $card : $link;
        const $img = $ctx.find('img').first();
        if ($img.length) imageUrl = $img.attr('src') || $img.attr('data-src') || '';
        if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
        if (imageUrl.startsWith('data:') || imageUrl.length < 20) imageUrl = '';

        if (href.startsWith('/')) href = baseOrigin + href;

        seenUrls.add(cleanUrl);
        seenNames.add(normalizedName);
        products.push({ name, productUrl: href.split('?')[0], imageUrl, priceFormatted: '', price: null, productId: urlMatch[2] || '' });
      } catch {}
    });

    if (products.length === 0) this.extractFromJsonLd($, products, seenUrls, seenNames, baseOrigin);

    if (products.length === 0) {
      try {
        $('script:not([src]):not([type="application/ld+json"])').each((i, el) => {
          const content = $(el).html() || '';
          if (!content.includes('"products"') && !content.includes('"productId"')) return;
          const matches = content.matchAll(/"name"\s*:\s*"([^"]{10,150})"/g);
          for (const match of matches) {
            const name = match[1];
            if (!name || name.length < 5) continue;
            const normalizedName = name.toLowerCase().replace(/\s+/g, ' ').trim();
            if (!seenNames.has(normalizedName) && name.match(/[a-zA-Z]{3}/)) {
              seenNames.add(normalizedName);
              products.push({ name, productUrl: '', imageUrl: '', priceFormatted: '', price: null });
            }
          }
          if (products.length > 0) return false;
        });
      } catch {}
    }

    if (products.length === 0) {
      logger.warn(`Abercrombie: 0 products from ${html.length} bytes`);
      const links = [];
      $('a[href*="/shop/"], a[href*="/p/"]').slice(0, 10).each((i, el) => {
        links.push($(el).attr('href')?.substring(0, 80) || '');
      });
      if (links.length > 0) logger.debug(`Abercrombie sample links: ${links.join(', ')}`);
    }

    return products;
  }

  // ─── Snipes ──────────────────────────────────────────────────────────

  extractSnipes($, baseUrl, html) {
    const products = [];
    const seenUrls = new Set();

    $('.product-tile, .product-card, [data-product-id], .grid-tile').each((i, el) => {
      try {
        const $el = $(el);
        const $link = $el.find('a[href*="/product"], a[href]').first();
        const href = $link.attr('href');
        if (!href || seenUrls.has(href)) return;

        let name = $el.find('.product-name, .product-title, [class*="name"], h2, h3').first().text().trim();
        if (!name) name = $link.attr('title') || $link.text().trim();
        if (!name || name.length < 5) return;

        const priceText = $el.find('.price, [class*="price"]').first().text().trim();
        let imageUrl = '';
        const $img = $el.find('img').first();
        if ($img.length) imageUrl = $img.attr('data-src') || $img.attr('src') || '';
        if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;

        seenUrls.add(href);
        products.push({
          name,
          productUrl: href.startsWith('http') ? href : new URL(href, baseUrl).href,
          imageUrl,
          priceFormatted: priceText,
          price: parsePrice(priceText)
        });
      } catch {}
    });

    return products;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  extractFromJsonLd($, products, seenUrls, seenNames, baseOrigin) {
    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const data = JSON.parse($(el).html());
        const items = [];

        if (data['@type'] === 'ItemList' && data.itemListElement) {
          data.itemListElement.forEach(item => {
            const p = item.item || item;
            if (p['@type'] === 'Product' && p.name) items.push(p);
          });
        }
        if (data['@type'] === 'Product' && data.name) items.push(data);
        if (data['@graph']) data['@graph'].filter(i => i['@type'] === 'Product' && i.name).forEach(i => items.push(i));

        items.forEach(item => {
          const normalizedName = item.name.toLowerCase().replace(/\s+/g, ' ').trim();
          if (seenNames.has(normalizedName)) return;

          const url = item.url || item.offers?.url || '';
          const cleanUrl = url.split('?')[0].toLowerCase();
          if (cleanUrl && seenUrls.has(cleanUrl)) return;

          const image = Array.isArray(item.image) ? item.image[0] : (item.image || '');
          const priceText = item.offers?.price ? `$${item.offers.price}` : '';

          if (cleanUrl) seenUrls.add(cleanUrl);
          seenNames.add(normalizedName);
          products.push({
            name: item.name,
            productUrl: url.startsWith('http') ? url : `${baseOrigin}${url}`,
            imageUrl: image,
            priceFormatted: priceText,
            price: parsePrice(priceText)
          });
        });
      } catch {}
    });
  }

  extractGeneric($, baseUrl, cfg) {
    const products = [];
    const seen = new Set();

    $(cfg.container).each((i, el) => {
      try {
        const $el = $(el);
        const link = cfg.link ? $el.find(cfg.link).first() : $el.find('a[href]').first();
        const href = link.attr('href');
        if (!href || seen.has(href)) return;
        if (cfg.skipUrls?.some(p => href.toLowerCase().includes(p))) return;

        let name = cfg.name ? $el.find(cfg.name).first().text().trim() : '';
        if (!name && cfg.nameFromLink) name = link.attr('title') || link.text().trim();
        if (!name || name.length < 5 || name.length > 200) return;

        const priceText = cfg.price ? $el.find(cfg.price).first().text().trim() : '';
        let imageUrl = '';
        const $img = $el.find('img').first();
        if ($img.length) imageUrl = $img.attr('data-src') || $img.attr('src') || '';
        if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;

        seen.add(href);
        products.push({
          name,
          productUrl: href.startsWith('http') ? href : new URL(href, baseUrl).href,
          imageUrl,
          priceFormatted: priceText,
          price: parsePrice(priceText)
        });
      } catch {}
    });

    return products;
  }
}

module.exports = ScrapingBeeClient;