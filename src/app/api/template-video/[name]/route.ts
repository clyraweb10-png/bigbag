import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

export const dynamic = "force-dynamic";

const LOCAL_VIDEOS_DIR = "E:\\New folder\\motionsites-prompt-collection\\assets\\videos";
const PUBLIC_VIDEOS_DIR = path.join(process.cwd(), "public", "templates", "videos");

function findVideoFile(name: string): string | null {
  // Disallow directory traversal
  if (!name || !/^[a-zA-Z0-9_\-]+$/.test(name)) return null;

  const candidates = [
    path.join(PUBLIC_VIDEOS_DIR, `${name}.mp4`),
    path.join(PUBLIC_VIDEOS_DIR, `${name}_0.mp4`),
    path.join(LOCAL_VIDEOS_DIR, `${name}_0.mp4`),
    path.join(LOCAL_VIDEOS_DIR, `${name}.mp4`),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const filePath = findVideoFile(name);

  if (!filePath) {
    return new NextResponse("Video not found", { status: 404 });
  }

  try {
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = request.headers.get("range");

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${fileSize}`,
          },
        });
      }

      const chunkSize = end - start + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });
      const webStream = Readable.toWeb(fileStream);

      return new NextResponse(webStream as unknown as BodyInit, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize.toString(),
          "Content-Type": "video/mp4",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    } else {
      const fileStream = fs.createReadStream(filePath);
      const webStream = Readable.toWeb(fileStream);

      return new NextResponse(webStream as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Length": fileSize.toString(),
          "Content-Type": "video/mp4",
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }
  } catch (err) {
    console.error(`[template-video] Error streaming ${name}:`, err);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
