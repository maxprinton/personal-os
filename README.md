# Personal OS
Run locally: `npm install` then `npm run dev` -> http://localhost:3000

## Environment variables (Vercel → Settings → Environment Variables, Production)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEY`
- `TELEGRAM_BOT_TOKEN`
- `GEMINI_API_KEY` (free key from Google AI Studio; optional `GEMINI_MODEL`): free text, voice notes and receipt photos in the bot. Check with /ai.
- New or changed variables only apply after a new deploy (push, or Redeploy in Vercel).
