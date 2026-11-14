# Changelog

Updates are listed newest first. Each entry summarizes the features and changes
introduced in that release.

## The House Learns

- Challenge Prestigious in heads-up Texas Hold'em on the casino page. Entry is
  $100–$4,503,599,627,370,495; both players begin with that many virtual chips. Blinds
  start at 10/20 and increase by 10% every five hands. Tied hands split the pot.
  The tournament ends when one player has all the chips.
- Each entry is held until settlement. A loss, forfeit or five-minute timeout
  adds it to the shared pool; a win returns the entry and pays a share of the
  pool at settlement. The share is the greater of 0.1% of the pool or the
  entry divided by 75% of the pool, capped at 100%. Pool prizes are rounded
  down to whole dollars; the remainder stays in the pool. Simultaneous matches
  settle in order, and the new rule also applies to matches already in progress.
  The page's estimate uses the last displayed pool, which may change.
  Disconnecting does not forfeit:
  return before the deadline to resume. After a server restart, active games
  get a fresh five minutes, and unrecoverable games have their entry returned.
  Amounts exceeding the supported balance remain owed and are credited when
  there is room on a subsequent visit to the game.
- Prestigious uses persistent player-specific and shared action frequencies to
  adjust a heuristic poker strategy. This is not a guarantee of continual
  improvement. Casino payout boosts and developer hidden-card previews do not
  apply to this mode.
- The private developer dashboard can search players and inspect their stored
  raise, call/check, and fold counts, shared counts, and the resulting strategy
  adjustments. It does not expose hidden cards or individual hand histories.
- Poker games visually deal hole and community cards in sequence with card
  sounds. The casino sound toggle applies, and reduced-motion preferences skip
  the animation. Rejoining an existing hand does not replay its earlier deals.
- To run the PostgreSQL tests, set `HOUSE_TEST_DATABASE_URL` to an empty,
  disposable database and run `npx vitest run tests/houseLearnsGame.test.ts
  tests/houseLearnsIntegration.test.ts`. Never use a production database.

## 2026-11-13 — Developer diagnostics

- Added `/store` with an Auction House and a placeholder Bot Shop. Players can
  list items, companions, unopened lootboxes and unused boosts, bid with funds
  held in escrow, and claim winnings (items require backpack space). Auctions
  last 1–168 hours; ending early awards the current highest bidder. A listing
  costs 1% of its starting price per 24 hours, minimum $10, charged on creation.
  If a later fee cannot be paid, the auction ends and the seller is notified
  on their profile. Three optional 24-hour promoted spots start at the greater
  of $100 or 1% of starting price; a full slot requires a higher payment than
  the cheapest spot, with unused time refunded when replaced or ended. Auction
  settlement runs in the API service and catches up after downtime.
- To run the auction PostgreSQL integration tests, provide
  `AUCTION_TEST_DATABASE_URL` pointing to an empty, disposable PostgreSQL
  database and run `npx vitest run tests/auctionIntegration.test.ts`. Never use
  a production database for these tests.
- The Bot Shop in `/store` shares stock globally and regenerates after 24 hours
  with maintenance running about once per minute, or on the next shop request.
  The developer can restock it early from the Store or developer dashboard.
  Selection is weighted by rarity and item circulation; price is rounded from
  2.5–100 times base price, with higher prices favored and scarcity shifting
  prices upward. Backpacks are excluded. Sold-out listings remain visible
  until restock and purchases require sufficient inventory space and balance.
  To run its integration tests, point `BOT_SHOP_TEST_DATABASE_URL` at an
  empty, disposable PostgreSQL database and run
  `npx vitest run tests/botShopIntegration.test.ts`.
- The Bot Shop supports name, rarity and type filters. Signed-in players see a
  restock alert until they mark it read. Public purchase history is retained for
  30 days; purchases made before purchase recording was added are unavailable.
  At least one eligible item is selected per restock, with each additional item
  less likely than the last; rarity and circulation weight the choices.
- Player saves now detect concurrent balance changes and preserve newer
  balances when the save does not modify money, preventing stale saves from
  overwriting casino transactions or other balance updates.
- Restored the purple-and-gold theme and added a persistent light/dark switch.
  The character overview groups stats into compact, illustrated sections. A
  profile Boosts tab shows active temporary consumable and lootbox effects,
  their descriptions and expiration times; refresh it to see newly activated
  effects. Permanent and equipment bonuses are separate. Skill-tree
  instructions appear below the tree, with a balance chart showing the
  share of unlocked skills per category; drag, zoom, and keyboard navigation
  remain available without visible tree scrollbars.
- Refreshed the website's RPG-inspired visual design across the homepage,
  navigation, profiles, catalogs, guide, skill tree, casino, and developer page.
- Redesigned profiles with a single prestige, level, and XP progress display,
  plus tabs for overview, companions, items, skill tree, and personal settings.
  The skill tree remains editable on your own profile and read-only for others.
  Discord's `/skills` command lists prerequisite-ready skills and asks for
  confirmation before spending points, even when a skill is not yet affordable.
- Profiles now show Discord avatars and usernames, level progress, and a
  player-chosen display name. Signed-in players can change their own name
  (1–32 characters); the name appears on the leaderboard, in game displays,
  and alongside Discord mentions in bot announcements. The website service
  needs `DISCORD_TOKEN` to look up Discord profiles; lookups are cached for
  one hour and profiles show a fallback if Discord is unavailable.
- Added a global lootbox debug topic for eligible message drop chances and
  outcomes, prestige awards, and opened or saved item, companion, and boost
  rewards. Message drop rolls only happen on cooldown-eligible messages.
- Added a private `/developer` dashboard for the Discord account configured by
  `DEVELOPER_ID`. Set this environment variable on the website service and log
  in with Discord; access is denied if it is missing. Docker Compose passes it
  from `.env`. The bot application owner can still use `/debug` in Discord.
- Debug topics are now global across all servers and channels. Enabled legacy
  channel settings become global at startup. The dashboard shares the latest
  500 enabled events through Redis and displays usernames and server/channel
  names for message events without recording message contents. Redis
  persistence determines whether the feed survives a Redis restart.
- Companion chance diagnostics also report when a message is skipped because
  the same person sent the previous eligible message, showing the unchanged
  base chance rather than implying a roll occurred.
- Rebuild and restart both bot and API services, and run
  `npm run deploy:commands` to update the Discord command descriptions.

## 2026-11-12 — Level progression

- Increased XP requirements by a multiplier based on the current level: 1× at
  levels 1–10, 2× at 11–20, 3× at 21–30, and so on. Existing levels, XP,
  and historical lifetime-XP estimates are preserved.

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
- Solo poker bots use other players' display names when available, with a bot
  marker and generated-name fallback; they do not represent real players.
- The configured `DEVELOPER_ID` can toggle Casino view on the developer
  dashboard. Enabled by default, it privately reveals both dealer cards and
  the next card in solo blackjack during an active hand. The next card is
  dealt to the player on Hit or Double, or to the dealer first on Stand if
  the dealer needs to draw. Blackjack action advice compares expected net
  winnings for Stand, Hit once then Stand, and Double when affordable. It
  uses that known card and exact probabilities for subsequent random draws;
  it does not predict further player decisions or guarantee the outcome.
  It also reveals opponents' hole cards and upcoming
  community cards in solo and multiplayer poker to the developer only. All
  poker players see their own current hand. Developer view includes each
  player's hand, estimated equity from 300 random boards (ties split), and
  actual-board showdown winners, assuming no further folds. Equity and
  predictions do not account for side pots or future betting.
  Changes apply on the next action or refresh.

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
