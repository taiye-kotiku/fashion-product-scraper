const VisionAnalyzer = require('./VisionAnalyzer');
const DOMAnalyzer = require('./DOMAnalyzer');
const PatternLearner = require('./PatternLearner');
const SelfHealer = require('./SelfHealer');
const StrategySelector = require('../strategies/StrategySelector');
const BrowserManager = require('../browser/BrowserManager');
const InteractionManager = require('../browser/InteractionManager');
const ScrapingBeeClient = require('../integrations/ScrapingBeeClient');
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

    this.config = {
      maxRetries: config.agent.maxRetries,
      confidenceThreshold: config.agent.confidenceThreshold,
      enableLearning: config.agent.enableLearning,
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
    const { name, url, category } = siteConfig;
    logger.subsection(`Scraping: ${name} - ${category}`);

    const context = {
      site: name,
      category,
      url,
      attempts: 0,
      startTime: Date.now()
    };

    // Check if this site needs ScrapingBee
    const sitesConfig = require('../config/sites');
    const siteInfo = sitesConfig.getSiteByName(name);
    
    if (siteInfo?.useScrapingBee) {
      return await this.scrapeWithScrapingBee(siteConfig, context);
    }

    // Regular browser-based scraping
    let page = null;

    try {
      page = await this.browserManager.newPage();
      await this.browserManager.navigateWithRetry(page, url);

      await this.interactionManager.closePopups(page);
      await this.interactionManager.acceptCookies(page);
      await delay(1000);

      await this.browserManager.waitForProducts(page);
      await this.handlePageLoading(page, context);

      // Try direct DOM extraction first
      const directProducts = await this.extractProductsDirectly(page, context);
      
      if (directProducts.length >= 3) {
        logger.info(`Direct extraction found ${directProducts.length} products`);
        
        if (this.config.enableLearning) {
          await this.patternLearner.recordSuccess(context, { name: 'direct-dom' }, directProducts);
        }
        
        return directProducts;
      }

      // Fallback to strategy-based extraction
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
      logger.error(`Extraction failed: ${error.message}`);
      await this.patternLearner.recordFailure(context, error);
      throw error;
    } finally {
      if (page) {
        await this.browserManager.closePage(page);
      }
    }
  }

  async scrapeWithScrapingBee(siteConfig, context) {
    const { name, url, category } = siteConfig;
    
    if (!this.scrapingBee.isConfigured()) {
      logger.warn(`ScrapingBee not configured. Skipping ${name} (requires API key)`);
      return [];
    }

    logger.info(`Using ScrapingBee for ${name} (bot-protected site)`);

    try {
      const products = await this.scrapingBee.extractProducts(url, name);
      
      // Validate products
      const productValidator = require('../processors/ProductValidator');
      const validated = productValidator.filterProducts(products);
      
      // Add metadata
      const enriched = validated.map(p => ({
        ...p,
        source: name,
        category: category,
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
    
    const products = await page.evaluate(() => {
      const results = [];
      const seenUrls = new Set();

      const hostname = window.location.hostname;
      const isRiverIsland = hostname.includes('riverisland.com');
      const isBoohoo = hostname.includes('boohooman.com');
      const isNext = hostname.includes('next.us') || hostname.includes('next.co');

      if (isBoohoo) {
        // Boohoo extraction
        const tiles = document.querySelectorAll('.product-tile');
        
        tiles.forEach(tile => {
          try {
            const link = tile.querySelector('a[href*=".html"]');
            if (!link) return;
            
            const href = link.href;
            const cleanUrl = href.split('?')[0].toLowerCase();
            if (seenUrls.has(cleanUrl)) return;
            
            if (href.includes('/page/') || href.includes('/customer-service')) return;
            
            // Get SKU from URL
            const skuMatch = href.match(/\/([A-Z]{2,4}\d{4,})\.html/i);
            const sku = skuMatch ? skuMatch[1] : '';
            
            // Get name and price
            let name = '';
            let price = '';
            const text = tile.innerText || '';
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            
            for (const line of lines) {
              if (line.match(/^\$[\d,.]+/) || line.match(/^[\d,.]+$/)) {
                if (!price) price = line;
                continue;
              }
              if (line.match(/^(add to|quick view|extended sizes|notify me)/i)) continue;
              if (line.length >= 10 && line.length <= 200 && !name) {
                name = line;
              }
            }
            
            if (!name) {
              const urlMatch = href.match(/\/([a-z0-9-]+)\/[A-Z]{2,4}\d+\.html/i);
              if (urlMatch) {
                name = urlMatch[1].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
              }
            }
            
            if (!name || name.length < 5) return;
            
            // Get image URL - Method 1: from hidden input
            let imageUrl = '';
            const hiddenInput = tile.querySelector('.js-primary-image-default-url, input[class*="primary-image"]');
            if (hiddenInput) {
              imageUrl = hiddenInput.value || '';
            }
            
            // Method 2: from data-color attribute
            if (!imageUrl && sku) {
              const imageWrapper = tile.querySelector('[data-color]');
              const color = imageWrapper?.getAttribute('data-color') || '';
              if (color) {
                const colorEncoded = encodeURIComponent(color.toLowerCase());
                imageUrl = `//mediahub.boohooman.com/${sku.toLowerCase()}_${colorEncoded}_xl?qlt=85&w=314&h=0&fit=ctn&fmt=webp`;
              }
            }
            
            // Method 3: Check for any mediahub image
            if (!imageUrl) {
              const imgs = tile.querySelectorAll('img');
              for (const img of imgs) {
                const src = img.src || '';
                if (src.includes('mediahub.boohooman.com') && !src.startsWith('data:')) {
                  imageUrl = src;
                  break;
                }
              }
            }
            
            // Normalize URL
            if (imageUrl && imageUrl.startsWith('//')) {
              imageUrl = 'https:' + imageUrl;
            }
            
            seenUrls.add(cleanUrl);
            results.push({ name, productUrl: href.split('?')[0], imageUrl, priceFormatted: price, sku });
          } catch (e) {}
        });
        
      } else if (isRiverIsland) {
        // River Island extraction
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
            
            if (href.includes('how-can-we-help') || href.includes('product-recalls')) return;
            
            const container = link;
            
            let name = '';
            let price = '';
            const fullText = link.innerText?.trim() || '';
            
            if (fullText) {
              const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
              for (const line of lines) {
                if (line.match(/^[\$£€₦]\s*[\d,]+/) || line.match(/^[\d,]+\s*[\$£€₦]/)) {
                  if (!price) price = line;
                  continue;
                }
                if (line.match(/^(PLUS|PETITE|TALL|\d+-\d+\s*YEARS)/i)) continue;
                if (line.length >= 8 && line.length <= 150 && !name) {
                  name = line;
                }
              }
            }
            
            if (!name) {
              const urlMatch = href.match(/\/p\/([a-z0-9-]+)-\d+/i);
              if (urlMatch) {
                name = urlMatch[1].split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
              }
            }
            
            if (!name || name.length < 5) return;
            
            let imageUrl = '';
            const img = container.querySelector('img.single-tile-image');
            if (img && img.src && !img.src.startsWith('data:')) {
              imageUrl = img.src;
            } else {
              imageUrl = `https://images.riverisland.com/image/upload/t_plp_portraitSmall/f_auto/q_auto/${productId}_main`;
            }
            
            seenUrls.add(cleanUrl);
            results.push({ name, productUrl: href.split('?')[0], imageUrl, priceFormatted: price, productId });
          } catch (e) {}
        });
        
      } else if (isNext) {
        // Next extraction
        const cards = document.querySelectorAll('[class*="MuiCard-root"], [data-testid*="product-card"]');
        
        cards.forEach(card => {
          try {
            const link = card.querySelector('a[href*="/style/"]');
            if (!link) return;
            
            const href = link.href;
            const cleanUrl = href.split('#')[0].split('?')[0].toLowerCase();
            if (seenUrls.has(cleanUrl)) return;
            
            const itemCodeMatch = href.match(/\/([a-z]\d{5,})/i);
            const itemCode = itemCodeMatch ? itemCodeMatch[1].toUpperCase() : '';
            
            let name = '';
            let price = '';
            const fullText = card.innerText?.trim() || '';
            
            if (fullText) {
              const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
              
              for (const line of lines) {
                if (line.match(/^(NEW IN|SALE|BESTSELLER|LOW STOCK)/i)) continue;
                if (line.match(/^\$[\d,]+\s*-?\s*\$?[\d,]*/) || line.match(/^\$[\d,.]+$/)) {
                  if (!price) price = line;
                  continue;
                }
                if (line.match(/^\(\d+.*\)$/)) continue;
                if (line.length >= 10 && line.length <= 200 && !name) {
                  name = line;
                }
              }
            }
            
            if (!name || name.length < 5) return;
            
            let imageUrl = '';
            const imgs = card.querySelectorAll('img');
            
            for (const img of imgs) {
              const src = img.src || '';
              if (src.includes('/ph.jpg') || src.includes('placeholder')) continue;
              if (src.includes('21x21') || src.includes('Swatch')) continue;
              
              if (src && src.includes('xcdn.next.co.uk') && src.length > 50) {
                imageUrl = src;
                break;
              }
            }
            
            if (!imageUrl && itemCode) {
              imageUrl = `https://xcdn.next.co.uk/Common/Items/Default/Default/ItemImages/3_4Ratio/SearchINT/Lge/${itemCode}.jpg`;
            }
            
            seenUrls.add(cleanUrl);
            results.push({
              name,
              productUrl: href.split('#')[0].split('?')[0],
              imageUrl,
              priceFormatted: price,
              itemCode
            });
          } catch (e) {}
        });
        
      } else {
        // Generic extraction
        const productLinks = document.querySelectorAll(`
          a[href*="/p/"],
          a[href*="/product/"],
          a[href*="/pd/"],
          .product-tile a,
          .product-card a
        `);
        
        productLinks.forEach(link => {
          try {
            const href = link.href;
            if (!href) return;
            
            const cleanUrl = href.split('?')[0].toLowerCase();
            if (seenUrls.has(cleanUrl)) return;
            
            const skipPatterns = ['/cart', '/login', '/account', '/wishlist', '/c/', '/category'];
            if (skipPatterns.some(p => href.toLowerCase().includes(p))) return;
            
            let container = link;
            for (let i = 0; i < 5; i++) {
              if (!container.parentElement) break;
              container = container.parentElement;
              if (container.className?.includes('product') || container.className?.includes('card')) break;
            }
            
            let name = '';
            let price = '';
            const fullText = container.innerText?.trim() || '';
            
            if (fullText) {
              const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
              for (const line of lines) {
                if (line.match(/^[\$£€₦]\s*[\d,]+/)) {
                  if (!price) price = line;
                  continue;
                }
                if (line.length >= 5 && line.length <= 150 && !name) {
                  name = line;
                }
              }
            }
            
            if (!name || name.length < 5) return;
            
            let imageUrl = '';
            const img = container.querySelector('img');
            if (img) {
              imageUrl = img.dataset?.src || img.src || '';
              if (imageUrl.startsWith('data:')) imageUrl = '';
            }
            
            seenUrls.add(cleanUrl);
            results.push({ name, productUrl: href.split('?')[0], imageUrl, priceFormatted: price });
          } catch (e) {}
        });
      }

      return results;
    });

    // Normalize
    const normalized = products.map(p => ({
      ...p,
      name: p.name?.trim(),
      price: this.parsePrice(p.priceFormatted),
      imageUrl: this.normalizeUrl(p.imageUrl, baseUrl),
      source: context.site,
      category: context.category,
      scrapedAt: new Date().toISOString()
    }));

    const productValidator = require('../processors/ProductValidator');
    const validated = productValidator.filterProducts(normalized);

    logger.info(`Direct extraction: ${products.length} found -> ${validated.length} valid products`);

    return validated;
  }

  parsePrice(priceStr) {
    if (!priceStr) return null;
    const match = String(priceStr).match(/[\d,.]+/);
    return match ? parseFloat(match[0].replace(',', '')) : null;
  }

  normalizeUrl(url, baseUrl) {
    if (!url) return null;
    try {
      if (url.startsWith('//')) return 'https:' + url;
      if (url.startsWith('/')) return new URL(url, baseUrl).toString();
      if (url.startsWith('http')) return url;
      return null;
    } catch {
      return null;
    }
  }

  async handlePageLoading(page, context) {
    const sitesConfig = require('../config/sites');
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
    const analysis = {
      hasSchemaOrg: false,
      hasSemanticHTML: false,
      productIndicators: [],
      isReactApp: false
    };

    try {
      analysis.hasSchemaOrg = await page.evaluate(() => {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of scripts) {
          try {
            const data = JSON.parse(script.textContent);
            if (data['@type'] === 'Product' || 
                data['@type'] === 'ItemList' ||
                data['@graph']?.some(i => i['@type'] === 'Product')) {
              return true;
            }
          } catch {}
        }
        return false;
      });

      analysis.hasSemanticHTML = await page.evaluate(() => {
        return document.querySelectorAll('[itemtype*="Product"], [data-product-id]').length > 0;
      });

      analysis.productIndicators = await page.evaluate(() => {
        const patterns = [
          '[class*="product-card"]',
          '[class*="product-grid"]',
          '[class*="product-item"]',
          '[class*="ProductCard"]',
          '[data-testid*="product"]',
          'article[class*="product"]'
        ];
        return patterns.map(p => ({
          selector: p,
          count: document.querySelectorAll(p).length
        })).filter(p => p.count > 0);
      });

      analysis.isReactApp = await page.evaluate(() => {
        return !!(
          document.querySelector('[data-reactroot]') || 
          document.querySelector('#__next') ||
          window.__NEXT_DATA__
        );
      });

    } catch (error) {
      logger.warn(`Page analysis error: ${error.message}`);
    }

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
        if (healed.success && healed.products.length > 0) {
          return this.cleanProducts(healed.products, context);
        }
      } catch (error) {
        logger.warn(`Self-healing failed: ${error.message}`);
      }
    }

    const directProducts = await this.extractProductsDirectly(page, context);
    if (directProducts.length > 0) {
      return directProducts;
    }

    return this.cleanProducts(products, context);
  }

  async enrichProductsWithDOM(page, products) {
    const domProducts = await this.extractProductsDirectly(page, { site: '', category: '' });
    
    if (domProducts.length === 0) {
      return products;
    }

    return products.map(product => {
      if (product.productUrl && product.productUrl.startsWith('http')) {
        return product;
      }

      const match = domProducts.find(dp => {
        const similarity = this.fuzzyMatch(product.name || '', dp.name || '');
        return similarity > 0.4;
      });

      if (match) {
        return {
          ...product,
          productUrl: match.productUrl,
          imageUrl: product.imageUrl || match.imageUrl
        };
      }

      return product;
    });
  }

  fuzzyMatch(str1, str2) {
    if (!str1 || !str2) return 0;
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();
    if (s1 === s2) return 1;

    const words1 = s1.split(/\s+/);
    const words2 = s2.split(/\s+/);
    let matches = 0;

    for (const word of words1) {
      if (word.length > 2 && words2.some(w => w.includes(word) || word.includes(w))) {
        matches++;
      }
    }
    return matches / Math.max(words1.length, words2.length);
  }

  cleanProducts(products, context) {
    if (!products || !Array.isArray(products)) return [];
    
    const productValidator = require('../processors/ProductValidator');
    
    const normalized = products
      .filter(p => p && p.name)
      .map(p => ({
        ...p,
        name: (p.name || '').trim(),
        source: context.site,
        category: context.category,
        scrapedAt: p.scrapedAt || new Date().toISOString()
      }));

    const validated = productValidator.filterProducts(normalized);

    logger.info(`Cleaned: ${products.length} -> ${validated.length} valid products`);
    
    return validated;
  }

  async shutdown() {
    logger.info('Shutting down agent...');
    await this.patternLearner.savePatterns();
    await this.browserManager.close();
    logger.info('Agent shutdown complete');
  }
}

module.exports = AgentOrchestrator;