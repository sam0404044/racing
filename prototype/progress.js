(function () {
  const STORAGE_KEY = "finalDriverProgress";
  const CURRENT_VERSION = 1;
  const DEFAULT_PROGRESS = Object.freeze({
    version: CURRENT_VERSION,
    clearedLevel1: false,
    clearedLevel2: false,
    clearedLevel3: false
  });

  function normalizeProgress(value) {
    if (!value || typeof value !== "object" || value.version !== CURRENT_VERSION) {
      return { ...DEFAULT_PROGRESS };
    }
    return {
      version: CURRENT_VERSION,
      clearedLevel1: value.clearedLevel1 === true,
      clearedLevel2: value.clearedLevel2 === true,
      clearedLevel3: value.clearedLevel3 === true
    };
  }

  function readProgress() {
    try {
      return normalizeProgress(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
    } catch {
      return { ...DEFAULT_PROGRESS };
    }
  }

  function writeProgress(progress) {
    const clean = normalizeProgress(progress);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch {
      /* ignore storage failures */
    }
    return clean;
  }

  function markLevelCleared(level) {
    const progress = readProgress();
    if (level >= 1) progress.clearedLevel1 = true;
    if (level >= 2) progress.clearedLevel2 = true;
    if (level >= 3) progress.clearedLevel3 = true;
    return writeProgress(progress);
  }

  function isLevelUnlocked(level) {
    const progress = readProgress();
    if (level <= 1) return true;
    if (level === 2) return progress.clearedLevel1 === true;
    if (level === 3) return progress.clearedLevel2 === true;
    return false;
  }

  function resetProgress() {
    return writeProgress(DEFAULT_PROGRESS);
  }

  window.FinalDriverProgress = {
    read: readProgress,
    markLevelCleared,
    isLevelUnlocked,
    reset: resetProgress
  };
})();
