# Discord Bot

## Web server

Run `npm start` to build and start the Express server at `http://localhost:3000`.
Set the `PORT` environment variable to use a different port.

The server responds with `public/index.html` at `/` and serves the files in
`public/scripts/` and `public/styles/` from their matching URL paths.

## Player storage

The bot stores player data in PostgreSQL (`POSTGRES_URL`) and caches it in
Redis (`REDIS_URL`). On startup, it creates the `players` table if it does not
already exist.
