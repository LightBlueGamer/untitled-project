## Skill tree

Log in with Discord, open your own profile, and select **Open skill tree** to
visit `/skills`.
Skills show their cost and any prerequisite; unlocking one spends the listed
skill points and enables its effect. Drag the tree to explore it and hover or
focus a node to preview its details; select a node to unlock it. The focused
tree also supports arrow-key panning. Use the mouse wheel over the tree or the
zoom buttons to change its scale; reset zoom returns it to 100%.
Base skills line up in the center, with skills arranged on a shared grid and
branching outward in different directions. Cross-branch skills require every listed prerequisite. Hovering, focusing, or selecting
a skill highlights its entire prerequisite chain, including cross-branch paths.
The graph uses a checked layout for the current catalog. When changing the
catalog, update `skillLayout` in `public/scripts/skills.js` and run the skill
tree page tests; if a catalog cannot be drawn without overlaps, the page shows
the skills as a selectable list instead.
Every player profile links to its skill tree and lists owned companions, their
quantities and equipped companion. Companion names link to the wiki when
available. Other players' trees are public and read-only; purchasing skills
still requires logging in and always affects the logged-in player only.
A Discord player record must already exist
to use the tree. Each level awards one skill point, modified by your unlocked
skill-point skills (additive effects apply before multipliers). Each level
earned in a multi-level gain receives that reward. Prestiging resets your
level, XP, unlocked skills, and unspent skill points without a refund; your
money is retained.

On prestige, choose one of three weighted buff options. Newly generated choices
are distinct; choices already offered before this update remain unchanged. Choices and
their descriptions remain available until selected. Permanent buffs stack and
survive future prestiges: XP and money multipliers, flat XP and money per
rewarded message, mixed XP/money boosts, and companion appearance or
Rare-or-higher selection boosts. Flat prestige bonuses are added before
ordinary skill multipliers; prestige XP/money multipliers then apply before
the equipped companion and message-skill bonuses. The original random roll
still determines effects based on "base" rewards. Fresh Start and Head Start
are instead one-time grants of 3 or 6 skill points after the reset; unspent
points still reset at the next prestige. The profile displays permanent
prestige bonuses.

The base XP roll is 15–40 per rewarded message (27.5 on average). The next
level requires 90 XP at level 1, 350 at level 10, and 1,036 at level 20, so
early flat bonuses help quickly while multipliers become more useful as
requirements grow. For example, Experience Gain I plus Experience Multiplier I
turns the average roll into 46.875 XP before rounding and companion bonuses.
Skill Mastery I costs 5 points and Skill Gain I costs 8: once both are owned,
they award three points per level instead of one. Prices apply to new
purchases only; previously unlocked skills remain unlocked.

Message skills trigger only on messages that earn rewards (the existing
30-second cooldown applies). Chance skills roll independently. Their bonuses
are added after the ordinary skill-modified message reward; a "base" reward
is the original roll before skill bonuses. Each message-skill XP bonus is
rounded down, and the total message XP is rounded down before it is awarded.
The total money reward is also rounded down after all skill and companion bonuses.
Interest uses your balance before the message reward. Insightful Discovery adds
20% of the regular XP reward after additive and multiplier skills, excluding
other message-skill bonuses.
Momentum has a 1 in 1,000 chance per rewarded message to award a random whole
percentage from 1% to 100% of the total XP needed for the next level, calculated
before the message reward. When Momentum activates, each percentage has weight
`1 / percentage²`: 1% occurs about 61% of the time, while 100% occurs about
0.006% of the time. At low levels, a small percentage can round
down to zero XP.
Discovery grants an extra point directly, without applying
level-up skill-point multipliers. Jackpot and Discovery are announced in chat.
All of these skills reset on prestige.
Steady Study and Nest Egg add to regular XP and money before multipliers;
Deep Focus adds 15% of regular XP separately from Insightful Discovery, and
Windfall has a 1 in 50 chance to add five times the base money roll.

## Companions

The companion catalog in `src/resources/companions.ts` defines creatures with
combat stats, rarity, encounter weights, and one typed bonus each. Use `/companion list` to see your
inventory and `/companion equip` to choose one owned companion. The list is
private, shows up to ten species per page, and includes stats and bonuses.
Players start with one equipment slot. Companion Bond, a skill after Keen
Senses, grants one slot until prestige; the Companion Keeper prestige buff
grants one permanent slot, for a maximum of three. Each slot must contain a
different owned species. Use `/companion unequip` to free a slot; equipping
when full is rejected. Losing the last copy automatically unequips that
species. Prestige retains inventory, but if the skill slot is lost, the most
recently equipped companions are unequipped until the remaining slots fit.
Register the slash command after building with `npm run deploy:commands`
(requires `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_SERVER_ID`,
`POSTGRES_URL`, and `REDIS_URL`).
Discord global command updates may take time to appear.
The stats are reserved for a future combat system.
The catalog includes 20 additional companions in every rarity, defined in
`src/resources/additionalCompanions.ts`. Their bonuses use the existing XP,
money, skill-point, and rare-encounter effects; adding species changes the
relative selection probabilities of existing companions.

Encounter weights are relative across the whole catalog, not percentages.
Each companion's base weight (1 to 100,000,000) is multiplied by its rarity:
Common 5, Uncommon 3, Rare 1.5, Epic 1, Legendary 0.6, Mythic 0.35,
Eternal 0.2. Divide the resulting weight by the sum of all eligible effective
weights to obtain its probability. Glimmerfox and Prismoth additionally multiply
each Rare-or-higher candidate's weight before normalization; they do not add a
flat percentage to its chance.
Only equipped companions grant bonuses. Equipped XP and money bonuses apply
after ordinary skills and before message skill bonuses. Flat bonuses are added
first, then multipliers stack multiplicatively; XP is rounded down when awarded.
Skill-point bonuses apply once
per level after skill-point skills, not to special skill rewards. The equipped
rare-encounter bonuses of the player whose message triggered a spawn multiply
together and affect the selection of that spawn.

Non-bot messages in server channels can spawn a companion, independently of
the message reward cooldown. Only a message from a different user than the
last eligible sender in that channel triggers a new roll. Repeated messages
from the same user do not roll or increase the chance. Each channel starts at a
chance of 1 in 1,000.
After each unsuccessful roll it gains a random 1–10 chances in 1,000, capped
at 1,000 in 1,000. It resets after a successful spawn roll, not after
inactivity; there is no 30-minute reset timer. The last sender still needs
another user to message before they can roll again. Channel chance and last
sender are stored in PostgreSQL and survive bot restarts.
Field Notes and Lucky Trails multiply only the triggering player's eligible
roll by 1.25 and 1.2 respectively, stacking up to 1.5 times and capped at
certainty. They do not change the shared channel counter. Keen Senses and Rare
Insight similarly multiply Rare-or-higher selection weights by 1.25 and 1.2;
they stack with each other and the triggering player's equipped companion.
Permanent prestige appearance and rarity multipliers also stack with these
skills, and apply only to the triggering player; appearance chance remains
capped at certainty.
Selection uses the catalog's base and rarity weights, divided by
`1 + current circulation / 100` for each species. Thus 100 companions in
circulation halve that species' selection weight. The first player to catch
the companion receives it; after 30 seconds it escapes. Catching and updating
circulation are atomic, and outstanding encounters resume after a bot restart.

The Discord application owner can use `/debug` to enable, disable, or check
console logging for companion chance and message rewards in the current
channel, or gambling outcomes globally. Only administrators see the command by
default; only the application owner can use it, and replies are private.
Settings persist in PostgreSQL across restarts. Chance and reward logs are in
the bot console; gambling logs are in the API console.

The database stores each player's quantities in `player_companions`. Changes
automatically append signed quantities to `companion_events` in the same
transaction. `obtainCompanion` and `loseCompanion` in `src/companionStorage.ts`
are the write operations for future features; a player must already exist and
cannot lose a companion they do not own. Existing and future player data saves
and prestige do not reset this separate inventory. `GET /api/companions/mine`
returns the logged-in player's quantities, and `GET /api/companions/circulation`
returns every catalog companion and its total current circulation (including
zeroes and any retired keys with historical events). The ledger's **Companion
circulation** link shows these totals on the website. Circulation quantities are
decimal strings so large counts are not rounded by JavaScript. Database tables
are created on API or bot startup.

The `/companions` page sorts by name, rarity, or count and links to a wiki page
for each current companion. Its adjusted weight and approximate "1 in X" odds
use current circulation and rarity. The odds are conditional on a companion
appearing and assume no equipped encounter bonus, rarity skills, or prestige
rarity bonus; they are not the chance per message.

The website's `/wiki` page explains progression, skills, companions, casino
games, and common commands. The Discord `/help` command links to it; configure
`WEBSITE_URL` to the public site URL so the bot can generate the correct link.
Without that setting, the bot falls back to `DISCORD_REDIRECT_URI`'s origin and
then `http://localhost:3000`.

Loaded `Player` instances expose a `companions` snapshot of `{ key, quantity }`
entries, also included in the public player API responses. `player.obtainCompanion(key)`
and `player.loseCompanion(key)` persist changes and update that instance's
snapshot; reload the player to see changes made elsewhere. The inventory table
is authoritative, so saving an older player instance cannot overwrite companion
changes or their circulation events.