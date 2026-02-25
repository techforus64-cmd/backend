// backend/routes/newsRoute.js
import express from 'express';
import axios from 'axios';
import { parseStringPromise } from 'xml2js';

const router = express.Router();

/**
 * In-memory cache for news articles
 * Prevents hitting Google News RSS on every request
 */
let newsCache = {
    articles: [],
    lastFetched: null,
    CACHE_DURATION: 30 * 60 * 1000, // 30 minutes in milliseconds
};

/**
 * Fetches and parses Google News RSS feed
 * @returns {Array} Array of news articles
 */
async function fetchGoogleNewsRSS() {
    try {
        console.log('[Google News RSS] Fetching fresh news...');

        // Google News RSS URL for India business news
        const rssUrl = 'https://news.google.com/rss/search?q=India+business+OR+Indian+economy+OR+stocks+OR+Sensex+OR+Nifty&hl=en-IN&gl=IN&ceid=IN:en';

        const response = await axios.get(rssUrl, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        });

        // Parse XML to JSON
        const result = await parseStringPromise(response.data, {
            explicitArray: false,
            ignoreAttrs: false,
        });

        const items = result.rss?.channel?.item || [];

        // Ensure items is an array (xml2js returns object if single item)
        const itemsArray = Array.isArray(items) ? items : [items];

        // Transform RSS items to NewsAPI-compatible format
        const articles = itemsArray.slice(0, 10).map(item => {
            // Extract source from title (Google News format: "Title - Source")
            const titleParts = item.title?.split(' - ') || ['Unknown'];
            const source = titleParts.length > 1 ? titleParts[titleParts.length - 1] : 'Google News';
            const title = titleParts.slice(0, -1).join(' - ') || item.title;

            return {
                source: { id: null, name: source },
                title: title,
                description: item.description || '',
                url: item.link || '#',
                urlToImage: null, // RSS doesn't provide images, frontend should handle gracefully
                publishedAt: item.pubDate || new Date().toISOString(),
            };
        });

        console.log(`[Google News RSS] Successfully fetched ${articles.length} articles`);
        return articles;

    } catch (error) {
        console.error('[Google News RSS] Error fetching news:', error.message);
        throw error;
    }
}

/**
 * GET /api/news/business
 * Returns cached Indian business news from Google News RSS
 * Refreshes cache every 30 minutes
 */
router.get('/business', async (req, res) => {
    try {
        const now = Date.now();
        const cacheAge = newsCache.lastFetched ? now - newsCache.lastFetched : Infinity;

        // Check if cache is stale or empty
        if (!newsCache.lastFetched || cacheAge > newsCache.CACHE_DURATION || newsCache.articles.length === 0) {
            console.log('[News Cache] Cache is stale or empty, fetching fresh news...');

            try {
                const articles = await fetchGoogleNewsRSS();

                // Update cache
                newsCache.articles = articles;
                newsCache.lastFetched = now;

                console.log(`[News Cache] Cache updated with ${articles.length} articles`);
            } catch (fetchError) {
                // If fetch fails but we have cached data, serve stale cache
                if (newsCache.articles.length > 0) {
                    console.warn('[News Cache] Fetch failed, serving stale cache');
                } else {
                    // No cache and fetch failed - return error
                    throw fetchError;
                }
            }
        } else {
            const cacheAgeMinutes = Math.floor(cacheAge / 60000);
            console.log(`[News Cache] Serving cached news (age: ${cacheAgeMinutes} minutes)`);
        }

        // Return cached articles in NewsAPI-compatible format
        res.json({
            status: 'ok',
            totalResults: newsCache.articles.length,
            articles: newsCache.articles,
            cached: true,
            cacheAge: newsCache.lastFetched ? Math.floor((now - newsCache.lastFetched) / 60000) : 0,
        });

    } catch (error) {
        console.error('[News Proxy] Error:', error.message);

        res.status(500).json({
            success: false,
            message: 'Failed to fetch news from Google News RSS',
            error: error.message,
        });
    }
});

/**
 * GET /api/news/refresh
 * Force refresh the news cache (useful for testing)
 */
router.get('/refresh', async (req, res) => {
    try {
        console.log('[News Cache] Force refresh requested');

        const articles = await fetchGoogleNewsRSS();

        newsCache.articles = articles;
        newsCache.lastFetched = Date.now();

        res.json({
            success: true,
            message: 'Cache refreshed successfully',
            articleCount: articles.length,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to refresh cache',
            error: error.message,
        });
    }
});

export default router;
