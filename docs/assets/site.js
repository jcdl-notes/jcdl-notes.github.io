"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const data = window.XINHUO_LIBRARY;
  const catalog = window.XinhuoCatalog;
  const errors = catalog.validate(data);
  function make(tag, content, className) {
    const node = document.createElement(tag);
    if (content) node.textContent = content;
    if (className) node.className = className;
    return node;
  }
  if (errors.length) {
    $("course-grid").append(make("p","资料索引暂时无法读取。请稍后刷新页面。","empty"));
    console.error(errors);
    return;
  }
  const terms = new Map(data.terms.map(term => [term.id, term.label]));
  const editions = new Map(data.editions.map(edition => [edition.id, edition.label]));
  const grouped = new Map(data.courses.map(course => [course.id, []]));
  for (const resource of data.resources) grouped.get(resource.course).push(resource);
  grouped.forEach(list => list.sort((a,b) => Number(b.featured) - Number(a.featured) || b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title,"zh-CN")));

  const query = new URLSearchParams(location.search);
  let term = terms.has(query.get("term")) ? query.get("term") : "";
  const tabButtons = new Map();
  const search = $("search");
  const edition = $("edition");
  const featured = $("featured");
  search.value = query.get("q") || "";
  edition.append(new Option("全部届次",""));
  for (const item of [...data.editions].reverse()) edition.append(new Option(item.label,item.id));
  if (editions.has(query.get("edition"))) edition.value = query.get("edition");
  featured.setAttribute("aria-pressed", String(query.get("featured") === "1"));

  for (const [id,label] of [["","全部课程"], ...terms]) {
    const button = make("button",label);
    button.type = "button";
    button.addEventListener("click", () => { term = id; render(); });
    $("terms").append(button);
    tabButtons.set(id,button);
  }
  for (const element of [search,edition]) element.addEventListener("input",render);
  featured.addEventListener("click", () => {
    featured.setAttribute("aria-pressed", String(featured.getAttribute("aria-pressed") !== "true"));
    render();
  });
  function clean(value) { return value.normalize("NFKC").toLowerCase().replace(/\s+/g,""); }
  function matching(course, tokens) {
    const courseText = clean([course.name, terms.get(course.term)].join(" "));
    const selected = grouped.get(course.id).filter(resource =>
      (!edition.value || resource.edition === edition.value) &&
      (featured.getAttribute("aria-pressed") === "false" || resource.featured) &&
      tokens.every(token => clean([courseText,resource.title,resource.kind,resource.summary,...resource.topics].join(" ")).includes(token))
    );
    return { selected, courseMatches: tokens.every(token => courseText.includes(token)) };
  }
  function render() {
    const tokens = search.value.trim().split(/\s+/).filter(Boolean).map(clean);
    const filtered = [];
    tabButtons.forEach((button,id) => button.setAttribute("aria-pressed",String(id === term)));
    for (const course of data.courses) {
      if (term && course.term !== term) continue;
      const {selected,courseMatches} = matching(course,tokens);
      if (selected.length || (courseMatches && !edition.value && featured.getAttribute("aria-pressed") === "false")) filtered.push([course,selected]);
    }
    $("stats").textContent = data.courses.length + " 门课程 · " + data.resources.length + " 份资料";
    const count = filtered.reduce((sum,[,list]) => sum + list.length, 0);
    $("result-count").textContent = filtered.length + " 门 · " + count + " 份";
    const grid = $("course-grid");
    grid.replaceChildren();
    if (!filtered.length) grid.append(make("p","没有符合当前条件的资料。可以清除筛选或换个关键词。","empty"));
    for (const [course,list] of filtered) {
      const card = make("button",null,"course");
      card.type = "button";
      card.setAttribute("aria-haspopup","dialog");
      const top = make("span",null,"card-top");
      top.append(make("span",course.mark,"tile"),make("span",terms.get(course.term),"term-tag"));
      const name = make("span",course.name,"course-name");
      const foot = make("span",null,"card-foot");
      const stars = list.filter(item => item.featured).length;
      foot.append(make("span",list.length ? list.length + " 份资料" + (stars ? " · " + stars + " 份优秀" : "") : "待收录"),make("span","↗","arrow"));
      card.append(top,name,foot);
      card.addEventListener("click",() => openCourse(course,list));
      grid.append(card);
    }
    if (location.protocol !== "file:") {
      const url = new URL(location.href);
      for (const [key,value] of [["term",term],["q",search.value.trim()],["edition",edition.value],["featured",featured.getAttribute("aria-pressed") === "true" ? "1" : ""]]) {
        if (value) url.searchParams.set(key,value); else url.searchParams.delete(key);
      }
      history.replaceState(null,"",url);
    }
  }
  function openCourse(course,list) {
    $("course-term").textContent = terms.get(course.term);
    $("course-title").textContent = course.name;
    const files = $("course-files");
    files.replaceChildren();
    if (!list.length) files.append(make("p", "这门课暂未发布复习资料。","empty"));
    for (const resource of list) {
      const file = make("article",null,"file-card");
      const meta = [resource.kind,editions.get(resource.edition),resource.updated];
      if (resource.featured) meta.unshift("优秀笔记");
      if (resource.credit) meta.push("整理者 " + resource.credit);
      file.append(make("h3",resource.title),make("p",meta.join(" · "),"meta"));
      if (resource.topics.length) file.append(make("p","知识点 · " + resource.topics.join("、")));
      if (resource.summary) file.append(make("p",resource.summary));
      const link = catalog.fileURL(resource.file);
      const actions = make("div",null,"file-actions");
      if (link) {
        const preview = make("a",link.local ? "查看 PDF ↗" : "打开资料链接 ↗","action");
        preview.href = link.href;
        preview.target = "_blank";
        preview.rel = "noopener noreferrer";
        actions.append(preview);
        if (link.local) {
          const download = make("a","下载 PDF ↓","action");
          download.href = link.href;
          download.download = resource.title + ".pdf";
          actions.append(download);
        }
      }
      file.append(actions);
      files.append(file);
    }
    $("course-dialog").showModal();
  }
  render();
})();
