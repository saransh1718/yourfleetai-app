# FleetOS — Transport Management System

React + Vite app with a real Supabase (Postgres) database — data is shared
across every device that opens the app, not just one browser.

## Step 1 — Create your database (free, ~2 minutes)

1. Go to https://supabase.com → sign up (free tier is plenty for this)
2. Click "New Project" → pick any name, set a database password (save it
   somewhere), pick the region closest to you → "Create new project"
3. Once it's ready, go to the **SQL Editor** (left sidebar) → "New query"
   and paste this, then click "Run":

```sql
create table kv_store (
  id bigserial primary key,
  user_id uuid references auth.users(id) not null,
  key text not null,
  value text not null,
  updated_at timestamptz default now(),
  unique(user_id, key)
);

alter table kv_store enable row level security;

create policy "Users can only touch their own rows"
on kv_store for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

   > This is real per-user privacy, enforced by the database itself — even
   > if someone tampered with the app's code in their browser, Postgres
   > would still refuse to hand them another user's rows. Two people can
   > now sign up and each only ever sees their own fleet.

4. Go to **Authentication → Providers** (left sidebar) and confirm "Email"
   is enabled (it is by default). Under **Authentication → URL
   Configuration**, you can turn off "Confirm email" while testing, so new
   accounts can log in immediately without clicking an email link.

5. Go to **Project Settings → API** (left sidebar). You'll need two values
   from this page in Step 2:
   - **Project URL**
   - **anon public** key

## Step 2 — Connect the app to your database

1. In this project folder, copy `.env.example` to a new file called
   `.env.local`
2. Paste in your Project URL and anon key from Step 1

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

## Step 3 — Run it

### Option A — CodeSandbox / StackBlitz (no installs)
Import this folder, add the same two values under the sandbox's
"Environment Variables" / "Secrets" panel (not a committed `.env` file),
and it runs live with a shareable URL.

### Option B — Vercel (real hosting, custom domain)
1. Push this folder to a GitHub repo (web upload works, no command line
   needed)
2. On https://vercel.com → "Add New → Project" → select the repo
3. Before deploying, open "Environment Variables" and add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with your values
4. Deploy — you'll get a live URL in about a minute

### Option C — Local terminal
```bash
npm install
npm run dev        # http://localhost:5173
npm run build       # production build in dist/
```

## Going further

- **Auth** — right now anyone with the URL can read/write your data. Add
  Supabase Auth (email/password or magic link) so only you (and your team,
  if you invite them) can access it.
- **Realtime** — Supabase supports live sync, so if two people have the
  app open, changes appear instantly for both. Worth adding once you have
  more than one user.
- **Proper tables** — right now all your data lives as one JSON blob per
  key (matching the app's original design). Once the workflow is proven
  out, splitting into real `trucks`, `drivers`, `trips`, `fuel` tables
  makes reporting and multi-user editing much cleaner.
