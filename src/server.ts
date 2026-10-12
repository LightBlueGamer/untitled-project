import express from 'express'
import apiRouter from './api/router.js'
import casinoRouter from './api/casino.js'
import { restoreLobbies } from './api/lobbies.js'
import { authApiRouter, authRouter, discordOAuthCallback, requireLogin } from './auth.js'
import { initDatabase, initRedis } from './database.js'

import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express()
const projectRoot = resolve(__dirname, '..')
const port = Number(process.env.PORT) || 3000

app.use('/api', apiRouter)
app.use('/api/auth', authApiRouter)
app.use('/api/casino', express.json(), casinoRouter)
app.use('/auth', authRouter)

const configuredRedirectUri = process.env.DISCORD_REDIRECT_URI
if (configuredRedirectUri) {
    let callbackPath: string
    try {
        callbackPath = new URL(configuredRedirectUri).pathname
    } catch (error) {
        throw new Error('DISCORD_REDIRECT_URI must be a valid absolute URL', {
            cause: error,
        })
    }

    app.get(callbackPath, discordOAuthCallback)
}

// Redirects to the leaderboard when logged out, also for the direct file URL.
app.get(['/casino', '/casino.html'], requireLogin, (_request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.sendFile(join(projectRoot, 'public', 'casino.html'))
})

app.use('/scripts', express.static(join(projectRoot, 'public', 'scripts')))
app.use('/styles', express.static(join(projectRoot, 'public', 'styles')))
app.use(express.static(join(projectRoot, 'public')))

app.get('/', (_request, response) => {
    response.sendFile(join(projectRoot, 'public', 'index.html'))
})

async function startServer(): Promise<void> {
    await initDatabase()
    await initRedis()
    await restoreLobbies()

    app.listen(port, () => {
        console.log(`Server listening on http://localhost:${port}`)
    })
}

void startServer().catch((error: unknown) => {
    console.error('Failed to start server:', error)
    process.exitCode = 1
})
