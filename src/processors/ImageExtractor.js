// src/processors/ImageExtractor.js
const logger = require('../utils/logger');

class ImageExtractor {
  constructor() {
    this.placeholderPatterns = [
      /placeholder/i, /blank\.(gif|png|jpg)/i, /spacer/i, /loading/i,
      /spinner/i, /grey\.|gray\./i, /pixel\./i, /1x1/i, /transparent/i,
      /no-image/i, /default-image/i, /missing/i, /coming-soon/i,
    ];
    this.minBase64Length = 500;
  }

  isValidImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (url.length < 10) return false;

    for (const pattern of this.placeholderPatterns) {
      if (pattern.test(url)) return false;
    }

    if (url.startsWith('data:')) {
      return url.length >= this.minBase64Length && url.startsWith('data:image');
    }

    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('//')) {
      return false;
    }

    const hasImageExtension = /\.(jpg|jpeg|png|webp|gif|avif)/i.test(url);
    const isImageCdn = /(cloudinary|imgix|shopify|cloudfront|akamaized|scene7|media\.|mediahub|xcdn)/i.test(url);
    const hasImagePath = /(image|photo|product|media|assets|cdn)/i.test(url);

    return hasImageExtension || isImageCdn || hasImagePath;
  }

  normalizeUrl(url, baseUrl) {
    if (!url) return null;
    try {
      if (url.startsWith('//')) url = 'https:' + url;
      if (url.startsWith('/')) {
        const base = new URL(baseUrl);
        url = `${base.origin}${url}`;
      }
      if (!url.startsWith('http') && !url.startsWith('data:')) {
        url = new URL(url, baseUrl).href;
      }
      if (url.startsWith('http://')) url = url.replace('http://', 'https://');
      return url;
    } catch { return null; }
  }

  getExtractionScript() {
    return `
      function extractBestImage(container) {
        const placeholderPatterns = [
          /placeholder/i, /blank/i, /spacer/i, /loading/i,
          /spinner/i, /1x1/i, /transparent/i, /no-image/i
        ];

        function isPlaceholder(url) {
          if (!url || url.length < 20) return true;
          if (url.startsWith('data:') && url.length < 500) return true;
          return placeholderPatterns.some(p => p.test(url));
        }

        function getImageFromSrcset(srcset) {
          if (!srcset) return null;
          const sources = srcset.split(',').map(s => {
            const parts = s.trim().split(/\\s+/);
            const url = parts[0];
            const descriptor = parts[1] || '1x';
            let size = 1;
            if (descriptor.endsWith('w')) size = parseInt(descriptor);
            else if (descriptor.endsWith('x')) size = parseFloat(descriptor) * 1000;
            return { url, size };
          });
          sources.sort((a, b) => b.size - a.size);
          for (const s of sources) {
            if (!isPlaceholder(s.url)) return s.url;
          }
          return null;
        }

        const imgAttrs = [
          'data-src', 'data-lazy-src', 'data-lazysrc', 'data-original',
          'data-image', 'data-img-src', 'data-full-src', 'data-zoom-image',
          'data-large-image', 'data-main-image', 'src'
        ];

        const picture = container.querySelector('picture');
        if (picture) {
          const sources = picture.querySelectorAll('source[srcset]');
          for (const source of sources) {
            const url = getImageFromSrcset(source.getAttribute('srcset'));
            if (url && !isPlaceholder(url)) return url;
          }
        }

        const imgWithSrcset = container.querySelector('img[srcset]');
        if (imgWithSrcset) {
          const url = getImageFromSrcset(imgWithSrcset.getAttribute('srcset'));
          if (url && !isPlaceholder(url)) return url;
        }

        const imgs = container.querySelectorAll('img');
        for (const img of imgs) {
          const width = img.naturalWidth || img.width || parseInt(img.getAttribute('width')) || 0;
          const height = img.naturalHeight || img.height || parseInt(img.getAttribute('height')) || 0;
          if ((width > 0 && width < 50) || (height > 0 && height < 50)) continue;
          for (const attr of imgAttrs) {
            const url = img.getAttribute(attr);
            if (url && !isPlaceholder(url)) return url;
          }
        }

        const bgElements = container.querySelectorAll('[style*="background"], [class*="image"], [class*="photo"]');
        for (const el of bgElements) {
          const style = window.getComputedStyle(el);
          const bg = style.backgroundImage;
          if (bg && bg !== 'none') {
            const match = bg.match(/url\\(['"]?([^'"\\)]+)['"]?\\)/);
            if (match && match[1] && !isPlaceholder(match[1])) return match[1];
          }
        }

        for (const img of imgs) {
          const src = img.getAttribute('src');
          if (src && !isPlaceholder(src) && !src.startsWith('data:')) return src;
        }

        return null;
      }
    `;
  }
}

module.exports = new ImageExtractor();