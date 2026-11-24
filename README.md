# Merry Draw

Merry Draw is a family Secret Santa site built with React, Vite, Tailwind CSS, React Router, and Supabase. The organizer generates the draw. Participants open a shared invitation and enter their personal passcode to see their assignment.

## Set up Supabase

1. Create a Supabase project with the Data API enabled and the `public` schema exposed. Leave `merry_private` out of the exposed schemas.
2. In the SQL Editor, run [supabase/schema.sql](supabase/schema.sql) once for a new project, then run the [personal passcodes migration](supabase/migrations/202611240001_personal_passcodes.sql) as the project database owner. The migration uses `pgcrypto` in the Supabase `extensions` schema.
3. Under **Authentication → Users**, create an email/password user for each organizer. Use the dashboard's option to create a confirmed user. Copy the user's ID and run this SQL, replacing the placeholder with that ID.

   ```sql
   insert into merry_private.organizers (user_id)
   values ('REPLACE_WITH_AUTH_USER_UUID');
   ```

4. Disable public sign-ups and anonymous sign-ins in Auth settings. Participants use the invitation flow without Supabase Auth accounts. An authenticated user also needs an organizer allowlist entry to use the dashboard. [Supabase Auth settings](https://supabase.com/docs/guides/auth/general-configuration)
5. Copy the project URL and its publishable key. These values are embedded in the frontend. Keep database passwords, secret keys, and service-role keys out of this repository and GitHub Pages variables.

For an existing project, apply only the personal passcodes migration and coordinate it with the frontend deployment. It creates words for the existing roster and keeps invitation links and finalized assignments. The organizer needs to send everyone their new word because the migration retires the old joining codes and access keys.

## Run locally

Use Node.js 22.12 or later.

```sh
npm ci
npm test
npm run dev
```

Before running the dev server, copy `.env.example` to `.env.local` and fill in the two Supabase values. Restart Vite after changing them. For a production build use `npm run build`. Use `npm run preview` to serve the build locally.

## Run an exchange

1. Open **Organizer**, sign in, and create an exchange with its date, optional budget, and event details.
2. Add everyone taking part. Copy the shared invitation link for the group and send each person their word privately. Before the draw, **Regenerate** replaces a participant’s passcode immediately. Adding a name that overlaps an existing word also replaces that word, and the organizer screen identifies anyone who needs an updated passcode.
3. With at least two people on the roster, click **Generate Secret Santa**. Participants can enter their passcodes before the draw and check back once it is ready.
4. Participants open the invitation, enter their word, and open their gift. They can use the same word on another device to see the same assignment. The organizer can view the full draw from the private dashboard.

## Database and access model

| Table | Purpose |
| --- | --- |
| `merry_private.organizers` | Allowlist of authenticated organizer IDs |
| `merry_private.exchanges` | Owner, event details, invitation UUID, and finalization timestamp |
| `merry_private.participants` | Organizer-entered roster |
| `merry_private.passcodes` | Exchange-scoped keyed hashes and encrypted active words |
| `merry_private.passcode_keys` | Private hashing and encryption keys |
| `merry_private.passcode_attempts` | Exchange-wide failed-attempt limits |
| `merry_private.assignments` | Permanent giver and recipient pairs scoped to one exchange |
| `merry_private.activity` | Timestamped exchange, roster, and draw changes |

Every Merry Draw table has Row Level Security enabled. Browser roles access data through RPCs with a fixed search path. `merry_event` reads event information by invitation. `merry_participant` uses an exchange-scoped HMAC-SHA-256 lookup to return only the matching participant and recipient. `merry_admin` checks the authenticated user's allowlist membership and exchange ownership before decrypting the AES-256 copies used for the organizer’s passcode table.

Passcode issuance excludes words that overlap pieces of a roster name and reserves retired hashes so previous words cannot become valid again in the same exchange. Single dictionary words have limited entropy. Five failed lookups within 30 minutes temporarily pause passcode checks for that invitation. Roster writes, passcode lookups, and draws lock the same exchange row. Finalization samples random recipient permutations until there are no self-matches, then inserts all pairs and finalizes the exchange in the same transaction. Unique constraints enforce one recipient and one giver per exchange, and foreign keys enforce membership.

## Deploy to GitHub Pages

1. Create a separate GitHub repository and put the contents of this folder at its root. Use `main` as the deployment branch.
2. In **Settings → Secrets and variables → Actions → Variables**, define `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. In **Settings → Pages**, choose **GitHub Actions** as the source. [GitHub Pages publishing settings](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-a-github-pages-site)
4. Push to `main` or run **Deploy to GitHub Pages** from the Actions tab. The workflow installs locked dependencies, runs tests, builds, uploads the static artifact, and deploys it.
5. Use the deployed URL to sign in and generate the invitation link. Vite's relative asset paths and React Router's hash routes support the repository subdirectory. Invite links look like `https://ACCOUNT.github.io/REPOSITORY/#/join/INVITATION_ID`.

## Verification

`npm test` runs the baseline schema and migration in embedded PostgreSQL with simulated Supabase roles. It checks migration of finalized assignments, duplicate hash rejection, invalid and retired passcodes, failed-attempt limits, repeat visits, one-to-one assignments, and private organizer access.

After configuring a deployed Supabase project, run a disposable exchange with two participants in separate browser profiles. Check organizer sign-in, the shared link, copying and regenerating words, gift reveal, and returning with the same passcode.
