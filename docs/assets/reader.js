"use strict";
(async () => {
  const $ = id => document.getElementById(id);
  const state = $("reader-status");
  const pageField = $("page-number");
  const original = $("original");
  const note = new URLSearchParams(location.search).get("note");
  const catalog = window.XinhuoCatalog;
  const stamp = String(Math.floor(Date.now()/60000));
  const fresh = async path => {
    const result = await fetch(path+"?v="+stamp,{cache:"no-cache"});
    if (!result.ok) throw new Error("HTTP " + result.status);
    return result;
  };
  if (!note || !/^[a-z0-9][a-z0-9-]*$/.test(note)) {
    state.textContent = "未找到资料，请返回资料库选择一份 PDF。";
    return;
  }
  state.textContent = "正在加载预览…";
  const previewIndex = fresh("previews/index.json").then(response=>response.json()).catch(()=>null);
  let metadata;
  try {
    const data = catalog.parse(await (await fresh("data/library.js")).text());
    const resource = data.resources.find(item=>item.id === note);
    if (!resource) {
      state.textContent = "这份资料可能已经移除，请返回资料库。";
      return;
    }
    $("reader-title").textContent = resource.title;
    document.title = resource.title + " · 在线预览";
    const source = catalog.fileURL(resource.file);
    if (source) {
      original.href = source.local && resource.revision ? source.href+"?v="+encodeURIComponent(resource.revision) : source.href;
      if (source.local) original.download = resource.title + ".pdf";
      original.hidden = false;
    }
    metadata = (await previewIndex)?.[note];
    if (!metadata || !/^[a-f0-9]{24}$/.test(metadata.key)
       || metadata.file !== resource.file || metadata.revision !== (resource.revision || "")
       || !Number.isSafeInteger(metadata.pages) || metadata.pages < 1) throw new Error("Preview unavailable");
  } catch {
    state.textContent = original.hidden ? "未能读取资料信息，请返回资料库重试。" :
      "这份资料的分页预览暂不可用。请刷新重试，或使用上方的原版下载入口。";
    return;
  }

  const paper = $("reader-paper");
  const toolbar = $("page-toolbar");
  const pages = [];
  const fragment = document.createDocumentFragment();
  let current = 1;
  let pending = false;
  $("page-total").textContent = "/ " + metadata.pages;
  pageField.max = String(metadata.pages);
  state.textContent = "共 " + metadata.pages + " 页，向下滑动继续阅读。";
  for (let page=1; page<=metadata.pages; page++) {
    const section = document.createElement("section");
    section.className = "reader-page";
    const label = document.createElement("h2");
    label.textContent = "第 " + page + " 页";
    const retry = document.createElement("button");
    retry.className = "action";
    retry.type = "button";
    retry.textContent = "重试加载第 " + page + " 页";
    retry.hidden = true;
    const img = new Image();
    img.alt = label.textContent;
    const [width,height] = metadata.sizes?.[page-1] || [1188,1680];
    img.width = width;
    img.height = height;
    img.loading = page === 1 ? "eager" : "lazy";
    img.decoding = "async";
    const src = "previews/"+metadata.key+"/"+page+".jpg";
    img.addEventListener("load",()=>{ retry.hidden = true; });
    img.addEventListener("error",()=>{ retry.hidden = false; });
    retry.addEventListener("click",()=>{
      retry.hidden = true;
      img.src = src+"?retry="+Date.now();
    });
    img.src = src;
    section.append(label,retry,img);
    pages.push(section);
    fragment.append(section);
  }
  paper.append(fragment);
  toolbar.hidden = false;

  function updatePage() {
    pending = false;
    const line = toolbar.offsetHeight + 18;
    let low = 0;
    let high = pages.length-1;
    while (low < high) {
      const middle = Math.ceil((low+high)/2);
      if (pages[middle].getBoundingClientRect().top <= line) low = middle;
      else high = middle-1;
    }
    current = low+1;
    if (window.scrollY+window.innerHeight >= document.documentElement.scrollHeight-2) current = pages.length;
    if (document.activeElement !== pageField) pageField.value = String(current);
    $("previous").disabled = current === 1;
    $("next").disabled = current === metadata.pages;
  }
  function scheduleUpdate() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(updatePage);
  }
  function go(value) {
    if (!Number.isInteger(value) || !pages[value-1]) return;
    pageField.blur();
    pages[value-1].scrollIntoView({block:"start",behavior:"instant"});
    updatePage();
  }
  $("previous").addEventListener("click",()=>go(current-1));
  $("next").addEventListener("click",()=>go(current+1));
  $("jump-page").addEventListener("submit",event=>{
    event.preventDefault();
    go(Number(pageField.value));
  });
  window.addEventListener("scroll",scheduleUpdate,{passive:true});
  window.addEventListener("resize",scheduleUpdate);
  updatePage();
})();
