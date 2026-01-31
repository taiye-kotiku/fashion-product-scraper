// ============================================
// HTML DUMP SUPPRESSION - MUST BE AT VERY TOP
// ============================================
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = function(chunk, encoding, callback) {
  const str = typeof chunk === 'string' ? chunk : chunk.toString();
  if (str.includes('<!DOCTYPE') || str.includes('<html') || str.includes('<head>') || str.length > 5000) {
    return originalStdoutWrite('[HTML OUTPUT SUPPRESSED]\n', encoding, callback);
  }
  return originalStdoutWrite(chunk, encoding, callback);
};

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason?.message || 'Unknown error');
});
// ============================================

const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const OpenAI = require('openai');
require('dotenv').config();

const testSites = [
  {
    name: 'H&M',
    url: 'https://www2.hm.com/en_us/women/products/tops/t-shirts.html'
  },
  {
    name: 'Nordstrom',
    url: 'https://www.nordstrom.com/browse/women/clothing/tops-tees'
  },
  {
    name: 'Mango',
    url: 'https://shop.mango.com/us/en/c/women/t-shirts_c67888439'
  },
  {
    name: 'ASOS',
    url: 'https://www.asos.com/us/women/tops/t-shirts-tanks/cat/?cid=4718'
  },
  {
    name: 'Uniqlo',
    url: 'https://www.uniqlo.com/us/en/women/tops/t-shirts'
  }
];

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testSite(browser, openai, site) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Testing: ${site.name}`);
  console.log(`URL: ${site.url}`);
  console.log('='.repeat(50));

  const page = await browser.newPage();

  try {
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });

    // Block unnecessary resources to speed up loading
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['font', 'media'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log('Navigating...');
    await page.goto(site.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await delay(5000);

    // Scroll to load more products
    console.log('Scrolling...');
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 500));
      await delay(1000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await delay(1000);

    // Check if page is blocked BEFORE doing anything else
    const blockCheck = await page.evaluate(() => {
      const bodyText = document.body.innerText.slice(0, 1000).toLowerCase();
      return {
        isBlocked: bodyText.includes('wait') || 
                   bodyText.includes('blocked') || 
                   bodyText.includes('captcha') || 
                   bodyText.includes('robot') ||
                   bodyText.includes('access denied') ||
                   bodyText.includes('verify you are human') ||
                   bodyText.includes('checking your browser'),
        title: document.title,
        productElements: document.querySelectorAll('[class*="product"], [class*="Product"], article, [data-product]').length,
        images: document.querySelectorAll('img').length
      };
    });

    console.log(`Page Title: ${blockCheck.title}`);
    console.log(`Product-like elements: ${blockCheck.productElements}`);
    console.log(`Images: ${blockCheck.images}`);

    if (blockCheck.isBlocked) {
      console.log('⚠️ Page appears to be BLOCKED - skipping LLM analysis');
      await page.close();
      return { name: site.name, status: 'blocked', products: 0 };
    }

    if (blockCheck.productElements === 0 && blockCheck.images < 5) {
      console.log('⚠️ Page appears empty or failed to load - skipping');
      await page.close();
      return { name: site.name, status: 'empty', products: 0 };
    }

    // Take screenshot
    console.log('Taking screenshot...');
    const screenshot = await page.screenshot({
      encoding: 'base64',
      type: 'jpeg',
      quality: 80
    });

    // Save screenshot
    const filename = `${site.name.toLowerCase().replace(/\s+/g, '-')}-test.jpg`;
    await fs.writeFile(`data/screenshots/${filename}`, Buffer.from(screenshot, 'base64'));
    console.log(`Screenshot saved: data/screenshots/${filename}`);

    // Send to Vision API
    console.log('Analyzing with GPT-4 Vision...');
    const prompt = `Look at this fashion website screenshot and extract all visible products.

For each product, provide:
- name: Product name/title
- price: Price with currency
- imageDescription: Brief description

Return a JSON array:
[{"name": "...", "price": "...", "imageDescription": "..."}]

If no products are visible, return: []`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${screenshot}`,
                detail: 'high'
              }
            }
          ]
        }
      ],
      max_tokens: 4000
    });

    const llmResponse = response.choices[0].message.content;
    
    // Only show first 500 chars of LLM response (avoid HTML dumps from LLM)
    const cleanResponse = llmResponse.slice(0, 500);
    if (!cleanResponse.includes('<html') && !cleanResponse.includes('<!DOCTYPE')) {
      console.log('\nLLM Response:', cleanResponse);
    }

    // Parse products
    let products = [];
    const jsonMatch = llmResponse.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      try {
        products = JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.log('JSON parse error:', e.message);
      }
    }

    console.log(`\n✓ Found ${products.length} products`);
    if (products.length > 0) {
      console.log('Sample products:');
      products.slice(0, 3).forEach((p, i) => {
        console.log(`  ${i + 1}. ${p.name} - ${p.price || 'No price'}`);
      });
    }

    await page.close();
    return { name: site.name, status: 'success', products: products.length, data: products };

  } catch (error) {
    console.log(`Error: ${error.message}`);
    try { await page.close(); } catch {}
    return { name: site.name, status: 'error', error: error.message, products: 0 };
  }
}

async function main() {
  console.log('Multi-Site Test\n');

  // Ensure screenshots directory exists
  await fs.mkdir('data/screenshots', { recursive: true });

  // Initialize OpenAI
  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY not set in .env');
    process.exit(1);
  }
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Launch browser
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage'
    ]
  });

  const results = [];

  // Test each site
  for (let i = 0; i < testSites.length; i++) {
    const site = testSites[i];
    console.log(`\n[${i + 1}/${testSites.length}]`);
    
    try {
      const result = await testSite(browser, openai, site);
      results.push(result);
    } catch (error) {
      console.log(`Unexpected error for ${site.name}: ${error.message}`);
      results.push({ name: site.name, status: 'error', error: error.message, products: 0 });
    }

    // Delay between sites
    await delay(2000);
  }

  await browser.close();

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50));

  results.forEach(r => {
    const status = r.status === 'success' ? '✓' : r.status === 'blocked' ? '⚠️' : '✗';
    console.log(`${status} ${r.name}: ${r.products} products ${r.status !== 'success' ? `(${r.status})` : ''}`);
  });

  // Find best working sites
  const workingSites = results.filter(r => r.products > 0);
  console.log(`\n${workingSites.length} sites returned products`);

  if (workingSites.length > 0) {
    console.log('\nRecommended sites to use:');
    workingSites.forEach(s => {
      console.log(`  - ${s.name} (${s.products} products)`);
    });
  }
}

main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});