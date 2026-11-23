import { readFile, readdir, writeFile, rename, open, stat, mkdir, mkdtemp, copyFile, unlink, rmdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const docs = join(root, "docs");
export const files = join(docs, "files");
const indexFile = join(docs, "data", "library.js");
const context = { URL };
runInNewContext(await readFile(join(docs, "assets", "catalog.js"), "utf8"), context);
export const catalog = context.XinhuoCatalog;

export const readLibrary = async () => catalog.parse(await readFile(indexFile, "utf8"));
function assertValid(data) {
  const problems = catalog.validate(data);
  if (problems.length) throw new Error(problems.join("\n"));
}
export async function writeLibrary(data) {
  assertValid(data);
  const temporary = indexFile + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, catalog.serialize(data), "utf8");
    await rename(temporary, indexFile);
  } catch (error) {
    await unlink(temporary).catch(cleanup=>{ if (cleanup.code !== "ENOENT") console.error("清理临时目录文件失败：",cleanup.code); });
    throw error;
  }
}

export function requirePDF(bytes) {
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("仅接受有效的 PDF 文件。");
}

export function noteDirectory(data, edition, course, bucket) {
  if (!data.editions.some(item => item.id === edition) ||
      !data.courses.some(item => item.id === course) ||
      !["general", "featured"].includes(bucket)) throw new Error("请选择有效的届次和课程。");
  return join(files, edition, course, bucket);
}

export const isoDate = date => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(date);

export function notePath(data, note) {
  const bucket = note.featured ? "featured" : "general";
  const name = note.file.split("/").at(-1);
  if (!catalog.safeFilename(name) || note.file !== ["files",note.edition,note.course,bucket,name].join("/")) {
    throw new Error("找不到这份资料对应的 PDF。");
  }
  return join(noteDirectory(data,note.edition,note.course,bucket),name);
}

// Keep the old PDF outside the published tree until the new index has been written.
export async function updateNote(data, old, next, pdf) {
  const source = catalog.fileURL(old.file)?.local ? notePath(data,old) : null;
  const target = next && catalog.fileURL(next.file)?.local ? notePath(data,next) : null;
  const resources = data.resources.filter(item => item.id !== old.id);
  if (next) resources.push(next);
  const updatedData = {...data,resources};
  if (target === source && !pdf) {
    await writeLibrary(updatedData);
    return updatedData;
  }
  if (target) await mkdir(noteDirectory(data,next.edition,next.course,next.featured ? "featured" : "general"),{recursive:true});
  const backupDirectory = await mkdtemp(join(root,".note-change-"));
  const backup = join(backupDirectory,"original.pdf");
  let transferred = false;
  let targetWritten = false;
  try {
    if (source) {
      await rename(source,backup);
      transferred = true;
    }
    if (target) {
      if (pdf) {
        const handle = await open(target,"wx");
        targetWritten = true;
        try { await handle.writeFile(pdf); } finally { await handle.close(); }
      } else {
        await copyFile(backup,target,constants.COPYFILE_EXCL);
        targetWritten = true;
      }
    }
    await writeLibrary(updatedData);
  } catch (error) {
    if (targetWritten) await unlink(target).catch(cleanup=>console.error("清理未收录的 PDF 失败：",cleanup.code));
    try {
      if (transferred) await rename(backup,source);
      await rmdir(backupDirectory);
    } catch (rollback) {
      console.error("恢复 PDF 失败，备份目录：",backupDirectory,rollback.code);
    }
    if (error.code === "EEXIST") throw new Error("目标位置已有同名 PDF。");
    throw error;
  }
  try {
    if (transferred) await unlink(backup);
    await rmdir(backupDirectory);
  } catch (error) { console.error("无法清理本地 PDF 备份：",error.code); }
  return updatedData;
}
async function listDirectory(directory, recursive = false) {
  try {
    return await readdir(directory, { withFileTypes: true, recursive });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function courseHasPDFs(data, id) {
  for (const edition of data.editions) {
    for (const bucket of ["general", "featured"]) {
      const entries = await listDirectory(noteDirectory(data, edition.id, id, bucket), true);
      if (entries.some(entry => /\.pdf$/i.test(entry.name))) return true;
    }
  }
  return false;
}

export async function updateCourse(data, id, action, name, previousName) {
  assertValid(data);
  const course = data.courses.find(item => item.id === id);
  if (!course) {
    if (action === "delete") return data;
    throw new Error("课程已删除或不存在，请刷新管理页。");
  }

  if (action === "delete") {
    if (data.resources.some(note => note.course === id) || await courseHasPDFs(data, id)) {
      throw new Error("此课程仍有 PDF，请下架课程以保留资料。");
    }
    data.courses = data.courses.filter(item => item.id !== id);
  } else if (action === "archive") {
    if (course.archived === true) return data;
    course.archived = true;
  } else if (action === "restore") {
    if (!Object.hasOwn(course, "archived")) return data;
    delete course.archived;
  } else if (action === "rename") {
    if (!name) throw new Error("请填写课程名称。");
    if (course.name === name) return data;
    if (course.name !== previousName) throw new Error("课程名称已在其他页面修改，请刷新管理页后重试。");
    if (data.courses.some(item => item.id !== id && item.term === course.term && item.name === name)) {
      throw new Error("该学期已有同名课程。");
    }
    course.name = name;
  } else {
    throw new Error("无效的课程操作。");
  }

  await writeLibrary(data);
  return data;
}

export async function rebuildIndex(data = null) {
  data ??= await readLibrary();
  assertValid(data);
  const previous = new Map(data.resources.map(item => [item.file, item]));
  const resources = data.resources.filter(item => !catalog.fileURL(item.file).local);
  for (const edition of data.editions) {
    for (const course of data.courses) {
      for (const bucket of ["general", "featured"]) {
        const directory = noteDirectory(data, edition.id, course.id, bucket);
        for (const item of await listDirectory(directory)) {
          if (!/\.pdf$/i.test(item.name)) continue;
          if (!item.isFile() || !catalog.safeFilename(item.name)) throw new Error("PDF 文件名无法用于网站：" + item.name);
          const diskPath = join(directory, item.name);
          const fd = await open(diskPath, "r");
          try {
            const head = Buffer.alloc(5);
            const { bytesRead } = await fd.read(head, 0, 5, 0);
            requirePDF(head.subarray(0, bytesRead));
          } finally { await fd.close(); }
          const file = ["files", edition.id, course.id, bucket, item.name].join("/");
          const old = previous.get(file);
          const day = old?.updated || isoDate((await stat(diskPath)).mtime);
          resources.push({
            id: old?.id || "note-" + createHash("sha256").update(file).digest("hex").slice(0, 24),
            title: old?.title || item.name.slice(0, -4),
            course: course.id,
            edition: edition.id,
            kind: old?.kind || "其他复习资料",
            featured: bucket === "featured",
            credit: old?.credit || "",
            summary: old?.summary || "",
            topics: old?.topics || [],
            updated: day,
            ...(old?.revision ? {revision:old.revision} : {}),
            file
          });
        }
      }
    }
  }
  resources.sort((a, b) => a.file.localeCompare(b.file, "zh-CN"));
  const result = { ...data, resources };
  await writeLibrary(result);
  return result;
}

