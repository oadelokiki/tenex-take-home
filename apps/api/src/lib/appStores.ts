import type { OAuthPendingStore } from "./oauthPendingStore.js";
import type { SessionStore } from "./sessionStore.js";

export type AppStores = {
  sessions: SessionStore;
  oauthPending: OAuthPendingStore;
};
