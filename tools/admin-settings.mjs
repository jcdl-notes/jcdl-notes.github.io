import { randomBytes, scryptSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const credentialPath = process.env.XINHUO_SETTINGS ||
  join(process.env.LOCALAPPDATA || homedir(), "XinhuoNotes", "admin.json");

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const username = process.env.XINHUO_ADMIN_USER?.trim();
  const password = process.env.XINHUO_ADMIN_PASSWORD;
  delete process.env.XINHUO_ADMIN_PASSWORD;
  if (!username || username.includes(":") || !password || password.length < 6) {
    throw new Error("请输入有效账号，密码至少 6 个字符。");
  }
  const salt = randomBytes(24).toString("hex");
  const passwordHash = scryptSync(password,salt,64).toString("hex");
  const gitBinary = process.env.XINHUO_GIT_BIN || "";
  await mkdir(dirname(credentialPath),{recursive:true});
  await writeFile(credentialPath,JSON.stringify({username,salt,passwordHash,gitBinary}),{mode:0o600,flag:"wx"});
  console.log("管理端登录已配置。");
}
