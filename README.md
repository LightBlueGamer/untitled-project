# Discord Bot

## Web server

Run `npm start` to build and start the Express server at `http://localhost:3000`.
Set the `PORT` environment variable to use a different port.

The server responds with `public/index.html` at `/` and serves the files in
`public/scripts/` and `public/styles/` from their matching URL paths.

To run the API without starting the Discord bot, run `npm run start:api`. The
API process initializes the player table and Redis connection on its own.

## Player storage

Player data is stored in PostgreSQL (`POSTGRES_URL`) and cached in Redis
(`REDIS_URL`). The API process creates the `players` table if it does not
already exist.

Use `GET /api/players` to retrieve all players, or `GET /api/players/:id` to
retrieve a single existing player. Each response includes the player's ID, name,
balance, experience, level, prestige, and multipliers. The single-player route
returns `404` if the player does not exist.
