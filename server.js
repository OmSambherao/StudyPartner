import http from 'node:http';
import { MongoClient } from 'mongodb';

const port = Number(process.env.PORT || 10000);
const mongoUri = process.env.MONGODB_URI;
const geminiApiKey = process.env.GEMINI_API_KEY;
const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || 'https://endsem-compass.onrender.com,http://127.0.0.1:4173,http://localhost:4173').split(',').map(value => value.trim()).filter(Boolean));
const requestsByIp = new Map();
let clientPromise;

const MAX_BODY_BYTES = 16_000;
const MAX_MESSAGES_PER_CHAT = 50;
const MAX_CONTEXT_MESSAGES = 16;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 18;

function setCorsHeaders(request, response) {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Study-Owner');
}
function sendJson(response, status, body) {
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  response.end(JSON.stringify(body));
}
function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}
function safeMessages(messages) {
  return (Array.isArray(messages) ? messages : []).map(message => ({role: message.role === 'assistant' ? 'assistant' : 'user', content: cleanText(message.content, 2_000), createdAt: message.createdAt})).filter(message => message.content);
}
function ownerFrom(request) {
  const owner = cleanText(request.headers['x-study-owner'], 80);
  if (!/^[a-f0-9-]{20,80}$/i.test(owner)) throw Object.assign(new Error('Invalid study profile.'), {status: 400});
  return owner;
}
function topicIdFrom(url) {
  const match = url.pathname.match(/^\/api\/chat\/([a-zA-Z0-9-]{1,80})$/);
  if (!match) return null;
  return match[1];
}
function chatDocumentId(ownerId, topicId) { return `${ownerId}:${topicId}`; }
async function collection() {
  if (!mongoUri) throw Object.assign(new Error('Chat storage is not configured yet. Add MONGODB_URI in Render, then try again.'), {status: 503});
  if (!clientPromise) {
    const client = new MongoClient(mongoUri, {serverSelectionTimeoutMS: 8_000});
    clientPromise = client.connect().catch(error => {clientPromise = undefined; throw error;});
  }
  const client = await clientPromise;
  return client.db('endsem_compass').collection('topic_chats');
}
function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        const error = new Error('Request is too large.'); error.status = 413; request.destroy(error);
      }
    });
    request.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { const error = new Error('Invalid JSON request.'); error.status = 400; reject(error); }
    });
    request.on('error', reject);
  });
}
function validateChatRequest(body) {
  const subject = cleanText(body.subject, 100);
  const topicName = cleanText(body.topic?.name, 120);
  const message = cleanText(body.message, 2_000);
  if (!subject || !topicName || !message) throw Object.assign(new Error('A subject, topic, and question are required.'), {status: 400});
  return {subject, topic: {name: topicName, marks: Number(body.topic?.marks) || 0, notesAvailable: Boolean(body.topic?.notesAvailable), completed: Boolean(body.topic?.completed)}, message};
}
function rateLimited(request) {
  const ip = (request.headers['x-forwarded-for'] || request.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
  const now = Date.now();
  const recent = (requestsByIp.get(ip) || []).filter(time => now - time < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) return true;
  recent.push(now); requestsByIp.set(ip, recent); return false;
}
function outputText(result) {
  return (result.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('\n').trim();
}
async function askTutor({subject, topic, messages}) {
  if (!geminiApiKey) throw Object.assign(new Error('AI is not configured yet. Add GEMINI_API_KEY in Render, then try again.'), {status: 503});
  const instructions = `You are Endsem Compass, a supportive and precise study tutor. Help the student learn the specific topic below. Give concise, well-structured answers for end-semester revision. When helpful, include one short example, recall cue, or practice question. Do not claim to have access to notes that were not supplied.\n\nSubject: ${subject}\nTopic: ${topic.name}\nTopic marks: ${topic.marks}\nNotes available: ${topic.notesAvailable ? 'yes' : 'no'}\nStudy status: ${topic.completed ? 'completed' : 'not yet completed'}.`;
  const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey},
    body: JSON.stringify({
      systemInstruction: {parts: [{text: instructions}]},
      contents: messages.map(message => ({role: message.role === 'assistant' ? 'model' : 'user', parts: [{text: message.content}]})),
      generationConfig: {maxOutputTokens: 550, temperature: 0.4}
    })
  });
  const result = await upstream.json().catch(() => ({}));
  if (!upstream.ok) { console.error('Gemini response failed:', upstream.status, result.error?.message || ''); throw Object.assign(new Error('The AI tutor is temporarily unavailable. Please try again.'), {status: 502}); }
  const answer = outputText(result);
  if (!answer) throw Object.assign(new Error('The AI tutor returned no text. Please try again.'), {status: 502});
  return answer;
}
function publicMessages(document) {
  return safeMessages(document?.messages).map(({role, content, createdAt}) => ({role, content, createdAt}));
}

const server = http.createServer(async (request, response) => {
  setCorsHeaders(request, response);
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  if (request.method === 'GET' && url.pathname === '/health') { sendJson(response, 200, {status: 'ok'}); return; }
  const topicId = topicIdFrom(url);
  if (!topicId) { sendJson(response, 404, {error: 'Not found.'}); return; }
  try {
    const ownerId = ownerFrom(request);
    const chats = await collection();
    const id = chatDocumentId(ownerId, topicId);
    if (request.method === 'GET') {
      const document = await chats.findOne({_id: id}, {projection: {messages: 1}});
      sendJson(response, 200, {messages: publicMessages(document)}); return;
    }
    if (request.method !== 'POST') { sendJson(response, 405, {error: 'Method not allowed.'}); return; }
    if (rateLimited(request)) { sendJson(response, 429, {error: 'Please wait a few minutes before sending more tutor requests.'}); return; }
    const {subject, topic, message} = validateChatRequest(await readJson(request));
    const existing = await chats.findOne({_id: id}, {projection: {messages: 1}});
    const userMessage = {role: 'user', content: message, createdAt: new Date()};
    const context = [...safeMessages(existing?.messages), userMessage].slice(-MAX_CONTEXT_MESSAGES);
    await chats.updateOne({_id: id}, {$setOnInsert: {ownerId, topicId, createdAt: new Date()}, $set: {subject, topic, updatedAt: new Date()}, $push: {messages: {$each: [userMessage], $slice: -MAX_MESSAGES_PER_CHAT}}}, {upsert: true});
    const answer = await askTutor({subject, topic, messages: context});
    const assistantMessage = {role: 'assistant', content: answer, createdAt: new Date()};
    await chats.updateOne({_id: id}, {$set: {updatedAt: new Date()}, $push: {messages: {$each: [assistantMessage], $slice: -MAX_MESSAGES_PER_CHAT}}});
    const saved = await chats.findOne({_id: id}, {projection: {messages: 1}});
    sendJson(response, 200, {messages: publicMessages(saved)});
  } catch (error) {
    console.error('Chat request failed:', error.message);
    sendJson(response, error.status || 500, {error: error.status ? error.message : 'The tutor could not process that request.'});
  }
});

server.listen(port, '0.0.0.0', () => console.log(`Endsem Compass AI listening on ${port}`));
