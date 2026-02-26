module.exports = {
  name: 'web_search',
  description:
    'Search the web using DuckDuckGo. Returns titles, snippets, and URLs for the top results. Use this whenever the user asks a question that requires up-to-date information, facts you are unsure about, or anything that would benefit from a web lookup.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query.',
      },
      count: {
        type: 'integer',
        description: 'Max number of results to return (1-10, default 5).',
      },
    },
    required: ['query'],
  },

  async execute(params) {
    const count = Math.min(Math.max(params.count || 5, 1), 10);

    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(params.query)}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return { error: `DuckDuckGo returned HTTP ${res.status}` };
      }

      const html = await res.text();
      const results = parseResults(html, count);

      if (results.length === 0) {
        return { query: params.query, results: [], message: 'No results found.' };
      }

      return {
        query: params.query,
        results,
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        return { error: 'Search timed out after 12 seconds.' };
      }
      console.error('Web search error:', err);
      return { error: `Search failed: ${err.message}` };
    }
  },
};

/**
 * Parse DuckDuckGo HTML search results page.
 * Each organic result lives in an <a class="result__a"> with a sibling
 * <a class="result__snippet">.
 */
function parseResults(html, max) {
  const results = [];

  // Match each result block
  const blockRegex = /<div[^>]*class="[^"]*result\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]*class="[^"]*result\b|$)/gi;
  let blockMatch;

  while ((blockMatch = blockRegex.exec(html)) !== null && results.length < max) {
    const block = blockMatch[1];

    // Title + URL from <a class="result__a">
    const linkMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    let href = linkMatch[1];
    const title = stripTags(linkMatch[2]).trim();

    // DuckDuckGo wraps URLs in a redirect; extract the actual URL
    const uddgMatch = href.match(/[?&]uddg=([^&]+)/);
    if (uddgMatch) {
      href = decodeURIComponent(uddgMatch[1]);
    }

    // Snippet from <a class="result__snippet"> or <td class="result__snippet">
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td)>/i);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]).trim() : '';

    if (!title || !href || href.startsWith('/') || !href.startsWith('http')) continue;

    results.push({
      position: results.length + 1,
      title,
      url: href,
      snippet,
    });
  }

  return results;
}

function stripTags(html) {
  return html
    .replace(/<b>/gi, '')
    .replace(/<\/b>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}
