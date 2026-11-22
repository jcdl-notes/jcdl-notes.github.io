"use strict";
(() => {
  const prefix = "window.XINHUO_LIBRARY = ";
  const kinds = ["完整笔记", "专题笔记", "习题整理", "其他复习资料"];
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
  function publicLibrary(data) {
    const courses = data.courses.filter(course => !course.archived);
    if (courses.length === data.courses.length) return data;
    const visible = new Set(courses.map(course => course.id));
    return {...data,courses,resources:data.resources.filter(note => visible.has(note.course))};
  }
  function parse(source) {
    const normalized = source.trim();
    if (!normalized.startsWith(prefix) || !normalized.endsWith(";")) throw new Error("无法读取资料目录。");
    return JSON.parse(normalized.slice(prefix.length, -1));
  }
  function serialize(data) { return prefix + JSON.stringify(data, null, 2) + ";\n"; }
  globalThis.XinhuoCatalog = {kinds, fileURL, safeFilename, validate, publicLibrary, parse, serialize};
})();
