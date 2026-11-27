# Secret Santa

Secret Santa is a gift exchange site built with React, Vite, Tailwind CSS, React Router, and Supabase. The organizer generates the draw. Participants open a shared invitation and enter their personal passcode to see their assignment.

## Set up Supabase

1. Create a Supabase project with the Data API enabled and the `public` schema exposed. Leave `merry_private` out of the exposed schemas.
2. In the SQL Editor, run [supabase/schema.sql](supabase/schema.sql) once for a new project, then apply the [personal passcodes migration](supabase/migrations/202611240001_personal_passcodes.sql) followed by the [no-reciprocal-draws migration](supabase/migrations/202611250001_prevent_reciprocal_draws.sql) as the project database owner. The passcodes migration uses `pgcrypto` in the Supabase `extensions` schema.
3. Apply the [organizer signup migration](supabase/migrations/202611270001_organizer_signup.sql), the [delete exchange migration](supabase/migrations/202611270002_delete_exchange.sql), the [draw reassignment refresh](supabase/migrations/202611270003_refresh_draw_reassignment.sql), and the [passcode entry tracking migration](supabase/migrations/202611270004_track_passcode_entry.sql). Signup grants organizer access automatically after email confirmation.
4. In Supabase Auth settings, enable **Allow new users to sign up** and **Confirm Email**, and keep anonymous sign-ins disabled. Under **URL Configuration**, set the Site URL to the deployed app and allow the organizer redirect (the app URL followed by `#/organizer`, for example `https://example.github.io/merry-draw/#/organizer`). Configure custom SMTP to deliver confirmation emails to organizers outside the Supabase project team. Participants still use their invitation and passcode. [Supabase Auth settings](https://supabase.com/docs/guides/auth/general-configuration) · [Supabase SMTP setup](https://supabase.com/docs/guides/auth/auth-smtp)
5. Copy the project URL and its publishable key. These values are embedded in the frontend. Keep database passwords, secret keys, and service-role keys out of this repository and GitHub Pages variables.

For an existing project, apply any pending migrations in order and coordinate them with the frontend deployment. The passcodes migration creates words for the existing roster and keeps invitation links and finalized assignments. The organizer needs to send everyone their new word because that migration retires the old joining codes and access keys. The draw reassignment refresh reinstalls the current draw logic on databases that already ran an earlier migration. Assignments change when the organizer reassigns the draw.

## Run locally

Use Node.js 22.12 or later.

```sh
npm ci
npm test
npm run dev
```

Before running the dev server, copy `.env.example` to `.env.local` and fill in the two Supabase values. Restart Vite after changing them. For a production build use `npm run build`. Use `npm run preview` to serve the build locally.

## Run an exchange

1. Open **Organizer** and sign in. New organizers can choose **Create an organizer account**, confirm their email, then sign in. Create an exchange with its date, optional budget, and event details.
2. Add everyone taking part. Copy the shared invitation link for the group and send each person their word privately. Before the draw, **Regenerate** replaces a participant’s passcode immediately. Adding a name that overlaps an existing word also replaces that word, and the organizer screen identifies anyone who needs an updated passcode.
3. With at least three people on the roster, click **Generate Secret Santa**. Participants can enter their passcodes before the draw and check back once it is ready.
4. Participants open the invitation, enter their word, and open their gift. They can use the same word on another device to see the same assignment.
   Organizers can use **Refresh passcode status** to see each participant’s first successful entry since tracking was installed.
5. To replace a finalized draw, choose **Reassign draw** and confirm. The same invitation and passcodes open the new results. Ask anyone who already opened their gift to check their assignment again.

## Database and access model

| Table | Purpose |
| --- | --- |
| `merry_private.organizers` | Allowlist of authenticated organizer IDs |
| `merry_private.exchanges` | Owner, event details, invitation UUID, and finalization timestamp |
| `merry_private.participants` | Organizer-entered roster |
| `merry_private.passcodes` | Exchange-scoped keyed hashes and encrypted active words |
| `merry_private.passcode_keys` | Private hashing and encryption keys |
| `merry_private.passcode_attempts` | Exchange-wide failed-attempt limits |
| `merry_private.assignments` | Current giver and recipient pairs scoped to one exchange |
| `merry_private.activity` | Timestamped exchange, roster, and draw changes |

Every Secret Santa table has Row Level Security enabled. Browser roles access data through RPCs with a fixed search path. `merry_event` reads event information by invitation. `merry_participant` uses an exchange-scoped HMAC-SHA-256 lookup to return only the matching participant and recipient. `merry_admin` checks the authenticated user's allowlist membership and exchange ownership before decrypting the AES-256 copies used for the organizer’s passcode table.

Passcode issuance excludes words that overlap pieces of a roster name and reserves retired hashes so previous words cannot become valid again in the same exchange. Single dictionary words have limited entropy. Five failed lookups within 30 minutes temporarily pause passcode checks for that invitation. Roster writes, passcode lookups, and draws lock the same exchange row. Finalization samples random recipient permutations that exclude self-matches and two-way gift swaps, then inserts all pairs and finalizes the exchange in the same transaction. Unique constraints enforce one recipient and one giver per exchange, and foreign keys enforce membership.

## Deploy to GitHub Pages

1. Create a separate GitHub repository and put the contents of this folder at its root. Use `main` as the deployment branch.
2. In **Settings → Secrets and variables → Actions → Variables**, define `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. In **Settings → Pages**, choose **GitHub Actions** as the source. [GitHub Pages publishing settings](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-a-github-pages-site)
4. Push to `main` or run **Deploy to GitHub Pages** from the Actions tab. The workflow installs locked dependencies, runs tests, builds, uploads the static artifact, and deploys it.
5. Use the deployed URL to sign in and generate the invitation link. Vite's relative asset paths and React Router's hash routes support the repository subdirectory. Invite links look like `https://ACCOUNT.github.io/REPOSITORY/#/join/INVITATION_ID`.

## Verification

`npm test` runs the baseline schema and migration in embedded PostgreSQL with simulated Supabase roles. It checks migration of finalized assignments, duplicate hash rejection, invalid and retired passcodes, failed-attempt limits, repeat visits, one-to-one assignments, and private organizer access.

After configuring a deployed Supabase project, run a disposable exchange with three participants in separate browser profiles. Check organizer sign-in, the shared link, copying and regenerating words, gift reveal, and returning with the same passcode.
