import { handleRequest } from '../src/app-server.js';

export default async function handler(req, res) {
  try {
    const rawUrl = req.url || '/';
    const urlObj = new URL(rawUrl, `http://${req.headers?.host || 'localhost'}`);
    const apiPath = urlObj.searchParams.get('__apiPath');
    if (apiPath) {
      urlObj.searchParams.delete('__apiPath');
      const qs = urlObj.searchParams.toString();
      req.url = qs ? `${apiPath}?${qs}` : apiPath;
    }
  } catch {
    // Keep original req.url if URL parsing fails
  }

  try {
    return await handleRequest(req, res);
  } catch (err) {
    console.error('Vercel handler error:', err);
    if (!res.headersSent) {
      res.writeHead(500, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache'
      });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}
