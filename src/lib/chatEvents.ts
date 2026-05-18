import { EventEmitter } from "events";

export const chatEvents = new EventEmitter();

export function emitRequestChatMessage(requestId: string, message: unknown) {
  chatEvents.emit("request-message", { requestId, message });
}
