const fs = require('fs').promises;
const path = require('path');

async function viewPatterns() {
  const patternsFile = path.join(process.cwd(), 'data/patterns/learned_patterns.json');

  try {
    const content = await fs.readFile(patternsFile, 'utf-8');
    const patterns = JSON.parse(content);

    console.log('\n📚 Learned Patterns\n');
    console.log('='.repeat(60));

    const entries = Object.entries(patterns);

    if (entries.length === 0) {
      console.log('No patterns learned yet.');
      console.log('Run the scraper to start learning patterns.');
      return;
    }

    for (const [key, pattern] of entries) {
      console.log(`\n🔑 ${pattern.site}`);
      console.log(`   Category: ${pattern.category}`);
      console.log(`   Strategy: ${pattern.strategy?.name || 'unknown'}`);
      console.log(`   Confidence: ${(pattern.confidence * 100).toFixed(1)}%`);
      console.log(`   Success Count: ${pattern.successCount || 0}`);
      console.log(`   Avg Products: ${(pattern.avgProductCount || 0).toFixed(1)}`);
      console.log(`   Last Success: ${pattern.lastSuccess || 'never'}`);
      
      if (pattern.needsRelearning) {
        console.log(`   ⚠️  Needs relearning`);
      }

      if (pattern.strategy?.selectors) {
        console.log(`   Selectors:`);
        console.log(`     Container: ${pattern.strategy.selectors.container}`);
        console.log(`     Name: ${pattern.strategy.selectors.name}`);
        console.log(`     Price: ${pattern.strategy.selectors.price}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`Total patterns: ${entries.length}`);

  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('\nNo patterns file found.');
      console.log('Run the scraper first to learn patterns.');
    } else {
      console.error('Error reading patterns:', error.message);
    }
  }
}

viewPatterns();