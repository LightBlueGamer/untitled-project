import express from 'express'
import apiRouter from './api/router.js'
import { authApiRouter, authRouter, discordOAuthCallback } from './auth.js'
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

app.use('/scripts', express.static(join(projectRoot, 'public', 'scripts')))
app.use('/styles', express.static(join(projectRoot, 'public', 'styles')))
app.use(express.static(join(projectRoot, 'public')))

app.get('/', (_request, response) => {
    response.sendFile(join(projectRoot, 'public', 'index.html'))
})

async function startServer(): Promise<void> {
    await initDatabase()
    await initRedis()

    app.listen(port, () => {
        console.log(`Server listening on http://localhost:${port}`)
    })
}

void startServer().catch((error: unknown) => {
    console.error('Failed to start server:', error)
    process.exitCode = 1
})
