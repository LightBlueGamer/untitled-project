import { randomBytes, randomInt } from "node:crypto";
import { Router } from "express";
import { getPool } from "../database.js";
import { adjustBalance, recordBets } from "./casino.js";

// Multiplayer lobbies live in memory, so they are lost if the server restarts.

type LobbyGame = "bills" | "poker";
type Face = "circle" | "star" | "left" | "right";
type Card = { rank: string; suit: string };

const FACES: Face[] = ["circle", "star", "left", "right"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠", "♥", "♦", "♣"];
const HAND_NAMES = [
    "High card",
    "Pair",
    "Two pair",
    "Three of a kind",
    "Straight",
    "Flush",
    "Full house",
    "Four of a kind",
    "Straight flush",
];

const BILLS_PER_PLAYER = 3;
const BILLS_MIN_PLAYERS = 2;
const BILLS_MAX_PLAYERS = 8;
const BILLS_TURN_MS = 20_000;
const BILLS_AUTO_MS = 1_200;

const POKER_MIN_PLAYERS = 2;
const POKER_MAX_PLAYERS = 6;
const POKER_MIN_BUY_IN = 20;
const POKER_TURN_MS = 45_000;
const POKER_NEXT_HAND_MS = 7_000;

const ABSENT_MS = 3 * 60_000;
const FINISHED_TTL_MS = 5 * 60_000;
const MAX_LOBBIES = 200;

interface Member {
    id: string;
    name: string;
    lastSeen: number;
    left: boolean;
    auto: boolean;
    // Pass the Bills
    bills: number;
    // Poker
    chips: number;
    invested: number;
    bet: number;
    total: number;
    folded: boolean;
    allIn: boolean;
    acted: boolean;
    leaving: boolean;
    hole: Card[];
}

interface BillsState {
    center: number;
    inPlay: number;
    turn: number;
    phase: "main" | "final";
    lastRoll: { id: string; name: string; dice: Face[]; phase: "main" | "final" } | null;
    winner: string | null;
    deadline: number;
    rolls: number;
}

interface PokerResult {
    showdown: boolean;
    winners: { id: string; amount: number; hand: string | null }[];
    hands: Record<string, string>;
}

interface PokerState {
    stage: "preflop" | "flop" | "turn" | "river";
    community: Card[];
    deck: Card[];
    dealer: string | null;
    turn: number;
    currentBet: number;
    minRaise: number;
    active: boolean;
    handNo: number;
    deadline: number;
    nextHandAt: number;
    result: PokerResult | null;
    sb: number;
    bb: number;
}

interface Lobby {
    id: string;
    game: LobbyGame;
    hostId: string;
    bet: number; // Bills: per bill. Poker: buy-in.
    maxPlayers: number;
    status: "waiting" | "playing" | "finished";
    members: Member[];
    createdAt: number;
    finishedAt: number;
    bills: BillsState;
    poker: PokerState;
    solo?: boolean;
}

const lobbies = new Map<string, Lobby>();
const userLobby = new Map<string, string>();
const busyUsers = new Set<string>();

function newMember(id: string, name: string): Member {
    return {
        id,
        name,
        lastSeen: Date.now(),
        left: false,
        auto: false,
        bills: 0,
        chips: 0,
        invested: 0,
        bet: 0,
        total: 0,
        folded: false,
        allIn: false,
        acted: false,
        leaving: false,
        hole: [],
    };
}

const isBot = (id: string) => id.startsWith("bot:");

const BOT_NAMES = [
    "Ace", "Blaze", "Clover", "Dusty", "Echo", "Fable", "Ginger", "Hawk",
    "Indigo", "Jinx", "Kismet", "Lucky", "Maverick", "Nova", "Onyx", "Piper",
];

function addBot(lobby: Lobby): void {
    const used = new Set(lobby.members.map((member) => member.name));
    const free = BOT_NAMES.filter((name) => !used.has(`${name} 🤖`));
    const pool = free.length > 0 ? free : BOT_NAMES;
    const bot = newMember(`bot:${randomBytes(4).toString("hex")}`, `${pool[randomInt(pool.length)]} 🤖`);
    bot.chips = lobby.bet;
    bot.invested = lobby.bet;
    lobby.members.push(bot);
}

function money(task: Promise<unknown>): void {
    task.catch((error) => console.error("Lobby payout failed:", error));
}

function credit(userId: string, amount: number): void {
    if (amount > 0 && !isBot(userId)) {
        money(adjustBalance(userId, amount, 0));
    }
}

const billsStake = (lobby: Lobby) => lobby.bet * BILLS_PER_PLAYER;
const entryCost = (lobby: Lobby) =>
    lobby.game === "bills" ? billsStake(lobby) : lobby.bet;

// Poker hand evaluation

const rankValue = (rank: string) =>
    rank === "A" ? 14 : rank === "K" ? 13 : rank === "Q" ? 12 : rank === "J" ? 11 : Number(rank);

function eval5(cards: Card[]): number[] {
    const values = cards.map((card) => rankValue(card.rank)).sort((a, b) => b - a);
    const flush = cards.every((card) => card.suit === cards[0].suit);
    const counts = new Map<number, number>();
    for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
    const ranksByGroup = groups.map((group) => group[0]);
    const unique = [...new Set(values)];
    let straight = 0;
    if (unique.length === 5) {
        if (unique[0] - unique[4] === 4) {
            straight = unique[0];
        } else if (unique[0] === 14 && unique[1] === 5) {
            straight = 5;
        }
    }
    if (straight && flush) return [8, straight];
    if (groups[0][1] === 4) return [7, ...ranksByGroup];
    if (groups[0][1] === 3 && groups[1][1] === 2) return [6, ...ranksByGroup];
    if (flush) return [5, ...values];
    if (straight) return [4, straight];
    if (groups[0][1] === 3) return [3, ...ranksByGroup];
    if (groups[0][1] === 2 && groups[1][1] === 2) return [2, ...ranksByGroup];
    if (groups[0][1] === 2) return [1, ...ranksByGroup];
    return [0, ...values];
}

function compareScores(a: number[], b: number[]): number {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const difference = (a[i] ?? 0) - (b[i] ?? 0);
        if (difference !== 0) return difference;
    }
    return 0;
}

function bestHand(cards: Card[]): number[] {
    let best: number[] = [-1];
    const pick: Card[] = [];
    const walk = (start: number) => {
        if (pick.length === 5) {
            const score = eval5(pick);
            if (compareScores(score, best) > 0) best = score;
            return;
        }
        for (let i = start; i < cards.length; i++) {
            pick.push(cards[i]);
            walk(i + 1);
            pick.pop();
        }
    };
    walk(0);
    return best;
}

function newDeck(): Card[] {
    const deck = RANKS.flatMap((rank) => SUITS.map((suit) => ({ rank, suit })));
    for (let i = deck.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// Lobby lifecycle

function newLobby(game: LobbyGame, host: Member, bet: number, maxPlayers: number): Lobby {
    return {
        id: randomBytes(4).toString("hex"),
        game,
        hostId: host.id,
        bet,
        maxPlayers,
        status: "waiting",
        members: [host],
        createdAt: Date.now(),
        finishedAt: 0,
        bills: {
            center: 0,
            inPlay: 0,
            turn: 0,
            phase: "main",
            lastRoll: null,
            winner: null,
            deadline: 0,
            rolls: 0,
        },
        poker: {
            stage: "preflop",
            community: [],
            deck: [],
            dealer: null,
            turn: -1,
            currentBet: 0,
            minRaise: 0,
            active: false,
            handNo: 0,
            deadline: 0,
            nextHandAt: 0,
            result: null,
            sb: Math.max(1, Math.floor(bet / 20)),
            bb: Math.max(1, Math.floor(bet / 20)) * 2,
        },
    };
}

function deleteLobby(lobby: Lobby): void {
    lobbies.delete(lobby.id);
    for (const member of lobby.members) {
        if (userLobby.get(member.id) === lobby.id) {
            userLobby.delete(member.id);
        }
    }
}

function reassignHost(lobby: Lobby): void {
    const next = lobby.members.find(
        (member) => !member.left && !member.leaving && !isBot(member.id),
    );
    if (next) {
        lobby.hostId = next.id;
    }
}

// Pass the Bills

function startBills(lobby: Lobby): void {
    const state = lobby.bills;
    lobby.status = "playing";
    for (const member of lobby.members) {
        member.bills = BILLS_PER_PLAYER;
    }
    state.center = 0;
    state.inPlay = lobby.members.length * BILLS_PER_PLAYER;
    state.turn = randomInt(lobby.members.length);
    state.phase = "main";
    state.lastRoll = null;
    state.winner = null;
    state.rolls = 0;
    state.deadline = Date.now() + BILLS_TURN_MS;
}

function finishBills(lobby: Lobby, winnerId: string): void {
    const stake = billsStake(lobby);
    const pot = stake * lobby.members.length;
    lobby.bills.winner = winnerId;
    lobby.status = "finished";
    lobby.finishedAt = Date.now();
    credit(winnerId, pot);
    for (const member of lobby.members) {
        money(
            recordBets(member.id, "bills", [
                { bet: stake, payout: member.id === winnerId ? pot : 0 },
            ]),
        );
        if (userLobby.get(member.id) === lobby.id) {
            userLobby.delete(member.id);
        }
    }
}

function nextBillsHolder(lobby: Lobby, from: number): number {
    const { members } = lobby;
    for (let i = 1; i <= members.length; i++) {
        const index = (from + i) % members.length;
        if (members[index].bills > 0) return index;
    }
    return from;
}

function billsRoll(lobby: Lobby): void {
    const state = lobby.bills;
    const { members } = lobby;
    const count = members.length;
    const seat = state.turn;
    const roller = members[seat];
    const roll = (): Face => FACES[randomInt(FACES.length)];
    const dice: Face[] = [];
    state.rolls++;

    if (state.phase === "main") {
        const dieCount = Math.min(BILLS_PER_PLAYER, roller.bills);
        for (let i = 0; i < dieCount && state.inPlay > 1; i++) {
            const face = roll();
            dice.push(face);
            if (face === "left" || face === "right") {
                const target = (seat + (face === "left" ? 1 : count - 1)) % count;
                roller.bills--;
                members[target].bills++;
            } else if (face === "star") {
                roller.bills--;
                state.center++;
                state.inPlay--;
            }
        }
        state.lastRoll = { id: roller.id, name: roller.name, dice, phase: "main" };
        if (state.inPlay <= 1) {
            state.phase = "final";
            state.turn = members.findIndex((member) => member.bills > 0);
        } else {
            state.turn = nextBillsHolder(lobby, seat);
        }
    } else {
        const face = roll();
        dice.push(face);
        state.lastRoll = { id: roller.id, name: roller.name, dice, phase: "final" };
        if (face === "circle") {
            finishBills(lobby, roller.id);
            return;
        }
        if (face === "left" || face === "right") {
            const target = (seat + (face === "left" ? 1 : count - 1)) % count;
            roller.bills--;
            members[target].bills++;
            state.turn = target;
        }
    }

    const next = members[state.turn];
    state.deadline = Date.now() + (next.auto || next.left ? BILLS_AUTO_MS : BILLS_TURN_MS);
}

// Poker

function pokerIndex(lobby: Lobby, id: string | null): number {
    return lobby.members.findIndex((member) => member.id === id);
}

function post(member: Member, amount: number): void {
    const paid = Math.min(amount, member.chips);
    member.chips -= paid;
    member.bet += paid;
    member.total += paid;
    if (member.chips === 0) {
        member.allIn = true;
    }
}

function nextToAct(lobby: Lobby, from: number): number {
    const { members } = lobby;
    for (let i = 1; i <= members.length; i++) {
        const index = (from + i) % members.length;
        if (!members[index].folded && !members[index].allIn) return index;
    }
    return -1;
}

// Removes members who left or busted, paying out their remaining chips.
function cleanupSeats(lobby: Lobby): void {
    lobby.members = lobby.members.filter((member) => {
        if (member.chips > 0 && !member.leaving) {
            return true;
        }
        credit(member.id, member.chips);
        if (!isBot(member.id)) {
            money(
                recordBets(member.id, "poker", [
                    { bet: Math.max(1, member.invested), payout: member.chips },
                ]),
            );
        }
        if (userLobby.get(member.id) === lobby.id) {
            userLobby.delete(member.id);
        }
        return false;
    });
    if (lobby.members.every((member) => isBot(member.id))) {
        deleteLobby(lobby);
    } else if (!lobby.members.some((member) => member.id === lobby.hostId)) {
        reassignHost(lobby);
    }
}

function startHand(lobby: Lobby): void {
    const state = lobby.poker;
    cleanupSeats(lobby);
    if (!lobbies.has(lobby.id)) return;
    const { members } = lobby;
    if (members.length < POKER_MIN_PLAYERS) {
        state.active = false;
        lobby.status = "waiting";
        return;
    }

    lobby.status = "playing";
    state.handNo++;
    state.stage = "preflop";
    state.community = [];
    state.deck = newDeck();
    state.result = null;
    state.active = true;
    for (const member of members) {
        member.bet = 0;
        member.total = 0;
        member.folded = false;
        member.allIn = false;
        member.acted = false;
        member.hole = [];
    }

    const count = members.length;
    const dealer = (pokerIndex(lobby, state.dealer) + 1) % count;
    state.dealer = members[dealer].id;
    const smallBlind = count === 2 ? dealer : (dealer + 1) % count;
    const bigBlind = (smallBlind + 1) % count;
    post(members[smallBlind], state.sb);
    post(members[bigBlind], state.bb);
    state.currentBet = Math.max(members[smallBlind].bet, members[bigBlind].bet);
    state.minRaise = state.bb;
    for (const member of members) {
        member.hole = [state.deck.pop()!, state.deck.pop()!];
    }
    state.turn = nextToAct(lobby, bigBlind);
    state.deadline = Date.now() + POKER_TURN_MS;
    advance(lobby, true);
}

function finishHand(lobby: Lobby, showdown: boolean): void {
    const state = lobby.poker;
    const { members } = lobby;
    const live = members.filter((member) => !member.folded);
    const won = new Map<string, number>();
    const hands: Record<string, string> = {};
    const scores = new Map<string, number[]>();

    if (showdown) {
        for (const member of live) {
            const score = bestHand([...member.hole, ...state.community]);
            scores.set(member.id, score);
            hands[member.id] = HAND_NAMES[score[0]];
        }
        const levels = [
            ...new Set(members.filter((m) => m.total > 0).map((m) => m.total)),
        ].sort((a, b) => a - b);
        let previous = 0;
        for (const level of levels) {
            const contributors = members.filter((m) => m.total > previous);
            const amount = contributors.reduce(
                (sum, m) => sum + Math.min(m.total, level) - previous,
                0,
            );
            previous = level;
            let eligible = live.filter((m) => m.total >= level);
            if (eligible.length === 0) eligible = live;
            let top = [eligible[0]];
            for (const member of eligible.slice(1)) {
                const diff = compareScores(scores.get(member.id)!, scores.get(top[0].id)!);
                if (diff > 0) top = [member];
                else if (diff === 0) top.push(member);
            }
            const share = Math.floor(amount / top.length);
            let remainder = amount - share * top.length;
            for (const member of top) {
                const extra = remainder > 0 ? 1 : 0;
                remainder -= extra;
                won.set(member.id, (won.get(member.id) ?? 0) + share + extra);
            }
        }
    } else {
        won.set(
            live[0].id,
            members.reduce((sum, m) => sum + m.total, 0),
        );
    }

    for (const member of members) {
        member.chips += won.get(member.id) ?? 0;
        member.bet = 0;
    }
    state.result = {
        showdown,
        hands,
        winners: [...won.entries()].map(([id, amount]) => ({
            id,
            amount,
            hand: hands[id] ?? null,
        })),
    };
    state.active = false;
    state.turn = -1;
    state.nextHandAt = Date.now() + POKER_NEXT_HAND_MS;
}

// Moves play on after an action (or the start of a hand). Returns nothing; mutates the lobby.
function advance(lobby: Lobby, fromStart = false): void {
    const state = lobby.poker;
    const { members } = lobby;
    const live = members.filter((member) => !member.folded);
    if (live.length === 1) {
        finishHand(lobby, false);
        return;
    }

    const needsAction = (member: Member) =>
        !member.folded && !member.allIn && (!member.acted || member.bet < state.currentBet);
    if (members.some(needsAction)) {
        if (!fromStart) {
            for (let i = 1; i <= members.length; i++) {
                const index = (state.turn + i) % members.length;
                if (needsAction(members[index])) {
                    state.turn = index;
                    break;
                }
            }
        } else if (state.turn < 0 || !needsAction(members[state.turn])) {
            state.turn = members.findIndex(needsAction);
        }
        state.deadline = Date.now() + POKER_TURN_MS;
        return;
    }

    for (;;) {
        if (state.stage === "river") {
            finishHand(lobby, true);
            return;
        }
        if (state.stage === "preflop") {
            state.stage = "flop";
            state.community.push(state.deck.pop()!, state.deck.pop()!, state.deck.pop()!);
        } else {
            state.stage = state.stage === "flop" ? "turn" : "river";
            state.community.push(state.deck.pop()!);
        }
        for (const member of members) {
            member.bet = 0;
            member.acted = false;
        }
        state.currentBet = 0;
        state.minRaise = state.bb;
        const able = live.filter((member) => !member.allIn);
        if (able.length >= 2) {
            state.turn = nextToAct(lobby, pokerIndex(lobby, state.dealer));
            state.deadline = Date.now() + POKER_TURN_MS;
            return;
        }
    }
}

function pokerAct(
    lobby: Lobby,
    member: Member,
    action: string,
    to: unknown,
): string | null {
    const state = lobby.poker;
    if (action === "fold") {
        member.folded = true;
        member.acted = true;
    } else if (action === "call") {
        post(member, state.currentBet - member.bet);
        member.acted = true;
    } else if (action === "raise") {
        if (typeof to !== "number" || !Number.isSafeInteger(to)) {
            return "Raise amount must be a whole number";
        }
        const maxTo = member.bet + member.chips;
        const target = Math.min(to, maxTo);
        if (target <= state.currentBet) {
            if (target === maxTo) {
                post(member, state.currentBet - member.bet);
                member.acted = true;
                advance(lobby);
                return null;
            }
            return "Raise must be higher than the current bet";
        }
        if (target < maxTo && target < state.currentBet + state.minRaise) {
            return `Minimum raise is to ${state.currentBet + state.minRaise}`;
        }
        const size = target - state.currentBet;
        if (size >= state.minRaise) {
            state.minRaise = size;
        }
        post(member, target - member.bet);
        state.currentBet = target;
        for (const other of lobby.members) {
            if (other !== member && !other.folded && !other.allIn) {
                other.acted = false;
            }
        }
        member.acted = true;
    } else {
        return "Unknown action";
    }
    advance(lobby);
    return null;
}

// Leaving

function leaveLobby(lobby: Lobby, member: Member): void {
    if (userLobby.get(member.id) === lobby.id) {
        userLobby.delete(member.id);
    }

    if (lobby.game === "bills") {
        if (lobby.status === "waiting") {
            lobby.members = lobby.members.filter((m) => m !== member);
            credit(member.id, billsStake(lobby));
        } else if (lobby.status === "playing") {
            member.left = true;
            member.auto = true;
        } else {
            return;
        }
    } else {
        if (member.leaving) return;
        member.leaving = true;
        const state = lobby.poker;
        if (!state.active) {
            cleanupSeats(lobby);
            return;
        }
        if (!member.folded) {
            const wasTurn = lobby.members[state.turn] === member;
            member.folded = true;
            member.acted = true;
            if (wasTurn) {
                advance(lobby);
            } else if (lobby.members.filter((m) => !m.folded).length === 1) {
                finishHand(lobby, false);
            }
        }
    }

    if (
        lobby.members.length === 0 ||
        (lobby.game === "bills" && lobby.status === "waiting" && lobby.members.length === 0)
    ) {
        deleteLobby(lobby);
    } else if (lobby.hostId === member.id) {
        reassignHost(lobby);
    }
}

// Simple bot AI: estimates hand strength, then checks, calls, raises or folds.
function botStrength(lobby: Lobby, member: Member): number {
    const { community } = lobby.poker;
    let strength: number;
    if (community.length < 3) {
        const [a, b] = member.hole.map((card) => rankValue(card.rank)).sort((x, y) => y - x);
        strength = (a + b) / 40 + (a === b ? 0.35 + a / 60 : 0);
        if (member.hole[0].suit === member.hole[1].suit) strength += 0.05;
        if (Math.abs(a - b) === 1) strength += 0.04;
    } else {
        const category = bestHand([...member.hole, ...community])[0];
        strength = [0.15, 0.45, 0.65, 0.78, 0.85, 0.88, 0.93, 0.97, 1][category] ?? 0.15;
    }
    return strength + (Math.random() - 0.5) * 0.2;
}

function botAct(lobby: Lobby, member: Member): void {
    const state = lobby.poker;
    const pot = lobby.members.reduce((sum, m) => sum + m.total, 0);
    const toCall = Math.min(state.currentBet - member.bet, member.chips);
    const strength = botStrength(lobby, member);
    const raiseTo = () =>
        state.currentBet + Math.max(state.minRaise, Math.round(pot * (0.3 + Math.random() * 0.5)));
    const bluff = Math.random() < 0.05;

    let action: string = "call";
    let to: number | null = null;
    if (toCall === 0) {
        if ((strength > 0.62 && Math.random() < 0.6) || bluff) {
            action = "raise";
            to = raiseTo();
        }
    } else {
        const potOdds = toCall / (pot + toCall);
        if (strength > 0.78 && Math.random() < 0.4) {
            action = "raise";
            to = raiseTo();
        } else if (strength + 0.1 < potOdds * 1.3 && toCall > state.bb && !bluff) {
            action = "fold";
        }
    }
    if (pokerAct(lobby, member, action, to) !== null) {
        pokerAct(lobby, member, "call", null);
    }
}

// Advances timers: absent players, turn timeouts, automatic next hands and clean-up.
function tick(lobby: Lobby): void {
    const now = Date.now();

    for (const member of [...lobby.members]) {
        if (isBot(member.id)) continue;
        if (!member.left && !member.leaving && now - member.lastSeen > ABSENT_MS) {
            if (lobby.status === "finished") {
                member.left = true;
            } else {
                leaveLobby(lobby, member);
            }
        }
    }
    if (!lobbies.has(lobby.id)) return;

    if (lobby.status === "finished") {
        if (now - lobby.finishedAt > FINISHED_TTL_MS) deleteLobby(lobby);
        return;
    }

    if (lobby.game === "bills") {
        if (lobby.status === "playing" && now > lobby.bills.deadline) {
            const roller = lobby.members[lobby.bills.turn];
            if (!roller.left) roller.auto = true;
            billsRoll(lobby);
        }
        return;
    }

    const state = lobby.poker;
    if (state.active && now > state.deadline) {
        const member = lobby.members[state.turn];
        if (member) {
            pokerAct(lobby, member, member.bet >= state.currentBet ? "call" : "fold", null);
        }
    } else if (state.active) {
        const member = lobby.members[state.turn];
        // The deadline is reset whenever the turn changes, so it marks when the turn began.
        if (member && isBot(member.id) && now >= state.deadline - POKER_TURN_MS + 1500) {
            botAct(lobby, member);
        }
    } else if (!state.active && lobby.status === "playing" && now > state.nextHandAt) {
        startHand(lobby);
    }
}

// Persistence: lobbies (and the money escrowed in them) survive restarts.
const savedSnapshots = new Map<string, string>();
let saveChain: Promise<void> = Promise.resolve();

function persist(): Promise<void> {
    saveChain = saveChain
        .then(async () => {
            const pool = getPool();
            const present = new Set<string>();
            for (const lobby of [...lobbies.values()]) {
                present.add(lobby.id);
                const json = JSON.stringify(lobby);
                if (savedSnapshots.get(lobby.id) === json) continue;
                await pool.query(
                    `INSERT INTO casino_lobbies (id, data) VALUES ($1, $2::jsonb)
                     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
                    [lobby.id, json],
                );
                savedSnapshots.set(lobby.id, json);
            }
            for (const id of [...savedSnapshots.keys()]) {
                if (present.has(id)) continue;
                await pool.query(`DELETE FROM casino_lobbies WHERE id = $1`, [id]);
                savedSnapshots.delete(id);
            }
        })
        .catch((error) => console.error("Saving lobbies failed:", error));
    return saveChain;
}

export async function restoreLobbies(): Promise<void> {
    const { rows } = await getPool().query<{ id: string; data: Lobby }>(
        `SELECT id, data FROM casino_lobbies`,
    );
    const now = Date.now();
    for (const { data: lobby } of rows) {
        // Give everyone a fresh window to reconnect and act after the downtime.
        for (const member of lobby.members) {
            member.lastSeen = now;
        }
        lobby.bills.deadline = now + BILLS_TURN_MS;
        lobby.poker.deadline = now + POKER_TURN_MS;
        lobby.poker.nextHandAt = now + POKER_NEXT_HAND_MS;
        lobbies.set(lobby.id, lobby);
        savedSnapshots.set(lobby.id, JSON.stringify(lobby));
        if (lobby.status !== "finished") {
            for (const member of lobby.members) {
                if (!member.left && !member.leaving) {
                    userLobby.set(member.id, lobby.id);
                }
            }
        }
    }
    if (rows.length > 0) {
        console.log(`Restored ${rows.length} casino lobbies`);
    }
}

setInterval(() => {
    for (const lobby of [...lobbies.values()]) {
        try {
            tick(lobby);
        } catch (error) {
            console.error("Lobby tick failed:", error);
        }
    }
    void persist();
}, 1000).unref();

// Views

function summary(lobby: Lobby) {
    const host = lobby.members.find((member) => member.id === lobby.hostId);
    const joinable =
        !lobby.solo &&
        lobby.members.length < lobby.maxPlayers &&
        (lobby.game === "bills"
            ? lobby.status === "waiting"
            : lobby.status === "waiting" || !lobby.poker.active);
    return {
        id: lobby.id,
        game: lobby.game,
        hostName: host?.name ?? "?",
        players: lobby.members.length,
        maxPlayers: lobby.maxPlayers,
        bet: lobby.bet,
        cost: entryCost(lobby),
        status: lobby.status,
        joinable,
    };
}

function view(lobby: Lobby, userId: string) {
    const base = {
        ...summary(lobby),
        you: userId,
        now: Date.now(),
        hostId: lobby.hostId,
        solo: Boolean(lobby.solo),
    };

    if (lobby.game === "bills") {        const state = lobby.bills;
        const stake = billsStake(lobby);
        return {
            ...base,
            stake,
            pot: stake * lobby.members.length,
            members: lobby.members.map((member) => ({
                id: member.id,
                name: member.name,
                bills: lobby.status === "waiting" ? 0 : member.bills,
                left: member.left,
            })),
            bills: {
                center: state.center,
                turnId: lobby.status === "playing" ? lobby.members[state.turn]?.id : null,
                phase: state.phase,
                lastRoll: state.lastRoll,
                winner: state.winner,
                rolls: state.rolls,
                deadline: state.deadline,
            },
        };
    }

    const state = lobby.poker;
    const me = lobby.members.find((member) => member.id === userId);
    const reveal = Boolean(state.result?.showdown) && !state.active;
    const turnMember = state.active ? lobby.members[state.turn] : undefined;
    return {
        ...base,
        poker: {
            stage: state.stage,
            community: state.community,
            pot: lobby.members.reduce((sum, member) => sum + member.total, 0),
            currentBet: state.currentBet,
            minRaiseTo: state.currentBet + state.minRaise,
            toCall: me ? Math.min(state.currentBet - me.bet, me.chips) : 0,
            maxTo: me ? me.bet + me.chips : 0,
            active: state.active,
            handNo: state.handNo,
            turnId: turnMember?.id ?? null,
            deadline: state.deadline,
            nextHandAt: state.nextHandAt,
            dealerId: state.dealer,
            sb: state.sb,
            bb: state.bb,
            result: state.result,
            myHole: me?.hole ?? [],
            seats: lobby.members.map((member) => ({
                id: member.id,
                name: member.name,
                chips: member.chips,
                bet: member.bet,
                folded: member.folded,
                allIn: member.allIn,
                leaving: member.leaving,
                bot: isBot(member.id),
                inHand: state.active || reveal ? member.hole.length > 0 : false,
                hole:
                    member.id === userId || (reveal && !member.folded) ? member.hole : [],
            })),
        },
    };
}

// Routes

const lobbiesRouter = Router();

// Save right after any state-changing request has been answered.
lobbiesRouter.use((request, response, next) => {
    if (request.method !== "GET") {
        response.on("finish", () => void persist());
    }
    next();
});

async function playerName(userId: string): Promise<string> {
    const result = await getPool().query<{ name: string | null }>(
        `SELECT data->>'name' AS name FROM players WHERE id = $1`,
        [userId],
    );
    return result.rows[0]?.name || "Player";
}

function isWholeNumber(value: unknown, min: number): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}

lobbiesRouter.get("/", (request, response) => {
    const game = request.query.game;
    const list = [...lobbies.values()]
        .filter((lobby) => lobby.status !== "finished" && !lobby.solo)
        .filter((lobby) => game === undefined || lobby.game === game)
        .map(summary)
        .sort((a, b) => Number(b.joinable) - Number(a.joinable));
    response.json({ lobbies: list });
});

lobbiesRouter.get("/mine", (_request, response) => {
    const userId: string = response.locals.userId;
    const lobby = lobbies.get(userLobby.get(userId) ?? "");
    const member = lobby?.members.find((m) => m.id === userId);
    if (!lobby || !member) {
        response.json({ lobby: null });
        return;
    }
    member.lastSeen = Date.now();
    response.json({ lobby: view(lobby, userId) });
});

lobbiesRouter.post("/", async (request, response) => {
    const userId: string = response.locals.userId;
    const { game, bet, maxPlayers, bots }: Record<string, unknown> = request.body ?? {};
    const botCount = game === "poker" && typeof bots === "number" ? Math.floor(bots) : 0;

    if (game !== "bills" && game !== "poker") {
        response.status(400).json({ error: "Unknown game" });
        return;
    }
    const minPlayers = game === "bills" ? BILLS_MIN_PLAYERS : POKER_MIN_PLAYERS;
    const maxAllowed = game === "bills" ? BILLS_MAX_PLAYERS : POKER_MAX_PLAYERS;
    if (!isWholeNumber(bet, game === "poker" ? POKER_MIN_BUY_IN : 1)) {
        response.status(400).json({
            error:
                game === "poker"
                    ? `Buy-in must be a whole number of at least ${POKER_MIN_BUY_IN}`
                    : "Bet must be a whole number of at least 1",
        });
        return;
    }
    if (
        !isWholeNumber(maxPlayers, minPlayers) ||
        maxPlayers > maxAllowed
    ) {
        response
            .status(400)
            .json({ error: `Players must be between ${minPlayers} and ${maxAllowed}` });
        return;
    }
    if (botCount < 0 || botCount > maxPlayers - 1 || (botCount > 0 && botCount !== maxPlayers - 1)) {
        response.status(400).json({ error: "Invalid number of bots" });
        return;
    }
    const cost = game === "bills" ? bet * BILLS_PER_PLAYER : bet;
    if (!Number.isSafeInteger(cost)) {
        response.status(400).json({ error: "Bet is too large" });
        return;
    }
    if (userLobby.has(userId) || busyUsers.has(userId)) {
        response.status(400).json({ error: "You are already in a lobby" });
        return;
    }
    if (lobbies.size >= MAX_LOBBIES) {
        response.status(400).json({ error: "Too many open lobbies" });
        return;
    }

    busyUsers.add(userId);
    try {
        const name = await playerName(userId);
        const balance = await adjustBalance(userId, -cost, cost);
        if (balance === null) {
            response.status(400).json({ error: "Insufficient balance" });
            return;
        }
        const member = newMember(userId, name);
        if (game === "poker") {
            member.chips = cost;
            member.invested = cost;
        }
        const lobby = newLobby(game, member, bet, maxPlayers);
        for (let i = 0; i < botCount; i++) addBot(lobby);
        if (botCount > 0) {
            lobby.solo = true;
            startHand(lobby);
        }
        lobbies.set(lobby.id, lobby);
        userLobby.set(userId, lobby.id);
        await persist();
        response.json({ lobby: view(lobby, userId), balance });
    } finally {
        busyUsers.delete(userId);
    }
});

lobbiesRouter.post("/:id/join", async (request, response) => {
    const userId: string = response.locals.userId;
    const lobby = lobbies.get(String(request.params.id));
    if (!lobby) {
        response.status(404).json({ error: "Lobby not found" });
        return;
    }
    if (userLobby.has(userId) || busyUsers.has(userId)) {
        response.status(400).json({ error: "You are already in a lobby" });
        return;
    }
    const open = () =>
        lobbies.get(lobby.id) === lobby &&
        summary(lobby).joinable &&
        !lobby.members.some((member) => member.id === userId);
    if (!open()) {
        response.status(400).json({ error: "This lobby can't be joined right now" });
        return;
    }

    busyUsers.add(userId);
    try {
        const cost = entryCost(lobby);
        const name = await playerName(userId);
        const balance = await adjustBalance(userId, -cost, cost);
        if (balance === null) {
            response.status(400).json({ error: "Insufficient balance" });
            return;
        }
        if (!open()) {
            credit(userId, cost);
            response.status(400).json({ error: "This lobby can't be joined right now" });
            return;
        }
        const member = newMember(userId, name);
        if (lobby.game === "poker") {
            member.chips = cost;
            member.invested = cost;
        }
        lobby.members.push(member);
        userLobby.set(userId, lobby.id);
        await persist();
        response.json({ lobby: view(lobby, userId), balance });
    } finally {
        busyUsers.delete(userId);
    }
});

function memberLobby(
    request: { params: { id?: string | string[] } },
    userId: string,
): { lobby: Lobby; member: Member } | null {
    const lobby = lobbies.get(String(request.params.id));
    const member = lobby?.members.find((m) => m.id === userId);
    return lobby && member ? { lobby, member } : null;
}

lobbiesRouter.get("/:id", (request, response) => {
    const userId: string = response.locals.userId;
    const found = memberLobby(request, userId);
    if (!found) {
        response.status(404).json({ error: "Lobby not found" });
        return;
    }
    found.member.lastSeen = Date.now();
    response.json({ lobby: view(found.lobby, userId) });
});

lobbiesRouter.post("/:id/leave", (request, response) => {
    const userId: string = response.locals.userId;
    const found = memberLobby(request, userId);
    if (!found) {
        response.json({ ok: true });
        return;
    }
    leaveLobby(found.lobby, found.member);
    response.json({ ok: true });
});

lobbiesRouter.post("/:id/start", (request, response) => {
    const userId: string = response.locals.userId;
    const found = memberLobby(request, userId);
    if (!found) {
        response.status(404).json({ error: "Lobby not found" });
        return;
    }
    const { lobby } = found;
    if (lobby.hostId !== userId) {
        response.status(403).json({ error: "Only the host can start the game" });
        return;
    }
    if (lobby.status !== "waiting") {
        response.status(400).json({ error: "The game has already started" });
        return;
    }
    const minimum = lobby.game === "bills" ? BILLS_MIN_PLAYERS : POKER_MIN_PLAYERS;
    if (lobby.members.length < minimum) {
        response.status(400).json({ error: `Need at least ${minimum} players` });
        return;
    }
    if (lobby.game === "bills") {
        startBills(lobby);
    } else {
        startHand(lobby);
    }
    response.json({ lobby: view(lobby, userId) });
});

lobbiesRouter.post("/:id/action", (request, response) => {
    const userId: string = response.locals.userId;
    const found = memberLobby(request, userId);
    if (!found) {
        response.status(404).json({ error: "Lobby not found" });
        return;
    }
    const { lobby, member } = found;
    const { action, to }: Record<string, unknown> = request.body ?? {};
    found.member.lastSeen = Date.now();

    if (lobby.game === "bills") {
        if (
            action !== "roll" ||
            lobby.status !== "playing" ||
            lobby.members[lobby.bills.turn] !== member
        ) {
            response.status(400).json({ error: "It isn't your turn" });
            return;
        }
        member.auto = false;
        billsRoll(lobby);
    } else {
        if (!lobby.poker.active || lobby.members[lobby.poker.turn] !== member) {
            response.status(400).json({ error: "It isn't your turn" });
            return;
        }
        const error = pokerAct(lobby, member, String(action), to);
        if (error) {
            response.status(400).json({ error });
            return;
        }
    }
    response.json({ lobby: view(lobby, userId) });
});

export default lobbiesRouter;
