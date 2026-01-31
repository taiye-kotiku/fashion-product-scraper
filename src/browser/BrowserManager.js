// src/browser/BrowserManager.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const config = require('../config');
const logger = require('../utils/logger');
const { getRandomUserAgent, delay } = require('../utils/helpers');

// Add stealth plugin
puppeteer.use(StealthPlugin());

class BrowserManager {
  constructor() {
    this.browser = null;
    this.pages = new Map();
  }

  async launch() {
    if (this.browser) {
      return;
    }

    logger.info('Launching browser...');

    this.browser = await puppeteer.launch({
      headless: config.browser.headless ? 'new' : false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--lang=en-US,en',
        '--start-maximized'
      ],
      defaultViewport: config.browser.viewport,
      ignoreHTTPSErrors: true
    });

    logger.info('Browser launched successfully');
  }

  async newPage() {
    if (!this.browser) {
      await this.launch();
    }

    const page = await this.browser.newPage();
    const pageId = Date.now().toString();

    // Set realistic user agent
    const userAgent = getRandomUserAgent();
    await page.setUserAgent(userAgent);

    // Set viewport
    await page.setViewport(config.browser.viewport);

    // Override navigator properties to avoid detection
    await page.evaluateOnNewDocument(() => {
      // Override the webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });

      // Override plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });

      // Override languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en']
      });

      // Override platform
      Object.defineProperty(navigator, 'platform', {
        get: () => 'Win32'
      });

      // Override chrome property
      window.chrome = {
        runtime: {}
      };

      // Override permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    });

    // Set extra headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0',
      'sec-ch-ua': '"Google Chrome";v="120", "Chromium";v="120", "Not=A?Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1'
    });

    // Intercept requests to block unnecessary resources
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      const url = req.url();

      // Block fonts, media, and tracking - but NOT images
      if (['font', 'media'].includes(type)) {
        req.abort();
      } else if (
        url.includes('analytics') ||
        url.includes('tracking') ||
        url.includes('facebook.com') ||
        url.includes('google-analytics') ||
        url.includes('doubleclick')
      ) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Handle dialogs
    page.on('dialog', async (dialog) => {
      await dialog.dismiss();
    });

    // Log console errors in debug mode
    page.on('pageerror', error => {
      logger.debug(`Page error: ${error.message}`);
    });

    this.pages.set(pageId, page);
    return page;
  }

  async closePage(page) {
    try {
      await page.close();
      for (const [id, p] of this.pages.entries()) {
        if (p === page) {
          this.pages.delete(id);
          break;
        }
      }
    } catch (error) {
      logger.warn(`Error closing page: ${error.message}`);
    }
  }

  async close() {
    if (this.browser) {
      logger.info('Closing browser...');
      for (const page of this.pages.values()) {
        try {
          await page.close();
        } catch {}
      }
      this.pages.clear();
      await this.browser.close();
      this.browser = null;
      logger.info('Browser closed');
    }
  }

  // Dismiss cookie consent modals and popups
  async dismissCookieConsent(page) {
    try {
      await page.evaluate(() => {
        // Common cookie consent button selectors
        const cookieSelectors = [
          // OneTrust (used by Abercrombie, many others)
          '#onetrust-accept-btn-handler',
          '.onetrust-close-btn-handler',
          '#onetrust-reject-all-handler',
          '.ot-pc-refuse-all-handler',
          // Generic cookie buttons
          '[id*="cookie"][id*="accept"]',
          '[id*="cookie"][id*="close"]',
          '[class*="cookie"][class*="accept"]',
          '[class*="cookie"][class*="close"]',
          '[data-testid*="cookie"][data-testid*="accept"]',
          // Common button texts (case insensitive handled below)
          'button[id*="accept"]',
          'button[class*="accept"]',
          '.cookie-consent-accept',
          '.cookie-accept',
          '#accept-cookies',
          '.accept-cookies',
          '#cookieAccept',
          '.js-cookie-accept',
          '[data-action="accept-cookies"]',
          // GDPR specific
          '.gdpr-accept',
          '#gdpr-accept',
          '[class*="gdpr"][class*="accept"]',
          // Privacy/consent
          '[class*="consent"][class*="accept"]',
          '[class*="privacy"][class*="accept"]',
          // Modal close buttons
          '.modal-close',
          '[class*="modal"][class*="close"]',
          '[aria-label*="close"]',
          '[aria-label*="Close"]'
        ];

        for (const selector of cookieSelectors) {
          try {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
              if (el && el.offsetParent !== null) { // Check if visible
                el.click();
                return true;
              }
            }
          } catch (e) {}
        }

        // Try finding buttons by text content
        const buttons = document.querySelectorAll('button, a.button, [role="button"]');
        const acceptTexts = ['accept', 'agree', 'allow', 'ok', 'got it', 'i understand', 'continue'];
        
        for (const btn of buttons) {
          const text = btn.textContent?.toLowerCase().trim() || '';
          if (acceptTexts.some(t => text.includes(t)) && btn.offsetParent !== null) {
            btn.click();
            return true;
          }
        }

        return false;
      });
    } catch (error) {
      logger.debug(`Cookie consent dismissal error: ${error.message}`);
    }
  }

  // Close any modal/popup overlays
  async closeModals(page) {
    try {
      await page.evaluate(() => {
        // Close button selectors for modals
        const closeSelectors = [
          '.modal-close',
          '.modal-close-button',
          '[class*="modal"] [class*="close"]',
          '[class*="modal"] button[aria-label*="close"]',
          '[class*="popup"] [class*="close"]',
          '[class*="overlay"] [class*="close"]',
          '.js-close-modal',
          '[data-dismiss="modal"]',
          '.close-button',
          '.btn-close',
          // Email signup modals
          '[class*="email"][class*="close"]',
          '[class*="newsletter"][class*="close"]',
          '[class*="subscribe"][class*="close"]',
          // Generic X buttons
          'button[aria-label="Close"]',
          'button[aria-label="close"]'
        ];

        for (const selector of closeSelectors) {
          try {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
              if (el && el.offsetParent !== null) {
                el.click();
              }
            }
          } catch (e) {}
        }

        // Remove modal overlays directly
        const overlaySelectors = [
          '.modal-backdrop',
          '.modal-overlay',
          '[class*="overlay"]',
          '[class*="modal"][class*="active"]'
        ];

        for (const selector of overlaySelectors) {
          try {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
              if (el && el.classList.contains('backdrop')) {
                el.style.display = 'none';
              }
            }
          } catch (e) {}
        }
      });
    } catch (error) {
      logger.debug(`Modal close error: ${error.message}`);
    }
  }

  async navigateWithRetry(page, url, options = {}) {
    const {
      maxRetries = 3,
      waitUntil = 'domcontentloaded',
      timeout = config.browser.timeout
    } = options;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`Navigating to: ${url} (attempt ${attempt})`);

        // Add random delay to seem more human
        await delay(500 + Math.random() * 1000);

        await page.goto(url, {
          waitUntil,
          timeout
        });

        // Wait for page to settle
        await delay(2000 + Math.random() * 1000);

        // Dismiss cookie consent popups
        await this.dismissCookieConsent(page);
        await delay(500);

        // Close any other modals
        await this.closeModals(page);
        await delay(500);

        // Check if we hit a bot detection page
        const bodyText = await page.evaluate(() => document.body.innerText?.substring(0, 500));
        if (bodyText?.toLowerCase().includes('confirm you are') ||
            bodyText?.toLowerCase().includes('robot') ||
            bodyText?.toLowerCase().includes('captcha') ||
            bodyText?.toLowerCase().includes('access denied')) {
          logger.warn('Bot detection page detected');

          // Try waiting longer and moving mouse
          await this.humanBehavior(page);
          await delay(3000);

          // Try dismissing cookie consent again
          await this.dismissCookieConsent(page);

          // Reload
          await page.reload({ waitUntil: 'domcontentloaded' });
          await delay(2000);

          // Dismiss again after reload
          await this.dismissCookieConsent(page);
          await this.closeModals(page);
        }

        const title = await page.title();
        logger.info(`Page loaded: ${title}`);

        return true;
      } catch (error) {
        logger.warn(`Navigation attempt ${attempt} failed: ${error.message}`);

        if (attempt === maxRetries) {
          try {
            await page.goto(url, {
              waitUntil: 'load',
              timeout: timeout * 2
            });
            await delay(3000);
            await this.dismissCookieConsent(page);
            await this.closeModals(page);
            return true;
          } catch (e) {
            throw error;
          }
        }

        await delay(2000 * attempt);
      }
    }
  }

  // Simulate human-like behavior
  async humanBehavior(page) {
    try {
      // Random mouse movements
      const width = 1920;
      const height = 1080;

      for (let i = 0; i < 3; i++) {
        await page.mouse.move(
          100 + Math.random() * (width - 200),
          100 + Math.random() * (height - 200),
          { steps: 10 }
        );
        await delay(200 + Math.random() * 300);
      }

      // Random scroll
      await page.evaluate(() => {
        window.scrollBy(0, 100 + Math.random() * 200);
      });
      await delay(500);

    } catch (error) {
      logger.debug(`Human behavior simulation error: ${error.message}`);
    }
  }

  async scrollPage(page, options = {}) {
    const { maxScrolls = 5, scrollDelay = 1500 } = options;

    let previousHeight = 0;
    let scrollCount = 0;

    try {
      // Dismiss any popups before scrolling
      await this.dismissCookieConsent(page);
      await this.closeModals(page);

      while (scrollCount < maxScrolls) {
        const currentHeight = await page.evaluate(() => document.body.scrollHeight);

        if (currentHeight === previousHeight) {
          logger.info('Reached end of page');
          break;
        }

        previousHeight = currentHeight;

        // More human-like scroll
        await page.evaluate(() => {
          window.scrollBy({
            top: window.innerHeight * 0.8,
            behavior: 'smooth'
          });
        });

        await delay(scrollDelay + Math.random() * 500);

        // Check for and dismiss any lazy-loaded popups
        if (scrollCount % 2 === 0) {
          await this.closeModals(page);
        }

        scrollCount++;
        logger.info(`Scroll ${scrollCount}/${maxScrolls}`);
      }

      // Scroll back to top smoothly
      await page.evaluate(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      await delay(500);

      // Final popup check
      await this.closeModals(page);

    } catch (error) {
      logger.warn(`Scroll error: ${error.message}`);
    }

    return scrollCount;
  }

  async waitForProducts(page, timeout = 10000) {
    const selectors = [
      '[class*="product"]',
      '[data-product]',
      '[data-testid*="product"]',
      '[class*="item-card"]',
      '[class*="ProductCard"]',
      '[itemtype*="Product"]',
      '.product',
      '.product-card',
      '.product-tile',
      'article'
    ];

    // First dismiss any popups that might be blocking
    await this.dismissCookieConsent(page);
    await this.closeModals(page);

    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, { timeout: timeout / selectors.length });
        logger.info(`Found products with selector: ${selector}`);
        return true;
      } catch {
        continue;
      }
    }

    logger.warn('Could not find product elements with standard selectors');
    return false;
  }

  // Take screenshot without HTML dump on error
  async takeScreenshot(page, options = {}) {
    try {
      // Dismiss popups before screenshot
      await this.dismissCookieConsent(page);
      await this.closeModals(page);
      await delay(300);

      return await page.screenshot({
        encoding: options.encoding || 'base64',
        type: options.type || 'jpeg',
        quality: options.quality || 80,
        fullPage: options.fullPage || false
      });
    } catch (error) {
      logger.warn(`Screenshot error: ${error.message}`);
      return null;
    }
  }

  // Get page content without dumping HTML to console
  async getPageContent(page) {
    try {
      return await page.content();
    } catch (error) {
      logger.warn(`Failed to get page content: ${error.message}`);
      return '';
    }
  }

  // Safe evaluate that doesn't dump HTML on error
  async safeEvaluate(page, fn, ...args) {
    try {
      return await page.evaluate(fn, ...args);
    } catch (error) {
      logger.warn(`Evaluate error: ${error.message}`);
      return null;
    }
  }
}

module.exports = BrowserManager;