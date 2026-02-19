// src/config/sites.js
const sitesModule = {
  sites: [
    {
      name: 'River Island',
      enabled: true,
      useScrapingBee: false,
      categories: [
        {
          name: 'Women Graphic Tees',
          url: 'https://www.riverisland.com/search?keyword=graphic%20tee&f-division=women',
          category: 'Women'
        },
        {
          name: 'Men Graphic Tees',
          url: 'https://www.riverisland.com/search?keyword=graphic%20tee&f-division=men',
          category: 'Men'
        },
        {
          name: 'Boys Graphic Tees',
          url: 'https://www.riverisland.com/c/boys/tops',
          category: 'Boys'
        },
        {
          name: 'Girls Graphic Tees',
          url: 'https://www.riverisland.com/c/girls/tops',
          category: 'Girls'
        }
      ]
    },
    {
      name: 'Boohoo Man',
      enabled: true,
      useScrapingBee: false,
      scrapingBeeFallback: true,
      categories: [
        {
          name: 'Men Graphic Tees',
          url: 'https://www.boohooman.com/us/mens/tops/graphic-tops',
          category: 'Men'
        }
      ]
    },
    {
      name: 'Next',
      enabled: true,
      useScrapingBee: false,
      scrapingBeeFallback: true,
      categories: [
        {
          name: 'Boys Graphic Tees',
          url: 'https://www.next.us/en/shop/boys/clothing/tops/t-shirts/f/pattern-graphic',
          category: 'Boys'
        },
        {
          name: 'Girls Graphic Tees',
          url: 'https://www.next.us/en/shop/girls/clothing/tops/t-shirts',
          category: 'Girls'
        },
        {
          name: 'Women Graphic Tees',
          url: 'https://www.next.us/en/shop/womens/clothing/tops',
          category: 'Women'
        },
        {
          name: 'Men Graphic Tees',
          url: 'https://www.next.us/en/shop/mens/clothing/tops/f/pattern-graphic',
          category: 'Men'
        }
      ]
    },
    {
      name: 'Snipes',
      enabled: false,
      useScrapingBee: true,
      categories: [
        {
          name: 'Men Graphic Tees',
          url: 'https://www.snipesusa.com/mens-graphic-tees/',
          category: 'Men'
        }
      ]
    },
    {
      name: 'Abercrombie',
      enabled: true,
      useScrapingBee: false,
      scrapingBeeFallback: true,
      categories: [
        {
          name: 'Boys Graphic Tees',
          url: 'https://www.abercrombie.com/shop/us/kids/boys-tops-graphic-tees-t-shirts-and-henleys',
          category: 'Boys'
        },
        {
          name: 'Girls Graphic Tees',
          url: 'https://www.abercrombie.com/shop/us/kids/girls-tops',
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
          name: 'Women Graphic Tees',
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
          name: 'Women Graphic Tees',
          url: 'https://www.altardstate.com/as/clothing/tops/graphics/',
          category: 'Women'
        }
      ]
    }
  ],

  siteHints: {
    'River Island': { waitTime: 3000, scrollCount: 4 },
    'Boohoo Man': { waitTime: 5000, scrollCount: 6 },
    'Next': { waitTime: 4000, scrollCount: 5 },
    'Snipes': { waitTime: 5000, scrollCount: 4 },
    'Abercrombie': { waitTime: 5000, scrollCount: 6 }
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

function validateSiteConfigs(sites) {
  const errors = [];
  const names = new Set();
  for (const site of sites) {
    if (!site.name) { errors.push('Site missing name'); continue; }
    if (names.has(site.name.toLowerCase())) errors.push(`Duplicate site: "${site.name}"`);
    names.add(site.name.toLowerCase());
    if (site.enabled === undefined) errors.push(`"${site.name}" missing 'enabled'`);
    if (!Array.isArray(site.categories) || site.categories.length === 0) {
      errors.push(`"${site.name}" needs at least one category`); continue;
    }
    for (const cat of site.categories) {
      if (!cat.name) errors.push(`"${site.name}" has category missing 'name'`);
      if (!cat.url) errors.push(`"${site.name}" category "${cat.name || '?'}" missing 'url'`);
      else { try { new URL(cat.url); } catch { errors.push(`"${site.name}" "${cat.name}" invalid URL`); } }
      if (!cat.category) errors.push(`"${site.name}" "${cat.name}" missing 'category'`);
    }
  }
  if (errors.length > 0) {
    const msg = `Site config errors:\n  - ${errors.join('\n  - ')}`;
    console.error(`❌ ${msg}`);
    throw new Error(msg);
  }
}

validateSiteConfigs(sitesModule.sites);
module.exports = sitesModule;