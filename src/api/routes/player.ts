import { Router } from 'express'
import Player from '../../classes/Player.js'

const router = Router()

router.get('/', async (_request, response) => {
    try {
        const players = await Player.findAll()
        response.json(players.map((player) => player.toJSON()))
    } catch (error) {
        console.error('Failed to fetch player data:', error)
        response.status(500).json({ error: 'Failed to fetch player data' })
    }
})

router.get('/:id', async (request, response) => {
    try {
        const player = await Player.findById(request.params.id)

        if (!player) {
            response.status(404).json({ error: 'Player not found' })
            return
        }

        response.json(player.toJSON())
    } catch (error) {
        console.error('Failed to fetch player data:', error)
        response.status(500).json({ error: 'Failed to fetch player data' })
    }
})

router.get('/:id/requiredXP', async (request, response) => {
    try {
        const player = await Player.findById(request.params.id)

        if (!player) {
            response.status(404).json({ error: 'Player not found' })
            return
        }

        response.json({ requiredXP: player.xpForNextLevel(player.level) })
    } catch (error) {
        console.error('Failed to fetch required XP:', error)
        response.status(500).json({ error: 'Failed to fetch required XP' })
    }
})

export default router
