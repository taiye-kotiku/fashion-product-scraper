const VisionAnalyzer = require('../../src/agent/VisionAnalyzer');

describe('VisionAnalyzer', () => {
  let analyzer;

  beforeEach(() => {
    analyzer = new VisionAnalyzer();
  });

  test('should deduplicate products correctly', () => {
    const products = [
      { name: 'Test Tee', price: 29.99 },
      { name: 'Test Tee', price: 29.99 },
      { name: 'Another Tee', price: 19.99 }
    ];

    const deduped = analyzer.deduplicateProducts(products);

    expect(deduped.length).toBe(2);
  });

  test('should calculate confidence correctly', () => {
    const products = [
      { name: 'Test', price: 29.99, imageDescription: 'Black tee' },
      { name: 'Test 2', price: null, imageDescription: '' }
    ];

    const confidence = analyzer.calculateConfidence(products);

    expect(confidence).toBeGreaterThan(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  test('should parse response correctly', () => {
    const response = `Here are the products:
    [
      {"name": "Test Tee", "price": "$29.99", "imageDescription": "Black tee"}
    ]`;

    const products = analyzer.parseResponse(response);

    expect(products.length).toBe(1);
    expect(products[0].name).toBe('Test Tee');
  });
});