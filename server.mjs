import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4175);
const apiKey = process.env.GROQ_API_KEY;
const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'POST' && req.url === '/api/transcribe') {
    if (!apiKey) return sendJson(res, 503, { error: 'AI is not configured. Set GROQ_API_KEY, then restart the server.' });
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 32_000_000) return sendJson(res, 413, { error: 'Audio clip is too large. Please record a shorter question.' });
      }
      const parsed = JSON.parse(body || '{}');
      if (typeof parsed.audioBase64 !== 'string') return sendJson(res, 400, { error: 'No audio was received.' });
      const audio = Buffer.from(parsed.audioBase64, 'base64');
      if (!audio.length || audio.length > 24_000_000) return sendJson(res, 413, { error: 'Audio clip is empty or too large.' });
      const mimeType = typeof parsed.mimeType === 'string' ? parsed.mimeType : 'audio/webm';
      const extension = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : mimeType.includes('wav') ? 'wav' : 'webm';
      const form = new FormData();
      form.append('file', new Blob([audio], { type: mimeType }), `voice.${extension}`);
      form.append('model', 'whisper-large-v3-turbo');
      form.append('language', 'en');
      form.append('response_format', 'json');
      const upstream = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}` }, body: form
      });
      const result = await upstream.json();
      if (!upstream.ok) return sendJson(res, 502, { error: result?.error?.message || `Groq transcription returned HTTP ${upstream.status}.` });
      return sendJson(res, 200, { transcript: result.text || '' });
    } catch (error) {
      return sendJson(res, 500, { error: error instanceof SyntaxError ? 'Invalid audio request.' : 'Could not transcribe audio. Check the API key and connection.' });
    }
  }
  if (req.method === 'POST' && req.url === '/api/chat') {
    if (!apiKey) return sendJson(res, 503, { error: 'AI is not configured. Set GROQ_API_KEY, then restart the server.' });
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 100_000) return sendJson(res, 413, { error: 'Conversation is too large.' });
      }
      const parsed = JSON.parse(body || '{}');
      if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) return sendJson(res, 400, { error: 'Send a question to get started.' });
      const messages = parsed.messages.slice(-20).filter(m => ['user', 'assistant'].includes(m.role) && typeof m.content === 'string').map(m => ({ role: m.role, content: m.content.slice(0, 6000) }));
      const instructions = 'You are a helpful, general-purpose voice assistant. Answer the user\'s actual question using your knowledge and reasoning. Ask one brief follow-up only if essential. Keep the answer complete and concise: no more than 120 words, using at most 3 numbered steps or bullets. Prioritize practical next actions; do not add tables, long introductions, or exhaustive checklists unless requested. Use clean standard Markdown, ordinary spaces, and no HTML entities. Give a brief rationale, not hidden chain-of-thought. Be natural when read aloud. If the answer depends on current information you cannot access, say so. Do not claim to access Snapdeal systems or real seller data.';
      let upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: instructions }, ...messages], max_tokens: 650 })
      });
      let result = await upstream.json();
      if (!upstream.ok) {
        const detail = result?.error?.message || `AI provider returned HTTP ${upstream.status}.`;
        return sendJson(res, upstream.status === 401 ? 502 : 502, { error: detail });
      }
      if (result.choices?.[0]?.finish_reason === 'length') {
        const retry = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'system', content: instructions + ' The earlier draft was cut off. Write a fresh complete answer in no more than 80 words.' }, ...messages.slice(-4)], max_tokens: 400 })
        });
        if (retry.ok) {
          const compact = await retry.json();
          const compactAnswer = compact.choices?.[0]?.message?.content?.trim();
          if (compactAnswer && compact.choices?.[0]?.finish_reason !== 'length') result = compact;
          else return sendJson(res, 200, { answer: 'I could not fit a complete answer in one reply. Please ask me for the three most important next steps.' });
        }
      }
      return sendJson(res, 200, { answer: result.choices?.[0]?.message?.content?.trim() || 'I could not produce a complete answer. Please try asking for a shorter reply.' });
    } catch (error) {
      return sendJson(res, 500, { error: error instanceof SyntaxError ? 'Invalid request.' : 'Could not complete the AI request. Check the server connection and API configuration.' });
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed.' });
  const requested = req.url === '/' ? '/index.html' : decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const target = path.resolve(root, `.${requested}`);
  if (!target.startsWith(root + path.sep)) return sendJson(res, 403, { error: 'Forbidden.' });
  try {
    const data = await readFile(target);
    res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    sendJson(res, 404, { error: 'Not found.' });
  }
});

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

server.listen(port, '127.0.0.1', () => console.log(`Voice assistant available at http://127.0.0.1:${port}`));
