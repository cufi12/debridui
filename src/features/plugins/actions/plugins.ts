"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db, upsertUserSettings } from "@/lib/db/drizzle";
import { userSettings } from "@/lib/db/schema";

const capabilitySchema = z.enum(["subtitles", "player", "metadata", "iptv"]);
const pluginManifestSchema = z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/),
    name: z.string().trim().min(1).max(80),
    version: z.string().trim().min(1).max(32),
    description: z.string().trim().max(240).default(""),
    author: z.string().trim().max(80).default(""),
    homepage: z.string().url().refine((value) => value.startsWith("https://"), "Homepage must use HTTPS").optional(),
    capabilities: z.array(capabilitySchema).max(4).default([]),
}).strict();

const installedPluginSchema = pluginManifestSchema.extend({
    enabled: z.boolean(),
    installedAt: z.string(),
});

type InstalledPlugin = z.infer<typeof installedPluginSchema>;
const pluginManagerSchema = z.object({ installed: z.array(installedPluginSchema).max(30) }).default({ installed: [] });

async function getCurrentUserId() {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) redirect("/login");
    return session.user.id;
}

async function readInstalled(userId: string): Promise<InstalledPlugin[]> {
    const [row] = await db.select({ settings: userSettings.settings }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
    const settings = row?.settings && typeof row.settings === "object" ? row.settings as Record<string, unknown> : {};
    const parsed = pluginManagerSchema.safeParse(settings.pluginManager);
    return parsed.success ? parsed.data.installed : [];
}

async function writeInstalled(userId: string, installed: InstalledPlugin[]) {
    await upsertUserSettings(db, userId, { pluginManager: { installed } });
}

export async function getUserPlugins() {
    const userId = await getCurrentUserId();
    return readInstalled(userId);
}

/**
 * Plugins are declarative manifests only. Strict validation deliberately rejects
 * executable code, remote scripts, and unknown fields.
 */
export async function installPlugin(manifestText: string) {
    const userId = await getCurrentUserId();
    const text = z.string().min(2).max(16_384).parse(manifestText);
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        throw new Error("Die Plugin-Datei enthält kein gültiges JSON.");
    }
    const manifest = pluginManifestSchema.parse(raw);
    const installed = await readInstalled(userId);
    const existing = installed.find((plugin) => plugin.id === manifest.id);
    if (!existing && installed.length >= 30) throw new Error("Maximal 30 Plugins können installiert werden.");
    const next: InstalledPlugin = {
        ...manifest,
        enabled: existing?.enabled ?? true,
        installedAt: existing?.installedAt ?? new Date().toISOString(),
    };
    await writeInstalled(userId, [...installed.filter((plugin) => plugin.id !== manifest.id), next]);
    return next;
}

export async function setPluginEnabled(pluginId: string, enabled: boolean) {
    const userId = await getCurrentUserId();
    const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/).parse(pluginId);
    const isEnabled = z.boolean().parse(enabled);
    const installed = await readInstalled(userId);
    if (!installed.some((plugin) => plugin.id === id)) throw new Error("Plugin nicht gefunden.");
    await writeInstalled(userId, installed.map((plugin) => plugin.id === id ? { ...plugin, enabled: isEnabled } : plugin));
    return { success: true };
}

export async function removePlugin(pluginId: string) {
    const userId = await getCurrentUserId();
    const id = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/).parse(pluginId);
    const installed = await readInstalled(userId);
    await writeInstalled(userId, installed.filter((plugin) => plugin.id !== id));
    return { success: true };
}
