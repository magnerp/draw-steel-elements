import {readFileSync, writeFileSync} from "fs";

// `npm version` runs this after bumping package.json: copy the new version into manifest.json
const targetVersion = process.env.npm_package_version;
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
