// test-one-site.js
const AgentOrchestrator = require('./src/agent/AgentOrchestrator');
const sitesConfig = require('./src/config/sites');
const logger = require('./src/utils/logger');

async function testOneSite() {
  const agent = new AgentOrchestrator();
  
  // Get site name from command line argument
  const siteName = process.argv[2];
  
  // Find the site in config
  let testSite = null;
  
  if (siteName) {
    // Find matching site (case-insensitive)
    const site = sitesConfig.sites.find(s => 
      s.name.toLowerCase() === siteName.toLowerCase()
    );
    
    if (!site) {
      console.log(`\nSite "${siteName}" not found!\n`);
      console.log('Available sites:');
      sitesConfig.sites.forEach(s => {
        const status = s.enabled ? '✓' : '✗';
        console.log(`  ${status} ${s.name}`);
      });
      process.exit(1);
    }
    
    if (!site.enabled) {
      console.log(`\nWarning: "${site.name}" is disabled in config, but running anyway...\n`);
    }
    
    // Use first category from the site
    const category = site.categories[0];
    testSite = {
      name: site.name,
      url: category.url,
      category: category.category
    };
  } else {
    // No argument - show usage and pick first enabled site
    console.log('\nUsage: node test-one-site.js <site-name>\n');
    console.log('Available sites:');
    sitesConfig.sites.forEach(s => {
      const status = s.enabled ? '✓' : '✗';
      console.log(`  ${status} ${s.name}`);
      s.categories.forEach(c => {
        console.log(`      - ${c.name}`);
      });
    });
    
    // Default to first enabled site
    const firstEnabled = sitesConfig.getEnabledSites()[0];
    if (!firstEnabled) {
      console.log('\nNo enabled sites found!');
      process.exit(1);
    }
    
    const category = firstEnabled.categories[0];
    testSite = {
      name: firstEnabled.name,
      url: category.url,
      category: category.category
    };
    
    console.log(`\nDefaulting to: ${testSite.name}\n`);
  }

  try {
    await agent.initialize();
    
    logger.info(`Testing: ${testSite.name} - ${testSite.category}`);
    logger.info(`URL: ${testSite.url}`);
    
    const products = await agent.scrapeSite(testSite);
    
    logger.info(`\n${'='.repeat(50)}`);
    logger.info(`RESULTS: Found ${products.length} products`);
    logger.info(`${'='.repeat(50)}\n`);
    
    if (products.length > 0) {
      // Count products with/without images
      const withImages = products.filter(p => p.imageUrl).length;
      const withUrls = products.filter(p => p.productUrl).length;
      
      logger.info(`With Images: ${withImages}/${products.length}`);
      logger.info(`With URLs: ${withUrls}/${products.length}\n`);
      
      // Show sample products
      logger.info('Sample Products:');
      logger.info('-'.repeat(50));
      
      products.slice(0, 10).forEach((p, i) => {
        logger.info(`${i + 1}. ${p.name}`);
        logger.info(`   Price: ${p.priceFormatted || p.price || 'N/A'}`);
        logger.info(`   Image: ${p.imageUrl ? '✓' : '✗ MISSING'}`);
        logger.info(`   URL: ${p.productUrl ? '✓' : '✗ MISSING'}`);
        if (p.imageUrl) {
          logger.info(`   Image URL: ${p.imageUrl.substring(0, 60)}...`);
        }
      });
      
      // Show products missing images
      const missingImages = products.filter(p => !p.imageUrl);
      if (missingImages.length > 0) {
        logger.info(`\n⚠️  Products missing images (${missingImages.length}):`);
        missingImages.slice(0, 5).forEach(p => {
          logger.info(`   - ${p.name}`);
        });
      }
    }
    
  } catch (error) {
    logger.error(`Test failed: ${error.message}`);
    console.error(error);
  } finally {
    await agent.shutdown();
  }
}

testOneSite();