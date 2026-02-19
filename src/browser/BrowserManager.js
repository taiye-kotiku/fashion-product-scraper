// src/browser/BrowserManager.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const config = require('../config');
const logger = require('../utils/logger');
const { getRandomUserAgent, delay } = require('../utils/helpers');

puppeteer.use(StealthPlugin());

class BrowserManager {
  constructor(options = {}) {
    this.browser = null;
    this.pages = new Map();
    this.maxConcurrentPages = options.maxConcurrentPages || 3;
    this.isShuttingDown = false;
  }

  getChromeVersion(userAgent) {
    const match = userAgent.match(/Chrome\/([\d]+)/);
    return match ? match[1] : '131';
  }

  async launch() {
    if (this.browser && this.browser.isConnected()) {
      return;
    }

    if (this.browser) {
      logger.warn('Browser disconnected. Relaunching...');
      this.browser = null;
      this.pages.clear();
    }

    logger.info('Launching browser...');

    const isCI = config.isCI;

    const args = [
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
    ];

    if (isCI) {
      args.push(
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-translate',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-first-run',
        '--single-process',
        '--disable-backgrounding-occluded-windows'
      );
      logger.info('CI environment detected — using memory-optimized browser settings');
    }

    this.browser = await puppeteer.launch({
      headless: 'new',
      args,
      defaultViewport: config.browser.viewport,
      ignoreHTTPSErrors: true
    });

    this.browser.on('disconnected', () => {
      if (!this.isShuttingDown) {
        logger.error('Browser disconnected unexpectedly');
        this.browser = null;
        this.pages.clear();
      }
    });

    logger.info('Browser launched successfully');
  }

  async newPage() {
    if (!this.browser || !this.browser.isConnected()) {
      await this.launch();
    }

    if (this.pages.size >= this.maxConcurrentPages) {
      logger.warn(`Page limit reached (${this.maxConcurrentPages}). Waiting...`);
      await this.waitForAvailablePage(15000);
    }

    const page = await this.browser.newPage();
    const pageId = `page_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const userAgent = getRandomUserAgent();
    await page.setUserAgent(userAgent);
    await page.setViewport(config.browser.viewport);

    const chromeVersion = this.getChromeVersion(userAgent);

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
      window.chrome = { runtime: {} };
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters)
      );
    });

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cache-Control': 'max-age=0',
      'sec-ch-ua': `"Google Chrome";v="${chromeVersion}", "Chromium";v="${chromeVersion}", "Not=A?Brand";v="24"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1'
    });

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (this.isShuttingDown) {
        req.abort().catch(() => {});
        return;
      }
      try {
        const type = req.resourceType();
        const url = req.url();
        if (['font', 'media'].includes(type)) {
          req.abort().catch(() => {});
        } else if (
          url.includes('analytics') ||
          url.includes('tracking') ||
          url.includes('facebook.com') ||
          url.includes('google-analytics') ||
          url.includes('doubleclick') ||
          url.includes('hotjar') ||
          url.includes('segment.io') ||
          url.includes('sentry.io')
        ) {
          req.abort().catch(() => {});
        } else {
          req.continue().catch(() => {});
        }
      } catch {
        // Request already handled during navigation
      }
    });

    page.on('dialog', async (dialog) => {
      try { await dialog.dismiss(); } catch {}
    });

    page.on('pageerror', (error) => {
      logger.debug(`Page error: ${error.message}`);
    });

    this.pages.set(pageId, page);
    return page;
  }

  async waitForAvailablePage(timeout = 15000) {
    const start = Date.now();
    while (this.pages.size >= this.maxConcurrentPages) {
      if (Date.now() - start > timeout) {
        throw new Error(`Timed out waiting for available page slot`);
      }
      await delay(500);
    }
  }

  async closePage(page) {
    try {
      if (page && !page.isClosed()) {
        await page.close();
      }
    } catch (error) {
      logger.warn(`Error closing page: ${error.message}`);
    } finally {
      for (const [id, p] of this.pages.entries()) {
        if (p === page) {
          this.pages.delete(id);
          break;
        }
      }
    }
  }

  async close() {
    this.isShuttingDown = true;

    if (this.browser) {
      logger.info(`Closing browser (${this.pages.size} pages open)...`);

      const closePromises = [];
      for (const page of this.pages.values()) {
        closePromises.push(page.close().catch(() => {}));
      }
      await Promise.allSettled(closePromises);
      this.pages.clear();

      try {
        await this.browser.close();
      } catch (error) {
        logger.warn(`Browser close error: ${error.message}`);
        try {
          const proc = this.browser.process();
          if (proc) proc.kill('SIGKILL');
        } catch {}
      }

      this.browser = null;
      logger.info('Browser closed');
    }

    this.isShuttingDown = false;
  }

  async dismissCookieConsent(page) {
    try {
      await page.evaluate(() => {
        const selectors = [
          '#onetrust-accept-btn-handler',
          '.onetrust-close-btn-handler',
          '#onetrust-reject-all-handler',
          '.ot-pc-refuse-all-handler',
          '[id*="cookie"][id*="accept"]',
          '[id*="cookie"][id*="close"]',
          '[class*="cookie"][class*="accept"]',
          '[class*="cookie"][class*="close"]',
          '[data-testid*="cookie"][data-testid*="accept"]',
          'button[id*="accept"]',
          'button[class*="accept"]',
          '.cookie-consent-accept',
          '.cookie-accept',
          '#accept-cookies',
          '.accept-cookies',
          '#cookieAccept',
          '.js-cookie-accept',
          '[data-action="accept-cookies"]',
          '.gdpr-accept',
          '#gdpr-accept',
          '[class*="gdpr"][class*="accept"]',
          '[class*="consent"][class*="accept"]',
          '[class*="privacy"][class*="accept"]'
        ];

        for (const selector of selectors) {
          try {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
              if (el && el.offsetParent !== null) {
                el.click();
                return true;
              }
            }
          } catch {}
        }

        const buttons = document.querySelectorAll('button, a.button, [role="button"]');
        const acceptTexts = ['accept all', 'accept cookies', 'agree', 'allow all', 'got it', 'i understand'];
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

  async closeModals(page) {
    try {
      await page.evaluate(() => {
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
          '[class*="email"][class*="close"]',
          '[class*="newsletter"][class*="close"]',
          '[class*="subscribe"][class*="close"]',
          'button[aria-label="Close"]',
          'button[aria-label="close"]',
          'button[aria-label="Close dialog"]'
        ];

        for (const selector of closeSelectors) {
          try {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
              if (el && el.offsetParent !== null) el.click();
            }
          } catch {}
        }

        document.querySelectorAll('.modal-backdrop, .overlay-backdrop').forEach(el => {
          el.style.display = 'none';
        });
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
        logger.info(`Navigating to: ${url} (attempt ${attempt}/${maxRetries})`);
        await delay(500 + Math.random() * 1000);

        await page.goto(url, { waitUntil, timeout });
        await delay(2000 + Math.random() * 1000);

        await this.dismissCookieConsent(page);
        await delay(500);
        await this.closeModals(page);
        await delay(500);

        const isBlocked = await page.evaluate(() => {
          const text = document.body?.innerText?.substring(0, 1000)?.toLowerCase() || '';
          return (
            text.includes('confirm you are') ||
            text.includes('robot') ||
            text.includes('captcha') ||
            text.includes('access denied') ||
            text.includes('blocked')
          );
        });

        if (isBlocked) {
          logger.warn('Bot detection page detected');
          await this.humanBehavior(page);
          await delay(3000);
          await this.dismissCookieConsent(page);
          await page.reload({ waitUntil: 'domcontentloaded', timeout });
          await delay(2000);
          await this.dismissCookieConsent(page);
          await this.closeModals(page);
        }

        const title = await page.title();
        logger.info(`Page loaded: ${title}`);
        return true;
      } catch (error) {
        logger.warn(`Navigation attempt ${attempt}/${maxRetries} failed: ${error.message}`);

        if (attempt === maxRetries) {
          try {
            await page.goto(url, { waitUntil: 'load', timeout: timeout * 2 });
            await delay(3000);
            await this.dismissCookieConsent(page);
            await this.closeModals(page);
            return true;
          } catch {
            throw error;
          }
        }
        await delay(2000 * attempt);
      }
    }
  }

  async humanBehavior(page) {
    try {
      for (let i = 0; i < 3; i++) {
        await page.mouse.move(
          100 + Math.random() * 1720,
          100 + Math.random() * 880,
          { steps: 10 }
        );
        await delay(200 + Math.random() * 300);
      }
      await page.evaluate(() => {
        window.scrollBy(0, 100 + Math.random() * 200);
      });
      await delay(500);
    } catch (error) {
      logger.debug(`Human behavior error: ${error.message}`);
    }
  }

  async scrollPage(page, options = {}) {
    const { maxScrolls = 5, scrollDelay = 1500 } = options;
    let previousHeight = 0;
    let scrollCount = 0;

    try {
      await this.dismissCookieConsent(page);
      await this.closeModals(page);

      while (scrollCount < maxScrolls) {
        const currentHeight = await page.evaluate(() => document.body.scrollHeight);
        if (currentHeight === previousHeight && scrollCount > 0) {
          logger.info('Reached end of page');
          break;
        }
        previousHeight = currentHeight;

        await page.evaluate(() => {
          window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
        });
        await delay(scrollDelay + Math.random() * 500);

        if (scrollCount % 2 === 0) await this.closeModals(page);
        scrollCount++;
        logger.debug(`Scroll ${scrollCount}/${maxScrolls}`);
      }

      await page.evaluate(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); });
      await delay(500);
      await this.closeModals(page);
    } catch (error) {
      logger.warn(`Scroll error: ${error.message}`);
    }

    return scrollCount;
  }

  async waitForProducts(page, timeout = 10000) {
    const selectors = [
      '[class*="product"]', '[data-product]', '[data-testid*="product"]',
      '[class*="item-card"]', '[class*="ProductCard"]', '[itemtype*="Product"]',
      '.product', '.product-card', '.product-tile', 'article'
    ];

    await this.dismissCookieConsent(page);
    await this.closeModals(page);

    const perSelector = Math.max(timeout / selectors.length, 1000);
    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, { timeout: perSelector });
        logger.info(`Found products with selector: ${selector}`);
        return true;
      } catch { continue; }
    }

    logger.warn('Could not find product elements with standard selectors');
    return false;
  }

  async takeScreenshot(page, options = {}) {
    try {
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

  async getPageContent(page) {
    try { return await page.content(); }
    catch (error) { logger.warn(`Failed to get page content: ${error.message}`); return ''; }
  }

  async safeEvaluate(page, fn, ...args) {
    try { return await page.evaluate(fn, ...args); }
    catch (error) { logger.warn(`Evaluate error: ${error.message}`); return null; }
  }
}

module.exports = BrowserManager;