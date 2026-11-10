import { Router } from 'express'
import playerRouter from './routes/player.js'
import skillsRouter from './routes/skills.js'
import companionsRouter from './routes/companions.js'

const router = Router()

router.get('/', (_request, response) => {
    response.json({ message: 'API is running' })
})

router.use('/players', playerRouter)
router.use('/skills', skillsRouter)
router.use('/companions', companionsRouter)

export default router
