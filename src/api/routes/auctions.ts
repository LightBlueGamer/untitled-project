import { json, Router, type Request, type Response, type NextFunction } from "express";
import { loadSession } from "../../auth.js";
import { AuctionError, auctionAccount, auctionDetail, auctionInventory, bidAuction, claimAuction, createAuction, endAuction, listAuctions, promoteAuction, readAuctionNotifications } from "../../auctionStorage.js";

const router = Router();
router.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });

router.get("/", async (request, response) => {
    const page = request.query.page ?? "0";
    if (typeof page !== "string" || !/^(0|[1-9]\d{0,6})$/.test(page)) throw new AuctionError("Invalid page.");
    const listings = await listAuctions(Number(page));
    response.json({ auctions: listings.slice(0, 50), hasMore: listings.length > 50 });
});
router.get("/account", async (request, response) => {
    const user = await loadSession(request.headers.cookie);
    if (!user) { response.status(401).json({ error: "Login required." }); return; }
    response.json(await auctionAccount(user.id));
});
router.get("/inventory", async (request, response) => {
    const user = await loadSession(request.headers.cookie);
    if (!user) { response.status(401).json({ error: "Login required." }); return; }
    response.json({ assets: await auctionInventory(user.id) });
});
router.get("/:id", async (request, response) => { response.json(await auctionDetail(request.params.id)); });

router.use(async (request, response, next) => {
    const user = await loadSession(request.headers.cookie);
    if (!user) { response.status(401).json({ error: "Login required." }); return; }
    if (!request.is("application/json") || request.get("X-Requested-With") !== "XMLHttpRequest") {
        response.status(400).json({ error: "JSON and X-Requested-With are required." }); return;
    }
    response.locals.userId = user.id;
    next();
}, json({ limit: "8kb" }));

router.post("/", async (request, response) => {
    const { kind, key, quantity, title, description, price, hours } = request.body ?? {};
    if (!["item", "companion", "lootbox", "boost"].includes(kind) || typeof key !== "string" || key.length < 1 || key.length > 100
        || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000
        || typeof title !== "string" || title.trim().length < 1 || Array.from(title.trim()).length > 80
        || typeof description !== "string" || Array.from(description.trim()).length > 500
        || !Number.isSafeInteger(price) || price < 1 || price > 1000000000
        || !Number.isInteger(hours) || hours < 1 || hours > 168) throw new AuctionError("Invalid listing. Check the asset, text, price and duration.");
    response.status(201).json(await createAuction(response.locals.userId, { kind, key, quantity, title: title.trim(), description: description.trim(), price, hours }));
});
router.post("/notifications/read", async (_request, response) => { await readAuctionNotifications(response.locals.userId); response.json({ ok: true }); });
router.post("/claims/:id", async (request, response) => { await claimAuction(request.params.id, response.locals.userId); response.json({ ok: true }); });
router.post("/:id/bid", async (request, response) => {
    const { amount } = request.body ?? {};
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000) throw new AuctionError("Bid must be a whole amount between $1 and $1,000,000,000.");
    await bidAuction(request.params.id, response.locals.userId, amount); response.json({ ok: true });
});
router.post("/:id/end", async (request, response) => { await endAuction(request.params.id, response.locals.userId); response.json({ ok: true }); });
router.post("/:id/promote", async (request, response) => {
    const { amount } = request.body ?? {};
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000) throw new AuctionError("Promotion payment must be a whole amount between $1 and $1,000,000,000.");
    await promoteAuction(request.params.id, response.locals.userId, amount); response.json({ ok: true });
});
router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof AuctionError) { response.status(error.status).json({ error: error.message }); return; }
    console.error("Auction request failed:", error);
    response.status(500).json({ error: "Auction request failed. Please try again." });
});
export default router;
