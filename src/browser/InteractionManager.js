const logger = require('../utils/logger');
const { delay } = require('../utils/helpers');

class InteractionManager {
  constructor() {}

  async clickLoadMore(page, options = {}) {
    const {
      maxClicks = 5,
      clickDelay = 2000,
      selectors = [
        'button[class*="load-more"]',
        'button[class*="loadMore"]',
        '[class*="load-more"]',
        'button:contains("Load More")',
        'button:contains("Show More")',
        'a[class*="load-more"]'
      ]
    } = options;

    let clickCount = 0;

    for (let i = 0; i < maxClicks; i++) {
      let clicked = false;

      for (const selector of selectors) {
        try {
          const button = await page.$(selector);
          
          if (button) {
            const isVisible = await page.evaluate(el => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }, button);

            if (isVisible) {
              await button.click();
              clicked = true;
              clickCount++;
              logger.debug(`Clicked load more button (${clickCount})`);
              await delay(clickDelay);
              break;
            }
          }
        } catch (error) {
          continue;
        }
      }

      if (!clicked) {
        logger.debug('No more load more buttons found');
        break;
      }
    }

    return clickCount;
  }

  async clickPagination(page, options = {}) {
    const {
      maxPages = 5,
      pageDelay = 2000,
      nextSelectors = [
        'a[class*="next"]',
        'button[class*="next"]',
        '[aria-label="Next"]',
        '[aria-label="Next page"]',
        'a:contains("Next")',
        '.pagination-next'
      ]
    } = options;

    let pageCount = 1;

    while (pageCount < maxPages) {
      let foundNext = false;

      for (const selector of nextSelectors) {
        try {
          const nextButton = await page.$(selector);
          
          if (nextButton) {
            const isDisabled = await page.evaluate(el => {
              return el.disabled || 
                     el.classList.contains('disabled') ||
                     el.getAttribute('aria-disabled') === 'true';
            }, nextButton);

            if (!isDisabled) {
              await nextButton.click();
              foundNext = true;
              pageCount++;
              logger.debug(`Navigated to page ${pageCount}`);
              await delay(pageDelay);
              break;
            }
          }
        } catch (error) {
          continue;
        }
      }

      if (!foundNext) {
        logger.debug('No more pages found');
        break;
      }
    }

    return pageCount;
  }

  async handleInfiniteScroll(page, options = {}) {
    const {
      maxScrolls = 10,
      scrollDelay = 2000,
      scrollAmount = 800
    } = options;

    let previousHeight = 0;
    let scrollCount = 0;
    let noChangeCount = 0;

    while (scrollCount < maxScrolls && noChangeCount < 3) {
      const currentHeight = await page.evaluate(() => document.body.scrollHeight);

      if (currentHeight === previousHeight) {
        noChangeCount++;
      } else {
        noChangeCount = 0;
      }

      previousHeight = currentHeight;

      await page.evaluate((amount) => {
        window.scrollBy(0, amount);
      }, scrollAmount);

      await delay(scrollDelay);
      scrollCount++;

      logger.debug(`Infinite scroll: ${scrollCount}/${maxScrolls}`);
    }

    return scrollCount;
  }

  async closePopups(page) {
    const popupSelectors = [
      '[class*="modal-close"]',
      '[class*="popup-close"]',
      '[aria-label="Close"]',
      '[class*="close-button"]',
      'button[class*="dismiss"]',
      '[class*="newsletter"] button[class*="close"]',
      '[id*="popup"] button[class*="close"]'
    ];

    for (const selector of popupSelectors) {
      try {
        const closeButton = await page.$(selector);
        if (closeButton) {
          await closeButton.click();
          logger.debug(`Closed popup with selector: ${selector}`);
          await delay(500);
        }
      } catch (error) {
        continue;
      }
    }
  }

  async acceptCookies(page) {
    const cookieSelectors = [
      '[class*="cookie"] button[class*="accept"]',
      '[id*="cookie"] button[class*="accept"]',
      'button:contains("Accept")',
      'button:contains("Accept All")',
      '[class*="consent"] button',
      '#onetrust-accept-btn-handler'
    ];

    for (const selector of cookieSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          await button.click();
          logger.debug('Accepted cookies');
          await delay(500);
          return true;
        }
      } catch (error) {
        continue;
      }
    }

    return false;
  }
}

module.exports = InteractionManager;