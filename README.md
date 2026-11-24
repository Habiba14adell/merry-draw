# Merry Draw

Merry Draw is a family Secret Santa site built with React, Vite, Tailwind CSS, React Router, and Supabase. Organizers manage exchanges and finalize a draw. Participants use a shared invitation and a personal joining code to register, then use their private access key to return to the same assignment.

## Set up Supabase

1. Create a Supabase project with the Data API enabled and the `public` schema exposed. Leave `merry_private` out of the exposed schemas.
2. In the SQL Editor, run [supabase/schema.sql](supabase/schema.sql) once as the project database owner. The script creates the schema and API functions in a single transaction.
3. Under **Authentication → Users**, create an email/password user for each organizer. Use the dashboard's option to create a confirmed user. Copy the user's ID and run this SQL, replacing the placeholder with that ID.

   ```sql
   insert into merry_private.organizers (user_id)
   values ('REPLACE_WITH_AUTH_USER_UUID');
   ```

4. Disable public sign-ups and anonymous sign-ins in Auth settings. Participants use the invitation flow without Supabase Auth accounts. An authenticated user also needs an organizer allowlist entry to use the dashboard. [Supabase Auth settings](https://supabase.com/docs/guides/auth/general-configuration)
5. Copy the project URL and its publishable key. These values are embedded in the frontend. Keep database passwords, secret keys, and service-role keys out of this repository and GitHub Pages variables.

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
2. Add the people taking part. Copy the shared invitation link. Open **Show joining codes** and send each code privately to its intended participant.
3. Participants open the link and enter their joining code. They can save their private access key for use on another device. The browser remembers the key on the current device. The key is shown in the participant view and can be copied at any time. If the key is lost before the draw, the organizer can remove and re-add that participant to issue a new joining code. After the draw, access requires the original key.
4. Refresh the roster. When at least two people have joined and every name is marked **Joined**, finalize the draw.
5. Participants return through the invitation, select **Return to my draw**, and open their gift. The organizer can view the full draw and download an Excel workbook with participants, assignments, and activity. Keep the workbook private.

## Database and access model

| Table | Purpose |
| --- | --- |
| `merry_private.organizers` | Allowlist of authenticated organizer IDs |
| `merry_private.exchanges` | Owner, event details, invitation UUID, and finalization timestamp |
| `merry_private.participants` | Organizer-entered roster, single-use joining codes, hashed access tokens, and join timestamps |
| `merry_private.assignments` | Permanent giver and recipient pairs scoped to one exchange |
| `merry_private.activity` | Timestamped exchange, roster, registration, and draw changes |

Every table has Row Level Security enabled. The browser roles have no schema access or direct table policies. Three narrowly granted RPCs run with a fixed search path. `merry_event` reads event information by invitation. `merry_participant` claims a roster slot or retrieves a single assignment using a 256-bit browser-generated secret. The database stores its SHA-256 digest. `merry_admin` checks the authenticated user's allowlist membership and exchange ownership.

Roster writes, claims, and draws lock the same exchange row. Finalization samples random recipient permutations until there are no self-matches. It inserts all pairs and marks the exchange finalized in the same transaction. Unique constraints enforce one recipient and one giver per exchange, and foreign keys enforce membership.

## Deploy to GitHub Pages

1. Create a separate GitHub repository and put the contents of this folder at its root. Use `main` as the deployment branch.
2. In **Settings → Secrets and variables → Actions → Variables**, define `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. In **Settings → Pages**, choose **GitHub Actions** as the source. [GitHub Pages publishing settings](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-a-github-pages-site)
4. Push to `main` or run **Deploy to GitHub Pages** from the Actions tab. The workflow installs locked dependencies, runs tests, builds, uploads the static artifact, and deploys it.
5. Use the deployed URL to sign in and generate the invitation link. Vite's relative asset paths and React Router's hash routes support the repository subdirectory. Invite links look like `https://ACCOUNT.github.io/REPOSITORY/#/join/INVITATION_ID`.

## Verification

`npm test` runs the real schema in an embedded PostgreSQL engine with Supabase roles and user IDs supplied by the test harness. It covers event creation and editing, role boundaries, roster changes, registration and retries, draw preconditions, one-to-one assignments, repeat-draw rejection, assignment recovery, and export contents.

After configuring a deployed Supabase project, run one disposable exchange through the browser with two participants in separate profiles. Check sign-in, invitation routing, roster refresh, gift reveal, private-key recovery, and workbook download.
