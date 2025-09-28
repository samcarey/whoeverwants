# Contributing to Whoever Wants

Thanks for your interest in contributing! This is a pretty chill project, so don't stress too much about perfect code. We're all about the vibes here.

## Development Setup

### Prerequisites

- Node.js 18+ 
- npm or yarn
- A Supabase account (free tier works great)

### Getting Started

1. Clone the repo:
```bash
git clone https://github.com/samcarey/whoeverwants.git
cd whoeverwants
```

2. Install dependencies:
```bash
npm install
```

3. Set up your environment variables by copying `.env.example` to `.env` and filling in your Supabase credentials.

4. Run the development server:
```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

The page auto-updates as you edit files.

### Database Setup

The project uses Supabase. Check the `database/migrations` folder for the schema. You can run migrations using the scripts in the `scripts` folder.

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run linter
- `npm run db:rebuild-test` - Rebuild test database
- `npm run db:clear-test` - Clear test database

## Code Style

This project is mostly vibe coded, which means:
- Intuition over rigid patterns
- Working code over perfect abstractions
- Quick iterations over extensive planning
- Keep it simple and functional

That said, try to:
- Keep components reasonably sized
- Use TypeScript types where helpful
- Write code that's easy to understand
- Test your changes manually (we don't have automated tests yet)

## Making Changes

1. Fork the repo
2. Create a feature branch (`git checkout -b my-cool-feature`)
3. Make your changes
4. Test everything works
5. Commit your changes with a clear message
6. Push to your fork
7. Open a Pull Request

## Questions?

Just open an issue if you're stuck or confused about anything. This is a friendly project and we're happy to help!