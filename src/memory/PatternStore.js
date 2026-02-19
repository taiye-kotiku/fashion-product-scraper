// src/memory/PatternStore.js
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class PatternStore {
  constructor(filePath) {
    this.filePath = filePath || path.join(process.cwd(), 'data/patterns/store.json');
    this.data = {};
    this.isDirty = false;
  }

  async load() {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      this.data = JSON.parse(content);
      logger.info(`PatternStore loaded ${Object.keys(this.data).length} entries`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.info('PatternStore: No existing file, starting fresh');
        this.data = {};
        return;
      }

      logger.warn(`PatternStore corrupted: ${error.message}. Trying backup...`);
      const backupPath = this.filePath + '.backup';

      try {
        const backup = await fs.readFile(backupPath, 'utf-8');
        this.data = JSON.parse(backup);
        logger.info(`PatternStore recovered from backup (${Object.keys(this.data).length} entries)`);
        await this.save();
      } catch {
        logger.error('PatternStore backup also failed. Starting fresh.');
        this.data = {};
      }
    }
  }

  async save() {
    try {
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });

      try {
        await fs.access(this.filePath);
        await fs.copyFile(this.filePath, this.filePath + '.backup');
      } catch {}

      const tempPath = this.filePath + '.tmp';
      await fs.writeFile(tempPath, JSON.stringify(this.data, null, 2), 'utf-8');
      await fs.rename(tempPath, this.filePath);

      this.isDirty = false;
      logger.debug(`PatternStore saved (${Object.keys(this.data).length} entries)`);
    } catch (error) {
      logger.error(`PatternStore save failed: ${error.message}`);
      try { await fs.unlink(this.filePath + '.tmp'); } catch {}
    }
  }

  get(key) { return this.data[key]; }

  set(key, value) {
    this.data[key] = value;
    this.isDirty = true;
  }

  delete(key) {
    delete this.data[key];
    this.isDirty = true;
  }

  getAll() { return { ...this.data }; }

  get size() { return Object.keys(this.data).length; }

  async saveIfDirty() {
    if (this.isDirty) await this.save();
  }
}

module.exports = PatternStore;