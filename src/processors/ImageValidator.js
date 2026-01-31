const axios = require('axios');
const logger = require('../utils/logger');

class ImageValidator {
  constructor() {
    this.minSize = 1000; // bytes
    this.validMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    this.timeout = 10000;
  }

  async validateUrl(imageUrl) {
    if (!imageUrl) return false;

    try {
      const response = await axios.head(imageUrl, {
        timeout: this.timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ImageValidator/1.0)'
        }
      });

      const contentType = response.headers['content-type'];
      const contentLength = parseInt(response.headers['content-length'] || '0');

      // Check content type
      if (!this.validMimeTypes.some(type => contentType?.includes(type))) {
        logger.debug(`Invalid image type: ${contentType}`);
        return false;
      }

      // Check size
      if (contentLength > 0 && contentLength < this.minSize) {
        logger.debug(`Image too small: ${contentLength} bytes`);
        return false;
      }

      return true;
    } catch (error) {
      logger.debug(`Image validation failed: ${error.message}`);
      return false;
    }
  }

  async validateBatch(products, options = {}) {
    const { skipValidation = false } = options;

    if (skipValidation) {
      return products;
    }

    const validatedProducts = [];
    let invalidCount = 0;

    for (const product of products) {
      if (!product.imageUrl) {
        // Keep products without images but mark them
        validatedProducts.push({
          ...product,
          imageValidated: false
        });
        continue;
      }

      const isValid = await this.validateUrl(product.imageUrl);

      if (isValid) {
        validatedProducts.push({
          ...product,
          imageValidated: true
        });
      } else {
        invalidCount++;
        // Still include product but without image
        validatedProducts.push({
          ...product,
          imageUrl: null,
          imageValidated: false
        });
      }
    }

    if (invalidCount > 0) {
      logger.warn(`${invalidCount} products had invalid images`);
    }

    return validatedProducts;
  }

  isValidImageUrl(url) {
    if (!url) return false;

    try {
      const parsed = new URL(url);
      const ext = parsed.pathname.toLowerCase();

      // Check for common image extensions
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'];
      const hasImageExt = imageExtensions.some(ext2 => ext.includes(ext2));

      // Or check for image-related paths
      const hasImagePath = ext.includes('image') || ext.includes('img') || ext.includes('photo');

      return hasImageExt || hasImagePath || parsed.hostname.includes('cdn');
    } catch {
      return false;
    }
  }
}

module.exports = new ImageValidator();