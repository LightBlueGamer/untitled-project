import { randomBytes } from "node:crypto";
import {
    Router,
    type RequestHandler,
    type Response,
} from "express";
import { getCache } from "./database.js";

const SESSION_COOKIE = "ledger_session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const OAUTH_STATE_TTL_SECONDS = 10 * 60;

interface DiscordUser {
    id: string;
    username: string;
    global_name?: string | null;
}

interface LoginSession {
    id: string;
    username: string;
    displayName: string;
}

interface DiscordTokenResponse {
    access_token: string;
    token_type: string;
}

export const authRouter = Router();
export const authApiRouter = Router();

function oauthConfiguration(): {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
} | null {
    const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI } =
        process.env;

    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_REDIRECT_URI) {
        return null;
    }

    return {
        clientId: DISCORD_CLIENT_ID,
        clientSecret: DISCORD_CLIENT_SECRET,
        redirectUri: DISCORD_REDIRECT_URI,
    };
}

function sessionIdFromCookie(cookieHeader: string | undefined): string | null {
    const cookie = cookieHeader
        ?.split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${SESSION_COOKIE}=`));

    if (!cookie) {
        return null;
    }

    const value = cookie.slice(SESSION_COOKIE.length + 1);
    return /^[A-Za-z0-9_-]{40,}$/.test(value) ? value : null;
}

function setSessionCookie(response: Response, sessionId: string): void {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    response.setHeader(
        "Set-Cookie",
        `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`,
    );
}

function clearSessionCookie(response: Response): void {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    response.setHeader(
        "Set-Cookie",
        `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`,
    );
}

authRouter.get("/discord", async (_request, response) => {
    const configuration = oauthConfiguration();
    if (!configuration) {
        response.redirect("/?authError=not-configured");
        return;
    }

    const state = randomBytes(32).toString("hex");
    const stored = await getCache().set(`oauth-state:${state}`, "1", {
        EX: OAUTH_STATE_TTL_SECONDS,
        NX: true,
    });

    if (!stored) {
        throw new Error("Could not store Discord OAuth state");
    }

    const authorizationUrl = new URL("https://discord.com/oauth2/authorize");
    authorizationUrl.searchParams.set("client_id", configuration.clientId);
    authorizationUrl.searchParams.set("redirect_uri", configuration.redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", "identify");
    authorizationUrl.searchParams.set("state", state);

    response.redirect(authorizationUrl.toString());
});

export const discordOAuthCallback: RequestHandler = async (
    request,
    response,
    next,
) => {
    const configuration = oauthConfiguration();
    const { code, state, error } = request.query;

    if (code === undefined && state === undefined && error === undefined) {
        next();
        return;
    }

    if (error !== undefined) {
        response.redirect("/?authError=discord");
        return;
    }

    if (
        !configuration ||
        typeof code !== "string" ||
        typeof state !== "string" ||
        !/^[a-f0-9]{64}$/.test(state)
    ) {
        response.redirect(
            `/?authError=${configuration ? "discord" : "not-configured"}`,
        );
        return;
    }

    const cache = getCache();
    const stateKey = `oauth-state:${state}`;
    const storedState = await cache.getDel(stateKey);
    if (storedState !== "1") {
        response.redirect("/?authError=discord");
        return;
    }

    try {
        const tokenResponse = await fetch(
            "https://discord.com/api/oauth2/token",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    client_id: configuration.clientId,
                    client_secret: configuration.clientSecret,
                    grant_type: "authorization_code",
                    code,
                    redirect_uri: configuration.redirectUri,
                }),
            },
        );

        if (!tokenResponse.ok) {
            throw new Error(
                `Discord token exchange failed (${tokenResponse.status})`,
            );
        }

        const token =
            (await tokenResponse.json()) as DiscordTokenResponse;
        if (!token.access_token || !token.token_type) {
            throw new Error("Discord returned an incomplete access token");
        }
        const userResponse = await fetch(
            "https://discord.com/api/users/@me",
            {
                headers: {
                    Authorization: `${token.token_type} ${token.access_token}`,
                },
            },
        );

        if (!userResponse.ok) {
            throw new Error(
                `Discord profile request failed (${userResponse.status})`,
            );
        }

        const user = (await userResponse.json()) as DiscordUser;
        if (!user.id || !user.username) {
            throw new Error("Discord returned an incomplete user profile");
        }

        const session: LoginSession = {
            id: user.id,
            username: user.username,
            displayName: user.global_name || user.username,
        };
        const sessionId = randomBytes(32).toString("base64url");

        await cache.set(
            `login-session:${sessionId}`,
            JSON.stringify(session),
            { EX: SESSION_TTL_SECONDS },
        );

        setSessionCookie(response, sessionId);
        response.redirect("/");
    } catch (error) {
        console.error("Discord OAuth callback failed:", error);
        response.redirect("/?authError=discord");
    }
};

authRouter.post("/logout", async (request, response) => {
    const sessionId = sessionIdFromCookie(request.headers.cookie);
    if (sessionId) {
        await getCache().del(`login-session:${sessionId}`);
    }

    clearSessionCookie(response);
    response.redirect(303, "/");
});

export async function loadSession(
    cookieHeader: string | undefined,
): Promise<LoginSession | null> {
    const sessionId = sessionIdFromCookie(cookieHeader);
    const sessionValue = sessionId
        ? await getCache().get(`login-session:${sessionId}`)
        : null;

    if (!sessionValue) {
        return null;
    }

    try {
        return JSON.parse(sessionValue) as LoginSession;
    } catch (error) {
        console.error("Could not read the Discord login session:", error);
        await getCache().del(`login-session:${sessionId}`);
        return null;
    }
}

export const requireLogin: RequestHandler = async (request, response, next) => {
    try {
        const user = await loadSession(request.headers.cookie);
        if (!user) {
            response.redirect("/");
            return;
        }
        next();
    } catch (error) {
        next(error);
    }
};

authApiRouter.get("/me", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");

    const user = await loadSession(request.headers.cookie);

    response.json({
        enabled: oauthConfiguration() !== null,
        user,
    });
});
