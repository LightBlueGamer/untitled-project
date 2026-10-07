import { Router } from 'express'
import playerRouter from './routes/player.js'

const router = Router()

router.get('/', (_request, response) => {
    response.json({ message: 'API is running' })
})

router.use('/players', playerRouter)

export default router
