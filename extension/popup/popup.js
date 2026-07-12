document.addEventListener("DOMContentLoaded", () => {
  const enableToggle = document.getElementById("enableToggle");
  const modeSelect = document.getElementById("modeSelect");
  const pageCount = document.getElementById("pageCount");
  const totalCount = document.getElementById("totalCount");
  const thresholdSlider = document.getElementById("thresholdSlider");
  const thresholdValue = document.getElementById("thresholdValue");

  // Load settings
  chrome.storage.local.get(
    ["enabled", "mode", "threshold", "totalFiltered", "disabledDomains"],
    (data) => {
      enableToggle.checked = data.enabled !== false;
      modeSelect.value = data.mode || "blur";
      thresholdSlider.value = (data.threshold || 0.75) * 100;
      thresholdValue.textContent = thresholdSlider.value + "%";
      totalCount.textContent = data.totalFiltered || 0;
      // Check current domain
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          const url = new URL(tabs[0].url);
          const domain = url.hostname;
          const disabled = data.disabledDomains || [];
          enableToggle.checked = !disabled.includes(domain);
        }
      });
    }
  );

  // Get page count from badge
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.action.getBadgeText({ tabId: tabs[0].id }, (text) => {
        pageCount.textContent = text || "0";
      });
    }
  });

  // Toggle enable/disable for current domain
  enableToggle.addEventListener("change", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      const url = new URL(tabs[0].url);
      const domain = url.hostname;

      chrome.storage.local.get(["disabledDomains"], (data) => {
        let disabled = data.disabledDomains || [];
        if (enableToggle.checked) {
          disabled = disabled.filter((d) => d !== domain);
        } else {
          if (!disabled.includes(domain)) disabled.push(domain);
        }
        chrome.storage.local.set({ disabledDomains: disabled });
        chrome.tabs.reload(tabs[0].id);
      });
    });
  });

  // Mode change
  modeSelect.addEventListener("change", () => {
    chrome.storage.local.set({ mode: modeSelect.value });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.reload(tabs[0].id);
    });
  });
  // Threshold slider
  thresholdSlider.addEventListener("input", () => {
    thresholdValue.textContent = thresholdSlider.value + "%";
  });

  thresholdSlider.addEventListener("change", () => {
    chrome.storage.local.set({ threshold: thresholdSlider.value / 100 });
  });
});
