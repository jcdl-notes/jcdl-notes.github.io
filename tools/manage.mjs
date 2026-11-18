import { createServer } from "node:http";
import { readFile, mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve, extname, sep, join } from "node:path";
import { randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { catalog, docs, root, readLibrary, rebuildIndex, writeLibrary, noteDirectory, requirePDF, isoDate, updateNote } from "./library.mjs";

import { credentialPath } from "./admin-settings.mjs";

const { username, salt, passwordHash, gitBinary } = JSON.parse(await readFile(credentialPath, "utf8"));
const credentials = Buffer.from(passwordHash, "hex");
function authorized(header) {
  if (!header?.startsWith("Basic ") || header.length > 2048) return false;
  const decoded = Buffer.from(header.slice(6),"base64").toString("utf8");
  const split = decoded.indexOf(":");
  if (split < 0 || decoded.slice(0,split) !== username) return false;
  return timingSafeEqual(scryptSync(decoded.slice(split+1),salt,credentials.length),credentials);
}
const port = Number(process.env.XINHUO_PORT || 8766);
const origin = "http://127.0.0.1:" + port;
const maxPDF = 25 * 1024 * 1024;
const runGit = promisify(execFile);
const git = async (...args) => (await runGit(gitBinary || "git", args, {cwd:root, timeout:75000})).stdout.trim();
const filenamePattern = /^[a-z0-9][a-z0-9-]*$/;
const assets = new Map(Object.entries({
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".jpg": "image/jpeg", ".pdf": "application/pdf"
}));
let busy = false;

async function publishingRepository() {
  try {
    const top = await git("rev-parse", "--show-toplevel");
    const comparable = path => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
    if (comparable(top) !== comparable(root) || await git("symbolic-ref", "--quiet", "--short", "HEAD") !== "main"
        || await git("config", "--local", "--get", "xinhuo.autoPublish") !== "true") return null;
    const remote = await git("remote", "get-url", "--push", "origin");
    return /^https:\/\/github\.com\/[a-z0-9-]+\/[a-z0-9_.-]+$/i.test(remote) ? remote : null;
  } catch { return null; }
}

async function sync(repo) {
  if (!repo) return { state: "local" };
  try {
    const paths = ["docs/data/library.js", "docs/files"];
    await git("add", "--", ...paths);
    if (await git("status", "--porcelain", "--", ...paths)) {
      await git("commit", "--only", "-m", "更新学习资料", "--", ...paths);
    }
    await git("push", "origin", "HEAD:main");
    return { state: "queued" };
  } catch (error) {
    console.error("GitHub 同步失败：", error.code ?? error.name);
    return { state: "failed" };
  }
}

async function bodyBytes(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const bytes of request) {
    size += bytes.length;
    if (size > limit) throw new Error("文件超过上传大小限制。");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function clean(value, limit) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function details(query) {
  return {
    title: clean(query.get("title"),120),
    kind: catalog.kinds.includes(query.get("kind")) ? query.get("kind") : "其他复习资料",
    credit: clean(query.get("credit"),60),
    topics: clean(query.get("topics"),240).split(/[、,，]/).map(value=>value.trim()).filter(Boolean)
  };
}

async function readPDF(request) {
  if (Number(request.headers["content-length"]) > maxPDF) throw new Error("单个 PDF 最大为 25 MB。");
  const pdf = await bodyBytes(request,maxPDF);
  requirePDF(pdf);
  return pdf;
}
async function upload(request, url) {
  const data = await readLibrary();
  const edition = url.searchParams.get("edition");
  const course = url.searchParams.get("course");
  const bucket = url.searchParams.get("featured") === "1" ? "featured" : "general";
  const directory = noteDirectory(data, edition, course, bucket);
  const name = url.searchParams.get("name");
  if (!catalog.safeFilename(name)) throw new Error("请选择文件名有效的 PDF。");
  const bytes = await readPDF(request);
  await mkdir(directory, {recursive:true});
  const path = join(directory, name);
  try {
    await writeFile(path, bytes, {flag:"wx"});
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("这门课已收录同名文件，请选择其他文件。");
    throw error;
  }
  const resource = {
    id: "note-" + randomUUID(),
    ...details(url.searchParams),
    title: clean(url.searchParams.get("title"),120) || name.slice(0,-4),
    course, edition,
    featured: bucket === "featured",
    summary: "",
    updated: isoDate(new Date()),
    file: ["files",edition,course,bucket,name].join("/")
  };
  try {
    return await rebuildIndex({...data,resources:[...data.resources,resource]});
  } catch (error) {
    await unlink(path);
    throw error;
  }
}

async function editOrDelete(request,url) {
  const data = await readLibrary();
  const query = url.searchParams;
  const old = data.resources.find(item => item.id === query.get("id"));
  if (!old) throw new Error("资料已变更或删除，请刷新管理页。");
  if (url.pathname.endsWith("/delete")) return updateNote(data,old,null,null);
  const pdf = request.headers["content-type"] === "application/pdf" ? await readPDF(request) : null;
  const edition = query.get("edition");
  const course = query.get("course");
  const featured = query.get("featured") === "1";
  const bucket = featured ? "featured" : "general";
  noteDirectory(data,edition,course,bucket);
  const next = {
    ...old, ...details(query), edition, course, featured,
    updated: isoDate(new Date()),
    file: ["files",edition,course,bucket,old.file.split("/").at(-1)].join("/")
  };
  if (pdf) next.revision = randomUUID();
  if (!next.title) throw new Error("请填写资料标题。");
  return updateNote(data,old,next,pdf);
}

async function addCategory(request) {
  const {type, label: rawLabel, term} = JSON.parse((await bodyBytes(request,8192)).toString("utf8"));
  const label = clean(rawLabel,80);
  const data = await readLibrary();
  if (!label || !["editions","terms","courses"].includes(type)) throw new Error("请填写有效的名称。");
  const getLabel = item => item.label || item.name;
  if (data[type].some(item=>getLabel(item)===label && (type!=="courses" || item.term===term))) throw new Error("此名称已存在。");
  const id = ({editions:"edition",terms:"term",courses:"course"})[type] + "-" + Date.now().toString(36);
  if (!filenamePattern.test(id)) throw new Error("编号无效。");
  if (type === "courses" && !data.terms.some(item=>item.id===term)) throw new Error("请选择课程所在学期。");
  data[type].push(type === "courses" ? {id, name:label, term, mark:[...label][0]} : {id,label});
  await writeLibrary(data);
  return data;
}

function json(response, code, data) {
  response.writeHead(code, {"Content-Type":"application/json; charset=utf-8"}).end(JSON.stringify(data));
}
async function staticFile(response, urlPath) {
  let base = docs;
  let relative = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath.slice(1));
  if (["admin/","admin/index.html","admin/editor.js"].includes(relative)) {
    base = join(root,"tools");
    relative = relative.endsWith("editor.js") ? "editor.js" : "editor.html";
  } else if (relative !== "index.html" && relative !== "data/library.js"
      && !/^assets\/[a-z0-9.-]+$/i.test(relative) && !catalog.fileURL(relative)) {
    response.writeHead(404).end();
    return;
  }
  const path = resolve(base, relative);
  if (!path.startsWith(base + sep)) return response.writeHead(404).end();
  try {
    const bytes = await readFile(path);
    response.writeHead(200,{"Content-Type":assets.get(extname(path).toLowerCase()) || "application/octet-stream"}).end(bytes);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    response.writeHead(404).end();
  }
}

const server = createServer(async (request,response) => {
  response.setHeader("Cache-Control","no-store");
  response.setHeader("X-Content-Type-Options","nosniff");
  response.setHeader("Content-Security-Policy","default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    if (request.headers.host !== new URL(origin).host) return response.writeHead(403).end();
    const url = new URL(request.url, origin);
    if (url.origin !== origin) return response.writeHead(403).end();
    const privatePage = url.pathname.startsWith("/admin/");
    if (privatePage && !authorized(request.headers.authorization)) {
      response.setHeader("WWW-Authenticate",'Basic realm="Xinhuo Notes", charset="UTF-8"');
      return response.writeHead(401).end("Administrator login required");
    }
    if (request.method === "GET" && url.pathname === "/admin/api/library") return json(response,200,{data:await readLibrary(), repository:await publishingRepository()});
    if (request.method === "GET") return await staticFile(response,url.pathname);
    const action = url.pathname.slice("/admin/api/".length);
    const actions = {upload, category:addCategory, edit:editOrDelete, delete:editOrDelete, publish:readLibrary};
    if (request.method !== "POST" || !url.pathname.startsWith("/admin/api/") || !Object.hasOwn(actions,action)) return response.writeHead(404).end();
    if (request.headers.origin !== origin || request.headers["x-xinhuo-editor"] !== "1") return response.writeHead(403).end();
    if (busy) return json(response,409,{message:"有一项更新正在处理，请稍后重试。"});
    busy = true;
    try {
      const repository = await publishingRepository();
      const data = await actions[action](request,url);
      json(response,200,{data, repository, publish:await sync(repository)});
    } finally { busy = false; }
  } catch (error) {
    json(response,400,{message:error.message});
  }
});

server.listen(port,"127.0.0.1",() => {
  console.log("管理端 " + origin + "/admin/");
  console.log("学生端预览 " + origin);
  if (process.argv.includes("--open") && process.platform === "win32") {
    const explorer = spawn("explorer.exe",[origin + "/admin/"],{detached:true,stdio:"ignore"});
    explorer.on("error",()=>{});
    explorer.unref();
  }
});
