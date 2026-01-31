module.exports = {
  sites: [
    {
      name: 'River Island',
      enabled: true,
      useScrapingBee: false,
      categories: [
        {
          name: "Women Graphic Tees",
          url: 'https://www.riverisland.com/search?keyword=graphic%20tee&f-division=women',
          category: 'Women'
        },
        {
          name: "Men Graphic Tees",
          url: 'https://www.riverisland.com/search?keyword=graphic%20tee&f-division=men',
          category: 'Men'
        },
        {
          name: "Boys Graphic Tees",
          url: 'https://www.riverisland.com/c/boys/tops',
          category: 'Boys'
        },
        {
          name: "Girls Graphic Tees",
          url: 'https://www.riverisland.com/c/girls/tops',
          category: 'Girls'
        }
      ]
    },
    {
      name: 'Boohoo Man',
      enabled: true,
      useScrapingBee: false,
      categories: [
        {
          name: "Men Graphic Tees",
          url: 'https://www.boohooman.com/us/mens/tops/graphic-tops',
          category: 'Men'
        }
      ]
    },
    {
      name: 'Next',
      enabled: true,
      useScrapingBee: false,
      categories: [
        {
          name: "Boys Graphic Tees",
          url: 'https://www.next.us/en/shop/boys/clothing/tops/t-shirts/f/pattern-graphic',
          category: 'Boys'
        },
        {
          name: "Girls Graphic Tees",
          url: 'https://www.next.us/en/shop/girls/clothing/tops/t-shirts',
          category: 'Girls'
        },
        {
          name: "Women Graphic Tees",
          url: 'https://www.next.us/en/shop/womens/clothing/tops',
          category: 'Women'
        },
        {
          name: "Men Graphic Tees",
          url: 'https://www.next.us/en/shop/mens/clothing/tops/f/pattern-graphic',
          category: 'Men'
        }
      ]
    },
    {
      name: 'Snipes',
      enabled: true,
      useScrapingBee: true,  // Requires ScrapingBee due to bot protection
      categories: [
        {
          name: "Men Graphic Tees",
          url: 'https://www.snipesusa.com/mens-graphic-tees/',
          category: 'Men'
        }
      ]
    },
    {
      name: 'Abercrombie',
      enabled: true,
      useScrapingBee: true,  // Requires ScrapingBee due to bot protection
      categories: [
        {
          name: "Boys Graphic Tees",
          url: 'https://www.abercrombie.com/shop/us/kids/boys-tops-graphic-tees-t-shirts-and-henleys',
          category: 'Boys'
        },
        {
          name: "Girls Graphic Tees",
          url: 'https://www.abercrombie.com/shop/us/kids/girls-tops-graphic-tees-t-shirts-and-henleys',
          category: 'Girls'
        }
      ]
    },
    {
      name: 'Anthropologie',
      enabled: false,
      useScrapingBee: true,
      categories: [
        {
          name: "Women Graphic Tees",
          url: 'https://www.anthropologie.com/tops-graphic-tees',
          category: 'Women'
        }
      ]
    },
    {
      name: 'Altard State',
      enabled: false,
      useScrapingBee: true,
      categories: [
        {
          name: "Women Graphic Tees",
          url: 'https://www.altardstate.com/as/clothing/tops/graphics/',
          category: 'Women'
        }
      ]
    }
  ],

  siteHints: {
    'River Island': { waitTime: 3000, scrollCount: 4 },
    'Boohoo Man': { waitTime: 3000, scrollCount: 4 },
    'Next': { waitTime: 3000, scrollCount: 4 },
    'Snipes': { waitTime: 5000, scrollCount: 4 },
    'Abercrombie': { waitTime: 5000, scrollCount: 5 }
  },

  getEnabledSites() {
    return this.sites.filter(s => s.enabled);
  },

  getSiteHints(siteName) {
    return this.siteHints[siteName] || { waitTime: 3000, scrollCount: 3 };
  },

  getSiteByName(name) {
    return this.sites.find(s => s.name.toLowerCase() === name.toLowerCase());
  }
};