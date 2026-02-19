// src/processors/ImageValidator.js
const axios = require('axios');
const logger = require('../utils/logger');
const imageExtractor = require('./ImageExtractor');

class ImageValidator {
  constructor() {
    this.minSize = 1000;
    this.validMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
    this.timeout = 8000;
    this.concurrency = 10;
  }

  async validateUrl(imageUrl) {
    if (!imageUrl) return false;

    if (imageUrl.startsWith('data:image')) return imageUrl.length > 500;

    if (!imageExtractor.isValidImageUrl(imageUrl)) return false;

    try {
      const response = await axios.head(imageUrl, {
        timeout: this.timeout,
        maxRedirects: 3,
        validateStatus: (status) => status < 400,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ImageValidator/1.0)',
          'Accept': 'image/*'
        }
      });

      const contentType = response.headers['content-type'] || '';
      const contentLength = parseInt(response.headers['content-length'] || '0');

      if (!this.validMimeTypes.some(type => contentType.includes(type))) return false;
      if (contentLength > 0 && contentLength < this.minSize) return false;
      return true;
    } catch {
      try {
        await axios.get(imageUrl, {
          timeout: this.timeout,
          maxRedirects: 3,
          headers: { 'Range': 'bytes=0-0', 'User-Agent': 'Mozilla/5.0 (compatible; ImageValidator/1.0)' },
          validateStatus: (status) => status < 400 || status === 206
        });
        return true;
      } catch {
        return false;
      }
    }
  }

  async validateBatch(products, options = {}) {
    if (options.skipValidation) return products;

    const results = new Array(products.length);
    let nextIndex = 0;
    let invalidCount = 0;

    const worker = async () => {
      while (nextIndex < products.length) {
        const index = nextIndex++;
        const product = products[index];

        if (!product.imageUrl) {
          results[index] = { ...product, imageValidated: false };
          continue;
        }

        const isValid = await this.validateUrl(product.imageUrl);
        if (isValid) {
          results[index] = { ...product, imageValidated: true };
        } else {
          invalidCount++;
          results[index] = { ...product, imageUrl: null, imageValidated: false };
        }
      }
    };

    const workerCount = Math.min(this.concurrency, products.length);
    const workers = [];
    for (let i = 0; i < workerCount; i++) workers.push(worker());
    await Promise.all(workers);

    if (invalidCount > 0) {
      logger.warn(`Image validation: ${invalidCount}/${products.length} had invalid images`);
    }

    return results;
  }

  isValidImageUrl(url) {
    return imageExtractor.isValidImageUrl(url);
  }
}

module.exports = new ImageValidator();