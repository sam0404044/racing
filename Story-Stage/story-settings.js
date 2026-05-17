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

function loadSettings() {
  try {
    return {
      ...defaultSettings,
      ...JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}")
    };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
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
