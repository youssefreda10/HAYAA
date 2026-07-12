document.addEventListener("DOMContentLoaded", () => {
  const enableToggle = document.getElementById("enableToggle");
  const modeSelect = document.getElementById("modeSelect");
  const pageCount = document.getElementById("pageCount");
  const totalCount = document.getElementById("totalCount");
  const thresholdSlider = document.getElementById("thresholdSlider");
  const thresholdValue = document.getElementById("thresholdValue");

  // Load settings
  chrome.storage.local.get(
    ["enabled", "mode", "threshold", "totalFiltered", "disabledDomains", "enabledDomains", "domainMode"],
    (data) => {
      modeSelect.value = data.mode || "blur";
      thresholdSlider.value = (data.threshold || 0.75) * 100;
      thresholdValue.textContent = thresholdSlider.value + "%";
      totalCount.textContent = data.totalFiltered || 0;

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          const url = new URL(tabs[0].url);
          const domain = url.hostname;
          const domainMode = data.domainMode || "normal";

          if (domainMode === "minimal") {
            const enabled = data.enabledDomains || [];
            enableToggle.checked = enabled.includes(domain);
          } else {
            const disabled = data.disabledDomains || [];
            enableToggle.checked = !disabled.includes(domain);
          }
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

      // Get filtered texts summary from content script
      chrome.tabs.sendMessage(tabs[0].id, { type: "getFilteredTexts" }, (items) => {
        if (chrome.runtime.lastError || !items || items.length === 0) return;
        var section = document.getElementById("summarySection");
        var list = document.getElementById("summaryList");
        section.style.display = "block";

        items.forEach((item) => {
          var li = document.createElement("li");
          li.className = "summary-item";
          var sourceLabel = item.source === "dictionary" ? "قاموس" : "AI";
          var sourceClass = item.source === "dictionary" ? "dict" : "api";
          li.innerHTML = '<span class="summary-text">' + escapeHtml(item.text) + '</span>' +
            '<span class="source-badge ' + sourceClass + '">' + sourceLabel + '</span>';
          list.appendChild(li);
        });
      });
    }
  });

  // Toggle enable/disable for current domain
  enableToggle.addEventListener("change", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      const url = new URL(tabs[0].url);
      const domain = url.hostname;

      chrome.storage.local.get(["disabledDomains", "enabledDomains", "domainMode"], (data) => {
        const domainMode = data.domainMode || "normal";

        if (domainMode === "minimal") {
          let enabled = data.enabledDomains || [];
          if (enableToggle.checked) {
            if (!enabled.includes(domain)) enabled.push(domain);
          } else {
            enabled = enabled.filter((d) => d !== domain);
          }
          chrome.storage.local.set({ enabledDomains: enabled });
        } else {
          let disabled = data.disabledDomains || [];
          if (enableToggle.checked) {
            disabled = disabled.filter((d) => d !== domain);
          } else {
            if (!disabled.includes(domain)) disabled.push(domain);
          }
          chrome.storage.local.set({ disabledDomains: disabled });
        }

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

  // Open options page
  document.getElementById("openOptions").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
});
