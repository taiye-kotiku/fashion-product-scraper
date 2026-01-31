const AgentOrchestrator = require('../agent/AgentOrchestrator');
const logger = require('../utils/logger');

async function testSite() {
  const url = process.argv[2];
  const category = process.argv[3] || 'Graphic Tees';
  const siteName = process.argv[4] || 'Test Site';

  if (!url) {
    console.log('Usage: npm run test-site <url> [category] [siteName]');
    console.log('Example: npm run test-site "https://example.com/tees" "Women\'s Tees" "Example Store"');
    process.exit(1);
  }

  console.log('\n🔍 Testing URL:', url);
  console.log('Category:', category);
  console.log('Site:', siteName);
  console.log('');

  const agent = new AgentOrchestrator();

  try {
    await agent.initialize();

    const products = await agent.scrapeSite({
      name: siteName,
      url: url,
      category: category
    });

    console.log('\n' + '='.repeat(50));
    console.log(`Found ${products.length} products`);
    console.log('='.repeat(50));

    if (products.length > 0) {
      console.log('\nFirst 3 products:');
      products.slice(0, 3).forEach((p, i) => {
        console.log(`\n--- Product ${i + 1} ---`);
        console.log(`Name: ${p.name}`);
        console.log(`Price: ${p.priceFormatted || p.price}`);
        console.log(`Image: ${p.imageUrl ? 'Yes' : 'No'}`);
        console.log(`URL: ${p.productUrl ? 'Yes' : 'No'}`);
      });
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  } finally {
    await agent.shutdown();
  }
}

testSite();