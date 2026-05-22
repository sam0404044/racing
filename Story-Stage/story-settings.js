const SETTINGS_STORAGE_KEY = "storyStageSettings";
const STORY_SHEET_ID = "1rIkC3ev81wGDyU9ItyMH0nO9jI22cvdofbNtk_QpSu0";
const MAX_PLAY_TEST_CHAPTERS = 30;

const defaultSettings = {
  textSpeed: 10,
  autoInterval: 0,
  skipMode: "all",
  startChapter: "play_test_1"
};

const textSpeed = document.querySelector("#textSpeed");
const textSpeedValue = document.querySelector("#textSpeedValue");
const autoInterval = document.querySelector("#autoInterval");
const autoIntervalValue = document.querySelector("#autoIntervalValue");
const skipModeButtons = [...document.querySelectorAll("[data-skip-mode]")];
const chapterPicker = document.querySelector("#chapterPicker");
const chapterLoading = document.querySelector("#chapterLoading");

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

function storySheetCsvUrl(sheetName) {
  const params = new URLSearchParams({
    tqx: "out:csv",
    sheet: sheetName
  });
  return `https://docs.google.com/spreadsheets/d/${STORY_SHEET_ID}/gviz/tq?${params.toString()}`;
}

async function fetchChapterCsv(sheetName) {
  const response = await fetch(`${storySheetCsvUrl(sheetName)}&cacheBust=${Date.now()}`);
  if (!response.ok) {
    const error = new Error(`Story sheet ${sheetName} request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return (await response.text()).replace(/^\uFEFF/, "");
}

function parseCsvFirstRow(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      if (rows.length >= 2) {
        return rows;
      }
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function chapterTitleFromCsv(csv) {
  const [, firstDataRow = []] = parseCsvFirstRow(csv);
  return (firstDataRow[3] || "").trim();
}

function render(settings) {
  textSpeed.value = String(settings.textSpeed);
  textSpeedValue.textContent = String(settings.textSpeed);
  autoInterval.value = String(settings.autoInterval);
  autoIntervalValue.textContent = settings.autoInterval === 0 ? "關" : String(settings.autoInterval);
  skipModeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.skipMode === settings.skipMode);
  });
  chapterPicker?.querySelectorAll("[data-start-chapter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.startChapter === settings.startChapter);
  });
}

function renderChapterButtons(chapters) {
  if (!chapterPicker) {
    return;
  }
  chapterPicker.replaceChildren();
  chapters.forEach((chapter) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.startChapter = chapter.id;
    const label = document.createElement("span");
    label.textContent = `TEST ${chapter.index}`;
    const title = document.createElement("small");
    title.textContent = chapter.title || chapter.id;
    button.append(label, title);
    button.addEventListener("click", () => {
      settings = { ...settings, startChapter: chapter.id };
      saveSettings(settings);
      render(settings);
    });
    chapterPicker.appendChild(button);
  });
  render(settings);
}

async function loadChapterButtons() {
  if (!chapterPicker) {
    return;
  }
  try {
    const chapters = [];
    let firstChapterCsv = "";
    for (let index = 1; index <= MAX_PLAY_TEST_CHAPTERS; index += 1) {
      const id = `play_test_${index}`;
      let csv = "";
      try {
        csv = await fetchChapterCsv(id);
      } catch (error) {
        if (index > 1 && (error.status === 400 || error.status === 404)) {
          break;
        }
        throw error;
      }
      if (index === 1) {
        firstChapterCsv = csv;
      } else if (firstChapterCsv && csv === firstChapterCsv) {
        break;
      }
      chapters.push({
        id,
        index,
        title: chapterTitleFromCsv(csv)
      });
    }
    renderChapterButtons(chapters);
  } catch (error) {
    console.error("Chapter list load failed:", error);
    if (chapterLoading) {
      chapterLoading.textContent = "章節載入失敗";
    }
  }
}

let settings = loadSettings();
render(settings);
loadChapterButtons();

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
