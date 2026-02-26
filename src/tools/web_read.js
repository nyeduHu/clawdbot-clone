module.exports = {
  name: 'web_read',
  description:
    'Fetch a webpage and extract its text content. Use this after web_search to read the full content of a result, or when the user gives you a URL to read.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The full URL to fetch (must start with http:// or https://).',
      },
      maxLength: {
        type: 'integer',
        description: 'Maximum characters of text to return (default 8000).',
      },
    },
    required: ['url'],
  },

  async execute(params) {
    const targetUrl = params.url;
    const maxLen = Math.min(params.maxLength || 8000, 30000);

    if (!/^https?:\/\//i.test(targetUrl)) {
      return { error: 'URL must start with http:// or https://' };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ClawdBot/1.0)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return { error: `HTTP ${res.status}: ${res.statusText}` };
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('text') && !contentType.includes('json') && !contentType.includes('xml')) {
        return { error: `Non-text content type: ${contentType}. Cannot extract text.` };
      }

      const html = await res.text();

      // Strip HTML to plain text
      const text = htmlToText(html);

      const truncated = text.length > maxLen;
      return {
        url: targetUrl,
        title: extractTitle(html),
        content: text.slice(0, maxLen),
        length: text.length,
        truncated,
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        return { error: 'Request timed out after 15 seconds.' };
      }
      console.error('Web read error:', err);
      return { error: `Failed to fetch: ${err.message}` };
    }
  },
};

/**
 * Simple HTML-to-text conversion.
 * Strips scripts, styles, tags, and normalises whitespace.
 */
function htmlToText(html) {
  return html
    // Remove script and style blocks
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    // Replace <br>, <p>, headings, <li> etc. with newlines
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|h[1-6]|li|tr|blockquote|section|article|header|footer|nav|aside)[\s>]/gi, '\n')
    // Strip remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    // Collapse whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract <title> from HTML.
 */
function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].replace(/\s+/g, ' ').trim() : null;
}
