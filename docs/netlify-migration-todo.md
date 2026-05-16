# Netlify Migration — Remaining TODOs

## ~~1. Supabase Auth Redirect URL~~ ✅ Done
- Added `https://cadence-amls.netlify.app` to Supabase redirect URLs (coexists with Vercel URL)

## 2. GHL Webhook URLs
Duplicate triggers in GoHighLevel pointing to Netlify:
- `https://cadence-amls.netlify.app/api/webhooks/ghl-contact`
- `https://cadence-amls.netlify.app/api/webhooks/ghl-message`
- `https://cadence-amls.netlify.app/api/webhooks/ghl-appointment`

## 3. Retell AI Webhook URL
Update in Retell dashboard:
- `https://cadence-amls.netlify.app/api/webhooks/retell-call`

## ~~4. Rate Limiter — Migrate to Upstash Redis~~ ✅ Done
- Replaced in-memory rate limiter with Upstash Redis
- Env vars set in `.env.local` and Netlify

## 5. Custom Domain (if applicable)
If you had a custom domain on Vercel, add it in Netlify → Domain settings.
