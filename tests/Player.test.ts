import { afterEach, describe, expect, test, vi } from 'vitest'
import Player, { defaultPlayerData } from '../src/classes/Player.js'

const getPlayerData = (player: Player) =>
  (player as unknown as { data: typeof defaultPlayerData }).data

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Player', () => {
  test('initializes a player with the provided name and ID', () => {
    const player = new Player('Steve', '123456789')

    expect(player).toBeInstanceOf(Player)
    expect(player.name).toBe('Steve')
    expect(player.id).toBe('123456789')
  })

  test('initializes a player with default data when no data is provided', () => {
    const player = new Player('Steve', '123456789')

    expect(getPlayerData(player)).toEqual({
      balance: 0,
      experience: 0,
      level: 1,
      prestige: 0,
      experienceMultiplier: 1.0,
      balanceMultiplier: 1.0,
    })
    
    expect(getPlayerData(player)).toEqual(defaultPlayerData)
  })

  test('uses supplied player data when it is provided', () => {
    const savedData = {
      balance: 500,
      experience: 250,
      level: 4,
      prestige: 0,
      experienceMultiplier: 1.5,
      balanceMultiplier: 1.2,
    }

    const player = new Player('Steve', '123456789', savedData)

    expect(player.name).toBe('Steve')
    expect(player.id).toBe('123456789')
    expect(getPlayerData(player)).toEqual({
      balance: 500,
      experience: 250,
      level: 4,
      prestige: 0,
      experienceMultiplier: 1.5,
      balanceMultiplier: 1.2,
    })
  })

  test('Tests for experience and balance randomized assignment', () => {
    const player = new Player('Steve', '123456789')

    player.assignRandomExperienceAndBalance()

    expect(player.experience).toBeGreaterThanOrEqual(15)
    expect(player.experience).toBeLessThanOrEqual(40)
    expect(player.balance).toBeGreaterThanOrEqual(50)
    expect(player.balance).toBeLessThanOrEqual(150)
  })
})
