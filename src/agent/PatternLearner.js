const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');
const { generateSiteKey } = require('../utils/helpers');

class PatternLearner {
  constructor() {
    this.patterns = new Map();
    this.patternsFile = path.join(process.cwd(), 'data/patterns/learned_patterns.json');
  }

  async loadPatterns() {
    try {
      const data = await fs.readFile(this.patternsFile, 'utf-8');
      const parsed = JSON.parse(data);
      for (const [key, value] of Object.entries(parsed)) {
        this.patterns.set(key, value);
      }
      logger.info(`Loaded ${this.patterns.size} patterns`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warn(`Could not load patterns: ${error.message}`);
      }
    }
  }

  async savePatterns() {
    try {
      await fs.mkdir(path.dirname(this.patternsFile), { recursive: true });
      const data = Object.fromEntries(this.patterns);
      await fs.writeFile(this.patternsFile, JSON.stringify(data, null, 2));
      logger.info('Patterns saved');
    } catch (error) {
      logger.error(`Could not save patterns: ${error.message}`);
    }
  }

  async getPattern(site) {
    const key = generateSiteKey(site);
    return this.patterns.get(key) || null;
  }

  async recordSuccess(context, strategy, products) {
    const key = generateSiteKey(context.site);
    const existing = this.patterns.get(key) || {};

    const pattern = {
      site: context.site,
      category: context.category,
      strategy: {
        name: strategy.name,
        selectors: strategy.selectors || null
      },
      lastSuccess: new Date().toISOString(),
      successCount: (existing.successCount || 0) + 1,
      avgProductCount: this.calcAvg(existing.avgProductCount || 0, existing.successCount || 0, products.length),
      confidence: this.calcConfidence(existing.confidence || 0.5, true),
      needsRelearning: false
    };

    this.patterns.set(key, pattern);

    if (pattern.successCount % 5 === 0) {
      await this.savePatterns();
    }
  }

  async recordFailure(context, error) {
    const key = generateSiteKey(context.site);
    const existing = this.patterns.get(key);

    if (existing) {
      existing.failureCount = (existing.failureCount || 0) + 1;
      existing.lastFailure = new Date().toISOString();
      existing.lastError = error.message;
      existing.confidence = this.calcConfidence(existing.confidence, false);

      if (existing.failureCount > 3 && existing.confidence < 0.3) {
        existing.needsRelearning = true;
      }

      this.patterns.set(key, existing);
    }
  }

  calcAvg(currentAvg, count, newValue) {
    return ((currentAvg * count) + newValue) / (count + 1);
  }

  calcConfidence(current, success) {
    const alpha = 0.3;
    return (alpha * (success ? 1 : 0)) + ((1 - alpha) * current);
  }
}

module.exports = PatternLearner;