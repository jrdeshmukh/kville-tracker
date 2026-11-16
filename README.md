# K-Ville Tracker

Tent schedules, swaps, tent checks and money for Duke K-Ville tenting groups. Built for phones first.

## Try it now (demo mode, no setup)

```bash
npm install
npm run dev
```

Open http://localhost:3000 and tap **Open the demo tent**. With no Supabase keys configured, the app runs in
demo mode: a 10-person tent with a live schedule, expenses and gear, all stored in your browser.
Use the **acting as** dropdown in the black bar to switch between members (for example, ask someone to cover a
shift, then switch to them to accept). **reset** restores the demo data.

## Going live (about 15 minutes)

### 1. Supabase (database + Google sign-in)
1. Create a free project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, paste all of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
3. In **Authentication → Providers → Google**, turn Google on. You need a Google OAuth client:
   [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → Create credentials → OAuth client ID →
   Web application. Add `https://<your-project>.supabase.co/auth/v1/callback` as an authorized redirect URI, then paste
   the client ID and secret into Supabase.
4. In **Authentication → URL Configuration**, set the Site URL to your deployed URL (for example `https://kville.vercel.app`)
   and add `http://localhost:3000/**` and `https://<your-domain>/**` to the Redirect URLs.
5. In **Project Settings → API**, copy the project URL, the `anon` key and the `service_role` key.

### 2. Environment variables
Copy `.env.example` to `.env.local` and fill it in:

| Variable | What it is |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From Supabase → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. Used for push notifications, reminders and the calendar feed |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Run `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | `mailto:` plus your email |
| `CRON_SECRET` | Any long random string |

### 3. Deploy
Push the folder to GitHub, import it in [Vercel](https://vercel.com), and add the same environment variables there.

### 4. Shift reminders (cron)
`GET /api/cron/reminders` sends a push to everyone whose shift starts within their group's reminder window. Call it
every 5 minutes with the header `Authorization: Bearer <CRON_SECRET>`. Vercel's free plan only allows daily cron jobs,
so use a free service like [cron-job.org](https://cron-job.org) for this.

Calendar subscriptions (Profile → Calendar sync) also include alarms, so people get reminders even without push.

> **iPhone:** web push only works after **Share → Add to Home Screen**, then opening the app from the home screen.

## How scheduling works
- **Two kinds of groups.** *Carolina*: Black/Blue/White phases, each with its own day and night head count (Black 2/10,
  Blue 1/6, White 1/2 are typical numbers, so **check this year's K-Ville policy**). *Other game* (e.g. Illinois):
  no phases, no member limit, and a fraction of the group (default 1/3, rounded up) in the tent at all times.
- **Flexible shifts.** The scheduler works in 15-minute steps. Day shifts aim for about 2h (3h in game mode) and nights
  for the whole night, but a shift ends early or starts late to fit around someone's class, so a class ending at
  10:50 means a hand-off at 11:00, not a lost 2-hour block. People block time to the 5 minute (drag on the grid or
  type exact times).
- **Partial swaps.** "Can't make it" lets you give away the whole shift or just part of it (for example, the first
  45 minutes); the rest stays yours.
- Each hour is weighted: day 1×, weeknight 1.5×, Fri/Sat night 1.25×, cold or rough 2×. The scheduler evens out
  everyone's **weighted** hours.
- "Can't come" hours are never scheduled. "Prefer not" hours, back-to-back shifts and consecutive nights are avoided
  when possible. Night buddies are paired when that doesn't hurt fairness.
- Grace periods remove blocks entirely. Adding or removing one while the schedule is live regenerates future shifts.
- On regenerate, past and in-progress shifts, manual shifts and accepted swaps are locked and count toward totals.
  Only future auto-generated shifts get reshuffled, and the scheduler prefers keeping existing assignments.
- Algorithm: [`src/lib/scheduler.ts`](src/lib/scheduler.ts). Tests: `npx vitest run`.

## Project layout
```
src/app/            pages: / (home), /new, /join/[code], /profile, /g/[id]/{,schedule,times,money,tent}
src/app/api/        push notify, reminder cron, .ics calendar feed
src/lib/scheduler.ts  the scheduling + replacement-ranking algorithm
src/lib/data/       DataApi interface with Supabase and demo (localStorage) backends
supabase/schema.sql tables, row-level security, RPCs, realtime
```
