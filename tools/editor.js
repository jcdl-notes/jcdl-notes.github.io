"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const form = $("upload");
  const category = $("category");
  const editor = $("edit-form");
  const dialog = $("edit-note");
  const catalog = window.XinhuoCatalog;
  const field = (owner,name) => owner.elements.namedItem(name);
  let data;
  let repository;
  let busy = false;
  let editing;
  function message(value, error = false) {
    $("edit-status").textContent = value;
    $("edit-status").classList.toggle("error", error);
  }
  function options(select, records) {
    const old = select.value;
    select.replaceChildren(...records.map(([id,label])=>new Option(label,id)));
    if (records.some(([id])=>id===old)) select.value=old;
  }
  function drawEntries() {
    const normalized = value => value.normalize("NFKC").toLowerCase();
    const query = normalized($("note-search").value.trim());
    const course = $("note-course").value;
    const edition = $("note-edition").value;
    const courseNames = new Map(data.courses.map(item=>[item.id,item.name]));
    const editionNames = new Map(data.editions.map(item=>[item.id,item.label]));
    const results = data.resources.filter(item =>
      (!course || item.course === course) && (!edition || item.edition === edition) &&
      (!$("note-featured").checked || item.featured) &&
      normalized([item.title,item.credit,courseNames.get(item.course),...item.topics].join(" ")).includes(query)
    ).sort((a,b)=>b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title,"zh-CN"));
    $("entry-count").textContent = "显示 " + results.length + " / " + data.resources.length + " 份";
    const list = $("entries");
    list.replaceChildren();
    if (!results.length) {
      const empty = document.createElement("li");
      empty.textContent = data.resources.length ? "没有符合筛选条件的资料。" : "当前暂无资料。";
      list.append(empty);
    }
    for (const item of results) {
      const li = document.createElement("li");
      li.className = "entry";
      const info = document.createElement("div");
      info.className = "entry-info";
      const title = document.createElement("strong");
      title.textContent = item.title;
      const meta = document.createElement("small");
      meta.textContent = [courseNames.get(item.course),editionNames.get(item.edition),item.kind,
        ...(item.featured ? ["优秀"] : []),item.credit,item.updated].filter(Boolean).join(" · ");
      info.append(title,meta);
      const actions = document.createElement("div");
      actions.className = "entry-actions";
      const open = document.createElement("a");
      const link = catalog.fileURL(item.file);
      open.className = "action";
      open.href = link.local ? "/" + link.href.slice(2) : link.href;
      open.target = "_blank";
      open.rel = "noopener noreferrer";
      open.textContent = link.local ? "预览" : "下载 PDF";
      function button(label,callback,style="") {
        const node = document.createElement("button");
        node.type = "button";
        node.className = "action " + style;
        node.textContent = label;
        node.disabled = busy;
        node.addEventListener("click",callback);
        return node;
      }
      actions.append(open,button("编辑",()=>edit(item)),button("删除",()=>deleteNote(item),"danger"));
      li.append(info,actions);
      list.append(li);
    }
  }
  function draw() {
    const terms = new Map(data.terms.map(term=>[term.id,term.label]));
    const courses = new Map(data.courses.map(course=>[course.id,course.name]));
    const editions = [...data.editions].reverse().map(item=>[item.id,item.label]);
    const courseOptions = data.courses.map(item=>[item.id,terms.get(item.term) + " · " + courses.get(item.id)]);
    for (const target of [form,editor]) {
      options(field(target,"edition"),editions);
      options(field(target,"course"),courseOptions);
    }
    options(field(editor,"kind"),Array.from(field(form,"kind").options,option=>[option.value,option.label]));
    options($("note-edition"),[["","全部届次"],...editions]);
    options($("note-course"),[["","全部课程"],...courseOptions]);
    options(field(category,"term"),[...terms]);
    $("sync-status").textContent = repository ? "已连接正式站，保存后自动提交发布。" : "当前更新本机预览。连接 GitHub 后可自动发布。";
    drawEntries();
  }
  async function request(path, body, type) {
    const headers = {"X-Xinhuo-Editor":"1"};
    if (type) headers["Content-Type"]=type;
    const response = await fetch("/admin/api/" + path,body === undefined ? {} : {method:"POST",body,headers});
    if (response.status === 401) throw new Error("管理端登录已失效，请刷新页面重新登录。");
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "更新失败。");
    data=result.data;
    repository=result.repository;
    draw();
    return result.publish?.state;
  }
  function syncMessage(state) {
    $("retry").hidden = state !== "failed";
    if (state === "queued") return "已同步到 GitHub，学生端将在发布完成后更新。";
    if (state === "failed") return "本地目录已更新，GitHub 同步失败。可以点击下方按钮重试。";
    return "本地学生端已更新。";
  }
  async function run(action,onError=error=>message(error.message,true)) {
    if (busy) return;
    busy=true;
    for (const button of document.querySelectorAll("main button")) button.disabled=true;
    try { await action(); }
    catch (error) { onError(error); }
    finally {
      busy=false;
      for (const button of document.querySelectorAll("main button")) button.disabled=false;
    }
  }
  function edit(item) {
    if (busy) return;
    editing = item.id;
    for (const key of ["title","edition","course","credit","kind"]) field(editor,key).value = item[key];
    field(editor,"topics").value = item.topics.join("、");
    field(editor,"featured").checked = item.featured;
    field(editor,"pdf").value = "";
    $("edit-note-status").textContent = "";
    dialog.showModal();
  }
  function deleteNote(item) {
    const reminder = catalog.fileURL(item.file).local ? "" : " GitHub 附件中的原下载地址会保留。";
    if (busy || !confirm("删除《" + item.title + "》？学生端的目录和 PDF 链接会在发布后移除。" + reminder)) return;
    run(async()=>{
      const state = await request("delete?" + new URLSearchParams({id:item.id}),"","text/plain");
      message("已删除《" + item.title + "》。" + syncMessage(state),state === "failed");
    });
  }
  editor.addEventListener("submit",event=>{
    event.preventDefault();
    run(async()=>{
      const values = new URLSearchParams({id:editing});
      for (const key of ["title","edition","course","credit","kind","topics"]) values.set(key,field(editor,key).value);
      values.set("featured",field(editor,"featured").checked ? "1" : "0");
      const file = field(editor,"pdf").files[0];
      $("edit-note-status").textContent = file?.size > 25 * 1024 * 1024 ? "正在上传大文件，请保持此页面打开…" : "正在保存…";
      const state = await request("edit?" + values,file || "",file ? "application/pdf" : "text/plain");
      dialog.close();
      message("已保存修改。" + syncMessage(state),state === "failed");
    },error=>{ $("edit-note-status").textContent = error.message; });
  });
  for (const id of ["note-search","note-edition","note-course","note-featured"]) {
    $(id).addEventListener("input",()=>{ if (data) drawEntries(); });
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    run(async()=>{
      const selected = [...field(form,"pdf").files];
      let completed=0;
      let state;
      for (const file of selected) {
        const note = file.size > 25 * 1024 * 1024 ? "。正在处理大文件，请保持此页面打开。" : "";
        message("正在上传 " + (completed+1) + "/" + selected.length + " · " + file.name + note);
        const values = new URLSearchParams({
          name:file.name, edition:field(form,"edition").value, course:field(form,"course").value,
          kind:field(form,"kind").value, credit:field(form,"credit").value, topics:field(form,"topics").value,
          featured:field(form,"featured").checked ? "1" : "0"
        });
        try { state=await request("upload?" + values,file,"application/pdf"); }
        catch (error) { throw new Error("已收录 " + completed + " 份。" + file.name + " · " + error.message); }
        completed++;
      }
      field(form,"pdf").value="";
      message("已收录 " + completed + " 份。" + syncMessage(state),state === "failed");
    });
  });
  field(category,"type").addEventListener("change",()=>{
    $("term-label").hidden=field(category,"type").value!=="courses";
  });
  category.addEventListener("submit",event=>{
    event.preventDefault();
    run(async()=>{
      const values=Object.fromEntries(new FormData(category));
      const state=await request("category",JSON.stringify(values),"application/json");
      field(category,"label").value="";
      message("已添加“" + values.label.trim() + "”。" + syncMessage(state),state === "failed");
    });
  });
  $("retry").addEventListener("click",()=>run(async()=>{
    const state=await request("publish","", "text/plain");
    message(syncMessage(state),state === "failed");
  }));
  request("library").catch(error=>message(error.message,true));
})();
