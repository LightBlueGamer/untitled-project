import { Router } from 'express'

const router = Router()

router.get('/', (_request, response) => {
    response.json({ message: 'API is running' })
})

export default router
