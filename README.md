# Mubasharat Backend API

Express.js backend server for the Mubasharat dream interpretation platform.

## Quick Start

```bash
# Install dependencies
npm install

# Setup database
npx prisma generate
npx prisma db push

# Start development server
npm run dev

# Build for production
npm run build
npm start
```

## Environment Variables

Create `.env` file:

```env
DATABASE_URL="mysql://root:@localhost:3306/tafseer_elahlam"
JWT_SECRET="your-secret-key-change-in-production"
PORT=5000
CORS_ORIGINS="http://localhost:3000"
NODE_ENV="development"
```

## Features

- ✅ RESTful API with Express
- ✅ Prisma ORM with MySQL
- ✅ JWT Authentication
- ✅ CORS configured
- ✅ Static file serving for uploads
- ✅ TypeScript
- ✅ Hot reload with ts-node-dev

## Project Structure

```
backend/
├── src/
│   ├── routes/          # API route handlers
│   │   ├── auth.ts
│   │   ├── profile.ts
│   │   ├── dreams.ts
│   │   ├── messages.ts
│   │   ├── requests.ts
│   │   └── ...
│   ├── middleware/      # Express middleware
│   │   ├── auth.ts
│   │   └── errorHandler.ts
│   ├── utils/           # Utility functions
│   │   ├── auth.ts
│   │   └── session.ts
│   ├── lib/             # Libraries
│   │   └── prisma.ts
│   └── server.ts        # Main server file
├── prisma/
│   ├── schema.prisma    # Database schema
│   └── seed.js          # Database seeder
├── public/
│   └── uploads/         # Uploaded files
│       └── avatars/
└── package.json
```

## API Documentation

See [INTEGRATION_GUIDE.md](../INTEGRATION_GUIDE.md) for complete API documentation.

## Development

```bash
# Run in development mode with hot reload
npm run dev

# Build TypeScript
npm run build

# Run Prisma Studio (DB GUI)
npm run prisma:studio

# Generate Prisma Client
npm run prisma:generate

# Push schema changes to DB
npx prisma db push
```

## Testing

```bash
# Health check
curl https://b-ahlamy.developteam.site/api/health

# Test authentication
curl -X POST https://b-ahlamy.developteam.site/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@mubasharat.com","password":"admin123"}'
```

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run prisma:generate` - Generate Prisma client
- `npm run prisma:migrate` - Run migrations
- `npm run prisma:studio` - Open Prisma Studio
- `npm run prisma:seed` - Seed database

## Port

Default: **5000**  
Change in `.env`: `PORT=YOUR_PORT`

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Language**: TypeScript
- **ORM**: Prisma
- **Database**: MySQL
- **Auth**: JWT + bcryptjs
- **Dev**: ts-node-dev

---

**Status**: ✅ Running  
**Version**: 1.0.0
