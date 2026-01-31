const AgentOrchestrator = require('../../src/agent/AgentOrchestrator');

describe('AgentOrchestrator', () => {
  let agent;

  beforeEach(() => {
    agent = new AgentOrchestrator();
  });

  afterEach(async () => {
    if (agent) {
      await agent.shutdown();
    }
  });

  test('should initialize correctly', async () => {
    await agent.initialize();
    expect(agent.browserManager.browser).toBeDefined();
  });

  test('should clean products correctly', () => {
    const context = { site: 'Test', category: 'Tees' };
    const products = [
      { name: 'Test Product', price: 29.99 },
      { name: '', price: 19.99 },
      { name: 'AB', price: 9.99 },
      { name: 'Valid Product 2', price: 39.99 }
    ];

    const cleaned = agent.cleanProducts(products, context);

    expect(cleaned.length).toBe(2);
    expect(cleaned[0].name).toBe('Test Product');
    expect(cleaned[0].source).toBe('Test');
    expect(cleaned[0].category).toBe('Tees');
  });
});