import { createServer } from "node:http";
import { readFile, mkdir, unlink, mkdtemp, open, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, extname, sep, join } from "node:path";
import { createHash, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { catalog, docs, root, readLibrary, rebuildIndex, writeLibrary, noteDirectory, requirePDF, isoDate, updateNote } from "./library.mjs";
import { releaseStorage } from "./releases.mjs";

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
const maxLocalPDF = 25 * 1024 * 1024;
const maxPDF = 512 * 1024 * 1024;
const runGit = promisify(execFile);
const git = async (...args) => (await runGit(gitBinary || "git", args, {cwd:root, timeout:75000})).stdout.trim();
const filenamePattern = /^[a-z0-9][a-z0-9-]*$/;
const assets = new Map(Object.entries({
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".jpg": "image/jpeg", ".pdf": "application/pdf",
  ".json": "application/json; charset=utf-8"
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

async function withPDF(request,repository,action) {
  const limit = repository ? maxPDF : maxLocalPDF;
  const limitMessage = repository ? "单个 PDF 最大为 512 MiB。" : "超过 25 MiB 的 PDF 需要连接正式站后上传。";
  if (Number(request.headers["content-length"]) > limit) {
    request.resume();
    throw new Error(limitMessage);
  }
  const directory = await mkdtemp(join(tmpdir(),"xinhuo-pdf-"));
  const path = join(directory,"upload.pdf");
  try {
    const handle = await open(path,"wx+");
    let bytes = 0;
    try {
      for await (const chunk of request.iterator({destroyOnReturn:false})) {
        bytes += chunk.length;
        if (bytes > limit) {
          request.resume();
          throw new Error(limitMessage);
        }
        await handle.writeFile(chunk);
      }
      const heading = Buffer.alloc(5);
      const {bytesRead} = await handle.read(heading,0,5,0);
      requirePDF(heading.subarray(0,bytesRead));
    } finally { await handle.close(); }
    return await action({path,bytes,large:bytes > maxLocalPDF});
  } finally {
    await unlink(path).catch(error=>{ if (error.code !== "ENOENT") console.error("清理上传缓存失败：",error.code); });
    await rmdir(directory).catch(error=>console.error("清理上传目录失败：",error.code));
  }
}

async function saveRelease(repository,pdf,resource,save) {
  const proxy = await git("config","--get","remote.origin.proxy").catch(()=>null);
  const storage = releaseStorage(repository,gitBinary || "git",proxy);
  const asset = await storage.issue({path:pdf.path,bytes:pdf.bytes,course:resource.course});
  try {
    return await save({...resource,...asset});
  } catch (error) {
    await storage.discard(asset.assetId).catch(()=>console.error("清理未收录的 GitHub 附件失败。"));
    throw error;
  }
}
async function upload(request, url, repository) {
  const data = await readLibrary();
  const edition = url.searchParams.get("edition");
  const course = url.searchParams.get("course");
  const bucket = url.searchParams.get("featured") === "1" ? "featured" : "general";
  const directory = noteDirectory(data, edition, course, bucket);
  const name = url.searchParams.get("name");
  if (!catalog.safeFilename(name)) throw new Error("请选择文件名有效的 PDF。");
  const path = join(directory, name);
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
  if (data.resources.some(item => item.edition === edition && item.course === course
      && item.featured === resource.featured && (item.filename || item.file.split("/").at(-1)).toLowerCase() === name.toLowerCase())) {
    throw new Error("这门课已收录同名文件，请选择其他文件。");
  }
  return withPDF(request,repository,async pdf=>{
    if (pdf.large) {
      return saveRelease(repository,pdf,{...resource,filename:name},async saved=>{
        const updated = {...data,resources:[...data.resources,saved]};
        await writeLibrary(updated);
        return updated;
      });
    }
    await mkdir(directory, {recursive:true});
    const handle = await open(path,"wx").catch(error=>{
      if (error.code === "EEXIST") throw new Error("这门课已收录同名文件，请选择其他文件。");
      throw error;
    });
    try {
      try { await handle.writeFile(await readFile(pdf.path)); }
      finally { await handle.close(); }
      return await rebuildIndex({...data,resources:[...data.resources,resource]});
    } catch (error) {
      await unlink(path).catch(cleanup=>console.error("清理未收录的 PDF 失败：",cleanup.code));
      throw error;
    }
  });
}

async function editOrDelete(request,url,repository,action) {
  const data = await readLibrary();
  const query = url.searchParams;
  const old = data.resources.find(item => item.id === query.get("id"));
  if (!old) throw new Error("资料已变更或删除，请刷新管理页。");
  if (query.get("version") !== noteVersion(old)) throw new Error("这份资料已在其他页面更新，请刷新管理页后重试。");
  if (action === "delete") return updateNote(data,old,null,null);
  const edition = query.get("edition");
  const course = query.get("course");
  const featured = query.get("featured") === "1";
  const bucket = featured ? "featured" : "general";
  noteDirectory(data,edition,course,bucket);
  const local = catalog.fileURL(old.file).local;
  const filename = old.filename || old.file.split("/").at(-1);
  const localFile = ["files",edition,course,bucket,filename].join("/");
  const next = {
    ...old, ...details(query), edition, course, featured,
    updated: isoDate(new Date()),
    file: local ? localFile : old.file
  };
  if (!next.title) throw new Error("请填写资料标题。");
  if (request.headers["content-type"] !== "application/pdf") return updateNote(data,old,next,null);
  return withPDF(request,repository,async pdf=>{
    if (pdf.large) return saveRelease(repository,pdf,{...next,filename},saved=>updateNote(data,old,saved,null));
    const {assetId,bytes,filename:previousName,...metadata} = next;
    return updateNote(data,old,{...metadata,file:localFile,revision:randomUUID()},await readFile(pdf.path));
  });
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
function noteVersion(note) {
  const fields = Object.entries(note).sort(([a],[b])=>a.localeCompare(b));
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}
function adminLibrary(data) {
  return {...data,resources:data.resources.map(note=>({...note,version:noteVersion(note)}))};
}
async function staticFile(response, urlPath) {
  let base = docs;
  let relative = urlPath === "/" ? "index.html" : urlPath.slice(1);
  if (["admin/","admin/index.html","admin/editor.js"].includes(relative)) {
    base = join(root,"tools");
    relative = relative.endsWith("editor.js") ? "editor.js" : "editor.html";
  } else if (!["index.html","reader.html","read.html","data/library.js","previews/index.json"].includes(relative)
      && !/^previews\/[a-f0-9]{24}\/[1-9]\d*\.jpg$/.test(relative)
      && !/^assets\/[a-z0-9.-]+$/i.test(relative) && !catalog.fileURL(relative)?.local) {
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
    const pathname = decodeURIComponent(url.pathname);
    const privatePage = pathname.startsWith("/admin/");
    if (privatePage && !authorized(request.headers.authorization)) {
      response.setHeader("WWW-Authenticate",'Basic realm="Xinhuo Notes", charset="UTF-8"');
      return response.writeHead(401).end("Administrator login required");
    }
    if (request.method === "GET" && pathname === "/admin/api/library") return json(response,200,{data:adminLibrary(await readLibrary()), repository:await publishingRepository()});
    if (request.method === "GET") return await staticFile(response,pathname);
    const action = pathname.slice("/admin/api/".length);
    const actions = {upload, category:addCategory, edit:editOrDelete, delete:editOrDelete, publish:readLibrary};
    if (request.method !== "POST" || !pathname.startsWith("/admin/api/") || !Object.hasOwn(actions,action)) return response.writeHead(404).end();
    if (request.headers.origin !== origin || request.headers["x-xinhuo-editor"] !== "1") return response.writeHead(403).end();
    if (busy) return json(response,409,{message:"有一项更新正在处理，请稍后重试。"});
    busy = true;
    try {
      const repository = await publishingRepository();
      const data = await actions[action](request,url,repository,action);
      json(response,200,{data:adminLibrary(data), repository, publish:await sync(repository)});
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
