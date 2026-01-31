const crypto = require('crypto');

class SiteFingerprint {
  constructor(url, domStructure) {
    this.url = url;
    this.domStructure = domStructure;
    this.fingerprint = this.generate();
  }

  generate() {
    const elements = [
      this.domStructure?.productContainers?.length || 0,
      this.domStructure?.hasSchemaOrg ? 1 : 0,
      this.domStructure?.hasSemanticHTML ? 1 : 0,
      JSON.stringify(this.domStructure?.productIndicators || [])
    ];

    const str = elements.join('|');
    return crypto.createHash('md5').update(str).digest('hex');
  }

  matches(other) {
    return this.fingerprint === other.fingerprint;
  }

  toJSON() {
    return {
      url: this.url,
      fingerprint: this.fingerprint,
      createdAt: new Date().toISOString()
    };
  }
}

module.exports = SiteFingerprint;