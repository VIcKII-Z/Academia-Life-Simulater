export const HOME_TUTORIAL_COMPLETED_KEY = "academia-life-home-tutorial-completed-v1";
export const STORY_TUTORIAL_COMPLETED_KEY = "academia-life-story-tutorial-completed-v1";
export const STORY_TUTORIAL_PENDING_KEY = "academia-life-story-tutorial-pending-v1";

export function readTutorialFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

export function writeTutorialFlag(key: string, value: boolean): void {
  try {
    if (value) window.localStorage.setItem(key, "true");
    else window.localStorage.removeItem(key);
  } catch {
    // Storage can be blocked in private/restricted contexts; the guide still works for this visit.
  }
}
