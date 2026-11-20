import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { root } from "./library.mjs";

const tag = "course-pdfs";
const curl = process.platform === "win32" ? join(process.env.SystemRoot || "C:\\Windows","System32","curl.exe") : "curl";

function command(program,args,input) {
  return new Promise((resolve,reject)=>{
    const child=spawn(program,args,{
      cwd:root, windowsHide:true, stdio:["pipe","pipe","ignore"],
      env:{...process.env,GIT_TERMINAL_PROMPT:"0",GCM_INTERACTIVE:"Never"}
    });
    let output="";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data",chunk=>{ output+=chunk; });
    child.on("error",reject);
    child.on("close",code=>code===0 ? resolve(output) : reject(new Error("网络请求失败（" + code + "）。")));
    child.stdin.on("error",()=>{});
    child.stdin.end(input);
  });
}

export function releaseStorage(repository,gitBinary,proxy) {
  const group = /^https:\/\/github\.com\/([a-z0-9-]+\/[a-z0-9_.-]+)\.git$/i.exec(repository || "")?.[1];
  if (!group) throw new Error("大文件需要连接正式站的 GitHub 仓库。");
  const api = "https://api.github.com/repos/" + group;
  let credential;
  async function auth() {
    if (!credential) {
      const connection = "protocol=https\nhost=github.com\npath=" + group + ".git\n\n";
      const supplied = await command(gitBinary,["credential","fill"],connection);
      credential = supplied.split(/\r?\n/).find(line=>line.startsWith("password="))?.slice(9);
      if (!credential || /[\r\n]/.test(credential)) throw new Error("读取 GitHub 登录凭据失败。");
    }
    return "Authorization: Bearer " + credential;
  }
  async function request(target,{method="GET",payload,path,type="application/json",maximum="30"}={}) {
    const args = ["-q","--silent","--connect-timeout","20","--max-time",maximum,"--request",method,
      "--header","@-","--header","Accept: application/vnd.github+json",
      "--header","X-GitHub-Api-Version: 2022-11-28",
      "--user-agent","XinhuoNotes", "--write-out","\n%{http_code}"];
    if (proxy) args.push("--proxy",proxy);
    if (path) args.push("--header","Content-Type: "+type,"--upload-file",path);
    if (payload) args.push("--header","Content-Type: "+type,"--data-binary",JSON.stringify(payload));
    const header = await auth();
    const output = await command(curl,[...args,target],header+"\n");
    const end = output.lastIndexOf("\n");
    const status = Number(output.slice(end+1).trim());
    const body = output.slice(0,end).trim();
    let data = null;
    if (body && status >= 200 && status < 300) data = JSON.parse(body);
    return {status,data};
  }
  async function issue({path,bytes,course}) {
    let release = await request(api+"/releases/tags/"+tag);
    if (release.status === 404) {
      release = await request(api+"/releases",{
        method:"POST",payload:{
          tag_name:tag, target_commitish:"main", name:"芯火相传大文件资料",
          body:"存放资料库的 PDF 附件。请在学生端按课程和知识点查找：https://jcdl-notes.github.io/",
          make_latest:"false"
        }
      });
      if (release.status === 422) release = await request(api+"/releases/tags/"+tag);
    }
    if (![200,201].includes(release.status) || !Number.isSafeInteger(release.data?.id) || release.data.draft) {
      throw new Error("无法准备 GitHub 大文件存储（HTTP " + release.status + "）。");
    }
    const name = course + "-" + randomUUID() + ".pdf";
    const download = "https://github.com/" + group + "/releases/download/" + tag + "/" + name;
    const endpoint = "https://uploads.github.com/repos/" + group + "/releases/" + release.data.id + "/assets?name=" + name;
    const {status,data} = await request(endpoint,{method:"POST",path,type:"application/pdf",maximum:"1200"});
    if (status !== 201 || data?.state !== "uploaded" || data?.size !== bytes
        || data?.browser_download_url !== download || !Number.isSafeInteger(data?.id)) {
      throw new Error("GitHub 大文件上传未完成（HTTP " + status + "）。");
    }
    return {file:download,bytes,assetId:data.id};
  }
  async function discard(assetId) {
    const {status}=await request(api+"/releases/assets/"+assetId,{method:"DELETE"});
    if (status !== 204 && status !== 404) throw new Error("GitHub 附件清理失败（HTTP " + status + "）。");
  }
  return {issue,discard};
}
