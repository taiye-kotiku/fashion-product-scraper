const fs = require('fs').promises;
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

class ScreenshotManager {
  constructor() {
    this.screenshotDir = config.paths.screenshots;
  }

  async ensureDir() {
    try {
      await fs.mkdir(this.screenshotDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
  }

  async captureFullPage(page, options = {}) {
    const { quality = 80, maxChunks = 5 } = options;
    
    await this.ensureDir();

    const screenshots = [];
    
    try {
      // Get page dimensions
      const dimensions = await page.evaluate(() => ({
        viewportHeight: window.innerHeight,
        totalHeight: Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight,
          document.body.offsetHeight,
          document.documentElement.offsetHeight
        ),
        viewportWidth: window.innerWidth
      }));

      logger.info(`Page dimensions: ${dimensions.totalHeight}px height, ${dimensions.viewportWidth}px width`);

      // If page is too short, just capture viewport
      if (dimensions.totalHeight <= dimensions.viewportHeight) {
        const screenshot = await this.captureViewport(page, { quality });
        return [screenshot];
      }

      let currentPosition = 0;
      let chunkIndex = 0;

      while (currentPosition < dimensions.totalHeight && chunkIndex < maxChunks) {
        // Scroll to position
        await page.evaluate((y) => window.scrollTo(0, y), currentPosition);
        
        // Wait for content to load
        await this.delay(1500);

        // Capture screenshot
        try {
          const screenshot = await page.screenshot({
            encoding: 'base64',
            type: 'jpeg',
            quality,
            fullPage: false
          });

          screenshots.push({
            data: screenshot,
            position: currentPosition,
            index: chunkIndex
          });

          logger.info(`Captured screenshot chunk ${chunkIndex + 1}`);
        } catch (err) {
          logger.warn(`Failed to capture chunk ${chunkIndex}: ${err.message}`);
        }

        currentPosition += dimensions.viewportHeight * 0.8;
        chunkIndex++;
      }

      // Scroll back to top
      await page.evaluate(() => window.scrollTo(0, 0));

    } catch (error) {
      logger.error(`Screenshot capture error: ${error.message}`);
      
      // Try to capture at least one screenshot
      try {
        const fallback = await this.captureViewport(page, { quality });
        return [fallback];
      } catch (e) {
        logger.error(`Fallback screenshot failed: ${e.message}`);
      }
    }

    logger.info(`Captured ${screenshots.length} screenshot chunks`);
    return screenshots;
  }

  async captureViewport(page, options = {}) {
    const { quality = 80 } = options;
    
    await this.ensureDir();

    try {
      const screenshot = await page.screenshot({
        encoding: 'base64',
        type: 'jpeg',
        quality,
        fullPage: false
      });

      return {
        data: screenshot,
        position: 0,
        index: 0
      };
    } catch (error) {
      logger.error(`Viewport screenshot failed: ${error.message}`);
      throw error;
    }
  }

  async saveScreenshot(screenshot, filename) {
    await this.ensureDir();
    const filepath = path.join(this.screenshotDir, filename);
    const buffer = Buffer.from(screenshot.data, 'base64');
    await fs.writeFile(filepath, buffer);
    logger.info(`Screenshot saved: ${filepath}`);
    return filepath;
  }

  async saveDebugScreenshot(page, prefix = 'debug') {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${prefix}-${timestamp}.jpg`;
      const screenshot = await this.captureViewport(page);
      return await this.saveScreenshot(screenshot, filename);
    } catch (error) {
      logger.warn(`Could not save debug screenshot: ${error.message}`);
      return null;
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = ScreenshotManager;