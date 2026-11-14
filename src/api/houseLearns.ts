import { Router } from "express";
import { HouseError, houseStatus, moveHouseGame, startHouseGame } from "../houseLearnsStorage.js";

const router = Router();

router.use((request, response, next) => {
    if (request.method !== "GET" && (!request.is("application/json") || request.get("X-Requested-With") !== "XMLHttpRequest")) {
        response.status(400).json({ error: "JSON and X-Requested-With are required." });
        return;
    }
    next();
});

router.get("/", async (_request, response) => {
    response.json(await houseStatus(response.locals.userId));
});

router.post("/start", async (request, response) => {
    try {
        response.json(await startHouseGame(response.locals.userId, request.body?.wager));
    } catch (error) {
        if (!(error instanceof HouseError)) throw error;
        response.status(error.status).json({ error: error.message });
    }
});

router.post("/:id/action", async (request, response) => {
    try {
        response.json(await moveHouseGame(response.locals.userId, String(request.params.id), request.body?.action, request.body?.amount, request.body?.revision));
    } catch (error) {
        if (!(error instanceof HouseError)) throw error;
        response.status(error.status).json({ error: error.message });
    }
});

export default router;
