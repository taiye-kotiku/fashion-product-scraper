const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');

async function clearPatterns() {
  const patternsFile = path.join(process.cwd(), 'data/patterns/learned_patterns.json');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const site = process.argv[2];

  if (site) {
    // Clear specific site
    try {
      const content = await fs.readFile(patternsFile, 'utf-8');
      const patterns = JSON.parse(content);

      const keys = Object.keys(patterns);
      const toDelete = keys.filter(k => 
        patterns[k].site?.toLowerCase().includes(site.toLowerCase())
      );

      if (toDelete.length === 0) {
        console.log(`No patterns found for site: ${site}`);
        rl.close();
        return;
      }

      console.log(`Found ${toDelete.length} pattern(s) to delete:`);
      toDelete.forEach(k => console.log(`  - ${patterns[k].site}`));

      rl.question('\nConfirm delete? (y/n): ', async (answer) => {
        if (answer.toLowerCase() === 'y') {
          toDelete.forEach(k => delete patterns[k]);
          await fs.writeFile(patternsFile, JSON.stringify(patterns, null, 2));
          console.log('✓ Patterns deleted');
        } else {
          console.log('Cancelled');
        }
        rl.close();
      });

    } catch (error) {
      console.error('Error:', error.message);
      rl.close();
    }
  } else {
    // Clear all
    rl.question('⚠️  Delete ALL learned patterns? (yes/no): ', async (answer) => {
      if (answer.toLowerCase() === 'yes') {
        try {
          await fs.writeFile(patternsFile, '{}');
          console.log('✓ All patterns cleared');
        } catch (error) {
          console.error('Error:', error.message);
        }
      } else {
        console.log('Cancelled');
      }
      rl.close();
    });
  }
}

clearPatterns();