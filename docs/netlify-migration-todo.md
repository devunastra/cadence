# Netlify Migration — Remaining TODOs

## ~~1. Supabase Auth Redirect URL~~ ✅ Done
- Added `https://cadence-amls.netlify.app` to Supabase redirect URLs (coexists with Vercel URL)

## 2. GHL Webhook URLs
Update in GoHighLevel to point to Netlify:
- `https://cadence-amls.netlify.app/api/webhooks/ghl-contact`
- `https://cadence-amls.netlify.app/api/webhooks/ghl-message`
- `https://cadence-amls.netlify.app/api/webhooks/ghl-appointment`

## 3. Retell AI Webhook URL
Update in Retell dashboard:
- `https://cadence-amls.netlify.app/api/webhooks/retell-call`

## 4. Rate Limiter — Migrate to Upstash Redis
Current in-memory rate limiter (`lib/rate-limit.ts`) does not work reliably on Netlify (stateless serverless functions).

**Steps:**
1. Create an Upstash Redis database at [console.upstash.com](https://console.upstash.com)
2. Copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
3. Add to `.env.local` and Netlify env vars
4. Install `@upstash/redis` and `@upstash/ratelimit`
5. Rewrite `lib/rate-limit.ts` to use Upstash Redis

## 5. Custom Domain (if applicable)
If you had a custom domain on Vercel, add it in Netlify → Domain settings.
