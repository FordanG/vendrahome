import "server-only";
import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import QRCode from "qrcode";

export const newRoomToken = () => randomBytes(12).toString("base64url");

/** The address a room's door code opens. Uses APP_URL when set, else the address this page was opened on. */
export async function roomScanUrl(token: string): Promise<string> {
  const base = process.env.APP_URL ?? (await requestOrigin());
  return new URL(`/r/${token}`, base).toString();
}

async function requestOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** The code as an SVG string, black on white so it scans from paper and screens alike. */
export function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#000000", light: "#ffffff" } });
}
