import { readFile, readdir, writeFile, rename, open, stat } from "node:fs/promises";
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
  await writeFile(temporary, catalog.serialize(data), "utf8");
  await rename(temporary, indexFile);
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

const isoDate = date => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(date);
async function listDirectory(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function rebuildIndex(data = null) {
  data ??= await readLibrary();
  assertValid(data);
  const previous = new Map(data.resources.map(item => [item.file, item]));
  const resources = [];
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
            id: "note-" + createHash("sha256").update(file).digest("hex").slice(0, 24),
            title: old?.title || item.name.slice(0, -4),
            course: course.id,
            edition: edition.id,
            kind: old?.kind || "其他复习资料",
            featured: bucket === "featured",
            credit: old?.credit || "",
            summary: old?.summary || "",
            topics: old?.topics || [],
            updated: day,
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

