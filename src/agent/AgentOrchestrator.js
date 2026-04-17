// src/agent/AgentOrchestrator.js
const VisionAnalyzer = require('./VisionAnalyzer');
const DOMAnalyzer = require('./DOMAnalyzer');
const PatternLearner = require('./PatternLearner');
const SelfHealer = require('./SelfHealer');
const StrategySelector = require('../strategies/StrategySelector');
const BrowserManager = require('../browser/BrowserManager');
const InteractionManager = require('../browser/InteractionManager');
const ScrapingBeeClient = require('../integrations/ScrapingBeeClient');
const ProductValidator = require('../processors/ProductValidator');
const sitesConfig = require('../config/sites');
const config = require('../config');
const logger = require('../utils/logger');
const { delay } = require('../utils/helpers');

class AgentOrchestrator {
  constructor(options = {}) {
    this.visionAnalyzer = new VisionAnalyzer();
    this.domAnalyzer = new DOMAnalyzer();
    this.patternLearner = new PatternLearner();
    this.selfHealer = new SelfHealer();
    this.strategySelector = new StrategySelector();
    this.browserManager = new BrowserManager();
    this.interactionManager = new InteractionManager();
    this.scrapingBee = new ScrapingBeeClient();
    this.productValidator = ProductValidator;
    this.isShuttingDown = false;

    this.config = {
      maxRetries: config.agent.maxRetries,
      confidenceThreshold: config.agent.confidenceThreshold,
      enableLearning: config.agent.enableLearning,
      scrapeTimeout: 120000,
      ...options
    };
  }

  async initialize() {
    logger.section('Initializing AI Agent');
    await this.browserManager.launch();
    await this.patternLearner.loadPatterns();
    logger.info('Agent initialized successfully');
  }

  async scrapeSite(siteConfig) {
    const timeout = siteConfig.timeout || this.config.scrapeTimeout;
    return Promise.race([
      this._scrapeSiteInternal(siteConfig),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Scrape timeout after ${timeout}ms for ${siteConfig.name} - ${siteConfig.category}`)), timeout)
      )
    ]);
  }

  async _scrapeSiteInternal(siteConfig) {
    const { name, url, category } = siteConfig;
    logger.subsection(`Scraping: ${name} - ${category}`);

    const context = { site: name, category, url, attempts: 0, startTime: Date.now() };
    const siteInfo = sitesConfig.getSiteByName(name);

    // ScrapingBee-primary sites
    if (siteInfo?.useScrapingBee) {
      return await this.scrapeWithScrapingBee(siteConfig, context);
    }

    // Browser-based extraction
    let page = null;
    try {
      page = await this.browserManager.newPage();
      await this.browserManager.navigateWithRetry(page, url);

      await this.interactionManager.closePopups(page);
      await this.interactionManager.acceptCookies(page);
      await delay(1000);

      // Check if we hit a bot detection page before wasting time scrolling
      const pageTitle = await page.title().catch(() => '');
      const isBlocked = pageTitle.toLowerCase().includes('access denied') ||
                        pageTitle.toLowerCase().includes('blocked') ||
                        pageTitle.toLowerCase().includes('captcha');

      if (isBlocked) {
        logger.warn(`Bot detection detected on ${name}. Skipping browser extraction.`);
        if (siteInfo?.scrapingBeeFallback && this.scrapingBee.isConfigured()) {
          logger.info(`Going directly to ScrapingBee fallback for ${name}...`);
          return await this.scrapeWithScrapingBee(siteConfig, context);
        }
        return [];
      }

      await this.browserManager.waitForProducts(page);

      // Try scrolling but don't let it block forever
      try {
        await this.handlePageLoading(page, context);
      } catch (scrollErr) {
        logger.warn(`Scroll error on ${name}: ${scrollErr.message}`);
      }

      const directProducts = await this.extractProductsDirectly(page, context);
      if (directProducts.length >= 3) {
        logger.info(`Direct extraction found ${directProducts.length} products`);
        if (this.config.enableLearning) {
          await this.patternLearner.recordSuccess(context, { name: 'direct-dom' }, directProducts);
        }
        return directProducts;
      }

      // Browser found too few — try ScrapingBee fallback immediately (don't run full strategy pipeline)
      if (siteInfo?.scrapingBeeFallback && this.scrapingBee.isConfigured()) {
        logger.info(`Browser found only ${directProducts.length} products. Trying ScrapingBee fallback...`);
        try {
          const sbProducts = await this.scrapeWithScrapingBee(siteConfig, context);
          if (sbProducts.length > directProducts.length) {
            return sbProducts;
          }
        } catch (sbError) {
          logger.warn(`ScrapingBee fallback failed: ${sbError.message}`);
        }
        // Return whatever we have
        if (directProducts.length > 0) return directProducts;
      }

      // No fallback available or both failed — try full strategy pipeline
      if (directProducts.length > 0) return directProducts;

      const pageAnalysis = await this.analyzePage(page);
      const pattern = await this.patternLearner.getPattern(context.site);

      let strategy;
      if (pattern && pattern.confidence > 0.8) {
        logger.info(`Using learned pattern (confidence: ${pattern.confidence.toFixed(2)})`);
        strategy = this.strategySelector.fromPattern(pattern);
      } else {
        strategy = this.strategySelector.choose(pageAnalysis, context);
      }

      logger.info(`Selected strategy: ${strategy.name}`);

      const extraction = await strategy.extract(page, context);
      const validatedProducts = await this.validateAndHeal(page, extraction, context);

      if (this.config.enableLearning && validatedProducts.length > 0) {
        await this.patternLearner.recordSuccess(context, strategy, validatedProducts);
      }

      logger.info(`Extracted ${validatedProducts.length} products`);
      return validatedProducts;
    } catch (error) {
      logger.error(`Extraction failed for ${name} - ${category}: ${error.message}`);

      if (siteInfo?.scrapingBeeFallback && this.scrapingBee.isConfigured()) {
        logger.info(`Browser failed. Trying ScrapingBee as last resort...`);
        try {
          return await this.scrapeWithScrapingBee(siteConfig, context);
        } catch (sbError) {
          logger.warn(`ScrapingBee last resort also failed: ${sbError.message}`);
        }
      }

      await this.patternLearner.recordFailure(context, error);
      throw error;
    } finally {
      if (page) await this.browserManager.closePage(page);
    }
  }
  
  async scrapeWithScrapingBee(siteConfig, context) {
    const { name, url, category } = siteConfig;

    if (!this.scrapingBee.isConfigured()) {
      logger.warn(`ScrapingBee not configured. Skipping ${name}`);
      return [];
    }

    logger.info(`Using ScrapingBee for ${name}`);

    try {
      const products = await this.scrapingBee.extractProducts(url, name);
      const validated = this.productValidator.filterProducts(products);
      const enriched = validated.map(p => ({
        ...p,
        source: name,
        category,
        scrapedAt: new Date().toISOString()
      }));
      logger.info(`ScrapingBee: ${enriched.length} valid products from ${name}`);
      return enriched;
    } catch (error) {
      logger.error(`ScrapingBee failed for ${name}: ${error.message}`);
      return [];
    }
  }

  async extractProductsDirectly(page, context) {
    const baseUrl = await page.url();

    const rawProducts = await page.evaluate(() => {
      const results = [];
      const seenUrls = new Set();

      // ---------------------------------------------------------------------------
      // Shared image extractor: checks all lazy-load data-* attrs and native srcset
      // ---------------------------------------------------------------------------
      function getBestImageUrl(container) {
        const SKIP = /placeholder|swatch|blank\.|spacer|pixel\.|1x1|transparent|loading|spinner|no-image|coming-soon/i;

        function parseSrcset(s) {
          if (!s) return '';
          const parts = s.split(',')
            .map(p => p.trim().split(/\s+/)[0])
            .filter(u => u && (u.startsWith('http') || u.startsWith('//')));
          return parts.length ? parts[parts.length - 1] : '';
        }

        const imgs = container.querySelectorAll('img');
        for (const img of imgs) {
          // Skip tiny icon/layout images
          const w = img.naturalWidth  || parseInt(img.getAttribute('width')  || '0');
          const h = img.naturalHeight || parseInt(img.getAttribute('height') || '0');
          if ((w > 0 && w < 50) || (h > 0 && h < 50)) continue;

          const candidates = [
            img.getAttribute('data-src'),
            img.getAttribute('data-lazy-src'),
            img.getAttribute('data-lazysrc'),
            img.getAttribute('data-original'),
            img.getAttribute('data-image'),
            img.getAttribute('data-zoom-image'),
            img.getAttribute('data-full-src'),
            parseSrcset(img.getAttribute('data-srcset')),
            parseSrcset(img.getAttribute('srcset')),
            img.src
          ];

          for (const c of candidates) {
            if (c && c.length > 20 && !c.startsWith('data:') && !SKIP.test(c)) {
              return c.startsWith('//') ? 'https:' + c : c;
            }
          }
        }
        return '';
      }
      // ---------------------------------------------------------------------------

      const hostname = window.location.hostname;
      const isRiverIsland = hostname.includes('riverisland.com');
      const isBoohoo = hostname.includes('boohooman.com');
      const isNext = hostname.includes('next.us') || hostname.includes('next.co');

      if (isBoohoo) {
        const containers = document.querySelectorAll(
          '.product-tile, [data-test-id="productTile"], [class*="productTile"], [class*="product-card"], [data-component="product"], [data-product-id], [data-pid], .b-product_tile'
        );

        const elements = containers.length > 0
          ? containers
          : document.querySelectorAll('a[href*=".html"][href*="/us/"]');

        elements.forEach(el => {
          try {
            let link = el.tagName === 'A' ? el : el.querySelector('a[href*=".html"]');
            if (!link) link = el.querySelector('a[href*="/us/"]');
            if (!link) return;

            const href = link.href;
            if (!href) return;

            const cleanUrl = href.split('?')[0].toLowerCase();
            if (seenUrls.has(cleanUrl)) return;
            if (href.includes('/page/') || href.includes('/customer-service') || href.includes('/help')) return;

            // Only SKU-patterned URLs are real product pages (e.g. /BMM12345.html)
            // Broad path includes like '/us/mens/' also match category pages — excluded
            const isProductUrl = href.match(/\/[A-Z]{2,4}\d{4,}\.html/i);
            if (!isProductUrl) return;

            const skuMatch = href.match(/\/([A-Z]{2,4}\d{4,})\.html/i);
            const sku = skuMatch ? skuMatch[1] : '';

            let container = el;
            for (let i = 0; i < 6; i++) {
              if (!container.parentElement) break;
              container = container.parentElement;
              const cls = container.className || '';
              if (cls.includes('product') || cls.includes('tile') || cls.includes('card')) break;
            }

            let name = '', price = '';
            const text = container.innerText || el.innerText || '';
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

            for (const line of lines) {
              if (line.match(/^\$[\d,.]+/) || line.match(/^[\d,.]+\s*$/)) {
                if (!price) price = line;
                continue;
              }
              if (line.match(/^(add to|quick view|extended sizes|notify me|new in|color|colour)/i)) continue;
              if (line.length >= 10 && line.length <= 200 && !name) name = line;
            }

            if (!name || name.length < 5) {
              const urlMatch = href.match(/\/([a-z0-9-]+)\/[A-Z]{2,4}\d+\.html/i);
              if (urlMatch) {
                name = urlMatch[1].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
              }
            }

            if (!name || name.length < 5) return;

            let imageUrl = '';
            // 1. Prefer explicit hidden-input URL (most reliable on Boohoo)
            const hiddenInput = container.querySelector(
              '.js-primary-image-default-url, input[class*="primary-image"], input[name*="image"]'
            );
            if (hiddenInput) imageUrl = hiddenInput.value || '';

            // 2. Walk all img tags with full lazy-load attribute coverage
            if (!imageUrl) imageUrl = getBestImageUrl(container);

            // 3. Construct from SKU as last resort
            if (!imageUrl && sku) {
              imageUrl = `https://media.boohooman.com/i/boohooman/${sku.toLowerCase()}_xl?fmt=auto`;
            }

            if (imageUrl && imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;

            seenUrls.add(cleanUrl);
            results.push({ name, productUrl: href.split('?')[0], imageUrl, priceFormatted: price, sku });
          } catch {}
        });
      } else if (isRiverIsland) {
        const productLinks = document.querySelectorAll('a[href*="/p/"]');

        productLinks.forEach(link => {
          try {
            const href = link.href;
            if (!href) return;

            const productIdMatch = href.match(/\/p\/[a-z0-9-]+-(\d{4,})/i);
            if (!productIdMatch) return;

            const productId = productIdMatch[1];
            const cleanUrl = href.split('?')[0].toLowerCase();
            if (seenUrls.has(cleanUrl)) return;

            if (href.includes('how-can-we-help') || href.includes('product-recalls') ||
                href.includes('products-sizing') || href.includes('delivery-information')) return;

            let name = '', price = '';
            const linkText = link.innerText?.trim() || '';

            if (linkText) {
              const lines = linkText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
              for (const line of lines) {
                if (line.match(/^[\$£€₦]\s*[\d,]+/) || line.match(/^[\d,]+\s*[\$£€₦]/) ||
                    line.match(/^[\$£€₦][\d,.]+\s*[-–]\s*[\$£€₦]?[\d,.]+/)) {
                  if (!price) price = line;
                  continue;
                }
                if (line.match(/^(PLUS|PETITE|TALL|MATERNITY|\d+-\d+\s*YEARS)/i)) continue;
                // Skip single-word/short marketing labels (exact or prefix)
                if (line.match(/^(new|sale|trending|limited|exclusive)$/i)) continue;
                if (line.match(/^(new in|new arrival|new arrivals|just landed|just arrived|back in stock|coming soon|low stock)/i)) continue;
                if (line.match(/^(wishlist|add to bag|quick buy|quick view|add to wishlist)/i)) continue;
                if (line.match(/^\d+ colou?rs?$/i)) continue;
                if (line.match(/^(black|white|blue|red|green|pink|grey|gray|navy|cream|beige|yellow|orange|purple|brown)(\s*\/\s*(black|white|blue|red|green|pink|grey|gray|navy|cream))?$/i)) continue;

                if (line.length >= 8 && line.length <= 150 && !name) {
                  name = line;
                }
              }
            }

            if (!name || name.length < 5) {
              const urlMatch = href.match(/\/p\/([a-z0-9-]+)-\d+/i);
              if (urlMatch) {
                name = urlMatch[1].split('-')
                  .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                  .join(' ');
              }
            }

            if (!name || name.length < 5) return;

            // Use shared extractor (checks data-src, data-lazy-src, srcset, etc.)
            let imageUrl = getBestImageUrl(link);

            // Construct from Cloudinary CDN pattern if no image found in DOM
            if (!imageUrl && productId) {
              imageUrl = `https://images.riverisland.com/image/upload/t_plp_portraitSmall/f_auto/q_auto/${productId}_main`;
            }

            seenUrls.add(cleanUrl);
            results.push({ name, productUrl: href.split('?')[0], imageUrl, priceFormatted: price, productId });
          } catch {}
        });
      } else if (isNext) {
        const cards = document.querySelectorAll(
          '[class*="MuiCard-root"], [data-testid*="product-card"], [class*="ProductCard"], article[class*="product"]'
        );

        cards.forEach(card => {
          try {
            const link = card.querySelector('a[href*="/style/"]');
            if (!link) return;
            const href = link.href;
            const cleanUrl = href.split('#')[0].split('?')[0].toLowerCase();
            if (seenUrls.has(cleanUrl)) return;

            const itemCodeMatch = href.match(/\/([a-z]\d{5,})/i);
            const itemCode = itemCodeMatch ? itemCodeMatch[1].toUpperCase() : '';

            let name = '', price = '';
            const lines = (card.innerText?.trim() || '').split('\n').map(l => l.trim()).filter(l => l.length > 0);
            for (const line of lines) {
              if (line.match(/^(NEW IN|SALE|BESTSELLER|LOW STOCK)/i)) continue;
              if (line.match(/^\$[\d,]+\s*-?\s*\$?[\d,]*/) || line.match(/^\$[\d,.]+$/)) {
                if (!price) price = line;
                continue;
              }
              if (line.match(/^\(\d+.*\)$/)) continue;
              if (line.length >= 10 && line.length <= 200 && !name) name = line;
            }
            if (!name || name.length < 5) return;

            // getBestImageUrl handles lazy-load attrs + srcset; Next uses xcdn CDN
            let imageUrl = getBestImageUrl(card);

            // Validate it looks like a real Next product image; reject tiny/placeholder CDN paths
            if (imageUrl && (imageUrl.includes('/ph.jpg') || imageUrl.includes('21x21') || imageUrl.includes('Swatch'))) {
              imageUrl = '';
            }

            // Construct from item code when DOM image is missing/unusable
            if (!imageUrl && itemCode) {
              imageUrl = `https://xcdn.next.co.uk/Common/Items/Default/Default/ItemImages/3_4Ratio/SearchINT/Lge/${itemCode}.jpg`;
            }

            seenUrls.add(cleanUrl);
            results.push({ name, productUrl: href.split('#')[0].split('?')[0], imageUrl, priceFormatted: price, itemCode });
          } catch {}
        });
      } else if (hostname.includes('abercrombie.com')) {
        document.querySelectorAll('a[href*="/p/"]').forEach(link => {
          try {
            const href = link.href;
            if (!href) return;

            const urlMatch = href.match(/\/p\/([a-z0-9-]+?)(?:-(\d{6,}))?(?:\?|$)/i);
            if (!urlMatch) return;

            const cleanUrl = href.split('?')[0].toLowerCase();
            if (seenUrls.has(cleanUrl)) return;

            const urlSlug = urlMatch[1];
            const productId = urlMatch[2] || '';

            let name = urlSlug.split('-')
              .map(w => w.charAt(0).toUpperCase() + w.slice(1))
              .join(' ');

            let container = link;
            for (let i = 0; i < 6; i++) {
              if (!container.parentElement) break;
              container = container.parentElement;
              const cls = (container.className || '').toLowerCase();
              if (cls.includes('product') || cls.includes('card') || cls.includes('tile')) break;
            }

            const nameEl = container.querySelector(
              '[class*="productName"], [class*="product-name"], [data-auto-id="product-name"]'
            );
            if (nameEl) {
              const cardName = nameEl.textContent?.trim();
              if (cardName && cardName.length >= 3) name = cardName;
            }

            if (name.length < 3) return;

            let imageUrl = getBestImageUrl(container);

            let price = '';
            const priceEl = container.querySelector('[class*="price"]');
            if (priceEl) price = priceEl.textContent?.trim().split('\n')[0] || '';

            seenUrls.add(cleanUrl);
            results.push({
              name,
              productUrl: href.split('?')[0],
              imageUrl: imageUrl.startsWith('//') ? 'https:' + imageUrl : imageUrl,
              priceFormatted: price,
              productId
            });
          } catch {}
        });
      } else {
        document.querySelectorAll(
          'a[href*="/p/"], a[href*="/product/"], a[href*="/pd/"], .product-tile a, .product-card a'
        ).forEach(link => {
          try {
            const href = link.href;
            if (!href) return;
            const cleanUrl = href.split('?')[0].toLowerCase();
            if (seenUrls.has(cleanUrl)) return;
            if (['/cart', '/login', '/account', '/wishlist', '/c/', '/category'].some(p => href.toLowerCase().includes(p))) return;

            let container = link;
            for (let i = 0; i < 5; i++) {
              if (!container.parentElement) break;
              container = container.parentElement;
              if (container.className?.includes('product') || container.className?.includes('card')) break;
            }

            let name = '', price = '';
            const lines = (container.innerText?.trim() || '').split('\n').map(l => l.trim()).filter(l => l.length > 0);
            for (const line of lines) {
              if (line.match(/^[\$£€₦]\s*[\d,]+/)) { if (!price) price = line; continue; }
              if (line.length >= 5 && line.length <= 150 && !name) name = line;
            }
            if (!name || name.length < 5) return;

            let imageUrl = getBestImageUrl(container);

            seenUrls.add(cleanUrl);
            results.push({ name, productUrl: href.split('?')[0], imageUrl, priceFormatted: price });
          } catch {}
        });
      }

      return results;
    });

    const normalized = rawProducts.map(p => ({
      ...p,
      name: p.name?.trim(),
      price: this.parsePrice(p.priceFormatted),
      imageUrl: this.normalizeUrl(p.imageUrl, baseUrl),
      source: context.site,
      category: context.category,
      scrapedAt: new Date().toISOString()
    }));

    const validated = this.productValidator.filterProducts(normalized);

    if (validated.length === 0 && rawProducts.length > 0) {
      logger.warn(`All ${rawProducts.length} raw products were filtered. Sample raw data:`);
      rawProducts.slice(0, 3).forEach((p, i) => {
        logger.warn(`  Raw[${i}]: name="${(p.name || '').substring(0, 50)}" url="${(p.productUrl || '').substring(0, 80)}" img=${p.imageUrl ? 'yes' : 'no'}`);
      });
    }

    logger.info(`Direct extraction: ${rawProducts.length} found -> ${validated.length} valid`);
    return validated;
  }

  parsePrice(priceStr) {
    if (!priceStr) return null;
    const str = String(priceStr).trim();

    const rangeMatch = str.match(/([\$£€₦])\s*([\d,.]+)\s*[-–]\s*[\$£€₦]?\s*([\d,.]+)/);
    if (rangeMatch) {
      return this.parseNumericPrice(rangeMatch[2], rangeMatch[1]);
    }

    const singleMatch = str.match(/([\$£€₦])\s*([\d,.]+)/);
    if (singleMatch) {
      return this.parseNumericPrice(singleMatch[2], singleMatch[1]);
    }

    const plainMatch = str.match(/([\d,.]+)/);
    if (plainMatch) {
      return this.parseNumericPrice(plainMatch[1]);
    }

    return null;
  }

  parseNumericPrice(numStr, currencySymbol) {
    if (!numStr) return null;

    const dots = (numStr.match(/\./g) || []).length;
    const commas = (numStr.match(/,/g) || []).length;

    let result;

    if (dots === 1 && commas === 0) {
      result = parseFloat(numStr);
    } else if (commas === 1 && dots === 0) {
      result = parseFloat(numStr.replace(',', '.'));
    } else if (dots === 1 && commas === 1) {
      const dotPos = numStr.lastIndexOf('.');
      const commaPos = numStr.lastIndexOf(',');
      if (dotPos > commaPos) {
        result = parseFloat(numStr.replace(/,/g, ''));
      } else {
        result = parseFloat(numStr.replace(/\./g, '').replace(',', '.'));
      }
    } else if (dots > 1) {
      result = parseFloat(numStr.replace(/\./g, ''));
    } else if (commas > 1) {
      result = parseFloat(numStr.replace(/,/g, ''));
    } else {
      result = parseFloat(numStr);
    }

    if (isNaN(result)) return null;

    if (result > 500 && !numStr.includes('.') && !numStr.includes(',')) {
      const divided = result / 100;
      if (divided >= 1 && divided <= 500) {
        result = divided;
      }
    }

    return Math.round(result * 100) / 100;
  }

  normalizeUrl(url, baseUrl) {
    if (!url) return null;
    try {
      if (url.startsWith('//')) return 'https:' + url;
      if (url.startsWith('/')) return new URL(url, baseUrl).toString();
      if (url.startsWith('http')) return url;
      return null;
    } catch { return null; }
  }

  async handlePageLoading(page, context) {
    const hints = sitesConfig.getSiteHints ? sitesConfig.getSiteHints(context.site) : {};
    if (hints.scrollBehavior === 'infinite' || !hints.scrollBehavior) {
      await this.browserManager.scrollPage(page, { maxScrolls: hints.scrollCount || 3 });
    }
    if (hints.scrollBehavior === 'loadMore') {
      await this.interactionManager.clickLoadMore(page, { maxClicks: 3 });
    }
    await delay(hints.waitTime || 2000);
  }

  async analyzePage(page) {
    const analysis = { hasSchemaOrg: false, hasSemanticHTML: false, productIndicators: [], isReactApp: false };
    try {
      analysis.hasSchemaOrg = await page.evaluate(() => {
        for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
          try {
            const data = JSON.parse(script.textContent);
            if (data['@type'] === 'Product' || data['@type'] === 'ItemList' || data['@graph']?.some(i => i['@type'] === 'Product')) return true;
          } catch {}
        }
        return false;
      });
      analysis.hasSemanticHTML = await page.evaluate(() => document.querySelectorAll('[itemtype*="Product"], [data-product-id]').length > 0);
      analysis.productIndicators = await page.evaluate(() => {
        return ['[class*="product-card"]', '[class*="product-grid"]', '[class*="product-item"]', '[class*="ProductCard"]', '[data-testid*="product"]', 'article[class*="product"]']
          .map(p => ({ selector: p, count: document.querySelectorAll(p).length })).filter(p => p.count > 0);
      });
      analysis.isReactApp = await page.evaluate(() => !!(document.querySelector('[data-reactroot]') || document.querySelector('#__next') || window.__NEXT_DATA__));
    } catch (error) { logger.warn(`Page analysis error: ${error.message}`); }
    return analysis;
  }

  async validateAndHeal(page, extraction, context) {
    const { products, confidence } = extraction;
    const productsWithUrls = products.filter(p => p.productUrl && p.productUrl.startsWith('http'));

    if (productsWithUrls.length >= products.length * 0.5 && productsWithUrls.length > 0) {
      return this.cleanProducts(productsWithUrls, context);
    }
    if (confidence >= this.config.confidenceThreshold && products.length > 0) {
      const enriched = await this.enrichProductsWithDOM(page, products);
      return this.cleanProducts(enriched, context);
    }

    logger.warn(`Low confidence (${confidence?.toFixed(2) || 0}), attempting self-healing`);
    context.attempts++;

    if (context.attempts <= this.config.maxRetries) {
      try {
        const healed = await this.selfHealer.heal(page, extraction, context);
        if (healed.success && healed.products.length > 0) return this.cleanProducts(healed.products, context);
      } catch (error) { logger.warn(`Self-healing failed: ${error.message}`); }
    }

    const directProducts = await this.extractProductsDirectly(page, context);
    if (directProducts.length > 0) return directProducts;
    return this.cleanProducts(products, context);
  }

  async enrichProductsWithDOM(page, products) {
    const domProducts = await this.extractProductsDirectly(page, { site: '', category: '' });
    if (domProducts.length === 0) return products;

    return products.map(product => {
      if (product.productUrl && product.productUrl.startsWith('http')) return product;
      const match = domProducts.find(dp => this.fuzzyMatch(product.name || '', dp.name || '') > 0.4);
      if (match) return { ...product, productUrl: match.productUrl, imageUrl: product.imageUrl || match.imageUrl };
      return product;
    });
  }

  fuzzyMatch(str1, str2) {
    if (!str1 || !str2) return 0;
    const s1 = str1.toLowerCase(), s2 = str2.toLowerCase();
    if (s1 === s2) return 1;
    const words1 = s1.split(/\s+/), words2 = s2.split(/\s+/);
    let matches = 0;
    for (const word of words1) {
      if (word.length > 2 && words2.some(w => w.includes(word) || word.includes(w))) matches++;
    }
    return matches / Math.max(words1.length, words2.length);
  }

  cleanProducts(products, context) {
    if (!products || !Array.isArray(products)) return [];
    const normalized = products.filter(p => p && p.name).map(p => ({
      ...p, name: (p.name || '').trim(), source: context.site, category: context.category, scrapedAt: p.scrapedAt || new Date().toISOString()
    }));
    const validated = this.productValidator.filterProducts(normalized);
    logger.info(`Cleaned: ${products.length} -> ${validated.length} valid products`);
    return validated;
  }

  async shutdown() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    logger.info('Shutting down agent...');
    try { await this.patternLearner.savePatterns(); } catch (e) { logger.error(`Error saving patterns: ${e.message}`); }
    try { await this.browserManager.close(); } catch (e) { logger.error(`Error closing browser: ${e.message}`); }
    this.isShuttingDown = false;
    logger.info('Agent shutdown complete');
  }
}

module.exports = AgentOrchestrator;