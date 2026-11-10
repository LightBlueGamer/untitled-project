# Changelog

Updates are listed newest first. Each entry summarizes the features and changes
introduced in that release.

## 2026-11-10 — Skill tree, companions, and game guide

- Added the interactive `/skills` tree, including skill prerequisites,
  cross-branch paths, zoom and keyboard navigation, and a list fallback for
  layouts that cannot be drawn.
- Added skill-point progression and expanded skills for XP, money, message
  rewards, and companion encounters. Prestige now offers persistent buffs and
  profile details for those bonuses.
- Added collectible companions with rarity, stats, weighted selection, and
  equipped bonuses. `/companion list`, `/companion equip`, and
  `/companion unequip` manage collections and equipment slots.
- Added companion encounters to eligible server messages. The base appearance
  chance is 1 in 1,000 per eligible roll; unsuccessful rolls increase the
  channel chance by 1–10 in 1,000. Channel chance and last sender persist in
  PostgreSQL across bot restarts, and a successful appearance resets the
  chance. There is no inactivity reset timer.
- Added companion circulation and detail pages, plus player profile
  collections. Catching companions and updating circulation are atomic.
- Added `/wiki` for game information and `/help` to link to the guide.
  Companion, skill, casino, and wiki pages use clean URLs.
- Added `/debug` controls for companion appearance, message rewards, and casino
  logging.
- Added regression coverage for skill-tree behavior, API endpoints,
  progression, companions, and Discord interactions.

## 2026-10-14 — Core skills

- Applied skills to player progression and message rewards, including XP,
  money, and skill-point effects.

## 2026-10-13 — Skill catalog

- Added the initial skill resource and definitions for player abilities.

## 2026-10-12 — Multiplayer casino

- Added multiplayer lobbies, additional casino games, and a casino leaderboard.

## 2026-10-11 — Casino games

- Added browser-based Plinko and Blackjack with server-backed game actions.

## 2026-10-10 — Discord sign-in and prestige buffs

- Added Discord OAuth for the web ledger and improved the prestige system with
  selectable buffs.

## 2026-10-09 — Ledger improvements and prestige

- Added prestige progression and formalized reset and progression behavior.
- Refined the ledger interface and separated its client-side logic.

## 2026-10-07 — Web ledger and persistent bot

- Added the player ledger website and API.
- Added persistent player storage, Discord bot commands and events, a web API,
  and Docker deployment.

## 2026-10-06 — Player progression

- Added player balances, experience, leveling, and randomized XP and money
  multipliers.

## 2026-10-05 — Project setup

- Created the initial project and player model.
