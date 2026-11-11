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

app.get('/casino.html', (request, response) => {
    response.redirect(301, `/casino${request.url.slice(request.path.length)}`)
})

app.get('/casino', requireLogin, (_request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.sendFile(join(projectRoot, 'public', 'casino.html'))
})

app.get('/skills.html', (request, response) => {
    response.redirect(301, `/skills${request.url.slice(request.path.length)}`)
})

app.get('/skills', (request, response, next) => {
    if (typeof request.query.player === 'string' && request.query.player.length > 0) return next()
    return requireLogin(request, response, next)
}, (_request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.sendFile(join(projectRoot, 'public', 'skills.html'))
})

app.get('/companions.html', (request, response) => {
    response.redirect(301, `/companions${request.url.slice(request.path.length)}`)
})

app.get('/companions', (_request, response) => {
    response.sendFile(join(projectRoot, 'public', 'companions.html'))
})

app.get('/items.html', (request, response) => {
    response.redirect(301, `/items${request.url.slice(request.path.length)}`)
})

app.get('/items', (_request, response) => {
    response.sendFile(join(projectRoot, 'public', 'items.html'))
})

app.get('/item.html', (request, response) => {
    response.redirect(301, `/item${request.url.slice(request.path.length)}`)
})

app.get('/item', (_request, response) => {
    response.sendFile(join(projectRoot, 'public', 'item.html'))
})

app.get('/companion.html', (request, response) => {
    response.redirect(301, `/companion${request.url.slice(request.path.length)}`)
})

app.get('/companion', (_request, response) => {
    response.sendFile(join(projectRoot, 'public', 'companion.html'))
})

app.get('/wiki.html', (request, response) => {
    response.redirect(301, `/wiki${request.url.slice(request.path.length)}`)
})

app.get('/wiki', (_request, response) => {
    response.sendFile(join(projectRoot, 'public', 'wiki.html'))
})

app.get('/leaderboard.html', (request, response) => {
    response.redirect(301, `/leaderboard${request.url.slice(request.path.length)}`)
})

app.get('/leaderboard', (_request, response) => {
    response.sendFile(join(projectRoot, 'public', 'leaderboard.html'))
})

app.get('/', (request, response) => {
    if (['id', 'view', 'authError'].some(key => key in request.query)) {
        response.redirect(302, `/leaderboard${request.url.slice(request.path.length)}`)
        return
    }
    response.sendFile(join(projectRoot, 'public', 'index.html'))
})

app.use('/scripts', express.static(join(projectRoot, 'public', 'scripts')))
app.use('/styles', express.static(join(projectRoot, 'public', 'styles')))
app.use(express.static(join(projectRoot, 'public')))

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
