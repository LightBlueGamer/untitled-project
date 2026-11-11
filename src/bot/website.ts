export function websiteUrl(path: string): string {
    const baseUrl = process.env.WEBSITE_URL || process.env.DISCORD_REDIRECT_URI || "http://localhost:3000";
    return new URL(path, baseUrl).toString();
}
