import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function readJson(relativePath) {
  const absolutePath = join(projectRoot, relativePath);
  const contents = await readFile(absolutePath, "utf8");

  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`${relativePath} is not valid JSON: ${error.message}`);
  }
}

const [appPackage, appLock, desktopPackage, desktopLock] = await Promise.all([
  readJson("package.json"),
  readJson("package-lock.json"),
  readJson("desktop/package.json"),
  readJson("desktop/package-lock.json"),
]);

const expectedVersion = appPackage.version;
const versionSources = [
  ["package.json", expectedVersion],
  ["package-lock.json", appLock.version],
  ['package-lock.json packages[""]', appLock.packages?.[""]?.version],
  ["desktop/package.json", desktopPackage.version],
  ["desktop/package-lock.json", desktopLock.version],
  ['desktop/package-lock.json packages[""]', desktopLock.packages?.[""]?.version],
];

const errors = [];

if (typeof expectedVersion !== "string" || expectedVersion.length === 0) {
  errors.push("package.json must contain a non-empty string version");
} else {
  for (const [source, version] of versionSources) {
    if (version !== expectedVersion) {
      errors.push(`${source} has version ${JSON.stringify(version)}; expected ${expectedVersion}`);
    }
  }
}

const releaseNotePath = join(projectRoot, "docs", "releases", `${expectedVersion}.md`);

try {
  await access(releaseNotePath, constants.R_OK);
  const releaseNote = await stat(releaseNotePath);
  if (!releaseNote.isFile()) {
    errors.push(`${relative(projectRoot, releaseNotePath)} is not a file`);
  }
} catch {
  errors.push(`missing readable release note: ${relative(projectRoot, releaseNotePath)}`);
}

if (errors.length > 0) {
  console.error("Release metadata check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Release metadata OK: ${expectedVersion}`);
  console.log(`Release note: ${relative(projectRoot, releaseNotePath)}`);
}
