document.addEventListener("DOMContentLoaded", function () {
  // Tabs
  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
      document.querySelectorAll(".tab-content").forEach(function (c) { c.classList.remove("active"); });
      tab.classList.add("active");
      document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
    });
  });

  var emptyHTML = '<div class="empty-state"><svg viewBox="0 0 80 80" width="60" height="60" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" transform="translate(25,20) scale(1.8)"/><path d="M13.73 21a2 2 0 0 1-3.46 0" transform="translate(25,20) scale(1.8)"/></svg><p>لا توجد أحداث بعد</p></div>';

  function formatTime(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleDateString("ar-EG") + " " + d.toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
    } catch (e) { return iso; }
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  // Load stats
  chrome.storage.local.get(["totalFiltered", "reports", "pagesScanned"], function (data) {
    document.getElementById("totalCount").textContent = (data.totalFiltered || 0).toLocaleString("ar-EG");
    document.getElementById("pagesCount").textContent = (data.pagesScanned || 0).toLocaleString("ar-EG");

    var reports = data.reports || [];
    document.getElementById("reportCount").textContent = reports.length.toLocaleString("ar-EG");

    var reportList = document.getElementById("reportList");
    if (reports.length === 0) {
      reportList.innerHTML = emptyHTML.replace("لا توجد أحداث بعد", "لا توجد بلاغات بعد");
    } else {
      reports.slice().reverse().forEach(function (r) {
        var li = document.createElement("li");
        li.className = "event-item";
        li.innerHTML =
          '<div class="event-top"><span class="event-badge badge-report">بلاغ خطأ</span><span class="event-time">' + formatTime(r.timestamp) + '</span></div>' +
          '<div class="event-text">' + escapeHtml(r.text) + '</div>' +
          (r.domain ? '<div class="event-domain">' + escapeHtml(r.domain) + '</div>' : '');
        reportList.appendChild(li);
      });

      var clearBtn = document.createElement("button");
      clearBtn.className = "clear-btn";
      clearBtn.textContent = "مسح كل البلاغات";
      clearBtn.addEventListener("click", function () {
        if (!confirm("مسح كل البلاغات؟")) return;
        chrome.storage.local.set({ reports: [] }, function () {
          reportList.innerHTML = emptyHTML.replace("لا توجد أحداث بعد", "لا توجد بلاغات بعد");
          document.getElementById("reportCount").textContent = "٠";
        });
      });
      reportList.parentNode.appendChild(clearBtn);
    }
  });

  // Activity
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var activityList = document.getElementById("activityList");
    if (!tabs[0]) { activityList.innerHTML = emptyHTML; return; }

    chrome.tabs.sendMessage(tabs[0].id, { type: "getFilteredTexts" }, function (items) {
      if (chrome.runtime.lastError || !items || items.length === 0) {
        activityList.innerHTML = emptyHTML;
        return;
      }

      items.slice().reverse().forEach(function (item) {
        var li = document.createElement("li");
        li.className = "event-item";
        var badgeClass = item.source === "dictionary" ? "badge-dict" : "badge-filter";
        var badgeText = item.source === "dictionary" ? "قاموس" : "AI";
        li.innerHTML =
          '<div class="event-top"><span class="event-badge ' + badgeClass + '">' + badgeText + '</span></div>' +
          '<div class="event-text">' + escapeHtml(item.text) + '</div>';
        activityList.appendChild(li);
      });
    });
  });
});
