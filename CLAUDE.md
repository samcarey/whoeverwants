# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm run dev` - Start development server with Turbopack (opens at http://localhost:3000)
- `npm run build` - Build the production application
- `npm run start` - Start the production server
- `npm run lint` - Run Next.js linting

## Project Architecture

This is a Next.js 15 application using the App Router architecture with TypeScript and Tailwind CSS v4.

### Key Structure
- **App Router**: Uses `app/` directory for routing
- **Styling**: Tailwind CSS v4 with custom CSS variables for theme management
- **Fonts**: Geist Sans and Geist Mono fonts loaded via `next/font`
- **TypeScript**: Strict mode enabled with path aliases (`@/*` maps to root)

### Current Application Flow
The app implements a simple poll creation workflow:
1. **Home page** (`app/page.tsx`) - Centered menu with "Create Poll" button
2. **Create Poll page** (`app/create-poll/page.tsx`) - Form with title input and submit
3. **Confirmation page** (`app/confirmation/page.tsx`) - Success message after submission

### Navigation Pattern
All pages include a "Home" button that routes back to the main page using Next.js `Link` components.

### Styling Conventions
- Uses Tailwind CSS utility classes
- Custom CSS variables defined in `globals.css` for theme colors
- Dark mode support via `prefers-color-scheme`
- Consistent button styling patterns across pages
- Responsive design with mobile-first approach

### Component Patterns
- Client components use `"use client"` directive when needed (forms, state)
- Server components by default
- Form handling with React state and `useRouter` for navigation

## Database Integration

The application uses Supabase as the backend database.

### Setup Requirements
1. Copy `.env.example` to `.env.local` and add your Supabase credentials:
   - `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Your Supabase public API key

### Database Schema
- **polls table**: Stores poll data with `id`, `title`, `created_at`, `updated_at`
- Row Level Security (RLS) enabled with public read/insert policies
- Auto-updating timestamps via database triggers

### Migrations
- Located in `database/migrations/` directory
- Each migration has corresponding up/down SQL files
- Apply via Supabase Dashboard SQL Editor
- See `database/README.md` for detailed instructions

### Database Client
- Supabase client configured in `lib/supabase.ts`
- Includes TypeScript interfaces for database entities
- Error handling and environment variable validation