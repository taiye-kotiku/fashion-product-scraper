const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class PatternStore {
  constructor(filePath) {
    this.filePath = filePath || path.join(process.cwd(), 'data/patterns/store.json');
    this.data = {};
  }

  async load() {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      this.data = JSON.parse(content);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.warn(`Could not load store: ${error.message}`);
      }
      this.data = {};
    }
  }

  async save() {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (error) {
      logger.error(`Could not save store: ${error.message}`);
    }
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
  }

  delete(key) {
    delete this.data[key];
  }

  getAll() {
    return { ...this.data };
  }
}

module.exports = PatternStore;