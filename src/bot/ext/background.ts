// ============================================================
// Background service worker (Manifest V3): persistence and relay only.
//
// It holds NO long-lived state: every message opens IndexedDB, writes, and
// returns, so being stopped and restarted by Chrome at any time is harmless.
// Decisions never depend on it (they are computed in the content script).
// Messages are accepted only from this extension's own pages and from its
// content script on a PokerNow tab, and are structurally validated.
// ============================================================

import { parseBotMessage, DEFAULT_SETTINGS, sanitizeSettings } from './records';
import { BotStorage } from './storage';

const storage = new BotStorage();
const POKERNOW = /^https:\/\/(www\.)?pokernow\.(club|com)\//;

chrome.runtime.onInstalled.addListener(async () => {
  const cur = (await chrome.storage.local.get('settings')).settings;
  // Never arm automatically: a fresh install or an upgrade starts in recommend mode unless already configured.
  await chrome.storage.local.set({ settings: cur ? sanitizeSettings(cur) : DEFAULT_SETTINGS });
});

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const fromContent = !!sender.tab;
  if (fromContent && !POKERNOW.test(sender.tab?.url ?? sender.url ?? '')) return false;
  const msg = parseBotMessage(raw);
  if (!msg) return false;
  (async () => {
    switch (msg.type) {
      case 'bot/live':
        await chrome.storage.session.set({ live: msg.live });
        return { ok: true };
      case 'bot/hand':
        return { ok: true, stored: await storage.saveHand(msg.hand, msg.profiles) };
      case 'bot/decision':
        await storage.saveDecision(msg.record);
        return { ok: true };
      case 'bot/diag':
        await storage.saveDiagnostic(msg.record);
        return { ok: true };
      case 'bot/frames':
        await storage.saveFrames(msg.frames);
        return { ok: true };
      case 'bot/loadProfiles':
        return { ok: true, profiles: await storage.loadProfiles(msg.ids) };
    }
  })().then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});
