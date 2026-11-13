import { EventEmitter } from "node:events";

export const profileNameEvents = new EventEmitter<{
    changed: [userId: string, name: string];
}>();
