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

    expect(formatted['Name']).toBe('Test Product');
    expect(formatted['Price']).toBe(29.99);
    expect(formatted['Price Display']).toBe('$29.99');
    expect(formatted['Image']).toEqual([{ url: 'http://example.com/image.jpg' }]);
    expect(formatted['Source']).toBe('Test Site');
    expect(formatted['Is Active']).toBe(true);
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