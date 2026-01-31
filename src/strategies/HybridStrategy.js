// src/strategies/HybridStrategy.js
const BaseStrategy = require('./BaseStrategy');
const VisionAnalyzer = require('../agent/VisionAnalyzer');
const DOMAnalyzer = require('../agent/DOMAnalyzer');
const LLMClient = require('../llm/LLMClient');
const logger = require('../utils/logger');
const { parsePrice, fuzzyMatch } = require('../utils/helpers');

class HybridStrategy extends BaseStrategy {
  constructor() {
    super();
    this.name = 'hybrid';
    this.visionAnalyzer = new VisionAnalyzer();
    this.domAnalyzer = new DOMAnalyzer();
    this.llm = new LLMClient();
    
    this.skipUrlPatterns = [
      'how-can-we-help',
      'product-recalls',
      'products-sizing',
      'sizing-and-stock',
      'delivery-information',
      'returns-policy',
      'customer-service',
      '/help/',
      '/faq',
      '/about',
      '/contact',
      '/stores',
      '/careers',
      '/cart',
      '/login',
      '/account',
      '/wishlist',
      '/c/',
      '/category',
      '/sale/',
      '/collections/',
      '/page/',
      '/register'
    ];
    
    this.skipNames = [
      'products sizing',
      'product recalls',
      'sizing and stock',
      'delivery',
      'returns',
      'help',
      'contact',
      'view all',
      'see more',
      'load more',
      'add to wish list',
      'add to wishlist',
      'quick view'
    ];

    // Image URL patterns for different sites
    this.imagePatterns = {
      'riverisland.com': (productId) => 
        `https://images.riverisland.com/image/upload/t_plp_portraitSmall/f_auto/q_auto/${productId}_main`,
      'boohooman.com': (sku) =>
        `https://media.boohooman.com/i/boohooman/${sku}_xl?fmt=auto`
    };
  }

  async extract(page, context) {
    logger.info('Using hybrid strategy');

    const domProducts = await this.extractAllProductsFromDOM(page);
    logger.info(`DOM found ${domProducts.length} product links`);

    if (domProducts.length >= 5) {
      return {
        products: domProducts,
        confidence: this.calculateConfidence(domProducts),
        method: 'dom-direct'
      };
    }

    const visionResult = await this.visionAnalyzer.extract(page, context, { maxChunks: 3 });
    
    if (visionResult.products.length > 0) {
      const enriched = await this.enrichWithDOM(page, visionResult.products);
      return {
        products: enriched,
        confidence: this.calculateConfidence(enriched),
        method: 'vision-enriched'
      };
    }

    return {
      products: domProducts,
      confidence: this.calculateConfidence(domProducts),
      method: 'fallback'
    };
  }

  async extractAllProductsFromDOM(page) {
    const baseUrl = await page.url();
    const skipUrls = this.skipUrlPatterns;
    const skipNames = this.skipNames;
    
    const products = await page.evaluate((skipUrls, skipNames) => {
      const results = [];
      const seenUrls = new Set();

      // Determine site type
      const hostname = window.location.hostname;
      const isRiverIsland = hostname.includes('riverisland.com');
      const isBoohoo = hostname.includes('boohooman.com');

      // Site-specific product selectors
      let productElements = [];
      
      if (isRiverIsland) {
        productElements = document.querySelectorAll('a[href*="/p/"]');
      } else if (isBoohoo) {
        productElements = document.querySelectorAll('.product-tile');
      } else {
        // Generic fallback
        productElements = document.querySelectorAll(`
          a[href*="/p/"],
          a[href*="/product/"],
          .product-tile,
          .product-card,
          [data-product-id]
        `);
      }

      productElements.forEach(element => {
        try {
          let href = '';
          let container = element;
          let productId = '';
          let sku = '';

          if (isBoohoo) {
            // Boohoo: element is the tile, find link inside
            const link = element.querySelector('a[href*=".html"]');
            if (!link) return;
            href = link.href;
            
            // Extract SKU from URL: /product-name/CMM21454.html -> CMM21454
            const skuMatch = href.match(/\/([A-Z]{2,4}\d{4,})\.html/i);
            if (skuMatch) {
              sku = skuMatch[1];
            }
          } else if (isRiverIsland) {
            // River Island: element is the link
            href = element.href;
            container = element;
            
            // Extract product ID
            const productIdMatch = href.match(/\/p\/[a-z0-9-]+-(\d{4,})/i);
            if (productIdMatch) {
              productId = productIdMatch[1];
            }
            
            // Check if link is the card
            const linkIsCard = element.className?.includes('card');
            if (!linkIsCard) {
              for (let i = 0; i < 6; i++) {
                if (!container.parentElement) break;
                container = container.parentElement;
                if (container.className?.includes('card')) break;
              }
            }
          } else {
            // Generic
            href = element.href || element.querySelector('a')?.href;
            if (!href) return;
          }

          if (!href) return;

          // Deduplicate by URL
          const cleanUrl = href.split('?')[0].toLowerCase();
          if (seenUrls.has(cleanUrl)) return;

          // Skip non-product URLs
          const lowerHref = href.toLowerCase();
          for (const pattern of skipUrls) {
            if (lowerHref.includes(pattern)) return;
          }

          // Validate URL looks like a product
          const isProductUrl = 
            href.includes('/p/') ||
            href.match(/\/[A-Z]{2,4}\d{4,}\.html/i) ||  // Boohoo SKU
            href.includes('/product/');
          
          if (!isProductUrl && !isBoohoo) return;

          // Get product name
          let name = '';
          let price = '';
          
          const fullText = container.innerText?.trim() || '';
          
          if (fullText) {
            const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            
            for (const line of lines) {
              // Skip price lines
              if (line.match(/^[\$£€₦]\s*[\d,]+/) || line.match(/^[\d,]+\s*[\$£€₦]/)) {
                if (!price) price = line;
                continue;
              }
              // Skip badges and buttons
              if (line.match(/^(PLUS|PETITE|TALL|MATERNITY|EXTENDED SIZES|\d+-\d+\s*(YEARS|YRS))$/i)) {
                continue;
              }
              // Skip action text
              const lowerLine = line.toLowerCase();
              let skip = false;
              for (const skipName of skipNames) {
                if (lowerLine.includes(skipName)) {
                  skip = true;
                  break;
                }
              }
              if (skip) continue;
              
              // Valid product name
              if (line.length >= 8 && line.length <= 200 && !name) {
                name = line;
              }
            }
          }
          
          // Fallback: parse from URL
          if (!name || name.length < 8) {
            if (isBoohoo) {
              // /us/oversized-shrunken-washed-panther-graphic-t-shirt/CMM21454.html
              const urlMatch = href.match(/\/([a-z0-9-]+)\/[A-Z]{2,4}\d+\.html/i);
              if (urlMatch) {
                name = urlMatch[1]
                  .split('-')
                  .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                  .join(' ');
              }
            } else {
              const urlMatch = href.match(/\/p\/([a-z0-9-]+)-\d+/i);
              if (urlMatch) {
                name = urlMatch[1]
                  .split('-')
                  .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                  .join(' ');
              }
            }
          }

          if (!name || name.length < 5) return;

          // Get image
          let imageUrl = '';
          const imgs = container.querySelectorAll('img');
          
          for (const img of imgs) {
            // Check various attributes
            let src = img.dataset?.src || 
                      img.dataset?.lazySrc ||
                      img.dataset?.original ||
                      img.dataset?.srcset ||
                      '';
            
            // Fallback to src if not a placeholder
            if (!src || src.length < 30) {
              src = img.src || '';
              // Skip base64 placeholders
              if (src.startsWith('data:')) {
                src = '';
              }
            }
            
            if (!src || src.length < 30) continue;
            if (src.includes('swatch')) continue;
            if (src.includes('placeholder')) continue;
            
            imageUrl = src;
            break;
          }

          seenUrls.add(cleanUrl);
          
          results.push({
            name: name.trim(),
            productUrl: href.split('?')[0],
            imageUrl: imageUrl,
            priceFormatted: price,
            productId: productId,
            sku: sku,
            site: hostname
          });
        } catch (e) {}
      });

      return results;
    }, skipUrls, skipNames);

    // Normalize and add fallback images
    const cleaned = products
      .filter(p => p.name && p.name.length >= 5 && p.productUrl)
      .map(p => {
        let imageUrl = this.normalizeImageUrl(p.imageUrl, baseUrl);
        
        // Construct image from SKU/ID if missing
        if (!imageUrl || imageUrl.length < 30) {
          if (p.site?.includes('riverisland.com') && p.productId) {
            imageUrl = this.imagePatterns['riverisland.com'](p.productId);
          } else if (p.site?.includes('boohooman.com') && p.sku) {
            imageUrl = this.imagePatterns['boohooman.com'](p.sku);
          }
        }
        
        return {
          ...p,
          price: parsePrice(p.priceFormatted),
          imageUrl: imageUrl
        };
      });

    logger.info(`After deduplication: ${cleaned.length} unique products`);
    return cleaned;
  }

  normalizeImageUrl(url, baseUrl) {
    if (!url) return null;
    if (url.length < 30) return null;
    if (url.startsWith('data:')) return null;
    try {
      if (url.startsWith('//')) return 'https:' + url;
      if (url.startsWith('/')) return new URL(baseUrl).origin + url;
      if (url.startsWith('http')) return url;
      return null;
    } catch {
      return null;
    }
  }

  async enrichWithDOM(page, visionProducts) {
    const domProducts = await this.extractAllProductsFromDOM(page);
    if (domProducts.length === 0) return visionProducts;

    const enriched = [];
    for (const vProduct of visionProducts) {
      const match = this.findBestMatch(vProduct, domProducts);
      if (match) {
        enriched.push({
          name: vProduct.name || match.name,
          price: vProduct.price || match.price,
          priceFormatted: vProduct.priceFormatted || match.priceFormatted,
          productUrl: match.productUrl,
          imageUrl: match.imageUrl || null
        });
      } else {
        enriched.push(vProduct);
      }
    }
    return enriched;
  }

  findBestMatch(visionProduct, domProducts) {
    if (!visionProduct.name) return null;
    let bestMatch = null;
    let bestScore = 0;
    for (const domProduct of domProducts) {
      const score = fuzzyMatch(visionProduct.name, domProduct.name);
      if (score > bestScore && score > 0.3) {
        bestScore = score;
        bestMatch = domProduct;
      }
    }
    return bestMatch;
  }

  calculateConfidence(products) {
    if (!products || products.length === 0) return 0;
    let total = 0;
    for (const p of products) {
      let score = 0;
      if (p.name && p.name.length > 5) score += 0.25;
      if (p.price) score += 0.2;
      if (p.productUrl && p.productUrl.startsWith('http')) score += 0.35;
      if (p.imageUrl && p.imageUrl.startsWith('http')) score += 0.2;
      total += score;
    }
    return Math.min(total / products.length, 1);
  }
}

module.exports = HybridStrategy;