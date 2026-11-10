# Endsem Compass

A simple browser-based tracker for end-semester preparation. Organise subjects and topics, assign marks, mark study progress, and record whether notes are ready.

## Run locally

Open `index.html` in a browser, or use any static file server. Data is stored locally in the browser. The app has built-in export and import so the plan can be backed up or moved.

## AI tutor and saved chats

Each topic has an **Ask AI** button. Conversations are saved separately per topic in MongoDB Atlas. The API service expects these Render environment variables:

- `MONGODB_URI` — Atlas connection string
- `OPENAI_API_KEY` — OpenAI API key
- `ALLOWED_ORIGINS` — `https://endsem-compass.onrender.com`

Never place either secret in browser code or commit it to the repository.

## Deploy

This is a static app. Upload the three root files (`index.html`, `styles.css`, and `app.js`) to any static host, or connect a Git repository to a static-site host.
