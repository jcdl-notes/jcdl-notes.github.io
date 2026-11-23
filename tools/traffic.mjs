import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { credentialPath } from "./admin-settings.mjs";

function fetchThroughProxy(url, key, proxy) {
  const curl = process.platform === "win32" ? join(process.env.SystemRoot || "C:\\Windows", "System32", "curl.exe") : "curl";
  return new Promise((resolve, reject) => {
    const child = spawn(curl, ["-q", "--silent", "--fail", "--max-time", "7", "--max-filesize", "1048576",
      "--proxy", proxy, "--header", "@-", url.href], {windowsHide:true, stdio:["pipe", "pipe", "ignore"]});
    let output = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { output += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(output) : reject(new Error("统计连接失败")));
    child.stdin.on("error", () => {});
    child.stdin.end(`Authorization: Bearer ${key}\n`);
  });
}

export async function trafficStats(proxy) {
  let configuration;
  try {
    configuration = JSON.parse(await readFile(join(dirname(credentialPath), "traffic.json"), "utf8"));
  } catch (error) {
    return {state: error.code === "ENOENT" ? "unconfigured" : "unavailable"};
  }

  try {
    const endpoint = new URL(configuration.origin);
    if (endpoint.protocol !== "https:" || endpoint.origin !== configuration.origin ||
        !/^[a-f0-9]{64}$/.test(configuration.key)) return {state: "unavailable"};
    const url = new URL("/stats", endpoint);
    let data;
    if (proxy) data = JSON.parse(await fetchThroughProxy(url, configuration.key, proxy));
    else {
      const result = await fetch(url, {
        headers: {Authorization: `Bearer ${configuration.key}`},
        redirect: "error", signal: AbortSignal.timeout(7000)
      });
      if (!result.ok) return {state: "unavailable"};
      data = await result.json();
    }
    const {today, total, downloads} = data;
    const numbers = [today?.views, today?.visitors, total?.views, total?.visitors];
    if (numbers.some(value => !Number.isSafeInteger(value) || value < 0)) return {state: "unavailable"};
    return {state: "ready", today, total, downloads};
  } catch {
    return {state: "unavailable"};
  }
}
