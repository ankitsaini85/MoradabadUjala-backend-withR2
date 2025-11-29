// News API Service - Live fetching from GNews API
const axios = require('axios');

class NewsAPIService {
  constructor() {
    this.apiKey = process.env.NEWS_API_KEY;
    this.provider = (process.env.NEWS_PROVIDER || 'gnews').toLowerCase();
    this.baseUrl = this.provider === 'newsapi' ? 'https://newsapi.org/v2' : 'https://gnews.io/api/v4';
    this.cache = new Map(); // Simple in-memory cache
    this.slugIndex = new Map(); // map slug -> article for direct lookup
    this.cacheTimeout = 10 * 60 * 1000; // 10 minutes
  }

  // Map our categories to GNews categories
  mapCategory(category) {
    const categoryMap = {
      'breaking': 'general',
      'india': 'nation',
      'world': 'world',
      'sports': 'sports',
      'entertainment': 'entertainment',
      'business': 'business',
      'technology': 'technology',
      'health': 'health',
      'education': 'general',
      'lifestyle': 'general',
      'auto': 'technology',
      'religion': 'general'
    };
    return categoryMap[category] || 'general';
  }

  // Get cache key
  getCacheKey(type, params) {
    return `${type}-${JSON.stringify(params)}`;
  }

  // Check if cache is valid
  isCacheValid(cacheKey) {
    const cached = this.cache.get(cacheKey);
    if (!cached) return false;
    return Date.now() - cached.timestamp < this.cacheTimeout;
  }

  // Fetch top headlines by category (LIVE)
  async fetchTopHeadlines(category = 'general', limit = 10) {
    try {
      if (!this.apiKey) {
        throw new Error('NEWS_API_KEY not configured. Please add your news provider API key to backend/.env file.');
      }

      // Check cache first
      const cacheKey = this.getCacheKey('headlines', { category, limit });
      if (this.isCacheValid(cacheKey)) {
        console.log(`✓ Returning cached ${category} news`);
        return this.cache.get(cacheKey).data;
      }

      // Provider-specific fetching
      if (this.provider === 'newsapi') {
        const newsapiCategory = this.mapCategory(category);
        const url = `${this.baseUrl}/top-headlines`;
        console.log(`🌐 Fetching LIVE ${category} news from NewsAPI.org...`);

        const params = {
          apiKey: this.apiKey,
          pageSize: limit
        };

        // NewsAPI supports country and category for top-headlines
        // If category is 'india' or user asked for india, use country=in
        if (category === 'india') {
          params.country = 'in';
        } else if (['business','entertainment','general','health','science','sports','technology'].includes(newsapiCategory)) {
          params.category = newsapiCategory;
          params.country = 'in';
        } else {
          // fallback: use general top headlines for India
          params.country = 'in';
        }

        const response = await axios.get(url, { params, timeout: 10000 });
        if (response.data && response.data.articles) {
          let articles = response.data.articles || [];

          // If provider returned zero articles for this category, attempt a relaxed fallback
          if (Array.isArray(articles) && articles.length === 0) {
            console.warn(`⚠️ NewsAPI returned 0 articles for category=${category}. Trying fallback query.`);
            try {
              // First try relaxing category and adding a q term to top-headlines
              const fallbackParams = { ...params };
              delete fallbackParams.category;
              fallbackParams.q = 'india';
              let fallbackResp = await axios.get(url, { params: fallbackParams, timeout: 10000 });
              if (!(fallbackResp.data && Array.isArray(fallbackResp.data.articles) && fallbackResp.data.articles.length > 0)) {
                // If still empty, use the /everything endpoint which is broader
                const everythingUrl = `${this.baseUrl}/everything`;
                const everythingParams = {
                  q: 'india OR भारत',
                  language: 'en',
                  pageSize: limit,
                  apiKey: this.apiKey
                };
                fallbackResp = await axios.get(everythingUrl, { params: everythingParams, timeout: 10000 });
              }

              if (fallbackResp.data && Array.isArray(fallbackResp.data.articles) && fallbackResp.data.articles.length > 0) {
                articles = fallbackResp.data.articles;
                console.log(`✓ Fallback returned ${articles.length} articles for ${category}`);
              } else {
                console.log('ℹ️ Fallback also returned 0 articles');
              }
            } catch (fbErr) {
              console.warn('⚠️ NewsAPI fallback failed:', fbErr.response?.status || fbErr.message || fbErr);
            }
          }

          // If fallback returned broad results, try to bias results toward the
          // requested category by filtering with simple keyword matching.
          const categoryKeywords = {
            breaking: ['breaking', 'live', 'update', 'latest'],
            sports: ['cricket', 'football', 'tennis', 'match', 'score', 'player'],
            entertainment: ['film', 'movie', 'actor', 'actress', 'bollywood', 'series', 'music'],
            business: ['business', 'stock', 'market', 'economy', 'company', 'shares'],
            technology: ['technology', 'tech', 'ai', 'app', 'software', 'google', 'apple'],
            health: ['health', 'covid', 'hospital', 'disease', 'medical', 'doctor'],
            world: ['world', 'international', 'united', 'countries', 'global'],
            india: ['india', 'modi', 'government', 'delhi', 'mumbai', 'bharat', 'भारत'],
            general: []
          };

          if (Array.isArray(articles) && articles.length > 0 && category && category !== 'general') {
            try {
              const kws = categoryKeywords[category] || [category];
              if (kws.length > 0) {
                const filtered = articles.filter(a => {
                  const text = `${a.title || ''} ${a.description || ''} ${a.content || ''}`.toLowerCase();
                  return kws.some(k => text.includes(k));
                });
                if (filtered.length > 0) {
                  articles = filtered;
                  console.log(`✓ Filtered fallback articles to ${filtered.length} items matching category '${category}'`);
                } else {
                  console.log(`ℹ️ No fallback articles matched keywords for category '${category}' — returning broader results`);
                }
              }
            } catch (ferr) {
              console.warn('⚠️ Category filter failed:', ferr.message || ferr);
            }
          }

          const transformed = this.transformArticles(articles, category);
          this.cache.set(cacheKey, { data: transformed, timestamp: Date.now() });
          console.log(`✓ Fetched ${transformed.length} ${category} articles from NewsAPI`);
          return transformed;
        }
        throw new Error('No articles returned from NewsAPI');
      } else {
        const gnewsCategory = this.mapCategory(category);
        const url = `${this.baseUrl}/top-headlines`;
        console.log(`🌐 Fetching LIVE ${category} news from GNews API...`);
        const response = await axios.get(url, {
          params: {
            category: gnewsCategory,
            lang: 'hi', // Try Hindi (limited availability)
            country: 'in',
            max: limit,
            apikey: this.apiKey
          },
          timeout: 10000
        });

        if (response.data && response.data.articles) {
          const transformed = this.transformArticles(response.data.articles, category);
          this.cache.set(cacheKey, { data: transformed, timestamp: Date.now() });
          console.log(`✓ Fetched ${transformed.length} ${category} articles`);
          return transformed;
        }
        throw new Error('No articles returned from API');
      }
    } catch (error) {
      // Attach provider response info when available
      if (error.response) {
        console.error(`❌ Error fetching ${category} from ${this.provider}:`, error.response.status, error.response.data || error.message);
      } else {
        console.error(`❌ Error fetching ${category} from ${this.provider}:`, error.message);
      }
      throw error;
    }
  }

  // Search news by keyword (LIVE)
  async searchNews(query, limit = 10) {
    try {
      if (!this.apiKey) {
        throw new Error('NEWS_API_KEY not configured.');
      }

      // Check cache
      const cacheKey = this.getCacheKey('search', { query, limit });
      if (this.isCacheValid(cacheKey)) {
        console.log(`✓ Returning cached search for "${query}"`);
        return this.cache.get(cacheKey).data;
      }

      if (this.provider === 'newsapi') {
        const url = `${this.baseUrl}/everything`;
        console.log(`🔍 Searching LIVE for "${query}" via NewsAPI...`);
        const params = {
          q: query,
          language: 'en',
          pageSize: limit,
          apiKey: this.apiKey
        };
        const response = await axios.get(url, { params, timeout: 10000 });
        if (response.data && response.data.articles) {
          const transformed = this.transformArticles(response.data.articles);
          this.cache.set(cacheKey, { data: transformed, timestamp: Date.now() });
          console.log(`✓ Found ${transformed.length} results for "${query}" via NewsAPI`);
          return transformed;
        }
        return [];
      }

      const url = `${this.baseUrl}/search`;
      console.log(`🔍 Searching LIVE for "${query}"...`);
      const response = await axios.get(url, {
        params: {
          q: query,
          lang: 'hi', // Try Hindi
          country: 'in',
          max: limit,
          apikey: this.apiKey
        },
        timeout: 10000
      });

      if (response.data && response.data.articles) {
        const transformed = this.transformArticles(response.data.articles);
        this.cache.set(cacheKey, { data: transformed, timestamp: Date.now() });
        console.log(`✓ Found ${transformed.length} results for "${query}"`);
        return transformed;
      }
      return [];
    } catch (error) {
      if (error.response) {
        console.error(`❌ Error searching "${query}" via ${this.provider}:`, error.response.status, error.response.data || error.message);
      } else {
        console.error(`❌ Error searching "${query}" via ${this.provider}:`, error.message);
      }
      throw error;
    }
  }

  // Fetch breaking news (LIVE)
  async fetchBreakingNews(limit = 5) {
    return this.fetchTopHeadlines('breaking', limit);
  }

  // Fetch featured/trending news (LIVE)
  async fetchFeaturedNews(limit = 6) {
    try {
      // Mix of top stories from different categories
      const [general, sports, tech] = await Promise.all([
        this.fetchTopHeadlines('india', 2),
        this.fetchTopHeadlines('sports', 2),
        this.fetchTopHeadlines('technology', 2)
      ]);

      return [...general, ...sports, ...tech].slice(0, limit);
    } catch (error) {
      console.error('❌ Error fetching featured news:', error.message);
      throw error;
    }
  }

  // Transform GNews articles to our format
  transformArticles(articles, category = 'general') {
    return articles.map((article, index) => {
      // Build a safe slug. If title becomes empty after sanitization, fall back to a timestamp-based base
      let slugBase = (article.title || '')
        .toString()
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/--+/g, '-')
        .trim()
        .substring(0, 80);

      if (!slugBase || slugBase.length === 0) {
        slugBase = `article-${Date.now()}`;
      }

      const slug = `${slugBase}-${Date.now()}-${index}`;

      // Normalize fields for both GNews and NewsAPI.org
      const imageUrl = article.urlToImage || article.image || 'https://via.placeholder.com/800x450?text=Breaking+News';
      const sourceName = (article.source && (article.source.name || article.source)) || article.source || 'External Source';

      const transformed = {
        _id: `live-${Date.now()}-${index}`, // Temporary ID for frontend
        title: article.title,
        slug: slug,
        description: article.description || (article.content && article.content.substring(0, 200)) || 'Read full article...',
        content: article.content || article.description || article.title,
        category: category,
        imageUrl: imageUrl,
        author: article.author || sourceName || 'News Desk',
        source: sourceName || 'External Source',
        views: Math.floor(Math.random() * 10000) + 500,
        isFeatured: false,
        isBreaking: index < 2, // First 2 are breaking
        tags: this.extractTags(article.title, article.description),
        createdAt: article.publishedAt || article.published_at || new Date().toISOString(),
        publishedAt: article.publishedAt || article.published_at,
        externalUrl: article.url || article.urlToImage || null,
        videoUrl: null
      };

      // Cache by slug for quick detail lookup
      try {
        this.slugIndex.set(transformed.slug, transformed);
      } catch (e) {
        // ignore cache set errors
      }

      return transformed;
    });
  }

  // Retrieve cached live article by slug (if previously fetched)
  getArticleBySlug(slug) {
    return this.slugIndex.get(slug);
  }

  // Extract tags from content
  extractTags(title, description) {
    const text = `${title} ${description || ''}`.toLowerCase();
    const keywords = [];

    const keywordPatterns = [
      'election', 'politics', 'cricket', 'football', 'tennis', 'business', 
      'stock', 'market', 'technology', 'ai', 'india', 'modi', 'government',
      'court', 'police', 'accident', 'weather', 'health', 'covid',
      'education', 'exam', 'university', 'film', 'actor', 'actress',
      'bollywood', 'series', 'match', 'player', 'minister', 'pm',
      'breaking', 'live', 'update', 'latest', 'news'
    ];

    keywordPatterns.forEach(keyword => {
      if (text.includes(keyword)) {
        keywords.push(keyword);
      }
    });

    return keywords.slice(0, 5);
  }

  // Clear cache (optional - for manual refresh)
  clearCache() {
    this.cache.clear();
    console.log('✓ Cache cleared');
  }
}

module.exports = new NewsAPIService();
