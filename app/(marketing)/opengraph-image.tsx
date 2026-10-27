import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

// Sharing image of the landing (DESIGN.md "Landing"): black ground, gradient heading, Geist.
export const alt = "Spontané : 20 candidatures spontanées en moins de 15 minutes.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const geistSemiBold = await readFile(join(process.cwd(), "assets/fonts/Geist-SemiBold.ttf"));
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        background: "#000000",
        color: "#ffffff",
        fontFamily: "Geist",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 40 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="40" height="40" viewBox="8 8 16 16">
            <rect
              x="9"
              y="10.5"
              width="14"
              height="11"
              rx="2"
              fill="none"
              stroke="#000000"
              strokeWidth="1.6"
            />
            <path
              d="m10 12 6 4.5 6-4.5"
              fill="none"
              stroke="#000000"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        Spontané
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          fontSize: 72,
          lineHeight: 1,
          letterSpacing: -2,
          backgroundImage: "linear-gradient(to right, #FFFFFF, #9B9B9B)",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        <span>20 candidatures spontanées</span>
        <span>en moins de 15 minutes.</span>
      </div>
      <div style={{ display: "flex", fontSize: 32, color: "#9B9B9B" }}>
        Ton alternance ou ton stage, en candidature spontanée.
      </div>
    </div>,
    { ...size, fonts: [{ name: "Geist", data: geistSemiBold, style: "normal", weight: 600 }] },
  );
}
