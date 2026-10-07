import express from 'express'
import apiRouter from './api/router.js'

import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { readdirSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express()
const projectRoot = resolve(__dirname, '..')
const port = Number(process.env.PORT) || 3000

app.use('/api', apiRouter)
app.use('/scripts', express.static(join(projectRoot, 'public', 'scripts')))
app.use('/styles', express.static(join(projectRoot, 'public', 'styles')))
app.use(express.static(join(projectRoot, 'public')))

app.get('/', (_request, response) => {
    response.sendFile(join(projectRoot, 'public', 'index.html'))
})

app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`)
})
