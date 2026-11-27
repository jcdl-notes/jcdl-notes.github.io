"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const catalog = window.XinhuoCatalog;
  const notice = $("usage-notice");
  const announcements = $("announcement-dialog");
  if (typeof notice?.showModal !== "function" || !announcements || !catalog) return;

  const noticeKey = "xinhuo-usage-notice-v2";
  const historyKey = "xinhuo-announcement-history";
  function read(storage, key) {
    try { return window[storage].getItem(key); }
    catch { return null; }
  }
  function save(storage, key, value) {
    try { window[storage].setItem(key, value); }
    catch { /* The current page still remembers the reading state. */ }
  }
  function readHistory() {
    try {
      const entries = JSON.parse(read("localStorage", historyKey));
      return new Set(Array.isArray(entries) ? entries : []);
    } catch { return new Set(); }
  }

  const trigger = $("announcement-open");
  const noticeTab = $("announcement-notice-tab");
  const timelineTab = $("announcement-timeline-tab");
  const noticePanel = $("announcement-notice-panel");
  const timelinePanel = $("announcement-timeline-panel");
  const entries = $("announcement-entries");
  let activeNotice;
  let noticeRead = false;
  let timeline = [];
  const readEntries = readHistory();

  function updateBadge() {
    const hasNewEntries = timeline.some(entry => !readEntries.has(catalog.announcementRevision(entry)));
    $("announcement-notice-dot").hidden = noticeRead;
    $("announcement-timeline-dot").hidden = !hasNewEntries;
    $("announcement-dot").hidden = noticeRead && !hasNewEntries;
    trigger.setAttribute("aria-label", noticeRead && !hasNewEntries ? "公告" : "公告，有未读");
  }
  function markNoticeRead() {
    noticeRead = true;
    save("localStorage", noticeKey+"-read", activeNotice.revision);
  }
  function markTimelineRead() {
    for (const entry of timeline) readEntries.add(catalog.announcementRevision(entry));
    save("localStorage", historyKey, JSON.stringify([...readEntries]));
  }
  function selectPanel(showTimeline) {
    noticeTab.setAttribute("aria-pressed", String(!showTimeline));
    timelineTab.setAttribute("aria-pressed", String(showTimeline));
    noticePanel.hidden = showTimeline;
    timelinePanel.hidden = !showTimeline;
    if (showTimeline) markTimelineRead();
    else markNoticeRead();
    updateBadge();
  }
  function element(tag, content) {
    const node = document.createElement(tag);
    node.textContent = content;
    return node;
  }
  function renderNotice(data) {
    activeNotice = catalog.noticeSettings(data);
    noticeRead = read("localStorage", noticeKey+"-read") === activeNotice.revision;
    const paragraphs = activeNotice.text.split(/\n\s*\n/);
    $("notice-title").textContent = activeNotice.title;
    $("announcement-notice-heading").textContent = activeNotice.title;
    for (const id of ["notice-copy","announcement-notice-copy"]) {
      $(id).replaceChildren(...paragraphs.map(text => element("p",text)));
    }
  }
  function renderTimeline(data) {
    timeline = Array.isArray(data.announcements) ? [...data.announcements].sort((a,b)=>b.month.localeCompare(a.month)) : [];
    entries.replaceChildren();
    $("announcement-placeholder").hidden = timeline.length > 0;
    for (const entry of timeline) {
      const item = document.createElement("li");
      item.classList.toggle("rename", Boolean(entry.previousTitle));
      const {title, body} = catalog.announcementText(data,entry);
      const [year, month] = entry.month.split("-");
      const time = element("time",year+"年"+Number(month)+"月");
      time.dateTime = entry.month;
      item.append(element("h3",title));
      if (body) item.append(element("p",body));
      item.append(time);
      entries.append(item);
    }
    if (announcements.open && !timelinePanel.hidden) markTimelineRead();
    updateBadge();
  }

  document.addEventListener("xinhuo:announcements", event => {
    renderNotice(event.detail);
    renderTimeline(event.detail);
    trigger.hidden = false;
    if (read("localStorage", noticeKey) !== "1" && read("sessionStorage", noticeKey) !== "1") notice.showModal();
  }, {once:true});
  trigger.addEventListener("click", () => {
    selectPanel(false);
    announcements.showModal();
  });
  noticeTab.addEventListener("click", () => selectPanel(false));
  timelineTab.addEventListener("click", () => selectPanel(true));
  notice.querySelector("form").addEventListener("submit", () => {
    if ($("notice-dismiss-permanently").checked) save("localStorage", noticeKey, "1");
  });
  notice.addEventListener("close", () => {
    save("sessionStorage", noticeKey, "1");
    markNoticeRead();
    updateBadge();
  });
})();
