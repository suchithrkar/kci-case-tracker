// userProfile.js
import {
  watchAuth,
  updateTheme
} from "./auth.js";

import {
  db, doc, getDoc
} from "./firebase.js";

// ====================================
// LOAD USER PROFILE + APPLY THEME
// ====================================
export function initUserProfile(onUserLoaded) {
  watchAuth(async (user) => {
    if (!user) {
      onUserLoaded(null);
      return;
    }

    document.documentElement.dataset.theme = user.theme || "dark";
    onUserLoaded(user);
  });
}

// ====================================
// CHANGE THEME
// ====================================
export async function toggleTheme(user) {
  const nextTheme = user.theme === "dark" ? "light" : "dark";
  await updateTheme(user.uid, nextTheme);
  document.documentElement.dataset.theme = nextTheme;
  user.theme = nextTheme;
}

// ====================================
// GET TEAM THAT TRACKER SHOULD DISPLAY
// ====================================
export function getCurrentTrackerTeam(user) {
  if (user.role === "primary") {
    return user.activeTeam || user.teamId;
  }
  return user.teamId;
}

// ====================================
// PERMISSION HELPERS
// ====================================
export function isPrimary(user) { return user.role === "primary"; }
export function isSecondary(user) { return user.role === "secondary"; }
export function isGeneral(user) { return user.role === "general"; }