# Development Server Configuration

## Base URL
- **Dev Server**: `http://decisionbot.a.pinggy.link/`
- **Local Dev**: `http://localhost:3000/`

## Poll URL Format
- **Pattern**: `http://decisionbot.a.pinggy.link/poll?id={POLL_ID}`
- **Example**: `http://decisionbot.a.pinggy.link/poll?id=be10bfcf-e903-4098-a698-27bbca9179da`

## Notes
- Server returns 308 redirect but resolves to 200 OK when following redirects
- Use dev server URL for all demo links and user-facing URLs