const readline = require('readline');
const fs = require('fs').promises;
const path = require('path');
const AgentOrchestrator = require('../agent/AgentOrchestrator');
const logger = require('../utils/logger');

class SiteAdder {
  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    this.agent = null;
  }

  async prompt(question) {
    return new Promise(resolve => {
      this.rl.question(question, answer => {
        resolve(answer.trim());
      });
    });
  }

  async run() {
    console.log('\n🤖 AI-Powered Site Addition Tool\n');
    console.log('This tool will test and add a new site to the scraper.\n');

    try {
      const siteName = await this.prompt('Site name (e.g., "Zara"): ');
      
      if (!siteName) {
        console.log('Site name is required');
        this.close();
        return;
      }

      const categories = [];
      let addMore = true;

      while (addMore) {
        console.log('\n--- Add Category ---');
        const catName = await this.prompt('Category name (e.g., "Women\'s Graphic Tees"): ');
        const catUrl = await this.prompt('Category URL: ');
        const table = await this.prompt('Airtable table (women/children/men): ');

        if (catName && catUrl && table) {
          categories.push({
            name: catName,
            url: catUrl,
            airtableTable: table
          });
          console.log(`✓ Added category: ${catName}`);
        }

        const more = await this.prompt('\nAdd another category? (y/n): ');
        addMore = more.toLowerCase() === 'y';
      }

      if (categories.length === 0) {
        console.log('At least one category is required');
        this.close();
        return;
      }

      // Test extraction
      const shouldTest = await this.prompt('\nTest extraction now? (y/n): ');

      if (shouldTest.toLowerCase() === 'y') {
        console.log('\n🔍 Testing extraction...\n');

        this.agent = new AgentOrchestrator();
        await this.agent.initialize();

        for (const category of categories) {
          try {
            console.log(`Testing: ${category.name}`);
            const products = await this.agent.scrapeSite({
              name: siteName,
              url: category.url,
              category: category.name
            });

            console.log(`✓ Found ${products.length} products`);

            if (products.length > 0) {
              console.log('\nSample product:');
              console.log(JSON.stringify(products[0], null, 2));
            }
          } catch (error) {
            console.log(`✗ Error: ${error.message}`);
          }
        }

        await this.agent.shutdown();
      }

      // Save configuration
      const shouldSave = await this.prompt('\nSave this site configuration? (y/n): ');

      if (shouldSave.toLowerCase() === 'y') {
        await this.saveConfig(siteName, categories);
        console.log('✓ Configuration saved to src/config/sites.js');
        console.log('\nYou can now run the scraper with: npm start');
      }

    } catch (error) {
      console.error('Error:', error.message);
    } finally {
      this.close();
    }
  }

  async saveConfig(siteName, categories) {
    const configPath = path.join(process.cwd(), 'src/config/sites.js');

    try {
      // Read current config
      let configContent = await fs.readFile(configPath, 'utf-8');

      // Find the sites array and add new site
      const newSite = {
        name: siteName,
        enabled: true,
        categories: categories
      };

      // Simple approach: read, parse, modify, write
      const sitesModule = require(configPath);
      sitesModule.sites.push(newSite);

      // Generate new content
      const newContent = `module.exports = ${JSON.stringify(sitesModule, null, 2)
        .replace(/"(\w+)":/g, '$1:')  // Remove quotes from keys
        .replace(/"/g, "'")};`;       // Use single quotes

      await fs.writeFile(configPath, newContent);

    } catch (error) {
      console.error('Could not save config:', error.message);
      console.log('\nManually add this to src/config/sites.js:');
      console.log(JSON.stringify({ name: siteName, enabled: true, categories }, null, 2));
    }
  }

  close() {
    this.rl.close();
    if (this.agent) {
      this.agent.shutdown().catch(() => {});
    }
  }
}

// Run
const adder = new SiteAdder();
adder.run();