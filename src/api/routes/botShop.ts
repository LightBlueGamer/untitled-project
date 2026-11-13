import { json, Router, type ErrorRequestHandler } from "express";
import { loadSession } from "../../auth.js";
import { BotShopError, botShopAlert, buyBotShopItem, getBotShop, getBotShopHistory, readBotShopAlert } from "../../botShop.js";

const router = Router();
router.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
router.get("/", async (_request, response) => { response.json(await getBotShop()); });
router.get("/history", async (request, response) => {
    const page = request.query.page ?? "0";
    if (typeof page !== "string" || !/^(0|[1-9]\d{0,6})$/.test(page)) throw new BotShopError("Invalid history page.");
    response.json(await getBotShopHistory(Number(page)));
});
router.get("/alert", async (request, response) => {
    const user = await loadSession(request.headers.cookie);
    if (!user) { response.status(401).json({ error: "Login required." }); return; }
    response.json(await botShopAlert(user.id));
});
router.post("/alert/read", json({ limit: "4kb" }), async (request, response) => {
    const user = await loadSession(request.headers.cookie);
    if (!user) { response.status(401).json({ error: "Login required." }); return; }
    if (!request.is("application/json") || request.get("X-Requested-With") !== "XMLHttpRequest") {
        response.status(400).json({ error: "JSON and X-Requested-With are required." }); return;
    }
    const { generation } = request.body ?? {};
    if (typeof generation !== "string" || !/^[1-9]\d{0,18}$/.test(generation)) throw new BotShopError("Invalid restock notification.");
    await readBotShopAlert(user.id, generation);
    response.json({ ok: true });
});
router.post("/buy", json({ limit: "4kb" }), async (request, response) => {
    const user = await loadSession(request.headers.cookie);
    if (!user) { response.status(401).json({ error: "Login required." }); return; }
    if (!request.is("application/json") || request.get("X-Requested-With") !== "XMLHttpRequest") {
        response.status(400).json({ error: "JSON and X-Requested-With are required." }); return;
    }
    const { key, quantity, generation } = request.body ?? {};
    if (typeof key !== "string" || key.length < 1 || key.length > 100 ||
        !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2_147_483_647 ||
        typeof generation !== "string" || !/^[1-9]\d{0,18}$/.test(generation)) {
        throw new BotShopError("Invalid purchase.");
    }
    await buyBotShopItem(user.id, key, quantity, generation);
    response.json({ ok: true });
});
const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof BotShopError) { response.status(error.status).json({ error: error.message }); return; }
    console.error("Bot shop request failed:", error);
    response.status(500).json({ error: "Bot shop request failed. Please try again." });
};
router.use(handleError);
export default router;
