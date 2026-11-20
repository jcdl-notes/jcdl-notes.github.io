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
  const bottomNext = $("reader-next-bottom");
  const retry = $("page-retry");
  let page = 1;
  let sequence = 0;
  $("page-total").textContent = "/ " + metadata.pages;
  pageField.max = String(metadata.pages);
  $("page-toolbar").hidden = false;
  function showPage(value) {
    if (!Number.isInteger(value) || value < 1 || value > metadata.pages) return;
    page = value;
    const token = ++sequence;
    retry.hidden = true;
    bottomNext.hidden = true;
    pageField.value = String(page);
    $("previous").disabled = page === 1;
    $("next").disabled = page === metadata.pages;
    state.textContent = "正在加载第 " + value + " 页…";
    paper.replaceChildren();
    const img = new Image();
    img.alt = "第 " + value + " 页";
    img.decoding = "async";
    img.addEventListener("load",()=>{
      if (token !== sequence) return;
      state.textContent = "第 " + value + " 页，共 " + metadata.pages + " 页";
      paper.replaceChildren(img);
      bottomNext.hidden = value >= metadata.pages;
    });
    img.addEventListener("error",()=>{
      if (token !== sequence) return;
      state.textContent = "第 " + value + " 页未能加载。";
      retry.hidden = false;
    });
    img.src = "previews/"+metadata.key+"/"+value+".jpg";
  }
  function go(value) {
    showPage(value);
    window.scrollTo(0,0);
  }
  $("previous").addEventListener("click",()=>go(page-1));
  $("next").addEventListener("click",()=>go(page+1));
  bottomNext.addEventListener("click",()=>go(page+1));
  retry.addEventListener("click",()=>showPage(page));
  $("jump-page").addEventListener("submit",event=>{
    event.preventDefault();
    go(Number(pageField.value));
  });
  showPage(1);
})();
