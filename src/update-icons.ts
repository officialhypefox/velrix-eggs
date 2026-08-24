import { promises as fs } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import * as path from "node:path";

interface IconConfig {
  url: string;
  name: string;
}

interface IconsConfig {
  [key: string]: IconConfig;
}

interface EggData {
  _comment?: string;
  meta?: {
    version: string;
    update_url: string;
  };
  exported_at?: string;
  name?: string;
  author?: string;
  uuid?: string;
  description?: string;
  image?: string;
  [key: string]: any;
}

const MIME_TYPES: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
};

async function fetchUrl(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;

    protocol
      .get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          const location = response.headers.location;
          if (!location || Array.isArray(location)) {
            return reject(
              new Error(`Redirect without location header for ${url}`)
            );
          }
          return resolve(fetchUrl(location));
        }

        if (response.statusCode !== 200) {
          return reject(
            new Error(`Failed to fetch ${url}: Status ${response.statusCode}`)
          );
        }

        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks)));
        response.on("error", reject);
      })
      .on("error", reject);
  });
}

function getMimeType(url: string, content: Buffer): string {
  const urlWithoutQuery = url.split("?")[0];
  const ext = path.extname(urlWithoutQuery || "").toLowerCase();

  if (MIME_TYPES[ext]) {
    return MIME_TYPES[ext];
  }

  const contentStr = content.toString("utf8", 0, Math.min(200, content.length));
  if (contentStr.includes("<svg") || contentStr.includes("<?xml")) {
    return "image/svg+xml";
  }

  if (
    content[0] === 0x89 &&
    content[1] === 0x50 &&
    content[2] === 0x4e &&
    content[3] === 0x47
  ) {
    return "image/png";
  }

  if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return "image/jpeg";
  }

  if (content.toString("utf8", 0, 3) === "GIF") {
    return "image/gif";
  }

  return "image/svg+xml";
}

function toBase64DataUri(imageBuffer: Buffer, mimeType: string): string {
  const base64 = imageBuffer.toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

async function updateEggFile(
  eggFilePath: string,
  imageDataUri: string
): Promise<void> {
  const content = await fs.readFile(eggFilePath, "utf8");
  const eggData: EggData = JSON.parse(content);

  const orderedEggData: any = {};

  for (const [key, value] of Object.entries(eggData)) {
    // Skip a pre-existing image: it is set explicitly right after
    // "description" below, and copying it here as well would run second and
    // overwrite the freshly-fetched data URI with the stale one already in
    // the file — which is exactly why re-running this on an egg that already
    // has an icon used to be a silent no-op.
    if (key === "image") continue;

    orderedEggData[key] = value;

    if (key === "description") {
      orderedEggData.image = imageDataUri;
    }
  }

  if (!eggData.description) {
    orderedEggData.image = imageDataUri;
  }

  await fs.writeFile(
    eggFilePath,
    JSON.stringify(orderedEggData, null, 4),
    "utf8"
  );
}

try {
  const iconsConfigPath = path.join(import.meta.dir, "icons.json");
  const iconsConfigContent = await fs.readFile(iconsConfigPath, "utf8");
  const iconsConfig: IconsConfig = JSON.parse(iconsConfigContent);

  console.log("🚀 Starting icon update process...\n");

  let successCount = 0;
  let failCount = 0;

  for (const [eggFile, config] of Object.entries(iconsConfig)) {
    const eggFilePath = path.join(import.meta.dir, "..", "eggs", eggFile);

    try {
      await fs.access(eggFilePath);

      console.log(`📦 Processing ${config.name} (${eggFile})...`);
      console.log(`   Fetching icon from: ${config.url}`);

      const imageBuffer = await fetchUrl(config.url);
      console.log(`   ✓ Downloaded ${imageBuffer.length} bytes`);

      const mimeType = getMimeType(config.url, imageBuffer);
      console.log(`   ✓ Detected MIME type: ${mimeType}`);

      const dataUri = toBase64DataUri(imageBuffer, mimeType);
      console.log(`   ✓ Converted to base64 (${dataUri.length} characters)`);

      await updateEggFile(eggFilePath, dataUri);
      console.log(`   ✅ Updated ${eggFile}\n`);

      successCount++;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`   ❌ Error processing ${eggFile}: ${errorMessage}\n`);
      failCount++;
    }
  }

  console.log("━".repeat(50));
  console.log(`\n✨ Process completed!`);
  console.log(`   Success: ${successCount}`);
  console.log(`   Failed: ${failCount}`);
  console.log(`   Total: ${successCount + failCount}\n`);

  if (failCount > 0) {
    process.exit(1);
  }
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error("❌ Fatal error:", errorMessage);
  process.exit(1);
}

export { fetchUrl, getMimeType, toBase64DataUri, updateEggFile };
