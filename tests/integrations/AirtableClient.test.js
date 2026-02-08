const airtableClient = require('../../src/integrations/AirtableClient');

describe('AirtableClient', () => {
  test('should format products correctly for Airtable', () => {
    const product = {
      name: 'Test Product',
      price: 29.99,
      priceFormatted: '$29.99',
      imageUrl: 'http://example.com/image.jpg',
      productUrl: 'http://example.com/product',
      source: 'Test Site',
      category: 'Women',
      productId: 'abc123',
      scrapedAt: '2024-01-01T00:00:00Z',
      isActive: true
    };

    const formatted = airtableClient.formatForAirtable(product);

    expect(formatted['Style Name']).toBe('Test Product');
    expect(formatted['Category']).toBe('Women');
    expect(formatted['Store']).toBe('Test Site');
    expect(formatted['Product URL']).toBe('http://example.com/product');
    expect(formatted['Image']).toEqual([{ url: 'http://example.com/image.jpg' }]);
  });

  test('should handle missing image', () => {
    const product = {
      name: 'Test Product',
      price: 29.99
    };

    const formatted = airtableClient.formatForAirtable(product);

    expect(formatted['Image']).toBeUndefined();
  });
});