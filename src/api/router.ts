import { Router } from 'express'
import playerRouter from './routes/player.js'
import skillsRouter from './routes/skills.js'
import companionsRouter from './routes/companions.js'
import homeRouter from './routes/home.js'
import itemsRouter from './routes/items.js'
import auctionsRouter from './routes/auctions.js'
import botShopRouter from './routes/botShop.js'

const router = Router()

router.get('/', (_request, response) => {
    response.json({ message: 'API is running' })
})

router.use('/home', homeRouter)
router.use('/players', playerRouter)
router.use('/skills', skillsRouter)
router.use('/companions', companionsRouter)
router.use('/items', itemsRouter)
router.use('/auctions', auctionsRouter)
router.use('/bot-shop', botShopRouter)

export default router
