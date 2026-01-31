const VisionStrategy = require('./VisionStrategy');
const SemanticStrategy = require('./SemanticStrategy');
const HybridStrategy = require('./HybridStrategy');
const logger = require('../utils/logger');

class StrategySelector {
  constructor() {
    this.strategies = {
      vision: new VisionStrategy(),
      semantic: new SemanticStrategy(),
      hybrid: new HybridStrategy()
    };
  }

  choose(pageAnalysis, context) {
    logger.info('Choosing extraction strategy...');

    // Priority 1: Schema.org data
    if (pageAnalysis && pageAnalysis.hasSchemaOrg) {
      logger.info('Schema.org detected - using semantic strategy');
      return this.strategies.semantic;
    }

    // Priority 2: Semantic HTML
    if (pageAnalysis && pageAnalysis.hasSemanticHTML) {
      logger.info('Semantic HTML detected - using semantic strategy');
      return this.strategies.semantic;
    }

    // Priority 3: Product grid patterns found
    if (pageAnalysis && pageAnalysis.productIndicators && pageAnalysis.productIndicators.length > 0) {
      const best = pageAnalysis.productIndicators.reduce((a, b) => 
        (a.count || 0) > (b.count || 0) ? a : b
      , { count: 0 });
      
      if (best.count >= 3) {
        logger.info(`Product grid detected (${best.count} items) - using hybrid strategy`);
        return this.strategies.hybrid;
      }
    }

    // Priority 4: React/SPA apps - use vision
    if (pageAnalysis && pageAnalysis.isReactApp) {
      logger.info('React/SPA app detected - using vision strategy');
      return this.strategies.vision;
    }

    // Default: Use hybrid (combines DOM + Vision)
    logger.info('Using default hybrid strategy');
    return this.strategies.hybrid;
  }

  fromPattern(pattern) {
    const strategyName = pattern.strategy?.name || 'hybrid';
    const strategy = this.strategies[strategyName] || this.strategies.hybrid;

    if (pattern.strategy?.selectors) {
      strategy.setSelectors(pattern.strategy.selectors);
    }

    return strategy;
  }

  get(name) {
    return this.strategies[name] || this.strategies.hybrid;
  }
}

module.exports = StrategySelector;