"use strict";
(() => {
  const prefix = "window.XINHUO_LIBRARY = ";
  const kinds = ["完整笔记", "专题笔记", "习题整理", "其他复习资料"];
  const defaultNotice = {
    title: "资料使用提示",
    text: [
      "本站资料由同学整理分享，仅供学习参考。请结合教材、课件和任课老师公布的考试范围，自行核对并判断。",
      "带红星的资料建议先预览，再按自己的复习需要选择，确认内容合适后再下载。",
      "祝同学们复习顺利，取得理想成绩！"
    ].join("\n\n"),
    revision: "1"
  };
  const validMonth = month => typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const safeFilename = name => typeof name === "string"
    && name === name.trim() && name.length <= 150
    && /^[^<>:"/\\|?*\u0000-\u001f]+\.pdf$/iu.test(name)
    && !name.startsWith(".")
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
  function fileURL(value) {
    if (typeof value !== "string") return null;
    if (/^https:\/\/github\.com\/[a-z0-9-]+\/[a-z0-9_.-]+\/releases\/download\/course-pdfs\/[a-z0-9-]+\.pdf$/i.test(value)) {
      return {href: value, local: false};
    }
    const [root,edition,course,bucket,name,...extra] = value.split("/");
    if (root !== "files" || extra.length || ![edition,course].every(id => id && /^[a-z0-9-]+$/.test(id))
        || !["general","featured"].includes(bucket) || !safeFilename(name)) return null;
    return {href: "./" + value.split("/").map(encodeURIComponent).join("/"), local: true};
  }
  function validate(data) {
    const errors = [];
    if (!data || !["terms","courses","editions","resources"].every(key => Array.isArray(data[key]))) return ["目录缺少学期、课程、届次或资料数组。"];
    const idValid = id => typeof id === "string" && /^[a-z0-9][a-z0-9-]*$/.test(id);
    for (const key of ["terms","courses","editions","resources"]) {
      const seen = new Set();
      data[key].forEach((item, i) => {
        if (!item || !idValid(item.id) || seen.has(item.id)) errors.push(key + " 第 " + (i+1) + " 项的编号无效或重复。");
        else seen.add(item.id);
      });
    }
    const termIds = new Set(data.terms.map(item => item?.id));
    const editions = new Set(data.editions.map(item => item?.id));
    const courses = new Set(data.courses.map(item => item?.id));
    const nonempty = value => typeof value === "string" && Boolean(value.trim());
    data.terms.forEach(item => {if (!nonempty(item?.label)) errors.push("学期缺少名称。");});
    data.courses.forEach(item => {
      if (!item || !termIds.has(item.term) || !nonempty(item.name) || !nonempty(item.mark)) errors.push("课程信息不完整：" + (item?.id || "未知"));
      else if (item.archived !== undefined && typeof item.archived !== "boolean") errors.push("课程的下架状态无效：" + item.name);
    });
    data.editions.forEach(item => {
      if (!nonempty(item?.label)) errors.push("届次缺少名称。");
    });
    data.resources.forEach(resource => {
      const label = resource?.title || resource?.id || "未命名资料";
      if (!resource || !nonempty(resource.title) || !courses.has(resource.course) || !editions.has(resource.edition)
          || !kinds.includes(resource.kind) || typeof resource.featured !== "boolean"
          || typeof resource.credit !== "string" || typeof resource.summary !== "string"
          || !Array.isArray(resource.topics) || !resource.topics.every(nonempty)) {
        errors.push(label + " 的标题、课程、届次或资料字段有误。");
      }
      const link = fileURL(resource?.file);
      if (!link || (!link.local && !(Number.isSafeInteger(resource.bytes) && resource.bytes > 0))) {
        errors.push(label + " 的 PDF 地址或大小无效。");
      }
      const date = new Date(resource?.updated || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(resource?.updated || "") || Number.isNaN(date.getTime()) || date.toISOString().slice(0,10) !== resource.updated) {
        errors.push(label + " 的更新日期无效。");
      }
    });
    return errors;
  }
  function noticeSettings(data) {
    const notice = data.notice;
    return notice && typeof notice.title === "string" && notice.title.trim() &&
      typeof notice.text === "string" && notice.text.trim() && typeof notice.revision === "string"
      ? notice : defaultNotice;
  }
  function announcementText(data, entry) {
    if (typeof entry.heading === "string") return {title:entry.heading, body:entry.body || ""};
    const note = data.resources.find(item => item.id === entry.note);
    const course = data.courses.find(item => item.id === note?.course);
    const title = (entry.previousTitle ? "资料更名" : "新增资料") + (course ? " · " + course.name : "");
    const body = entry.previousTitle ? "「" + entry.previousTitle + "」改为「" + entry.title + "」" : entry.title;
    return {title,body};
  }
  const announcementRevision = entry => entry.revision || entry.id;
  function publicLibrary(data) {
    const courses = data.courses.filter(course => !course.archived);
    const visible = new Set(courses.map(course => course.id));
    const resources = data.resources.filter(note => visible.has(note.course));
    if (!Array.isArray(data.announcements)) return {...data,courses,resources};
    const visibleNotes = new Set(resources.map(note => note.id));
    const announcements = data.announcements.filter(entry => {
      if (!entry || typeof entry.id !== "string" || !validMonth(entry.month)) return false;
      if (entry.note !== undefined && !visibleNotes.has(entry.note)) return false;
      if (typeof entry.heading === "string") return typeof entry.body === "string";
      return typeof entry.title === "string" && (entry.previousTitle === undefined || typeof entry.previousTitle === "string");
    });
    return {...data,courses,resources,announcements};
  }
  function parse(source) {
    const normalized = source.trim();
    if (!normalized.startsWith(prefix) || !normalized.endsWith(";")) throw new Error("无法读取资料目录。");
    return JSON.parse(normalized.slice(prefix.length, -1));
  }
  function serialize(data) { return prefix + JSON.stringify(data, null, 2) + ";\n"; }
  globalThis.XinhuoCatalog = {kinds, fileURL, safeFilename, validate, publicLibrary, noticeSettings,
    announcementText, announcementRevision, validMonth, parse, serialize};
})();
