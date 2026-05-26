const SETTINGS_STORAGE_KEY = "storyStageSettings";

const defaultSettings = {
  textSpeed: 10,
  autoInterval: 0,
  skipMode: "all"
};

const textSpeed = document.querySelector("#textSpeed");
const textSpeedValue = document.querySelector("#textSpeedValue");
const autoInterval = document.querySelector("#autoInterval");
const autoIntervalValue = document.querySelector("#autoIntervalValue");
const skipModeButtons = [...document.querySelectorAll("[data-skip-mode]")];
const settingsCloseLink = document.querySelector("#settingsCloseLink");

function safeReturnUrl(url) {
  const raw = String(url || "").trim();
  if (!raw || raw.startsWith("http:") || raw.startsWith("https:") || raw.startsWith("//")) {
    return "../index.html";
  }
  return raw;
}

function syncNavigationLinks() {
  const params = new URLSearchParams(window.location.search || "");
  const returnUrl = safeReturnUrl(params.get("return"));
  if (settingsCloseLink) {
    settingsCloseLink.href = returnUrl;
  }
}

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
    const { startChapter, ...safeStored } = stored && typeof stored === "object" ? stored : {};
    return {
      ...defaultSettings,
      ...safeStored
    };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings(settings) {
  const clean = {
    textSpeed: settings.textSpeed,
    autoInterval: settings.autoInterval,
    skipMode: settings.skipMode
  };
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(clean));
}

function render(settings) {
  textSpeed.value = String(settings.textSpeed);
  textSpeedValue.textContent = String(settings.textSpeed);
  autoInterval.value = String(settings.autoInterval);
  autoIntervalValue.textContent = settings.autoInterval === 0 ? "關" : String(settings.autoInterval);
  skipModeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.skipMode === settings.skipMode);
  });
}

let settings = loadSettings();
saveSettings(settings);
syncNavigationLinks();
render(settings);

textSpeed.addEventListener("input", () => {
  settings = { ...settings, textSpeed: Number(textSpeed.value) };
  saveSettings(settings);
  render(settings);
});

autoInterval.addEventListener("input", () => {
  settings = { ...settings, autoInterval: Number(autoInterval.value) };
  saveSettings(settings);
  render(settings);
});

skipModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    settings = { ...settings, skipMode: button.dataset.skipMode };
    saveSettings(settings);
    render(settings);
  });
});
