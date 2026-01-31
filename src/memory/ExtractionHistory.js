const fs = require('fs').promises;
const path = require('path');

class ExtractionHistory {
  constructor() {
    this.historyFile = path.join(process.cwd(), 'data/patterns/history.json');
    this.history = [];
    this.maxEntries = 1000;
  }

  async load() {
    try {
      const content = await fs.readFile(this.historyFile, 'utf-8');
      this.history = JSON.parse(content);
    } catch {
      this.history = [];
    }
  }

  async save() {
    try {
      await fs.mkdir(path.dirname(this.historyFile), { recursive: true });
      await fs.writeFile(this.historyFile, JSON.stringify(this.history.slice(-this.maxEntries), null, 2));
    } catch {}
  }

  add(entry) {
    this.history.push({
      ...entry,
      timestamp: new Date().toISOString()
    });

    if (this.history.length > this.maxEntries) {
      this.history = this.history.slice(-this.maxEntries);
    }
  }

  getForSite(site) {
    return this.history.filter(h => h.site === site);
  }

  getRecent(count = 10) {
    return this.history.slice(-count);
  }
}

module.exports = ExtractionHistory;