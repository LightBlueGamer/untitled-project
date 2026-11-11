# Changelog

Updates are listed newest first. Each entry summarizes the features and changes
introduced in that release.

## 2026-11-10 — Homepage, skill tree, companions, and game guide

- Added item sales on the signed-in player's profile, using the same prices,
  inventory checks and equipped-tool handling as `/sell`.
- Enabled public slash commands for both server and user installations,
  including DMs and group DMs, and added an account-install link to the
  homepage. The developer-only debug command remains server-scoped.
  To activate this, enable **User Install** and **Guild Install** in the
  Discord Developer Portal's Installation settings, configure the user
  install with the `applications.commands` scope, save the settings, and run
  `npm run deploy:commands`. Each player must add the app to their account.
- Fixed `/companion list` failing for collections that fit on a single page.
- Added a public homepage with bot features, live server and unique human-member
  counts, total player balance and lifetime XP, the top three players, and a
  server invite link. The existing leaderboard is available at `/leaderboard`.
- Added lifetime XP tracking, including experience earned across level-ups and
  prestiges. Existing players are credited for XP required by their prior
  prestige and level progress; future XP rewards are tracked cumulatively.
  Enable Discord's privileged Server Members Intent to provide the unique
  human-member count.
- Added house-game payout boosts from new companions, skills, and permanent
  prestige buffs. They increase winning payouts in Plinko, Blackjack, Pass the
  Bills, and solo poker without changing win odds; active boosts and adjusted
  Plinko multipliers appear in the casino.
- Added the interactive `/skills` tree, including skill prerequisites,
  cross-branch paths, zoom and keyboard navigation, and a list fallback for
  layouts that cannot be drawn. The complete tree now fits its canvas and can
  be explored by scrolling; skill nodes have a clearer visual hierarchy.
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
  collections. Companion circulation can be searched by name, key, or rarity.
  Catching companions and updating circulation are atomic.
- Added a categorized scavenging and crafting catalog with 20 materials,
  components, consumables, and treasures; rarity-scale encounter weights;
  tool-specific exclusions and bonuses; and craftable tools that improve
  item-category or higher-rarity odds.
- Expanded scavenging with ten additional items per rarity and tuned base
  weights into smoothly descending rarity bands from Common through Eternal.
- Added more craftable supplies and equipment, including three new scavenging
  tools with category-specific and rarity-based bonuses.
- Added `/scavenge` with a persistent five-minute base cooldown and item weights
  adjusted by rarity and current circulation. The Scavenging Efficiency skill
  reduces the cooldown by 15% and branches from Field Notes. Player profiles
  show inventory, equipped tools, and active consumable effects; `/tool`
  manages equipment, `/craft` creates recipes, and `/use` activates timed
  consumable bonuses.
- Every player starts with a 10-slot Small Pouch; each carried item uses one
  slot. Craft successive backpack upgrades to increase capacity, and use
  `/sell` to free space at listed prices. Existing over-capacity inventories
  are preserved but cannot be scavenged into until there is room.
- Added lootboxes from rewarded messages and prestige, with rarity-biased item
  and companion rewards, consumable timed boosts, skills, and prestige buffs.
  `/lootbox` manages boxes and boosts separately from backpack capacity.
- Expanded scavenging skills with improved find odds, extra-find chances, and
  additional equipped-tool slots.
- Assigned a timed scavenging effect to every consumable, with rarity boosts or
  an extra-item chance; each effect is shown in item descriptions.
- Item pages show approximate 1-in-X chances rather than raw item weights.
  Public scavenging embeds show the actual chance, item link, and XP earned;
  XP depends on item rarity, price, and quantity and can be improved by skills.
  Level-up announcements last 30 seconds and link to the skill tree when
  skill points are earned.
- Restyled companion and item collections on player profiles as rarity-accented
  cards. Item catalog and detail pages now show current total circulation.
- Added searchable, sortable `/items` and `/item` catalog pages with item
  details, recipes, and scavenging tool rules. Expanded the wiki with guidance
  for item categories, relative weights, and tool modifiers.
- Added `/wiki` for game information and `/help` to link to the guide.
  Companion, skill, casino, and wiki pages use clean URLs.
- Added `/debug` controls for companion appearance, message rewards, and casino
  logging.
- Added regression coverage for skill-tree behavior, API endpoints,
  progression, companions, scavenging and crafting, and Discord interactions.

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
