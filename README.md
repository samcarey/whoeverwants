# Whoever Wants

A simple tool for helping people decide what to do.

**Try it out: [whoeverwants.com](https://whoeverwants.com)**

## What is this?

Whoever Wants is a lightweight, anonymous polling app that helps groups make decisions together. Whether you're deciding where to eat, what movie to watch, or any other group decision - this tool makes it easy to collect everyone's preferences without the hassle of accounts or sign-ups.

## Features

- **No accounts required** - Create and vote on polls completely anonymously
- **Yes/No polls** - Simple binary decisions
- **Ranked choice voting** - Instant-runoff voting with Borda tiebreak for multi-option consensus
- **Suggestion polls** - Let voters suggest and vote on options
- **Participation polls** - RSVP with min/max constraints and conditional attendance
- **Time-limited polls** - Set deadlines to keep decisions moving
- **Share via link** - Just send the URL to collect responses
- **Mobile optimized** - Works great on any device (PWA support)

## Tech Stack

- **Frontend**: Next.js 15, React 18, Tailwind CSS 4, TypeScript — hosted on Vercel
- **Backend**: Python (FastAPI) — hosted on a DigitalOcean droplet
- **Database**: PostgreSQL 16

## Development

```bash
npm install        # Install frontend dependencies
npm run dev        # Start Next.js dev server
npm run test:run   # Run unit tests
npm run test:e2e   # Run Playwright E2E tests
```

The Python API server lives in `server/` and uses [uv](https://docs.astral.sh/uv/) for package management:

```bash
cd server
uv run pytest              # Run API tests
uv run uvicorn main:app    # Run API locally
```

See [CLAUDE.md](CLAUDE.md) for full development workflow and architecture docs.

## License

This project is dual-licensed under your choice of either:

- **MIT License** - See [LICENSE-MIT](LICENSE-MIT)
- **Apache License 2.0** - See [LICENSE-APACHE](LICENSE-APACHE)
