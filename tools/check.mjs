import { catalog, readLibrary, rebuildIndex } from "./library.mjs";

const data = process.argv.includes("--rebuild") ? await rebuildIndex() : await readLibrary();
const errors = catalog.validate(data);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("目录通过校验：" + data.courses.length + " 门课程，" + data.resources.length + " 份资料。");
}
