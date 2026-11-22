import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, copyFile, cp, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { catalog, docs, root, readLibrary, requirePDF } from "./library.mjs";

const run = promisify(execFile);
const environment = {...process.env, LC_ALL:"C"};
const cache = join(root,".preview-cache");
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

function imageSize(jpeg) {
  // Poppler emits ordinary baseline JPEGs; the SOF segment carries native dimensions.
  if (jpeg.length < 4 || jpeg.readUInt16BE(0) !== 0xffd8 || jpeg.readUInt16BE(jpeg.length-2) !== 0xffd9) return null;
  for (let offset=2; offset+1<jpeg.length && jpeg[offset]===0xff;) {
    while (jpeg[offset]===0xff) offset++;
    const marker = jpeg[offset++];
    if (offset+2>jpeg.length) break;
    const length = jpeg.readUInt16BE(offset);
    if (length<2 || offset+length>jpeg.length) break;
    if ([0xc0,0xc1,0xc2].includes(marker) && length>=7) {
      return [jpeg.readUInt16BE(offset+5),jpeg.readUInt16BE(offset+3)];
    }
    offset += length;
  }
  return null;
}

async function previewImages(directory,pages) {
  const sizes = [];
  let bytes = 0;
  for (let page = 1; page <= pages; page++) {
    const jpeg = await readFile(join(directory,page+".jpg"));
    const size = imageSize(jpeg);
    if (!size?.every(value=>value > 0)) return null;
    sizes.push(size);
    bytes += jpeg.length;
  }
  return {pages,bytes,sizes};
}

async function readPreview(directory) {
  try {
    const info = JSON.parse(await readFile(join(directory,"meta.json"),"utf8"));
    if (!Number.isSafeInteger(info?.pages) || info.pages < 1) return null;
    return await previewImages(directory,info.pages);
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
    for (const [name,page] of images) {
      if (page > pages) throw new Error("Unexpected preview page number.");
      await rename(join(temp,name),join(temp,page+".jpg"));
    }
    if (!link.local) await unlink(pdf);
    const info = await previewImages(temp,pages);
    if (!info) throw new Error("Preview JPEG dimensions are unavailable.");
    await writeFile(join(temp,"meta.json"),JSON.stringify({pages,bytes:info.bytes}));
    if (dirname(target) !== cache) throw new Error("Unexpected preview cache path.");
    await rm(target,{recursive:true,force:true});
    await rename(temp,target);
    return {directory:target,...info};
  } finally {
    await rm(temp,{recursive:true,force:true});
  }
}

const source = await readLibrary();
const errors = catalog.validate(source);
if (errors.length) throw new Error(errors.join("\n"));
const data = catalog.publicLibrary(source);
const publish = process.argv.includes("--publish");
let site = docs;
if (publish) {
  site = await mkdtemp(join(process.env.RUNNER_TEMP || root,".site-publish-"));
  const visibleFiles = new Set(data.resources.map(note=>note.file));
  const omitted = new Set([join(docs,"previews")]);
  for (const note of source.resources) {
    if (!visibleFiles.has(note.file) && catalog.fileURL(note.file).local) omitted.add(join(docs,note.file));
  }
  await cp(docs,site,{recursive:true,filter:path=>!omitted.has(path)});
  await writeFile(join(site,"data","library.js"),catalog.serialize(data));
}
const output = join(site,"previews");
if (dirname(output) !== site || basename(output) !== "previews") throw new Error("Unexpected preview output directory.");
let total = await bytesIn(site,output);
if (total > pageBudget) throw new Error("Website files exceed the Pages publishing budget before preview generation.");
await mkdir(cache,{recursive:true});
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
const entries = Object.create(null);
for (const resource of data.resources) {
  let key, result;
  try {
    const link = catalog.fileURL(resource.file);
    key = await previewKey(resource,link.local);
    result = await render(resource,link,key);
    if (total + result.bytes > pageBudget) throw new Error("Website preview size exceeds the publishing budget.");
  } catch (error) {
    console.warn("Preview unavailable:",resource.id,error.message.split(/\r?\n/)[0]);
    continue;
  }
  const directory = join(output,key);
  await mkdir(directory,{recursive:true});
  for (let page=1; page<=result.pages; page++) {
    const filename = page+".jpg";
    await copyFile(join(result.directory,filename),join(directory,filename));
  }
  total += result.bytes;
  entries[resource.id] = {key,pages:result.pages,file:resource.file,revision:resource.revision || "",sizes:result.sizes};
  console.log("Preview ready:",resource.id,result.pages+" pages",result.bytes+" bytes");
}
await writeFile(join(output,"index.json"),JSON.stringify(entries));
console.log("Online previews ready:",Object.keys(entries).length+"/"+data.resources.length,"published bytes:",total);
if (publish) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,"directory="+site+"\n");
  else console.log("Website artifact ready:",site);
}
