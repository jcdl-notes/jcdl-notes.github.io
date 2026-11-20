import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { catalog, docs, root, readLibrary, requirePDF } from "./library.mjs";

const run = promisify(execFile);
const environment = {...process.env, LC_ALL:"C"};
const cache = join(root,".preview-cache");
const output = join(docs,"previews");
const curl = process.platform === "win32" ? join(process.env.SystemRoot || "C:\\Windows","System32","curl.exe") : "curl";
const width = "1680";
const quality = "86";
const pagePattern = /^page-(\d+)\.jpg$/;
const pageBudget = 950_000_000;

async function bytesIn(directory,exclude = "") {
  let bytes = 0;
  for (const item of await readdir(directory,{withFileTypes:true})) {
    const path = join(directory,item.name);
    if (path === exclude) continue;
    if (item.isDirectory()) bytes += await bytesIn(path,exclude);
    else if (item.isFile()) bytes += (await stat(path)).size;
  }
  return bytes;
}

async function previewKey(resource,isLocal) {
  const hash = createHash("sha256").update(JSON.stringify([width,quality,resource.file,"v1"]));
  if (isLocal) for await (const chunk of createReadStream(join(docs,resource.file))) hash.update(chunk);
  return hash.digest("hex").slice(0,24);
}

async function readPreview(directory) {
  try {
    const info = JSON.parse(await readFile(join(directory,"meta.json"),"utf8"));
    if (!Number.isSafeInteger(info.pages) || info.pages < 1 || !Number.isSafeInteger(info.bytes) || info.bytes < 1) return null;
    for (let page = 1; page <= info.pages; page++) {
      if (!(await stat(join(directory,page+".jpg"))).size) return null;
    }
    return info;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function render(resource,link,cacheKey) {
  if (!/^[a-f0-9]{24}$/.test(cacheKey)) throw new Error("Invalid preview cache key.");
  const target = join(cache,cacheKey);
  const hit = await readPreview(target);
  if (hit) return {directory:target,...hit};

  const temp = await mkdtemp(join(cache,".working-"));
  if (dirname(temp) !== cache || !basename(temp).startsWith(".working-")) throw new Error("Unexpected preview temporary path.");
  try {
    const pdf = link.local ? join(docs,resource.file) : join(temp,"original.pdf");
    if (!link.local) {
      await run(curl,["-q","--fail","--location","--proto-redir","=https","--silent","--show-error",
        "--retry","1","--connect-timeout","15","--max-time","300","--max-filesize",String(resource.bytes),
        "--output",pdf,link.href],{env:environment,timeout:330000});
      if ((await stat(pdf)).size !== resource.bytes) throw new Error("Release PDF size does not match the catalogue.");
    }
    const input = await open(pdf,"r");
    try {
      const signature = Buffer.alloc(5);
      const {bytesRead} = await input.read(signature,0,5,0);
      requirePDF(signature.subarray(0,bytesRead));
    } finally { await input.close(); }
    const {stdout} = await run("pdfinfo",[pdf],{env:environment,timeout:30000});
    const pages = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1]);
    if (!Number.isSafeInteger(pages) || pages < 1) throw new Error("PDF page count is unavailable.");
    await run("pdftoppm",["-cropbox","-scale-to",width,"-jpeg","-jpegopt","quality="+quality+",optimize=y",
      "-forcenum",pdf,join(temp,"page")],{env:environment,timeout:480000});
    const images = (await readdir(temp)).map(name=>[name,Number(pagePattern.exec(name)?.[1])]).filter(([,number])=>number);
    if (images.length !== pages) throw new Error("PDF preview omitted one or more pages.");
    let bytes = 0;
    for (const [name,page] of images) {
      if (page > pages) throw new Error("Unexpected preview page number.");
      bytes += (await stat(join(temp,name))).size;
      await rename(join(temp,name),join(temp,page+".jpg"));
    }
    if (!link.local) await unlink(pdf);
    const info = {pages,bytes};
    await writeFile(join(temp,"meta.json"),JSON.stringify(info));
    if (dirname(target) !== cache) throw new Error("Unexpected preview cache path.");
    await rm(target,{recursive:true,force:true});
    await rename(temp,target);
    return {directory:target,...info};
  } finally {
    await rm(temp,{recursive:true,force:true});
  }
}

await mkdir(cache,{recursive:true});
if (dirname(output) !== docs || basename(output) !== "previews") throw new Error("Unexpected preview output directory.");
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
const entries = Object.create(null);
const data = await readLibrary();
const errors = catalog.validate(data);
if (errors.length) throw new Error(errors.join("\n"));
let total = await bytesIn(docs,output);
for (const resource of data.resources) {
  try {
    const link = catalog.fileURL(resource.file);
    const key = await previewKey(resource,link.local);
    const result = await render(resource,link,key);
    if (total + result.bytes > pageBudget) throw new Error("Website preview size exceeds the publishing budget.");
    const directory = join(output,key);
    await cp(result.directory,directory,{recursive:true});
    total += result.bytes;
    entries[resource.id] = {key,pages:result.pages,file:resource.file,revision:resource.revision || ""};
    console.log("Preview ready:",resource.id,result.pages+" pages",result.bytes+" bytes");
  } catch (error) {
    console.warn("Preview unavailable:",resource.id,error.message.split(/\r?\n/)[0]);
  }
}
await writeFile(join(output,"index.json"),JSON.stringify(entries));
console.log("Online previews ready:",Object.keys(entries).length+"/"+data.resources.length,"published bytes:",total);
