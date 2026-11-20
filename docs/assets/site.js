"use strict";
(async () => {
  const $ = id => document.getElementById(id);
  function drawCircuitTraces(canvas) {
    const context = canvas?.getContext("2d");
    if (!context) return;
    const bundles = [
      { trace: [[0,156],[155,156],[225,86],[455,86],[507,138],[725,138],[807,56],[960,56]], count: 4, gap: 20 },
      { trace: [[0,490],[174,490],[238,554],[469,554],[535,488],[756,488],[824,556],[960,556]], count: 4, gap: 20 },
      { trace: [[565,241],[658,241],[681,218],[960,218]], count: 2, gap: 17 },
      { trace: [[560,414],[671,414],[721,364],[960,364]], count: 2, gap: 20 }
    ];
    context.lineWidth = 2;
    context.lineJoin = "bevel";
    for (const { trace, count, gap } of bundles) {
      for (let lane = 0; lane < count; lane++) {
        const shift = lane * gap;
        context.strokeStyle = lane === 0 ? "#b7d3fc68" : "#b7d3fc45";
        context.beginPath();
        const [[startX,startY],...points] = trace;
        context.moveTo(startX,startY + shift);
        for (const [x,y] of points) context.lineTo(x,y + shift);
        context.stroke();
      }
    }
  }
  drawCircuitTraces(document.querySelector(".hero-art"));
  const catalog = window.XinhuoCatalog;
  const libraryURL = new URL("data/library.js",location.href);
  async function loadLibrary() {
    if (location.protocol !== "file:") {
      // Share one CDN cache entry per minute so a new deployment is seen promptly.
      libraryURL.searchParams.set("v",String(Math.floor(Date.now()/60000)));
      const result = await fetch(libraryURL,{cache:"no-cache"});
      if (!result.ok) throw new Error("HTTP " + result.status);
      return catalog.parse(await result.text());
    }
    return new Promise((resolve,reject) => {
      const script = document.createElement("script");
      script.src = libraryURL;
      script.onload = () => resolve(window.XINHUO_LIBRARY);
      script.onerror = reject;
      document.head.append(script);
    });
  }
  let data;
  try { data = await loadLibrary(); }
  catch { $("course-grid").textContent = "暂时无法加载资料，请刷新页面重试。"; return; }
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
      const meta = make("p",null,"meta");
      if (resource.featured) {
        const label = make("span",null,"featured-note");
        const star = make("span","★");
        star.setAttribute("aria-hidden","true");
        label.append(star," 优秀笔记");
        meta.append(label," · ");
      }
      meta.append(resource.kind);
      if (resource.credit) meta.append(" · 整理者 " + resource.credit);
      file.append(make("h3",resource.title),meta);
      if (resource.topics.length) file.append(make("p","知识点 · " + resource.topics.join("、")));
      if (resource.summary) file.append(make("p",resource.summary));
      const link = catalog.fileURL(resource.file);
      const actions = make("div",null,"file-actions");
      if (link) {
        const href = link.local && resource.revision ? link.href + "?v=" + encodeURIComponent(resource.revision) : link.href;
        if (location.protocol !== "file:" || link.local) {
          const preview = make("a",location.protocol === "file:" ? "在线预览 ↗" : "在线预览 · 连续阅读","action");
          preview.href = location.protocol === "file:" ? href : "./read.html?note="+encodeURIComponent(resource.id);
          if (location.protocol === "file:") {
            preview.target = "_blank";
            preview.rel = "noopener noreferrer";
          }
          actions.append(preview);
        }
        const label = link.local ? "下载 PDF ↓" : "下载 PDF（" + (resource.bytes / 1e6).toFixed(0) + " MB）↓";
        const download = make("a",label,"action");
        download.href = href;
        if (link.local) download.download = resource.title + ".pdf";
        actions.append(download);
      }
      file.append(actions);
      files.append(file);
    }
    $("course-dialog").showModal();
  }
  render();
})();
