"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const form = $("upload");
  const category = $("category");
  const field = (owner,name) => owner.elements.namedItem(name);
  let data;
  let repository;
  let busy = false;
  function message(value, error = false) {
    $("edit-status").textContent = value;
    $("edit-status").classList.toggle("error", error);
  }
  function options(select, records) {
    const old = select.value;
    select.replaceChildren(...records.map(([id,label])=>new Option(label,id)));
    if (records.some(([id])=>id===old)) select.value=old;
  }
  function draw() {
    const terms = new Map(data.terms.map(term=>[term.id,term.label]));
    const courses = new Map(data.courses.map(course=>[course.id,course.name]));
    options(field(form,"edition"),[...data.editions].reverse().map(item=>[item.id,item.label]));
    options(field(form,"course"),data.courses.map(item=>[item.id,terms.get(item.term) + " · " + item.name]));
    options(field(category,"term"),[...terms]);
    $("sync-status").textContent = repository ? "已连接 GitHub。上传成功后会自动同步。" : "当前更新本机预览。连接 GitHub 后可自动发布。";
    $("entries").replaceChildren(...data.resources.map(item=>Object.assign(document.createElement("li"),{
      textContent:(item.featured ? "优秀 · " : "") + courses.get(item.course) + " · " + item.title
    })));
    if (!data.resources.length) $("entries").textContent="当前暂无资料。";
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
  async function run(action) {
    if (busy) return;
    busy=true;
    for (const button of document.querySelectorAll("main button")) button.disabled=true;
    try { await action(); }
    catch (error) { message(error.message,true); }
    finally {
      busy=false;
      for (const button of document.querySelectorAll("main button")) button.disabled=false;
    }
  }
  form.addEventListener("submit", event => {
    event.preventDefault();
    run(async()=>{
      const selected = [...field(form,"pdf").files];
      let completed=0;
      let state;
      for (const file of selected) {
        message("正在上传 " + (completed+1) + "/" + selected.length + " · " + file.name);
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
