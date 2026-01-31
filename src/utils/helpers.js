const crypto = require('crypto');
const config = require('../config');

/**
 * Random delay between min and max milliseconds
 */
function randomDelay(min = 1000, max = 3000) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Fixed delay
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get random user agent
 */
function getRandomUserAgent() {
  const userAgents = config.browser.userAgents;
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

/**
 * Retry a function with exponential backoff
 */
async function retryAsync(fn, options = {}) {
  const { maxRetries = 3, initialDelay = 1000, maxDelay = 10000 } = options;
  
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        break;
      }
      
      const delayTime = Math.min(initialDelay * Math.pow(2, attempt - 1), maxDelay);
      console.log(`Attempt ${attempt} failed, retrying in ${delayTime}ms...`);
      await delay(delayTime);
    }
  }
  
  throw lastError;
}

/**
 * Generate a unique hash for a product
 */
function generateProductId(product) {
  const uniqueString = `${product.source || ''}|${product.productUrl || product.name}`;
  return crypto.createHash('md5').update(uniqueString).digest('hex');
}

/**
 * Generate a site fingerprint
 */
function generateSiteKey(siteName) {
  return crypto.createHash('md5').update(siteName.toLowerCase()).digest('hex').slice(0, 12);
}

/**
 * Parse price string to number
 */
function parsePrice(priceStr) {
  if (!priceStr) return null;
  if (typeof priceStr === 'number') return priceStr;
  
  // Remove currency symbols and extract number
  const match = String(priceStr).match(/[\d,.]+/);
  if (match) {
    // Handle European format (1.234,56) vs US format (1,234.56)
    let price = match[0];
    
    // If has both . and ,, determine format
    if (price.includes('.') && price.includes(',')) {
      // Check which comes last
      if (price.lastIndexOf(',') > price.lastIndexOf('.')) {
        // European format
        price = price.replace(/\./g, '').replace(',', '.');
      } else {
        // US format
        price = price.replace(/,/g, '');
      }
    } else if (price.includes(',')) {
      // Could be European decimal or US thousands
      if (price.match(/,\d{2}$/)) {
        // European decimal
        price = price.replace(',', '.');
      } else {
        // US thousands
        price = price.replace(/,/g, '');
      }
    }
    
    return parseFloat(price);
  }
  
  return null;
}

/**
 * Format price for display
 */
function formatPrice(price, currency = '$') {
  if (price === null || price === undefined) return null;
  return `${currency}${price.toFixed(2)}`;
}

/**
 * Clean and normalize text
 */
function cleanText(text) {
  if (!text) return '';
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\n\r\t]/g, ' ')
    .substring(0, 500);
}

/**
 * Validate URL
 */
function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize URL (ensure absolute, add protocol if needed)
 */
function normalizeUrl(url, baseUrl) {
  if (!url) return null;
  
  // Already absolute
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  
  // Protocol-relative
  if (url.startsWith('//')) {
    return 'https:' + url;
  }
  
  // Relative URL
  if (baseUrl) {
    try {
      return new URL(url, baseUrl).toString();
    } catch {
      return null;
    }
  }
  
  return null;
}

/**
 * Extract domain from URL
 */
function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Chunk array into smaller arrays
 */
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Deep merge objects
 */
function deepMerge(target, source) {
  const output = { ...target };
  
  for (const key of Object.keys(source)) {
    if (source[key] instanceof Object && key in target) {
      output[key] = deepMerge(target[key], source[key]);
    } else {
      output[key] = source[key];
    }
  }
  
  return output;
}

/**
 * Fuzzy string match score (0-1)
 */
function fuzzyMatch(str1, str2) {
  if (!str1 || !str2) return 0;
  
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  
  if (s1 === s2) return 1;
  
  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);
  
  let matches = 0;
  for (const word of words1) {
    if (words2.some(w => w.includes(word) || word.includes(w))) {
      matches++;
    }
  }
  
  return matches / Math.max(words1.length, words2.length);
}

module.exports = {
  randomDelay,
  delay,
  getRandomUserAgent,
  retryAsync,
  generateProductId,
  generateSiteKey,
  parsePrice,
  formatPrice,
  cleanText,
  isValidUrl,
  normalizeUrl,
  extractDomain,
  chunkArray,
  deepMerge,
  fuzzyMatch
};