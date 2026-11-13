import { json, Router } from 'express'
import Player from '../../classes/Player.js'
import { loadSession } from '../../auth.js'
import { getPool } from '../../database.js'
import { getDiscordProfile } from '../../discordProfile.js'
import { profileNameEvents } from '../../profileNameEvents.js'

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

        const discord = await getDiscordProfile(player.id)
        response.setHeader('Cache-Control', 'no-store')
        response.json({ ...player.toJSON(), requiredXP: player.xpForNextLevel(player.level), profileBonuses: player.profileBonuses, discord })
    } catch (error) {
        console.error('Failed to fetch player data:', error)
        response.status(500).json({ error: 'Failed to fetch player data' })
    }
})

router.put('/me/name', async (request, response, next) => {
    try {
        response.setHeader('Cache-Control', 'no-store')
        const user = await loadSession(request.headers.cookie)
        if (!user) {
            response.status(401).json({ error: 'Login required' })
            return
        }
        if (!request.is('application/json') || request.get('X-Requested-With') !== 'XMLHttpRequest') {
            response.status(400).json({ error: 'Invalid request' })
            return
        }
        response.locals.userId = user.id
        next()
    } catch (error) {
        next(error)
    }
}, json({ limit: '4kb' }), async (request, response) => {
    const name = typeof request.body?.name === 'string' ? request.body.name.trim() : ''
    if (!name || Array.from(name).length > 32 || /[@<>\p{C}]/u.test(name)) {
        response.status(400).json({ error: 'Choose a name of 1–32 characters without @, angle brackets, or control characters.' })
        return
    }
    try {
        const result = await getPool().query(
            "UPDATE players SET data = jsonb_set(data, '{name}', to_jsonb($2::text), true) WHERE id = $1 RETURNING id",
            [response.locals.userId, name],
        )
        if (!result.rowCount) {
            response.status(404).json({ error: 'Player not found. Participate in Discord first.' })
            return
        }
        profileNameEvents.emit('changed', response.locals.userId, name)
        try {
            await Player.invalidate(response.locals.userId)
        } catch (error) {
            console.error('Name saved but player cache could not be refreshed:', error)
            response.status(500).json({ error: 'Your name was saved, but the cache could not be refreshed. Please try again.' })
            return
        }
        response.json({ name })
    } catch (error) {
        console.error('Failed to update player name:', error)
        response.status(500).json({ error: 'Could not update your name. Please try again.' })
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
