const HybridStrategy = require('../../src/strategies/HybridStrategy');

describe('HybridStrategy', () => {
  let strategy;

  beforeEach(() => {
    strategy = new HybridStrategy();
  });

  test('should have correct name', () => {
    expect(strategy.name).toBe('hybrid');
  });

  test('should validate products correctly', () => {
    expect(strategy.validateProduct({ name: 'Test Product' })).toBe(true);
    expect(strategy.validateProduct({ name: '' })).toBe(false);
    expect(strategy.validateProduct({ name: 'AB' })).toBe(false);
    expect(strategy.validateProduct(null)).toBe(false);
  });

  test('should calculate confidence correctly', () => {
    const products = [
      { name: 'Test', price: 29.99, imageUrl: 'http://example.com/img.jpg', productUrl: 'http://example.com/p' },
      { name: 'Test 2' }
    ];

    const confidence = strategy.calculateConfidence(products);

    expect(confidence).toBeGreaterThan(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  test('should find matching products', () => {
    const product = { name: 'Vintage Band Graphic Tee' };
    const pageData = [
      { url: 'http://example.com/p1', text: 'vintage band graphic tee shirt', image: 'img1.jpg' },
      { url: 'http://example.com/p2', text: 'plain white tee', image: 'img2.jpg' }
    ];

    const match = strategy.findMatch(product, pageData);

    expect(match).toBeDefined();
    expect(match.url).toBe('http://example.com/p1');
  });
});