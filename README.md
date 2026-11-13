# Karachi Bites — Restaurant Ordering & Management

A mobile-first restaurant ordering MVP with three experiences:
- Customer storefront with Karachi delivery-area selection, product variants, cart and checkout.
- QR/table ordering for dine-in customers.
- Restaurant dashboard with separate online / in-house order queues, menu management and sales summary.

## Stack
React + Vite + Tailwind CSS · Node.js + Express · PostgreSQL + Prisma · Zod · JWT HTTP-only cookie · Docker Compose

## Requirements
- Node.js 20+
- Docker Desktop (recommended) or PostgreSQL 15+
- VS Code

## Run locally

1. Extract this ZIP and open the `karachi-bites` folder in VS Code.
2. Start PostgreSQL:

   ```bash
   docker compose up -d db
   ```

3. Configure backend:

   ```bash
   cd backend
   cp .env.example .env
   npm install
   npx prisma generate
   npx prisma migrate dev --name init
   npm run seed
   npm run dev
   ```

4. In a second terminal, configure frontend:

   ```bash
   cd frontend
   cp .env.example .env
   npm install
   npm run dev
   ```

5. Open http://localhost:5173

## Demo admin
- Email: `admin@karachibites.local`
- Password: `ChangeMe123!`

Change this password and all secrets before exposing the app publicly.

## QR table links
Open `/table/T1`, `/table/T2`, etc. The QR endpoint is:
`http://localhost:4000/api/qr/T1`
In production, generate QR codes using the public frontend URL, not localhost.

## Environment
See `backend/.env.example` and `frontend/.env.example`. Never commit `.env` files.

## Payment notes
- COD is supported as a payment selection.
- Bank transfer is implemented as a manual-transfer workflow. Configure the restaurant's real bank details in the admin UI / environment and reconcile transfers before marking an order paid.
- No card gateway is connected. For live online card payments, integrate a licensed provider (e.g. a locally supported gateway) and verify payment webhooks server-side. Never trust a success redirect from the browser.

## Production checklist
- Use HTTPS and secure cookies behind a trusted reverse proxy.
- Set strong unique `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` and database credentials.
- Set `CORS_ORIGIN` to the exact deployed frontend origin.
- Use managed PostgreSQL, automated backups, monitoring and centralized logs.
- Add payment-provider webhooks, SMS/WhatsApp notifications, image storage (S3-compatible), printer integration and kitchen display hardware.
- Review tax, privacy, consumer protection and food-delivery requirements applicable to your business.
- Add role-based staff accounts before giving dashboard access to kitchen / waiters.
