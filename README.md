# Internal HB

Internal HB is a shared atelier operations workspace for clients, orders, appointments, measurements, workshop progress, and delivery status.

The Vercel deployment exposes the Express API through `api/[...path].js`. The current JSON file store and in-memory sessions are suitable for local evaluation, but production use should migrate these to a durable database and shared session store.

## Deploy to Vercel

The repository is deployable as-is with Vercel's Node.js function detection:

```powershell
npm install
npx vercel
```

Configure these Vercel environment variables before using a deployment:

- `INTERNAL_HB_ADMIN_USER`
- `INTERNAL_HB_ADMIN_PASSWORD` (at least 8 characters)
- `SESSION_SECRET` (a long random value)

The function writes temporary data under `/tmp` on Vercel, so data and sessions can be lost when an instance is recycled and are not shared across instances. Use a durable database and shared session store before treating a deployment as production data storage.

## Run locally

```powershell
npm install
npm start
```

Open `http://127.0.0.1:3747`. The first local admin is `admin` / `change-me-now`. Set `INTERNAL_HB_ADMIN_USER`, `INTERNAL_HB_ADMIN_PASSWORD`, and `SESSION_SECRET` before using the app beyond local evaluation.

All organization data is stored in `data/internal-hb.json`. The `data` directory is local application state and should not be committed or shared.

## Roles

- **Admin:** shared operational data plus total amount, advance paid, and user administration.
- **Staff:** shared operational data with financial fields excluded at the API boundary.

Appointment state is explicit for completed/postponed visits and date-derived for scheduled visits: a past scheduled date shows as pending; a future date shows as scheduled. The appointment model is intentionally isolated so a future calendar or appointment source can be connected without changing the order screens.

## Connected workflow

Clients are identified by name and have one reusable measurement sheet. Orders reference the client name, custom garment description, appointment, workshop stage, and delivery state. The client profile, active orders, workshop, dashboard, and Status Quo views all read from those same order records.
